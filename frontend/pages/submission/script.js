const uploadForm = document.getElementById("uploadForm");
const uploadCategorySelect = document.getElementById("uploadCategorySelect");
const uploadSpecifyTypeWrap = document.getElementById("uploadSpecifyTypeWrap");
const uploadSpecifiedTypeInput = document.getElementById("uploadSpecifiedTypeInput");
const uploadSpecifiedTypeError = document.getElementById("uploadSpecifiedTypeError");
const submissionsTableBody = document.getElementById("submissionsTableBody");
const mySearch = document.getElementById("mySearch");
const myCategoryFilter = document.getElementById("myCategoryFilter");
const myStatusFilter = document.getElementById("myStatusFilter");
const mySort = document.getElementById("mySort");
const myPagination = document.getElementById("myPagination");
const reviewSearch = document.getElementById("reviewSearch");
const reviewCategoryFilter = document.getElementById("reviewCategoryFilter");
const reviewStatusFilter = document.getElementById("reviewStatusFilter");
const reviewSort = document.getElementById("reviewSort");
const reviewTableBody = document.getElementById("reviewTableBody");
const reviewPagination = document.getElementById("reviewPagination");

const REVIEW_PAGE_SIZE = 10;
const MY_PAGE_SIZE = 10;
const MAX_FILE_SIZE_BYTES = 20 * 1024 * 1024; // 20MB

// Shared with dashboard/script.js's identical map - see
// LINGKOD_SUBMISSION_CATEGORY_LABELS in js/common.js.
const SUBMISSION_CATEGORY_LABELS = LINGKOD_SUBMISSION_CATEGORY_LABELS;

// Kept "rejected" and "needs_revision" as distinct statuses (rather than
// collapsing both into a single "Returned" status) - they already drive
// genuinely different, working UI (separate Reject/Return-for-Revision
// buttons, separate rejected_at tracking) and merging them would destroy
// that distinction for no functional gain; "needs_revision" is simply
// relabeled "Returned" to match the requested wording.
const SUBMISSION_STATUS_LABELS = {
    pending: "🟡 Submitted",
    received: "🔵 Received",
    under_review: "🟣 Under Review",
    approved: "🟢 Approved",
    rejected: "🔴 Rejected",
    needs_revision: "🟠 Returned",
    completed: "⚪ Completed"
};

/* ================= "PLEASE SPECIFY" SHOW/HIDE ================= */
// Mirrors requests/script.js's identical "Others" pattern - category
// "other" used to cover two different-looking dropdown options ("New
// Organization Application" and "Other Documents") with no way to tell
// them apart once saved; now it's one "Other" option plus this field.

if(uploadCategorySelect){
    uploadCategorySelect.addEventListener("change", function(){
        const isOther = uploadCategorySelect.value === "other";
        uploadSpecifyTypeWrap.classList.toggle("visible", isOther);
        uploadSpecifiedTypeError.classList.remove("visible");
        if(!isOther) uploadSpecifiedTypeInput.value = "";
    });
}

// "Other" needs the submitter's own free-text answer to mean anything -
// showing the raw "Other" label back would lose which of the two
// original "Other" scenarios this particular submission actually was.
// Mirrors documents/script.js's own categoryDisplay() for the same
// custom_document_type pattern.
function submissionCategoryDisplay(row){
    if(row.category === "other" && row.specified_type) return row.specified_type;
    return SUBMISSION_CATEGORY_LABELS[row.category] || row.category;
}

function sanitizeFileName(name){
    return name.replace(/[^a-zA-Z0-9.\-_]/g, "_");
}

// The signed-URL/preview/download machinery (lingkodGetSignedFileUrl,
// lingkodDownloadFile, lingkodLoadFilePreview, lingkodBuildFileInfoCell)
// lives in js/common.js - shared with the dashboard/Profile pages, which
// also show an uploaded file's Download action. Only the upload itself is
// page-specific.
async function uploadSubmissionFile(file, submitterId){
    const path = submitterId + "/" + Date.now() + "-" + sanitizeFileName(file.name);

    const { error } = await supabaseClient.storage
        .from(LINGKOD_SUBMISSION_BUCKET)
        .upload(path, file, { cacheControl: "3600", upsert: false });

    if(error) throw error;

    return {
        file_path: path,
        file_name: file.name,
        file_type: file.type || null,
        file_size: file.size,
        storage_bucket: LINGKOD_SUBMISSION_BUCKET,
        uploaded_at: new Date().toISOString()
    };
}

