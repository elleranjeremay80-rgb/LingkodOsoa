/* ===================================================
   LINGKOD Meneses - Public Document Library (Guest access). No session
   required: documents' select RLS is `to anon, authenticated using(true)`,
   and the "documents" Storage bucket's select policy has no `to` clause
   at all (every role, anon included) - see 20260727020000_documents_
   module_rework.sql. Only ever ARCHIVED documents are excluded here
   (hardcoded, no toggle - guests get the same "public" view every time).

   Deliberately self-contained rather than reusing js/common.js's
   lingkodToast/lingkodOpenModal/lingkodGetSignedFileUrl/etc. - that
   file's DOMContentLoaded handler redirects any session-less visitor
   straight to Login, which is exactly the gate this page must NOT have.
   =================================================== */

const DOCUMENTS_BUCKET = "documents";

// Shared with documents/script.js's identical map - see
// js/document-categories.js. Still a separate load from js/common.js -
// see this file's header comment for why.
const DOCUMENT_CATEGORY_LABELS = LINGKOD_DOCUMENT_CATEGORY_LABELS;

const doclibSearch = document.getElementById("doclibSearch");
const doclibCategoryFilter = document.getElementById("doclibCategoryFilter");
const doclibTableBody = document.getElementById("doclibTableBody");
const doclibTableWrap = document.querySelector(".doclib-table-wrap");
const doclibEmpty = document.getElementById("doclibEmpty");
const doclibEmptyMessage = document.getElementById("doclibEmptyMessage");

let allDocuments = [];
let organizationNames = {};

/* ================= FORMATTING ================= */

function formatDate(isoString){
    return new Date(isoString).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
}

