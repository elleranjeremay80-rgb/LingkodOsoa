/* ===================================================
   LINGKOD Meneses - Documents
   A distinct module from Digital Repository: its own table
   (documents) and public Storage bucket ("documents"), with a
   genuinely org-scoped permission model (osoa_eb: everything;
   org_president: everything under their own organization_id;
   student: only what they personally uploaded, within their own
   organization_id) - see the documents-module-rework migration
   for the exact RLS this mirrors client-side.
   =================================================== */

const DOCUMENTS_BUCKET = "documents";
const MAX_DOCUMENT_SIZE_BYTES = 20 * 1024 * 1024;

// Matches the storage bucket's allowed_mime_types + the check on the
// file's own extension (belt-and-suspenders - a mislabeled MIME type
// from the OS shouldn't be the only thing standing between a rejected
// file and a confusing Storage-level error).
const ALLOWED_DOCUMENT_EXTENSIONS = ["pdf", "doc", "docx", "xls", "xlsx", "ppt", "pptx", "jpg", "jpeg", "png"];

// Shared with document-library/script.js's identical map - see
// js/document-categories.js.
const DOCUMENT_CATEGORY_LABELS = LINGKOD_DOCUMENT_CATEGORY_LABELS;

const documentsSearch = document.getElementById("documentsSearch");
const documentsCategoryFilter = document.getElementById("documentsCategoryFilter");
const documentsShowArchived = document.getElementById("documentsShowArchived");
const documentsPageSize = document.getElementById("documentsPageSize");
const documentsPagination = document.getElementById("documentsPagination");
const documentsTableBody = document.getElementById("documentsTableBody");
const documentUploadForm = document.getElementById("documentUploadForm");
const documentSubmitBtn = document.getElementById("documentSubmitBtn");
const documentSpecifyTypeWrap = document.getElementById("documentSpecifyTypeWrap");
const documentSpecifyTypeError = document.getElementById("documentSpecifyTypeError");

let viewerProfile = null;
let allDocuments = [];
let uploaderNames = {};
let organizationNames = {};
let currentPage = 1;

/* ================= PERMISSIONS =================
   Mirrors current_user_can_manage_document() from the rework migration:
   osoa_eb can manage any row; org_president any row in their own
   organization; everyone else (students included) only rows they
   personally uploaded. */
function canManageDocument(row){
    if(!viewerProfile) return false;
    if(viewerProfile.role === "osoa_eb") return true;
    if(viewerProfile.role === "org_president"){
        return !!viewerProfile.organization_id && viewerProfile.organization_id === row.organization_id;
    }
    return row.uploaded_by === viewerProfile.id;
}

function organizationLabel(row){
    return (row.organization_id && organizationNames[row.organization_id]) || "—";
}

// Others' whole point is that the fixed category list didn't have a good
// fit - showing the raw "Others" label back to the viewer would be less
// useful than the specific type the uploader actually typed in.
function categoryDisplay(row){
    if(row.category === "other") return row.custom_document_type || "Others";
    return DOCUMENT_CATEGORY_LABELS[row.category] || row.category;
}

/* ================= CONDITIONAL "SPECIFY DOCUMENT TYPE" =================
   Shared between the Upload form and the Edit modal - both have a
   Category <select> and their own matching wrap/input/error trio, so this
   just needs those four elements passed in rather than being hardcoded to
   one form. Toggling .visible (not the DOM presence) is what drives the
   CSS fade/slide in documents/style.css. */

function wireSpecifyTypeToggle(categorySelect, wrapEl, inputEl, errorEl){
    function sync(){
        const isOther = categorySelect.value === "other";
        wrapEl.classList.toggle("visible", isOther);
        inputEl.required = isOther;
        if(!isOther){
            inputEl.value = "";
            inputEl.classList.remove("invalid");
            errorEl.textContent = "";
            errorEl.classList.remove("visible");
        }
    }

    categorySelect.addEventListener("change", sync);
    sync();
}

/* ================= CELLS ================= */

function buildStatusBadge(status){
    const span = document.createElement("span");
    span.className = "status-badge " + (status || "active");
    span.textContent = status === "archived" ? "Archived" : "Active";
    return span;
}

function buildPreviewCell(row){
    const td = document.createElement("td");
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "file-action-btn";
    btn.innerHTML = "<i class=\"fa-solid fa-eye\"></i> Preview";
    btn.addEventListener("click", function(){
        lingkodOpenSimpleFilePreview(Object.assign({ document_title: row.title }, row));
    });
    td.appendChild(btn);
    return td;
}