/* ================= SUBMITTED DOCUMENTS (existing table) ================= */

function buildReviewForm(row){
    const wrapper = document.createElement("div");
    wrapper.className = "review-form";

    const statusLabel = document.createElement("label");
    statusLabel.textContent = "Status";
    wrapper.appendChild(statusLabel);

    const statusSelect = document.createElement("select");
    Object.keys(SUBMISSION_STATUS_LABELS).forEach(function(key){
        const option = document.createElement("option");
        option.value = key;
        option.textContent = SUBMISSION_STATUS_LABELS[key];
        if(key === row.status) option.selected = true;
        statusSelect.appendChild(option);
    });
    wrapper.appendChild(statusSelect);

    const remarksLabel = document.createElement("label");
    remarksLabel.textContent = "Remarks (visible to the submitter)";
    wrapper.appendChild(remarksLabel);

    const remarksInput = document.createElement("textarea");
    remarksInput.value = row.remarks || "";
    remarksInput.placeholder = "Add remarks for the submitter (optional)...";
    wrapper.appendChild(remarksInput);

    const saveBtn = document.createElement("button");
    saveBtn.type = "button";
    saveBtn.innerHTML = "<i class=\"fa-solid fa-check\"></i> Save Review";
    saveBtn.addEventListener("click", async function(){
        lingkodSetButtonLoading(saveBtn, true, "Saving...");
        const ok = await applyReviewDecision(row, statusSelect.value, remarksInput.value.trim());
        lingkodSetButtonLoading(saveBtn, false);

        if(ok){
            lingkodToast("Submission Updated Successfully", "success");
            lingkodCloseModal();
            await loadSubmissions();
        }
    });
    wrapper.appendChild(saveBtn);

    return wrapper;
}

// Review (osoa_eb only) is the sole remaining Actions-column entry - View
// and Download for the uploaded file now live in the Uploaded File column
// instead (see lingkodBuildFileInfoCell).
function buildActionsCell(row, canReview){
    const td = document.createElement("td");

    if(canReview){
        const reviewBtn = document.createElement("button");
        reviewBtn.type = "button";
        reviewBtn.className = "review-btn";
        reviewBtn.innerHTML = "<i class=\"fa-solid fa-magnifying-glass\"></i> Review";
        reviewBtn.addEventListener("click", function(){
            lingkodOpenModal("Review: " + row.document_title, buildReviewForm(row));
        });
        td.appendChild(reviewBtn);
    } else {
        td.textContent = "—";
    }

    return td;
}

let allMySubmissions = [];
let myCurrentPage = 1;
let myCanReview = false;

function getFilteredMySubmissions(){
    const query = mySearch.value.trim().toLowerCase();
    const categoryFilter = myCategoryFilter.value;
    const statusFilter = myStatusFilter.value;
    const sort = mySort.value;

    let rows = allMySubmissions.filter(function(row){
        if(categoryFilter !== "all" && row.category !== categoryFilter) return false;
        if(statusFilter !== "all" && row.status !== statusFilter) return false;
        if(query && !row.document_title.toLowerCase().includes(query)) return false;
        return true;
    });

    rows = rows.slice().sort(function(a, b){
        return sort === "oldest"
            ? new Date(a.created_at) - new Date(b.created_at)
            : new Date(b.created_at) - new Date(a.created_at);
    });

    return rows;
}

function renderMyTable(rows, canReview){
    submissionsTableBody.innerHTML = "";

    if(rows.length === 0){
        submissionsTableBody.appendChild(lingkodCreateEmptyRow("No documents match these filters.", 8));
        return;
    }

    rows.forEach(function(row){
        const tr = document.createElement("tr");
        tr.appendChild(lingkodCreateCell(row.document_title));
        tr.appendChild(lingkodCreateCell(submissionCategoryDisplay(row)));
        tr.appendChild(lingkodBuildFileInfoCell(row, { onView: function(r){ openViewModal(r, canReview); } }));
        tr.appendChild(lingkodCreateCell(lingkodFormatDate(row.created_at)));
        tr.appendChild(lingkodCreateStatusCell(row.status, SUBMISSION_STATUS_LABELS));
        tr.appendChild(lingkodCreateCell(row.remarks || "—"));
        tr.appendChild(lingkodCreateCell(row.updated_at ? lingkodFormatDate(row.updated_at) : "—"));
        tr.appendChild(buildActionsCell(row, canReview));
        submissionsTableBody.appendChild(tr);
    });
}

