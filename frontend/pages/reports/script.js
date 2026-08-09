/* ===================================================
   LINGKOD Meneses - Reports
   Members, Organization Presidents, and OSOA EB can each submit a report
   addressed either to their own Organization President (Members only) or
   to a specific named OSOA EB position (never a generic "OSOA EB") - see
   20260809060000_reports_table.sql's own header comment for the full
   server-side design. Modeled directly on requests/script.js's dual-
   section layout ("My Reports" tracking + "Reports Assigned to Me"
   management), extended with a real file attachment.

   Row visibility/edit rights are enforced server-side by RLS (reports_
   select/reports_update, both driven by can_view_report()/is_report_
   recipient() - see the migration) - isReportRecipient()/
   canSeeManagementTable() below are only the client-side mirror of that,
   same "hide it, RLS is the real enforcement" pattern used everywhere
   else in this app.
   =================================================== */

const REPORT_BUCKET = "report-attachments";
const MAX_REPORT_FILE_SIZE_BYTES = 20 * 1024 * 1024; // 20MB, matches the bucket's own file_size_limit
const ALLOWED_REPORT_MIME_TYPES = [
    "application/pdf",
    "application/msword",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
];

const REPORT_STATUS_LABELS = {
    submitted: "Submitted",
    received: "Received",
    under_review: "Under Review",
    in_progress: "In Progress",
    resolved: "Resolved",
    rejected: "Rejected",
    closed: "Closed"
};

const REPORT_STATUS_CLASSES = {
    submitted: "submitted",
    received: "received",
    under_review: "under_review",
    in_progress: "in_progress",
    resolved: "resolved",
    rejected: "rejected",
    closed: "closed"
};

const MANAGE_PAGE_SIZE = 10;

const reportFullNameDisplay = document.getElementById("reportFullNameDisplay");
const reportTitleInput = document.getElementById("reportTitleInput");
const reportTypeSelect = document.getElementById("reportTypeSelect");
const reportSpecifyFieldWrap = document.getElementById("reportSpecifyFieldWrap");
const reportSpecifiedTypeInput = document.getElementById("reportSpecifiedTypeInput");
const reportSpecifiedTypeError = document.getElementById("reportSpecifiedTypeError");
const reportRecipientSelect = document.getElementById("reportRecipientSelect");
const reportRecipientOrgHint = document.getElementById("reportRecipientOrgHint");
const reportDetailsInput = document.getElementById("reportDetailsInput");

const reportFileInput = document.getElementById("reportFileInput");
const reportFileChooseBtn = document.getElementById("reportFileChooseBtn");
const reportFilePreview = document.getElementById("reportFilePreview");
const reportFilePreviewName = document.getElementById("reportFilePreviewName");
const reportFilePreviewMeta = document.getElementById("reportFilePreviewMeta");
const reportFileRemoveBtn = document.getElementById("reportFileRemoveBtn");

const reportForm = document.getElementById("reportForm");
const reportButton = reportForm.querySelector("button[type=\"submit\"]");
const reportsTableBody = document.getElementById("reportsTableBody");

const reportManagementBox = document.getElementById("reportManagementBox");
const reportManageSearch = document.getElementById("reportManageSearch");
const reportManageTypeFilter = document.getElementById("reportManageTypeFilter");
const reportManageStatusFilter = document.getElementById("reportManageStatusFilter");
const reportManageDateFilter = document.getElementById("reportManageDateFilter");
const reportManageTableBody = document.getElementById("reportManageTableBody");
const reportManagePagination = document.getElementById("reportManagePagination");

let currentProfile = null;
let osoaOrganizationId = null;
let osoaPositions = []; // [{position_name}], active OSOA EB positions only
let allReports = [];
let manageReports = [];
let manageCurrentPage = 1;

/* ================= IDENTITY / RECIPIENT OPTIONS ================= */

async function loadIdentity(){
    currentProfile = await lingkodGetAuthedProfile();
    if(currentProfile){
        reportFullNameDisplay.value = currentProfile.full_name;
    } else {
        reportFullNameDisplay.value = "Not available for demo accounts";
        reportButton.disabled = true;
    }
}