function buildDownloadCell(row){
    const td = document.createElement("td");
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "file-action-btn";
    btn.innerHTML = "<i class=\"fa-solid fa-download\"></i> Download";
    btn.addEventListener("click", function(){ lingkodDownloadFile(row, btn); });
    td.appendChild(btn);
    return td;
}

function buildActionsCell(row){
    const td = document.createElement("td");
    td.className = "action";

    const wrap = document.createElement("span");
    wrap.className = "admin-actions";

    const view = document.createElement("a");
    view.href = "#";
    view.className = "view";
    view.textContent = "View";
    view.addEventListener("click", function(e){
        e.preventDefault();
        openViewDetailsModal(row);
    });
    wrap.appendChild(view);

    if(canManageDocument(row)){
        const edit = document.createElement("a");
        edit.href = "#";
        edit.className = "edit";
        edit.textContent = "Edit";
        edit.addEventListener("click", function(e){
            e.preventDefault();
            openEditModal(row);
        });
        wrap.appendChild(edit);

        const archive = document.createElement("a");
        archive.href = "#";
        archive.className = "archive";
        archive.textContent = row.status === "archived" ? "Unarchive" : "Archive";
        archive.addEventListener("click", function(e){
            e.preventDefault();
            toggleArchive(row);
        });
        wrap.appendChild(archive);

        const del = document.createElement("a");
        del.href = "#";
        del.className = "delete";
        del.textContent = "Delete";
        del.addEventListener("click", function(e){
            e.preventDefault();
            deleteDocument(row);
        });
        wrap.appendChild(del);
    }

    td.appendChild(wrap);
    return td;
}

/* ================= VIEW DETAILS ================= */

function buildDetailRow(label, value){
    const row = document.createElement("div");
    row.className = "member-view-row";
    const dt = document.createElement("span");
    dt.className = "member-view-label";
    dt.textContent = label;
    const dd = document.createElement("span");
    dd.className = "member-view-value";
    dd.textContent = value || "Not set";
    row.appendChild(dt);
    row.appendChild(dd);
    return row;
}

function openViewDetailsModal(row){
    const wrap = document.createElement("div");
    wrap.className = "member-view-grid";
    wrap.appendChild(buildDetailRow("Document Number", row.document_number));
    wrap.appendChild(buildDetailRow("Title", row.title));
    wrap.appendChild(buildDetailRow("Category", categoryDisplay(row)));
    wrap.appendChild(buildDetailRow("Organization", organizationLabel(row)));
    wrap.appendChild(buildDetailRow("Uploaded By", uploaderNames[row.uploaded_by] || "Unknown"));
    wrap.appendChild(buildDetailRow("Upload Date", lingkodFormatDate(row.created_at)));
    wrap.appendChild(buildDetailRow("File Name", row.file_name));
    wrap.appendChild(buildDetailRow("File Size", lingkodFormatFileSize(row.file_size)));
    wrap.appendChild(buildDetailRow("File Type", row.file_type));
    wrap.appendChild(buildDetailRow("Status", row.status === "archived" ? "Archived" : "Active"));

    lingkodOpenModal("Document Details — " + row.title, wrap);
}

/* ================= RENDER ================= */

function renderDocuments(rows){
    documentsTableBody.innerHTML = "";

    if(rows.length === 0){
        documentsTableBody.appendChild(lingkodCreateEmptyRow(
            allDocuments.length === 0 ? "No documents uploaded yet." : "No documents match your search or filters.",
            10
        ));
        return;
    }

    rows.forEach(function(row){
        const tr = document.createElement("tr");
        tr.appendChild(lingkodCreateCell(row.title));
        tr.appendChild(lingkodCreateCell(categoryDisplay(row)));
        tr.appendChild(lingkodCreateCell(uploaderNames[row.uploaded_by] || "Unknown"));
        tr.appendChild(lingkodCreateCell(organizationLabel(row)));
        tr.appendChild(lingkodCreateCell(lingkodFormatDate(row.created_at)));
        tr.appendChild(lingkodCreateCell(lingkodFormatFileSize(row.file_size)));
        const statusTd = document.createElement("td");
        statusTd.appendChild(buildStatusBadge(row.status));
        tr.appendChild(statusTd);
        tr.appendChild(buildPreviewCell(row));
        tr.appendChild(buildDownloadCell(row));
        tr.appendChild(buildActionsCell(row));
        documentsTableBody.appendChild(tr);
    });
}