function renderMyPage(){
    const filtered = getFilteredMySubmissions();
    const totalPages = Math.max(1, Math.ceil(filtered.length / MY_PAGE_SIZE));
    if(myCurrentPage > totalPages) myCurrentPage = totalPages;

    const start = (myCurrentPage - 1) * MY_PAGE_SIZE;
    renderMyTable(filtered.slice(start, start + MY_PAGE_SIZE), myCanReview);
    lingkodRenderPagination(myPagination, myCurrentPage, totalPages, function(page){
        myCurrentPage = page;
        renderMyPage();
    });
}

[mySearch, myCategoryFilter, myStatusFilter, mySort].forEach(function(el){
    if(!el) return;
    el.addEventListener(el.tagName === "SELECT" ? "change" : "input", function(){
        myCurrentPage = 1;
        renderMyPage();
    });
});

/* ================= REVIEW SUBMITTED DOCUMENTS (OSOA EB approval queue) ================= */
// A second, richer view over the *same* rows already fetched for the
// table above (no extra query) - shown only to osoa_eb, with the columns
// and Approve/Reject/Return-for-Revision workflow a real approval queue
// needs.

let allReviewSubmissions = [];
let submissionProfilesById = {};
let reviewCurrentPage = 1;
let reviewerId = null;

function getFilteredReviewSubmissions(){
    const query = reviewSearch.value.trim().toLowerCase();
    const categoryFilter = reviewCategoryFilter.value;
    const statusFilter = reviewStatusFilter.value;
    const sort = reviewSort.value;

    let rows = allReviewSubmissions.filter(function(row){
        if(categoryFilter !== "all" && row.category !== categoryFilter) return false;
        if(statusFilter !== "all" && row.status !== statusFilter) return false;

        if(query){
            const submitter = submissionProfilesById[row.submitted_by];
            const haystack = [
                row.document_title,
                submissionCategoryDisplay(row),
                submitter && submitter.organization,
                submitter && submitter.full_name,
                SUBMISSION_STATUS_LABELS[row.status]
            ].filter(Boolean).join(" ").toLowerCase();
            if(!haystack.includes(query)) return false;
        }

        return true;
    });

    rows = rows.slice().sort(function(a, b){
        return sort === "oldest"
            ? new Date(a.created_at) - new Date(b.created_at)
            : new Date(b.created_at) - new Date(a.created_at);
    });

    return rows;
}

// Shared by the row-level quick actions, the reject/revision remarks
// dialog, and the View modal's action buttons - one place that actually
// talks to Supabase for a review decision.
async function applyReviewDecision(row, status, remarks){
    if(!reviewerId){
        lingkodToast("Please log in with a registered OSOA EB account to review submissions.", "error");
        return false;
    }

    const now = new Date().toISOString();
    const payload = {
        status: status,
        remarks: remarks || null,
        reviewer_id: reviewerId,
        reviewed_at: now
    };
    if(status === "approved") payload.approved_at = now;
    if(status === "rejected") payload.rejected_at = now;

    const { error } = await supabaseClient.from("submissions").update(payload).eq("id", row.id);

    if(error){
        console.error("[submission] review decision failed:", error);
        lingkodToast("Failed to update this submission: " + error.message, "error");
        return false;
    }

    return true;
}

function approveSubmission(row){
    lingkodConfirmAction({
        title: "Approve Submission?",
        message: "Approve \"" + row.document_title + "\"? It will become visible on dashboards once approved.",
        icon: "fa-check",
        confirmLabel: "Approve",
        loadingLabel: "Approving...",
        destructive: false,
        onConfirm: async function(){
            const ok = await applyReviewDecision(row, "approved", row.remarks);
            if(!ok) throw new Error("approve failed");
            lingkodToast("Submission Approved Successfully", "success");
            await loadSubmissions();
        }
    });
}