async function loadOsoaPositions(){
    const { data: org, error: orgError } = await supabaseClient
        .from("organizations")
        .select("id")
        .eq("slug", "osoa-meneses")
        .maybeSingle();

    if(orgError || !org){
        console.error("[reports] OSOA organization lookup failed:", orgError);
        return;
    }
    osoaOrganizationId = org.id;

    const { data, error } = await supabaseClient
        .from("organization_positions")
        .select("position_name")
        .eq("organization_id", osoaOrganizationId)
        .eq("system_role", "osoa_eb")
        .eq("is_active", true)
        .order("display_order");

    if(error){
        console.error("[reports] OSOA position list load failed:", error);
        return;
    }
    osoaPositions = data || [];
}

// Recipient options depend on who's submitting:
//   Member (role=student)  -> Organization President + every OSOA position
//   Organization President -> every OSOA position (no self-option)
//   OSOA EB                -> every OSOA position EXCEPT their own current
//                             one - the client-side echo of reports_before_
//                             insert()'s server-side self-report guard.
function populateRecipientOptions(){
    reportRecipientSelect.innerHTML = "";

    const placeholder = document.createElement("option");
    placeholder.value = "";
    placeholder.disabled = true;
    placeholder.selected = true;
    placeholder.textContent = "Select Recipient";
    reportRecipientSelect.appendChild(placeholder);

    const role = currentProfile && currentProfile.role;

    if(role === "student"){
        const hasOrg = !!(currentProfile && currentProfile.organization_id);
        const presOpt = document.createElement("option");
        presOpt.value = "org_president";
        presOpt.textContent = "Organization President";
        presOpt.disabled = !hasOrg;
        reportRecipientSelect.appendChild(presOpt);
        if(reportRecipientOrgHint) reportRecipientOrgHint.style.display = hasOrg ? "none" : "";
    } else if(reportRecipientOrgHint){
        reportRecipientOrgHint.style.display = "none";
    }

    osoaPositions.forEach(function(p){
        if(role === "osoa_eb" && currentProfile.position === p.position_name) return;
        const opt = document.createElement("option");
        opt.value = "osoa_eb_position:" + p.position_name;
        opt.textContent = "OSOA EB " + p.position_name;
        reportRecipientSelect.appendChild(opt);
    });
}

/* ================= VISIBILITY HELPERS =================
   RLS (reports_select/reports_update) is the real enforcement - these
   only decide what this page renders for the current viewer. */

function isReportRecipient(row){
    if(!currentProfile) return false;
    if(row.recipient_type === "org_president"){
        return currentProfile.role === "org_president"
            && row.recipient_organization_id === currentProfile.organization_id;
    }
    if(row.recipient_type === "osoa_eb_position"){
        return currentProfile.role === "osoa_eb"
            && row.recipient_position === currentProfile.position;
    }
    return false;
}

function canSeeManagementTable(){
    return !!currentProfile && (currentProfile.role === "org_president" || currentProfile.role === "osoa_eb");
}

function recipientDisplay(row){
    if(row.recipient_type === "org_president") return "Organization President";
    return "OSOA EB " + row.recipient_position;
}

/* ================= "PLEASE SPECIFY" SHOW/HIDE ================= */

reportTypeSelect.addEventListener("change", function(){
    const isOthers = reportTypeSelect.value === "Others";
    reportSpecifyFieldWrap.classList.toggle("visible", isOthers);
    reportSpecifiedTypeError.classList.remove("visible");
    if(!isOthers) reportSpecifiedTypeInput.value = "";
});

/* ================= FILE PICKER ================= */

function isAllowedReportFile(file){
    if(ALLOWED_REPORT_MIME_TYPES.indexOf(file.type) !== -1) return true;
    // Some browsers/OSes report an empty MIME type for docx - fall back
    // to the extension rather than rejecting a genuinely valid file.
    return /\.(pdf|docx?|DOCX?|PDF)$/.test(file.name);
}

function resetReportFilePicker(){
    reportFileInput.value = "";
    reportFilePreview.hidden = true;
    reportFileChooseBtn.hidden = false;
}

reportFileChooseBtn.addEventListener("click", function(){ reportFileInput.click(); });