function getFilteredDocuments(){
    const query = documentsSearch.value.trim().toLowerCase();
    const category = documentsCategoryFilter.value;
    const showArchived = documentsShowArchived.checked;

    return allDocuments.filter(function(row){
        if(!showArchived && row.status === "archived") return false;
        if(category && row.category !== category) return false;
        if(!query) return true;

        const haystack = [
            row.title,
            row.document_number,
            categoryDisplay(row),
            organizationLabel(row),
            uploaderNames[row.uploaded_by]
        ].filter(Boolean).join(" ").toLowerCase();

        return haystack.includes(query);
    });
}

function renderDocumentsPage(){
    const filtered = getFilteredDocuments();
    const pageSize = Number(documentsPageSize.value);
    const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
    if(currentPage > totalPages) currentPage = totalPages;

    const start = (currentPage - 1) * pageSize;
    renderDocuments(filtered.slice(start, start + pageSize));

    lingkodRenderPagination(documentsPagination, currentPage, totalPages, function(page){
        currentPage = page;
        renderDocumentsPage();
    });
}

function applyFilters(){
    currentPage = 1;
    renderDocumentsPage();
}

documentsSearch.addEventListener("input", applyFilters);
documentsCategoryFilter.addEventListener("change", applyFilters);
documentsShowArchived.addEventListener("change", applyFilters);
documentsPageSize.addEventListener("change", applyFilters);

/* ================= LOAD ================= */

async function loadDocuments(){
    const [documentsResult, orgsResult] = await Promise.all([
        supabaseClient
            .from("documents")
            .select("id, document_number, title, category, custom_document_type, organization_id, status, file_name, file_url, file_path, file_size, file_type, storage_bucket, uploaded_by, created_at")
            .order("created_at", { ascending: false }),
        supabaseClient.from("organizations").select("id, name")
    ]);

    if(documentsResult.error){
        console.error("[documents] load failed:", documentsResult.error);
        documentsTableBody.innerHTML = "";
        documentsTableBody.appendChild(lingkodCreateEmptyRow("Couldn't load documents (" + documentsResult.error.message + ").", 10));
        documentsPagination.innerHTML = "";
        return;
    }

    allDocuments = documentsResult.data;

    organizationNames = {};
    (orgsResult.data || []).forEach(function(org){ organizationNames[org.id] = org.name; });

    uploaderNames = {};
    const profilesById = await lingkodFetchProfilesById(allDocuments.map(function(row){ return row.uploaded_by; }));
    Object.keys(profilesById).forEach(function(id){ uploaderNames[id] = profilesById[id].full_name; });

    applyFilters();
}

/* ================= UPLOAD ================= */

function sanitizeFileName(name){
    return name.replace(/[^a-zA-Z0-9._-]/g, "_");
}

function fileExtension(name){
    const parts = name.split(".");
    return parts.length > 1 ? parts.pop().toLowerCase() : "";
}

async function setupUploadOrgLock(){
    if(!documentUploadForm) return;

    viewerProfile = await lingkodGetAuthedProfile();
    if(!viewerProfile) return;

    const orgSelect = documentUploadForm.elements.organization_id;
    await lingkodPopulateOrganizationSelectById(orgSelect, viewerProfile.organization_id);

    if(viewerProfile.role !== "osoa_eb" && viewerProfile.organization_id){
        orgSelect.disabled = true;
    }
}