// Lightweight intake-progress quick actions - single click, no remarks,
// same shape as approveSubmission() above. Sit before the Approve/Reject/
// Return decision buttons in the workflow: Submitted -> Received ->
// Under Review -> (Approved/Rejected/Returned) -> Completed.
async function markSubmissionReceived(row){
    const ok = await applyReviewDecision(row, "received", row.remarks);
    if(ok){
        lingkodToast("Submission marked as Received.", "success");
        lingkodCloseModal();
        await loadSubmissions();
    }
}

async function markSubmissionUnderReview(row){
    const ok = await applyReviewDecision(row, "under_review", row.remarks);
    if(ok){
        lingkodToast("Submission marked as Under Review.", "success");
        lingkodCloseModal();
        await loadSubmissions();
    }
}

async function markSubmissionCompleted(row){
    const ok = await applyReviewDecision(row, "completed", row.remarks);
    if(ok){
        lingkodToast("Submission marked as Completed.", "success");
        lingkodCloseModal();
        await loadSubmissions();
    }
}

const DECISION_LABELS = {
    rejected: { title: "Reject Submission", verb: "Reject", success: "Submission Rejected" },
    needs_revision: { title: "Return for Revision", verb: "Return for Revision", success: "Returned for Revision" }
};

// Reject and Return-for-Revision both require remarks explaining why -
// unlike Approve, which is a single click.
function openDecisionModal(row, status){
    const labels = DECISION_LABELS[status];
    const wrapper = document.createElement("div");
    wrapper.className = "review-form";

    const label = document.createElement("label");
    label.textContent = "Remarks (required - explain what needs to change)";
    wrapper.appendChild(label);

    const remarksInput = document.createElement("textarea");
    remarksInput.placeholder = "Explain the reason for the submitter...";
    wrapper.appendChild(remarksInput);

    const confirmBtn = document.createElement("button");
    confirmBtn.type = "button";
    confirmBtn.textContent = labels.verb;
    confirmBtn.addEventListener("click", async function(){
        const remarks = remarksInput.value.trim();
        if(!remarks){
            lingkodToast("Remarks are required for this action.", "error");
            return;
        }

        lingkodSetButtonLoading(confirmBtn, true, "Saving...");
        const ok = await applyReviewDecision(row, status, remarks);
        lingkodSetButtonLoading(confirmBtn, false);

        if(ok){
            lingkodToast(labels.success, "success");
            lingkodCloseModal();
            await loadSubmissions();
        }
    });
    wrapper.appendChild(confirmBtn);

    lingkodOpenModal(labels.title + ": " + row.document_title, wrapper);
}

function buildViewModalInfoPanel(row){
    const submitter = submissionProfilesById[row.submitted_by];
    const reviewer = row.reviewer_id ? submissionProfilesById[row.reviewer_id] : null;

    const panel = document.createElement("div");
    panel.className = "view-modal-info";

    const badge = document.createElement("span");
    badge.className = "status " + row.status;
    badge.textContent = SUBMISSION_STATUS_LABELS[row.status] || row.status;
    panel.appendChild(badge);

    const h4 = document.createElement("h4");
    h4.textContent = row.document_title;
    panel.appendChild(h4);

    [
        ["Category", submissionCategoryDisplay(row)],
        ["Organization", submitter && submitter.organization ? submitter.organization : "Not set"],
        ["Submitted By", submitter ? submitter.full_name : "Unknown"],
        ["Date Submitted", lingkodFormatDate(row.created_at)],
        ["Reviewer Remarks", row.remarks || "None yet"]
    ].forEach(function(pair){
        const field = document.createElement("div");
        field.className = "view-modal-field";
        const dt = document.createElement("label");
        dt.textContent = pair[0];
        const dd = document.createElement("span");
        dd.textContent = pair[1];
        field.appendChild(dt);
        field.appendChild(dd);
        panel.appendChild(field);
    });

    // "Approval History": this table tracks only the single most recent
    // review action (reviewer_id/reviewed_at), not a full multi-decision
    // audit log - which would need a separate table, out of scope here -
    // so this is a one-entry summary rather than a true history list.
    const historyField = document.createElement("div");
    historyField.className = "view-modal-field";
    const historyLabel = document.createElement("label");
    historyLabel.textContent = "Approval History";
    historyField.appendChild(historyLabel);
    const historyValue = document.createElement("span");
    historyValue.textContent = row.reviewed_at
        ? (reviewer ? reviewer.full_name : "OSOA EB") + " reviewed this on " + lingkodFormatDate(row.reviewed_at) + " (" + (SUBMISSION_STATUS_LABELS[row.status] || row.status) + ")"
        : "Not yet reviewed.";
    historyField.appendChild(historyValue);
    panel.appendChild(historyField);

    return panel;
}