reportFileInput.addEventListener("change", function(){
    const file = reportFileInput.files[0];
    if(!file){
        resetReportFilePicker();
        return;
    }

    if(!isAllowedReportFile(file)){
        lingkodToast("Unsupported file type. Please upload a PDF, DOC, or DOCX file.", "error");
        resetReportFilePicker();
        return;
    }

    if(file.size > MAX_REPORT_FILE_SIZE_BYTES){
        lingkodToast("File size exceeds the allowed limit (20MB).", "error");
        resetReportFilePicker();
        return;
    }

    reportFilePreviewName.textContent = file.name;
    reportFilePreviewMeta.textContent = (file.type || "Unknown type") + " • " + lingkodFormatFileSize(file.size);
    reportFilePreview.hidden = false;
    reportFileChooseBtn.hidden = true;
});

reportFileRemoveBtn.addEventListener("click", resetReportFilePicker);

function sanitizeReportFileName(name){
    return name.replace(/[^a-zA-Z0-9.\-_]/g, "_");
}

async function uploadReportFile(file, reporterId){
    const path = reporterId + "/" + Date.now() + "-" + sanitizeReportFileName(file.name);

    const { error } = await supabaseClient.storage
        .from(REPORT_BUCKET)
        .upload(path, file, { cacheControl: "3600", upsert: false });

    if(error) throw error;

    return {
        attachment_file_name: file.name,
        attachment_file_path: path,
        attachment_file_type: file.type || null,
        attachment_file_size: file.size,
        storage_bucket: REPORT_BUCKET
    };
}

// lingkodBuildFileInfoCell/lingkodGetSignedFileUrl/lingkodDownloadFile/
// lingkodLoadFilePreview (js/common.js) all expect a plain file_path/
// file_name/file_type/file_size/storage_bucket shape - reports stores
// these under an attachment_-prefixed name instead (matching the exact
// field names asked for), so this adapts a report row into that shape
// rather than duplicating those helpers.
function toFileShape(row){
    return {
        file_path: row.attachment_file_path,
        file_name: row.attachment_file_name,
        file_type: row.attachment_file_type,
        file_size: row.attachment_file_size,
        storage_bucket: row.storage_bucket,
        title: row.report_title
    };
}

/* ================= FORMATTING HELPERS ================= */

function buildDateTimeCell(isoString){
    return lingkodBuildDateTimeCell(isoString, "request-datetime");
}

function formatReportTypeDisplay(row){
    if(row.report_type === "Others" && row.specified_type){
        return "Others (" + row.specified_type + ")";
    }
    return row.report_type;
}

/* ================= VIEW REPORT MODAL ================= */

function buildReportViewBody(row){
    const wrapper = document.createElement("div");
    wrapper.className = "review-form";

    const badge = document.createElement("span");
    badge.className = "status " + (REPORT_STATUS_CLASSES[row.status] || row.status);
    badge.textContent = REPORT_STATUS_LABELS[row.status] || row.status;
    wrapper.appendChild(badge);

    const parts = lingkodFormatDateTime(row.created_at);

    const fields = [
        ["Report ID", row.report_id],
        ["Reporter", row.reporter_name || "Unknown"],
        ["Organization", row.organization_name || "Not set"],
        ["Report Type", formatReportTypeDisplay(row)],
        ["Recipient", recipientDisplay(row)],
        ["Date Submitted", parts.date],
        ["Time Submitted", parts.time]
    ];

    fields.forEach(function(pair){
        const field = document.createElement("div");
        field.className = "view-modal-field";
        const dt = document.createElement("label");
        dt.textContent = pair[0];
        const dd = document.createElement("span");
        dd.textContent = pair[1];
        field.appendChild(dt);
        field.appendChild(dd);
        wrapper.appendChild(field);
    });

    if(row.report_details){
        const descField = document.createElement("div");
        descField.className = "view-modal-field";
        const descLabel = document.createElement("label");
        descLabel.textContent = "Report Details";
        const descValue = document.createElement("p");
        descValue.className = "request-view-description";
        descValue.textContent = row.report_details;
        descField.appendChild(descLabel);
        descField.appendChild(descValue);
        wrapper.appendChild(descField);
    }

    if(row.attachment_file_path){
        const fileField = document.createElement("div");
        fileField.className = "view-modal-field";
        const fileLabel = document.createElement("label");
        fileLabel.textContent = "Attachment";
        fileField.appendChild(fileLabel);
        const fileTable = document.createElement("table");
        fileTable.className = "view-modal-file-table";
        const fileRow = document.createElement("tr");
        fileRow.appendChild(lingkodBuildFileInfoCell(toFileShape(row), {
            onView: function(){ lingkodOpenSimpleFilePreview(toFileShape(row)); }
        }));
        fileTable.appendChild(fileRow);
        fileField.appendChild(fileTable);
        wrapper.appendChild(fileField);
    }

    if(row.remarks){
        const remarksField = document.createElement("div");
        remarksField.className = "view-modal-field";
        const remarksLabel = document.createElement("label");
        remarksLabel.textContent = "Remarks";
        const remarksValue = document.createElement("span");
        remarksValue.textContent = row.remarks;
        remarksField.appendChild(remarksLabel);
        remarksField.appendChild(remarksValue);
        wrapper.appendChild(remarksField);
    }

    return wrapper;
}