function formatFileSize(bytes){
    if(bytes === null || bytes === undefined) return "";
    if(bytes < 1024) return bytes + " B";
    if(bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
    return (bytes / (1024 * 1024)).toFixed(1) + " MB";
}

function organizationLabel(row){
    return (row.organization_id && organizationNames[row.organization_id]) || "—";
}

function categoryDisplay(row){
    if(row.category === "other") return row.custom_document_type || "Others";
    return DOCUMENT_CATEGORY_LABELS[row.category] || row.category;
}

/* ================= TOAST (mirrors js/common.js's lingkodToast) ================= */

function doclibToast(message, type){
    let container = document.getElementById("doclibToastContainer");
    if(!container){
        container = document.createElement("div");
        container.id = "doclibToastContainer";
        container.className = "toast-container";
        document.body.appendChild(container);
    }

    const toast = document.createElement("div");
    toast.className = "toast " + (type || "success");

    const icon = document.createElement("i");
    icon.className = type === "error" ? "fa-solid fa-circle-exclamation" : "fa-solid fa-circle-check";
    toast.appendChild(icon);

    toast.appendChild(document.createTextNode(message));
    container.appendChild(toast);

    setTimeout(function(){
        toast.classList.add("leaving");
        setTimeout(function(){ toast.remove(); }, 200);
    }, 4000);
}

/* ================= MODAL (mirrors js/common.js's lingkodOpenModal) ================= */

function doclibCloseModal(){
    const overlay = document.getElementById("doclibModalOverlay");
    if(overlay) overlay.classList.remove("open");
    document.body.style.overflow = "";
}

function doclibOpenModal(titleText, contentNode){
    let overlay = document.getElementById("doclibModalOverlay");

    if(!overlay){
        overlay = document.createElement("div");
        overlay.id = "doclibModalOverlay";
        overlay.className = "modal-overlay";

        const modal = document.createElement("div");
        modal.className = "modal modal-wide";

        const header = document.createElement("div");
        header.className = "modal-header";

        const title = document.createElement("h3");
        title.id = "doclibModalTitle";
        header.appendChild(title);

        const closeBtn = document.createElement("button");
        closeBtn.type = "button";
        closeBtn.className = "modal-close";
        closeBtn.setAttribute("aria-label", "Close");
        closeBtn.innerHTML = "<i class=\"fa-solid fa-xmark\"></i>";
        closeBtn.addEventListener("click", doclibCloseModal);
        header.appendChild(closeBtn);

        modal.appendChild(header);

        const body = document.createElement("div");
        body.className = "modal-body";
        body.id = "doclibModalBody";
        modal.appendChild(body);

        overlay.appendChild(modal);
        document.body.appendChild(overlay);

        overlay.addEventListener("click", function(e){
            if(e.target === overlay) doclibCloseModal();
        });

        document.addEventListener("keydown", function(e){
            if(e.key === "Escape") doclibCloseModal();
        });
    }

    document.getElementById("doclibModalTitle").textContent = titleText;
    const body = document.getElementById("doclibModalBody");
    body.innerHTML = "";
    body.appendChild(contentNode);

    overlay.classList.add("open");
    document.body.style.overflow = "hidden";
}

/* ================= SIGNED URLS + PREVIEW =================
   Only pdf/jpg/jpeg/png are ever previewable in-browser without a third-
   party embed service (which this app doesn't have) - doc/docx/xls/xlsx/
   ppt/pptx (the other allowed upload types) always fall through to the
   "not available" message, same as the authenticated Documents page's
   own lingkodGuessFilePreviewKind()/lingkodLoadFilePreview(). */

async function getSignedUrl(row, forDownload){
    if(!row.file_path) return row.file_url || null;

    const { data, error } = await supabaseClient.storage
        .from(row.storage_bucket || DOCUMENTS_BUCKET)
        .createSignedUrl(row.file_path, forDownload ? 60 : 3600, forDownload ? { download: row.file_name || true } : undefined);

    if(error){
        console.error("[document-library] signed URL generation failed:", error);
        return null;
    }

    return data.signedUrl;
}

function previewKind(row){
    const type = (row.file_type || "").toLowerCase();
    const name = (row.file_name || "").toLowerCase();
    if(type === "application/pdf" || name.endsWith(".pdf")) return "pdf";
    if(type.startsWith("image/") || /\.(jpe?g|png)$/.test(name)) return "image";
    return "unsupported";
}

async function openPreviewModal(row){
    const wrap = document.createElement("div");
    wrap.className = "doclib-preview-panel";
    wrap.innerHTML = "<p class=\"preview-unavailable\"><i class=\"fa-solid fa-spinner fa-spin\"></i><br>Loading preview...</p>";

    doclibOpenModal(row.title, wrap);

    const kind = previewKind(row);

    if(kind === "unsupported"){
        wrap.innerHTML = "";
        const msg = document.createElement("p");
        msg.className = "preview-unavailable";
        msg.innerHTML = "<i class=\"fa-solid fa-triangle-exclamation\"></i><br>Preview is not available for this file type. Use Download instead.";
        wrap.appendChild(msg);
        return;
    }

    const url = await getSignedUrl(row, false);

    if(!url){
        wrap.innerHTML = "";
        const msg = document.createElement("p");
        msg.className = "preview-unavailable";
        msg.innerHTML = "<i class=\"fa-solid fa-circle-exclamation\"></i><br>The document could not be located.";
        wrap.appendChild(msg);
        return;
    }

    wrap.innerHTML = "";

    if(kind === "image"){
        const img = document.createElement("img");
        img.src = url;
        img.alt = row.title;
        wrap.appendChild(img);
    } else {
        const iframe = document.createElement("iframe");
        iframe.src = url;
        iframe.title = "Document preview";
        wrap.appendChild(iframe);
    }
}

async function downloadDocument(row, triggerBtn){
    const originalLabel = triggerBtn.innerHTML;
    triggerBtn.disabled = true;
    triggerBtn.innerHTML = "<i class=\"fa-solid fa-spinner fa-spin\"></i> Preparing...";

    const url = await getSignedUrl(row, true);

    triggerBtn.disabled = false;
    triggerBtn.innerHTML = originalLabel;

    if(!url){
        doclibToast("The document could not be located.", "error");
        return;
    }

    window.open(url, "_blank");
}

/* ================= TABLE ================= */

function buildRow(row){
    const tr = document.createElement("tr");

    const titleTd = document.createElement("td");
    titleTd.textContent = row.title;
    tr.appendChild(titleTd);

    const categoryTd = document.createElement("td");
    categoryTd.textContent = categoryDisplay(row);
    tr.appendChild(categoryTd);

    const uploaderTd = document.createElement("td");
    uploaderTd.textContent = row.uploaded_by_name || "Unknown";
    tr.appendChild(uploaderTd);

    const orgTd = document.createElement("td");
    orgTd.textContent = organizationLabel(row);
    tr.appendChild(orgTd);

    const dateTd = document.createElement("td");
    dateTd.textContent = formatDate(row.created_at);
    tr.appendChild(dateTd);

    const sizeTd = document.createElement("td");
    sizeTd.textContent = formatFileSize(row.file_size);
    tr.appendChild(sizeTd);

    const previewTd = document.createElement("td");
    const previewBtn = document.createElement("button");
    previewBtn.type = "button";
    previewBtn.className = "file-action-btn";
    previewBtn.innerHTML = "<i class=\"fa-solid fa-eye\"></i> Preview";
    previewBtn.addEventListener("click", function(){ openPreviewModal(row); });
    previewTd.appendChild(previewBtn);
    tr.appendChild(previewTd);

    const downloadTd = document.createElement("td");
    const downloadBtn = document.createElement("button");
    downloadBtn.type = "button";
    downloadBtn.className = "file-action-btn";
    downloadBtn.innerHTML = "<i class=\"fa-solid fa-download\"></i> Download";
    downloadBtn.addEventListener("click", function(){ downloadDocument(row, downloadBtn); });
    downloadTd.appendChild(downloadBtn);
    tr.appendChild(downloadTd);

    return tr;
}

function getFilteredDocuments(){
    const query = doclibSearch.value.trim().toLowerCase();
    const category = doclibCategoryFilter.value;

    return allDocuments.filter(function(row){
        if(category && row.category !== category) return false;
        if(!query) return true;

        const haystack = [
            row.title,
            row.document_number,
            categoryDisplay(row),
            organizationLabel(row),
            row.uploaded_by_name
        ].filter(Boolean).join(" ").toLowerCase();

        return haystack.includes(query);
    });
}

function renderTable(){
    const filtered = getFilteredDocuments();

    doclibTableBody.innerHTML = "";

    if(filtered.length === 0){
        doclibTableWrap.classList.add("hidden");
        doclibEmpty.classList.remove("hidden");
        doclibEmptyMessage.textContent = allDocuments.length === 0
            ? "No documents uploaded yet."
            : "No documents match your search or filter.";
        return;
    }

    doclibTableWrap.classList.remove("hidden");
    doclibEmpty.classList.add("hidden");

    filtered.forEach(function(row){
        doclibTableBody.appendChild(buildRow(row));
    });
}

[doclibSearch, doclibCategoryFilter].forEach(function(el){
    el.addEventListener(el.tagName === "SELECT" ? "change" : "input", renderTable);
});

/* ================= LOAD ================= */

async function loadDocuments(){
    const [documentsResult, orgsResult] = await Promise.all([
        supabaseClient
            .from("documents")
            .select("id, document_number, title, category, custom_document_type, organization_id, status, file_name, file_url, file_path, file_size, file_type, storage_bucket, uploaded_by_name, created_at")
            .eq("status", "active")
            .order("created_at", { ascending: false }),
        supabaseClient.from("organizations").select("id, name")
    ]);

    if(documentsResult.error){
        console.error("[document-library] load failed:", documentsResult.error);
        doclibToast("Couldn't load documents: " + documentsResult.error.message, "error");
        return;
    }

    allDocuments = documentsResult.data || [];

    organizationNames = {};
    (orgsResult.data || []).forEach(function(org){ organizationNames[org.id] = org.name; });

    renderTable();
}

document.addEventListener("DOMContentLoaded", loadDocuments);

supabaseClient
    .channel("document_library_page_changes")
    .on("postgres_changes", { event: "*", schema: "public", table: "documents" }, function(){
        loadDocuments();
    })
    .subscribe();