if(documentUploadForm){
    wireSpecifyTypeToggle(
        documentUploadForm.elements.category,
        documentSpecifyTypeWrap,
        documentUploadForm.elements.custom_document_type,
        documentSpecifyTypeError
    );

    documentUploadForm.addEventListener("submit", async function(e){
        e.preventDefault();

        const title = documentUploadForm.elements.title.value.trim();
        const category = documentUploadForm.elements.category.value;
        const customDocumentType = documentUploadForm.elements.custom_document_type.value.trim();
        const organizationId = documentUploadForm.elements.organization_id.value;
        const file = documentUploadForm.elements.file.files[0];

        if(!title){
            lingkodToast("Please enter a document title.", "error");
            return;
        }
        if(!category){
            lingkodToast("Please select a category.", "error");
            return;
        }
        if(category === "other" && !customDocumentType){
            const input = documentUploadForm.elements.custom_document_type;
            input.classList.add("invalid");
            documentSpecifyTypeError.textContent = "Please specify the document type.";
            documentSpecifyTypeError.classList.add("visible");
            lingkodToast("Please specify the document type.", "error");
            return;
        }
        if(!organizationId){
            lingkodToast("Please select an organization.", "error");
            return;
        }
        if(!file){
            lingkodToast("Please choose a file to upload.", "error");
            return;
        }

        const extension = fileExtension(file.name);
        if(!ALLOWED_DOCUMENT_EXTENSIONS.includes(extension)){
            lingkodToast("That file type isn't supported. Allowed types: PDF, DOC, DOCX, XLS, XLSX, PPT, PPTX, JPG, JPEG, PNG.", "error");
            return;
        }
        if(file.size > MAX_DOCUMENT_SIZE_BYTES){
            lingkodToast("That file is larger than 20 MB.", "error");
            return;
        }

        if(!viewerProfile){
            lingkodToast("Please log in with a registered account to upload documents.", "error");
            return;
        }

        // Client-side heads-up only (not a hard DB constraint - two
        // legitimately different files can share a generic title like
        // "Minutes.pdf" from different years/categories, so this warns
        // rather than silently blocking).
        const isDuplicate = allDocuments.some(function(row){
            return row.title.toLowerCase() === title.toLowerCase() && row.file_name === file.name;
        });
        if(isDuplicate && !confirm("A document titled \"" + title + "\" with the same file name already exists. Upload anyway?")){
            return;
        }

        lingkodSetButtonLoading(documentSubmitBtn, true, "Uploading...");

        try {
            const path = category + "/" + crypto.randomUUID() + "-" + sanitizeFileName(file.name);

            const { error: uploadError } = await supabaseClient.storage
                .from(DOCUMENTS_BUCKET)
                .upload(path, file, { contentType: file.type || "application/octet-stream" });

            if(uploadError){
                console.error("[documents] file upload failed:", uploadError);
                lingkodToast("File upload failed: " + uploadError.message, "error");
                return;
            }

            const { data: urlData } = supabaseClient.storage.from(DOCUMENTS_BUCKET).getPublicUrl(path);

            const { error: insertError } = await supabaseClient
                .from("documents")
                .insert({
                    title: title,
                    category: category,
                    custom_document_type: category === "other" ? customDocumentType : null,
                    organization_id: organizationId,
                    status: "active",
                    file_name: file.name,
                    file_url: urlData.publicUrl,
                    file_path: path,
                    file_size: file.size,
                    file_type: file.type,
                    storage_bucket: DOCUMENTS_BUCKET,
                    uploaded_by: viewerProfile.id
                });

            if(insertError){
                console.error("[documents] metadata insert failed:", insertError);
                supabaseClient.storage.from(DOCUMENTS_BUCKET).remove([path]).catch(function(){});
                lingkodToast("The file was uploaded, but saving its details failed: " + insertError.message, "error");
                return;
            }

            lingkodToast("Document uploaded successfully.", "success");
            documentUploadForm.reset();
            documentUploadForm.elements.category.dispatchEvent(new Event("change"));
            await setupUploadOrgLock();
            await loadDocuments();
        } finally {
            lingkodSetButtonLoading(documentSubmitBtn, false);
        }
    });
}

/* ================= EDIT ================= */