function buildViewModalPreviewPanel(row){
    const panel = document.createElement("div");
    panel.className = "view-modal-preview";

    lingkodShowPreviewMessage(panel, "fa-solid fa-spinner fa-spin", "Loading preview...");
    lingkodLoadFilePreview(panel, row);

    return panel;
}

// Approve/Reject/Return-for-Revision only show for osoa_eb (canReview) -
// the same modal, opened from the org president's own "Submitted
// Documents" row, is view/download only.
function buildViewModalActions(row, canReview){
    const actions = document.createElement("div");
    actions.className = "view-modal-actions";

    if(canReview){
        if(row.status === "pending"){
            const receivedBtn = document.createElement("button");
            receivedBtn.type = "button";
            receivedBtn.className = "btn-secondary";
            receivedBtn.innerHTML = "<i class=\"fa-solid fa-inbox\"></i> Mark as Received";
            receivedBtn.addEventListener("click", function(){ markSubmissionReceived(row); });
            actions.appendChild(receivedBtn);
        }

        if(row.status === "pending" || row.status === "received"){
            const reviewBtn = document.createElement("button");
            reviewBtn.type = "button";
            reviewBtn.className = "btn-secondary";
            reviewBtn.innerHTML = "<i class=\"fa-solid fa-magnifying-glass\"></i> Mark as Under Review";
            reviewBtn.addEventListener("click", function(){ markSubmissionUnderReview(row); });
            actions.appendChild(reviewBtn);
        }

        const approveBtn = document.createElement("button");
        approveBtn.type = "button";
        approveBtn.className = "approve-btn";
        approveBtn.innerHTML = "<i class=\"fa-solid fa-check\"></i> Approve";
        approveBtn.addEventListener("click", function(){ approveSubmission(row); });
        actions.appendChild(approveBtn);

        const rejectBtn = document.createElement("button");
        rejectBtn.type = "button";
        rejectBtn.className = "reject-btn";
        rejectBtn.innerHTML = "<i class=\"fa-solid fa-xmark\"></i> Reject";
        rejectBtn.addEventListener("click", function(){ openDecisionModal(row, "rejected"); });
        actions.appendChild(rejectBtn);

        const revisionBtn = document.createElement("button");
        revisionBtn.type = "button";
        revisionBtn.className = "revision-btn";
        revisionBtn.innerHTML = "<i class=\"fa-solid fa-rotate-left\"></i> Return for Revision";
        revisionBtn.addEventListener("click", function(){ openDecisionModal(row, "needs_revision"); });
        actions.appendChild(revisionBtn);

        if(row.status === "approved"){
            const completeBtn = document.createElement("button");
            completeBtn.type = "button";
            completeBtn.className = "btn-secondary";
            completeBtn.innerHTML = "<i class=\"fa-solid fa-flag-checkered\"></i> Mark as Completed";
            completeBtn.addEventListener("click", function(){ markSubmissionCompleted(row); });
            actions.appendChild(completeBtn);
        }
    }

    if(row.file_path){
        const downloadBtn = document.createElement("button");
        downloadBtn.type = "button";
        downloadBtn.className = "download-link";
        downloadBtn.innerHTML = "<i class=\"fa-solid fa-download\"></i> Download";
        downloadBtn.addEventListener("click", function(){ lingkodDownloadFile(row, downloadBtn); });
        actions.appendChild(downloadBtn);
    }

    return actions;
}

function openViewModal(row, canReview){
    const wrapper = document.createElement("div");
    wrapper.className = "view-modal";

    const layout = document.createElement("div");
    layout.className = "view-modal-layout";
    layout.appendChild(buildViewModalInfoPanel(row));
    layout.appendChild(buildViewModalPreviewPanel(row));
    wrapper.appendChild(layout);

    wrapper.appendChild(buildViewModalActions(row, canReview));

    lingkodOpenModal("Review: " + row.document_title, wrapper, "modal-wide");
}