// Recipient-only: status update + remarks (never shown to the reporter's
// own tracking view of this same report).
function buildReportManageForm(row){
    const wrapper = document.createElement("div");
    wrapper.className = "request-manage-form";

    const statusLabel = document.createElement("label");
    statusLabel.textContent = "Update Status";
    wrapper.appendChild(statusLabel);

    const statusSelect = document.createElement("select");
    Object.keys(REPORT_STATUS_LABELS).forEach(function(key){
        const option = document.createElement("option");
        option.value = key;
        option.textContent = REPORT_STATUS_LABELS[key];
        if(key === row.status) option.selected = true;
        statusSelect.appendChild(option);
    });
    wrapper.appendChild(statusSelect);

    const remarksLabel = document.createElement("label");
    remarksLabel.textContent = "Remarks";
    wrapper.appendChild(remarksLabel);

    const remarksInput = document.createElement("textarea");
    remarksInput.value = row.remarks || "";
    remarksInput.placeholder = "Add remarks for the reporter (optional)...";
    wrapper.appendChild(remarksInput);

    const saveBtn = document.createElement("button");
    saveBtn.type = "button";
    saveBtn.innerHTML = "<i class=\"fa-solid fa-check\"></i> Save Changes";
    saveBtn.addEventListener("click", async function(){
        lingkodSetButtonLoading(saveBtn, true, "Saving...");
        const { error } = await supabaseClient
            .from("reports")
            .update({ status: statusSelect.value, remarks: remarksInput.value.trim() || null })
            .eq("id", row.id);
        lingkodSetButtonLoading(saveBtn, false);

        if(error){
            console.error("[reports] update failed:", error);
            lingkodToast("Failed to update this report: " + error.message, "error");
            return;
        }

        lingkodToast("Report updated successfully.", "success");
        lingkodCloseModal();
        await loadReports();
    });
    wrapper.appendChild(saveBtn);

    return wrapper;
}

function openReportViewModal(row){
    const wrapper = document.createElement("div");
    wrapper.className = "view-modal";
    wrapper.appendChild(buildReportViewBody(row));

    if(isReportRecipient(row)){
        wrapper.appendChild(buildReportManageForm(row));
    }

    lingkodOpenModal("Report " + row.report_id, wrapper);
}

/* ================= MY REPORTS (tracking table) ================= */

function buildViewActionCell(row){
    const td = document.createElement("td");
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "view-btn";
    btn.innerHTML = "<i class=\"fa-solid fa-eye\"></i> View";
    btn.addEventListener("click", function(){ openReportViewModal(row); });
    td.appendChild(btn);
    return td;
}

function buildAttachmentCell(row){
    if(!row.attachment_file_path){
        const td = document.createElement("td");
        td.textContent = "—";
        return td;
    }
    return lingkodBuildFileInfoCell(toFileShape(row), {
        onView: function(){ lingkodOpenSimpleFilePreview(toFileShape(row)); }
    });
}