function openEditModal(row){
    const form = document.createElement("form");
    form.className = "edit-profile-form";

    const titleInput = document.createElement("input");
    titleInput.type = "text";
    titleInput.value = row.title;
    form.appendChild(lingkodBuildFormField("Document Title", titleInput));

    const categorySelect = document.createElement("select");
    Object.keys(DOCUMENT_CATEGORY_LABELS).forEach(function(value){
        const opt = document.createElement("option");
        opt.value = value;
        opt.textContent = DOCUMENT_CATEGORY_LABELS[value];
        if(row.category === value) opt.selected = true;
        categorySelect.appendChild(opt);
    });
    form.appendChild(lingkodBuildFormField("Category", categorySelect));

    const specifyTypeWrap = document.createElement("div");
    specifyTypeWrap.className = "conditional-field";
    const specifyTypeInput = document.createElement("input");
    specifyTypeInput.type = "text";
    specifyTypeInput.name = "custom_document_type";
    specifyTypeInput.placeholder = "Enter the document type...";
    specifyTypeInput.value = row.custom_document_type || "";
    const specifyTypeError = document.createElement("small");
    specifyTypeError.className = "field-error";
    specifyTypeWrap.appendChild(lingkodBuildFormField("Specify Document Type", specifyTypeInput));
    specifyTypeWrap.appendChild(specifyTypeError);
    form.appendChild(specifyTypeWrap);
    wireSpecifyTypeToggle(categorySelect, specifyTypeWrap, specifyTypeInput, specifyTypeError);

    const orgSelect = document.createElement("select");
    form.appendChild(lingkodBuildFormField("Organization", orgSelect));
    lingkodPopulateOrganizationSelectById(orgSelect, row.organization_id);
    if(viewerProfile.role !== "osoa_eb") orgSelect.disabled = true;

    const statusSelect = document.createElement("select");
    ["active", "archived"].forEach(function(value){
        const opt = document.createElement("option");
        opt.value = value;
        opt.textContent = value === "archived" ? "Archived" : "Active";
        if(row.status === value) opt.selected = true;
        statusSelect.appendChild(opt);
    });
    form.appendChild(lingkodBuildFormField("Status", statusSelect));

    const saveBtn = document.createElement("button");
    saveBtn.type = "submit";
    saveBtn.textContent = "Save Changes";
    form.appendChild(saveBtn);

    form.addEventListener("submit", async function(e){
        e.preventDefault();

        const newTitle = titleInput.value.trim();
        const newCustomType = specifyTypeInput.value.trim();

        if(!newTitle){
            lingkodToast("Document title is required.", "error");
            return;
        }
        if(categorySelect.value === "other" && !newCustomType){
            specifyTypeInput.classList.add("invalid");
            specifyTypeError.textContent = "Please specify the document type.";
            specifyTypeError.classList.add("visible");
            lingkodToast("Please specify the document type.", "error");
            return;
        }
        if(!orgSelect.value){
            lingkodToast("Please select an organization.", "error");
            return;
        }

        lingkodSetButtonLoading(saveBtn, true, "Saving...");

        const { error } = await supabaseClient
            .from("documents")
            .update({
                title: newTitle,
                category: categorySelect.value,
                custom_document_type: categorySelect.value === "other" ? newCustomType : null,
                organization_id: orgSelect.value,
                status: statusSelect.value
            })
            .eq("id", row.id);

        lingkodSetButtonLoading(saveBtn, false);

        if(error){
            console.error("[documents] update failed:", error);
            lingkodToast("Couldn't update this document: " + error.message, "error");
            return;
        }

        lingkodCloseModal();
        lingkodToast("Document updated successfully.", "success");
        await loadDocuments();
    });

    lingkodOpenModal("Edit Document", form);
}

/* ================= ARCHIVE ================= */

async function toggleArchive(row){
    const archiving = row.status !== "archived";
    const verb = archiving ? "archive" : "unarchive";
    if(!confirm("Are you sure you want to " + verb + " \"" + row.title + "\"?")) return;

    const { error } = await supabaseClient
        .from("documents")
        .update({ status: archiving ? "archived" : "active" })
        .eq("id", row.id);

    if(error){
        console.error("[documents] " + verb + " failed:", error);
        lingkodToast("Couldn't " + verb + " this document: " + error.message, "error");
        return;
    }

    lingkodToast("Document " + (archiving ? "archived" : "unarchived") + " successfully.", "success");
    await loadDocuments();
}

/* ================= DELETE ================= */

async function deleteDocument(row){
    if(!confirm("Are you sure you want to delete this document?\n\n\"" + row.title + "\"\n\nThis cannot be undone.")) return;

    const { error } = await supabaseClient.from("documents").delete().eq("id", row.id);

    if(error){
        console.error("[documents] delete failed:", error);
        lingkodToast("Couldn't delete this document: " + error.message, "error");
        return;
    }

    const path = row.file_path || extractStoragePath(row.file_url, row.storage_bucket || DOCUMENTS_BUCKET);
    if(path){
        supabaseClient.storage.from(row.storage_bucket || DOCUMENTS_BUCKET).remove([path])
            .catch(function(err){ console.error("[documents] storage cleanup failed:", err); });
    }

    lingkodToast("Document deleted successfully.", "success");
    await loadDocuments();
}

// Legacy fallback only - new rows always carry a real file_path now, so
// this URL-parsing is just a safety net for any row that predates it.
function extractStoragePath(fileUrl, bucket){
    if(!fileUrl) return null;
    const marker = "/object/public/" + bucket + "/";
    const idx = fileUrl.indexOf(marker);
    if(idx === -1) return null;
    return decodeURIComponent(fileUrl.slice(idx + marker.length));
}

document.addEventListener("DOMContentLoaded", async function(){
    await setupUploadOrgLock();
    await loadDocuments();
});

// Live updates: any insert/update/delete on documents - from this tab,
// another tab, or another user entirely - refreshes the table without a
// page reload. RLS still applies to what postgres_changes delivers.
supabaseClient
    .channel("documents_page_changes")
    .on("postgres_changes", { event: "*", schema: "public", table: "documents" }, function(){
        loadDocuments();
    })
    .subscribe();