// Only Approve/Reject/Revision remain here - View and Download for the
// uploaded file now live in the Uploaded File column (lingkodBuildFileInfoCell).
function buildReviewRowActions(row){
    const td = document.createElement("td");
    td.className = "review-row-actions";

    const approveBtn = document.createElement("button");
    approveBtn.type = "button";
    approveBtn.className = "icon-btn approve";
    approveBtn.title = "Approve";
    approveBtn.innerHTML = "<i class=\"fa-solid fa-check\"></i>";
    approveBtn.addEventListener("click", function(){ approveSubmission(row); });
    td.appendChild(approveBtn);

    const rejectBtn = document.createElement("button");
    rejectBtn.type = "button";
    rejectBtn.className = "icon-btn reject";
    rejectBtn.title = "Reject";
    rejectBtn.innerHTML = "<i class=\"fa-solid fa-xmark\"></i>";
    rejectBtn.addEventListener("click", function(){ openDecisionModal(row, "rejected"); });
    td.appendChild(rejectBtn);

    const revisionBtn = document.createElement("button");
    revisionBtn.type = "button";
    revisionBtn.className = "icon-btn revision";
    revisionBtn.title = "Return for Revision";
    revisionBtn.innerHTML = "<i class=\"fa-solid fa-rotate-left\"></i>";
    revisionBtn.addEventListener("click", function(){ openDecisionModal(row, "needs_revision"); });
    td.appendChild(revisionBtn);

    return td;
}

function renderReviewTable(rows){
    reviewTableBody.innerHTML = "";

    if(rows.length === 0){
        reviewTableBody.appendChild(lingkodCreateEmptyRow("No submissions to review.", 9));
        return;
    }

    rows.forEach(function(row){
        const submitter = submissionProfilesById[row.submitted_by];
        const tr = document.createElement("tr");
        tr.appendChild(lingkodCreateCell(row.document_title));
        tr.appendChild(lingkodCreateCell(submissionCategoryDisplay(row)));
        tr.appendChild(lingkodCreateCell(submitter && submitter.organization ? submitter.organization : "—"));
        tr.appendChild(lingkodCreateCell(submitter ? submitter.full_name : "Unknown"));
        tr.appendChild(lingkodBuildFileInfoCell(row, { onView: function(r){ openViewModal(r, true); } }));
        tr.appendChild(lingkodCreateCell(lingkodFormatDate(row.created_at)));
        tr.appendChild(lingkodCreateStatusCell(row.status, SUBMISSION_STATUS_LABELS));
        tr.appendChild(lingkodCreateCell(row.remarks || "—"));
        tr.appendChild(buildReviewRowActions(row));
        reviewTableBody.appendChild(tr);
    });
}

function renderReviewPage(){
    const filtered = getFilteredReviewSubmissions();
    const totalPages = Math.max(1, Math.ceil(filtered.length / REVIEW_PAGE_SIZE));
    if(reviewCurrentPage > totalPages) reviewCurrentPage = totalPages;

    const start = (reviewCurrentPage - 1) * REVIEW_PAGE_SIZE;
    renderReviewTable(filtered.slice(start, start + REVIEW_PAGE_SIZE));
    lingkodRenderPagination(reviewPagination, reviewCurrentPage, totalPages, function(page){
        reviewCurrentPage = page;
        renderReviewPage();
    });
}

[reviewSearch, reviewCategoryFilter, reviewStatusFilter, reviewSort].forEach(function(el){
    if(!el) return;
    el.addEventListener(el.tagName === "SELECT" ? "change" : "input", function(){
        reviewCurrentPage = 1;
        renderReviewPage();
    });
});

/* ================= SHARED LOAD ================= */