function renderReports(rows){
    reportsTableBody.innerHTML = "";

    if(rows.length === 0){
        reportsTableBody.appendChild(lingkodCreateEmptyRow("No reports found.", 8));
        return;
    }

    rows.forEach(function(row){
        const statusClass = REPORT_STATUS_CLASSES[row.status] || row.status;
        const statusLabel = REPORT_STATUS_LABELS[row.status] || row.status;

        const tr = document.createElement("tr");
        tr.appendChild(lingkodCreateCell(row.report_id));
        tr.appendChild(lingkodCreateCell(row.report_title));
        tr.appendChild(lingkodCreateCell(recipientDisplay(row)));
        tr.appendChild(lingkodCreateCell(formatReportTypeDisplay(row)));
        tr.appendChild(buildDateTimeCell(row.created_at));
        tr.appendChild(lingkodCreateStatusCell(statusClass, { [statusClass]: statusLabel }));
        tr.appendChild(buildAttachmentCell(row));
        tr.appendChild(buildViewActionCell(row));
        reportsTableBody.appendChild(tr);
    });
}

/* ================= REPORTS ASSIGNED TO ME (org_president / osoa_eb) ================= */

function getFilteredManageReports(){
    const query = reportManageSearch.value.trim().toLowerCase();
    const typeFilter = reportManageTypeFilter.value;
    const statusFilter = reportManageStatusFilter.value;
    const dateFilter = reportManageDateFilter.value;

    return manageReports.filter(function(row){
        if(typeFilter !== "all" && row.report_type !== typeFilter) return false;
        if(statusFilter !== "all" && row.status !== statusFilter) return false;
        if(!lingkodMatchesCalendarDateFilter(row.created_at, dateFilter)) return false;

        if(query){
            const haystack = [row.report_id, row.reporter_name].filter(Boolean).join(" ").toLowerCase();
            if(!haystack.includes(query)) return false;
        }

        return true;
    });
}

function renderManageTable(rows){
    reportManageTableBody.innerHTML = "";

    if(rows.length === 0){
        reportManageTableBody.appendChild(lingkodCreateEmptyRow("No reports match these filters.", 8));
        return;
    }

    rows.forEach(function(row){
        const statusClass = REPORT_STATUS_CLASSES[row.status] || row.status;
        const statusLabel = REPORT_STATUS_LABELS[row.status] || row.status;

        const tr = document.createElement("tr");
        tr.appendChild(lingkodCreateCell(row.report_id));
        tr.appendChild(lingkodCreateCell(row.reporter_name || "Unknown"));
        tr.appendChild(lingkodCreateCell(row.organization_name || "Not set"));
        tr.appendChild(lingkodCreateCell(formatReportTypeDisplay(row)));
        tr.appendChild(buildDateTimeCell(row.created_at));
        tr.appendChild(lingkodCreateStatusCell(statusClass, { [statusClass]: statusLabel }));
        tr.appendChild(buildAttachmentCell(row));
        tr.appendChild(buildViewActionCell(row));
        reportManageTableBody.appendChild(tr);
    });
}

function renderManagePage(){
    const filtered = getFilteredManageReports();
    const totalPages = Math.max(1, Math.ceil(filtered.length / MANAGE_PAGE_SIZE));
    if(manageCurrentPage > totalPages) manageCurrentPage = totalPages;

    const start = (manageCurrentPage - 1) * MANAGE_PAGE_SIZE;
    renderManageTable(filtered.slice(start, start + MANAGE_PAGE_SIZE));
    lingkodRenderPagination(reportManagePagination, manageCurrentPage, totalPages, function(page){
        manageCurrentPage = page;
        renderManagePage();
    });
}

[reportManageSearch, reportManageTypeFilter, reportManageStatusFilter, reportManageDateFilter].forEach(function(el){
    if(!el) return;
    el.addEventListener(el.tagName === "SELECT" ? "change" : "input", function(){
        manageCurrentPage = 1;
        renderManagePage();
    });
});

/* ================= LOAD ================= */