// osoa_eb reviews every submission ("Review Submitted Documents"); every
// other role only ever sees their own uploads here, regardless of status -
// RLS (submissions_select) would also let them see *approved* rows from
// other organizations, but that's the dashboards' job, not this page's.
// Poster/reviewer profile info is fetched for every viewer (not just
// osoa_eb) since the org president's own "Submitted Documents" View modal
// needs a resolvable "Submitted By"/reviewer name too.
async function loadSubmissions(){
    const session = lingkodGetSession();
    const canReview = !!session && session.role === "admin";

    let query = supabaseClient
        .from("submissions")
        .select("id, document_title, category, specified_type, status, remarks, created_at, updated_at, submitted_by, reviewer_id, reviewed_at, approved_at, rejected_at, file_name, file_path, storage_bucket, file_type, file_size, uploaded_at")
        .order("created_at", { ascending: false });

    if(!canReview){
        const profile = await lingkodGetAuthedProfile();
        if(!profile){
            myCanReview = false;
            allMySubmissions = [];
            renderMyPage();
            return;
        }
        query = query.eq("submitted_by", profile.id);
    }

    const { data, error } = await query;

    if(error){
        console.error("[submission] load failed:", error);
        submissionsTableBody.innerHTML = "";
        submissionsTableBody.appendChild(lingkodCreateEmptyRow("Couldn't load documents (" + error.message + ").", 8));
        return;
    }

    const ids = data.map(function(row){ return row.submitted_by; })
        .concat(data.map(function(row){ return row.reviewer_id; }));
    submissionProfilesById = await lingkodFetchProfilesById(ids);

    myCanReview = canReview;
    allMySubmissions = data;
    renderMyPage();

    if(canReview && reviewTableBody){
        allReviewSubmissions = data;
        renderReviewPage();
    }
}

if(uploadForm){
    uploadForm.addEventListener("submit", async function(e){
        e.preventDefault();

        const category = uploadForm.elements.category.value;
        const specifiedType = uploadSpecifiedTypeInput ? uploadSpecifiedTypeInput.value.trim() : "";
        const title = uploadForm.elements.title.value.trim();
        const file = uploadForm.elements.file.files[0];

        if(!category || !title){
            lingkodToast("Please select a document type and enter a title.", "error");
            return;
        }

        if(category === "other" && !specifiedType){
            uploadSpecifiedTypeError.textContent = "Please specify the document type.";
            uploadSpecifiedTypeError.classList.add("visible");
            uploadSpecifiedTypeInput.focus();
            return;
        }
        if(uploadSpecifiedTypeError) uploadSpecifiedTypeError.classList.remove("visible");

        if(!file){
            lingkodToast("Please attach a file to submit.", "error");
            return;
        }

        if(file.size > MAX_FILE_SIZE_BYTES){
            lingkodToast("That file is too large - the limit is 20MB.", "error");
            return;
        }

        const profile = await lingkodGetAuthedProfile();
        if(!profile){
            lingkodToast("Please log in with a registered account to submit a document.", "error");
            return;
        }

        const submitBtn = uploadForm.querySelector("button[type=submit]");
        lingkodSetButtonLoading(submitBtn, true, "Uploading...");

        // Upload to Storage first: this way, if the upload fails, no
        // half-created submission row is left behind with no file.
        let fileMeta;
        try {
            fileMeta = await uploadSubmissionFile(file, profile.id);
        } catch(uploadError){
            lingkodSetButtonLoading(submitBtn, false);
            console.error("[submission] file upload failed:", uploadError);
            lingkodToast("Failed to upload file: " + uploadError.message, "error");
            return;
        }

        const { error } = await supabaseClient
            .from("submissions")
            .insert(Object.assign({
                document_title: title,
                category: category,
                specified_type: category === "other" ? specifiedType : null,
                status: "pending",
                submitted_by: profile.id
            }, fileMeta));

        lingkodSetButtonLoading(submitBtn, false);

        if(error){
            console.error("[submission] upload failed:", error);
            lingkodToast("Failed to submit document: " + error.message, "error");
            return;
        }

        lingkodToast("Document Submitted Successfully", "success");
        uploadForm.reset();
        if(uploadSpecifyTypeWrap) uploadSpecifyTypeWrap.classList.remove("visible");
        await loadSubmissions();
    });
}

document.addEventListener("DOMContentLoaded", async function(){
    const profile = await lingkodGetAuthedProfile();
    reviewerId = profile ? profile.id : null;
    await loadSubmissions();
});

// Live updates: a new upload, or a status/remarks/review change from OSOA
// EB, refreshes both tables (and their Uploaded File columns) on this
// page for anyone with it open - no reload, and no second subscription
// for the review section since it's driven by the same loadSubmissions()
// call.
supabaseClient
    .channel("submission_page_changes")
    .on("postgres_changes", { event: "*", schema: "public", table: "submissions" }, function(){
        loadSubmissions();
    })
    .subscribe();