async function loadReports(){
    if(!currentProfile){
        renderReports([]);
        if(reportManagementBox) reportManagementBox.style.display = "none";
        return;
    }

    const { data, error } = await supabaseClient
        .from("reports")
        .select("id, report_id, reporter_id, reporter_name, reporter_role, organization_id, organization_name, recipient_type, recipient_organization_id, recipient_position, report_title, report_type, specified_type, report_details, attachment_file_name, attachment_file_path, attachment_file_type, attachment_file_size, storage_bucket, status, remarks, updated_by, created_at, updated_at")
        .order("created_at", { ascending: false });

    if(error){
        console.error("[reports] load failed:", error);
        reportsTableBody.innerHTML = "";
        reportsTableBody.appendChild(lingkodCreateEmptyRow("Couldn't load reports (" + error.message + ").", 8));
        return;
    }

    allReports = data;

    // "My Reports" stays exactly "my own submissions" - RLS may also
    // return rows addressed to this viewer that they didn't submit
    // themselves, so this filter can't be skipped for any role.
    const myReports = data.filter(function(row){ return row.reporter_id === currentProfile.id; });
    renderReports(myReports);

    if(reportManagementBox){
        const showManagement = canSeeManagementTable();
        reportManagementBox.style.display = showManagement ? "" : "none";
        if(showManagement && reportManageTableBody){
            manageReports = data.filter(isReportRecipient);
            renderManagePage();
        }
    }
}

/* ================= SUBMIT ================= */

reportForm.addEventListener("submit", async function(e){
    e.preventDefault();

    const reportTitle = reportTitleInput.value.trim();
    const reportType = reportTypeSelect.value;
    const specifiedType = reportSpecifiedTypeInput.value.trim();
    const recipientValue = reportRecipientSelect.value;
    const reportDetails = reportDetailsInput.value.trim();
    const file = reportFileInput.files[0];

    if(!currentProfile){
        lingkodToast("Please log in with a registered account to submit a report.", "error");
        return;
    }

    if(!reportTitle){
        lingkodToast("Please enter a report title.", "error");
        return;
    }

    if(!reportType){
        lingkodToast("Please select a report type.", "error");
        return;
    }

    if(reportType === "Others" && !specifiedType){
        reportSpecifiedTypeError.textContent = "Please specify your report type.";
        reportSpecifiedTypeError.classList.add("visible");
        reportSpecifiedTypeInput.focus();
        return;
    }
    reportSpecifiedTypeError.classList.remove("visible");

    if(!recipientValue){
        lingkodToast("Please select a recipient.", "error");
        return;
    }

    if(recipientValue === "org_president" && !currentProfile.organization_id){
        lingkodToast("You must belong to an organization to address a report to your Organization President.", "error");
        return;
    }

    if(!file){
        lingkodToast("Please attach your report file.", "error");
        return;
    }

    let recipientType, recipientPosition;
    if(recipientValue === "org_president"){
        recipientType = "org_president";
        recipientPosition = null;
    } else {
        recipientType = "osoa_eb_position";
        recipientPosition = recipientValue.slice("osoa_eb_position:".length);
    }

    lingkodSetButtonLoading(reportButton, true, "Submitting...");

    try {
        let fileMeta;
        try {
            fileMeta = await uploadReportFile(file, currentProfile.id);
        } catch(uploadError){
            console.error("[reports] file upload failed:", uploadError);
            lingkodToast("Failed to upload the report file. Please try again.", "error");
            return;
        }

        const { error } = await supabaseClient
            .from("reports")
            .insert(Object.assign({
                reporter_id: currentProfile.id,
                recipient_type: recipientType,
                recipient_position: recipientPosition,
                report_title: reportTitle,
                report_type: reportType,
                specified_type: reportType === "Others" ? specifiedType : null,
                report_details: reportDetails || null
            }, fileMeta));

        if(error){
            console.error("[reports] submit failed:", error);
            lingkodToast("Failed to submit the report. Please try again.", "error");
            return;
        }

        reportForm.reset();
        reportFullNameDisplay.value = currentProfile.full_name;
        reportSpecifyFieldWrap.classList.remove("visible");
        resetReportFilePicker();
        populateRecipientOptions();

        lingkodToast("Report submitted successfully.", "success");
        await loadReports();
    } finally {
        lingkodSetButtonLoading(reportButton, false);
    }
});

document.addEventListener("DOMContentLoaded", async function(){
    await loadIdentity();
    await loadOsoaPositions();
    populateRecipientOptions();
    await loadReports();
});

// Live updates: a new submission, or a recipient's status/remarks change,
// refreshes both tables on this page for anyone with it open - no reload.
supabaseClient
    .channel("reports_page_changes")
    .on("postgres_changes", { event: "*", schema: "public", table: "reports" }, function(){
        loadReports();
    })
    .subscribe();
