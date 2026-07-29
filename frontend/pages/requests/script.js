const fullNameDisplay = document.getElementById("fullNameDisplay");
const studentNumberDisplay = document.getElementById("studentNumberDisplay");
const requestTypeSelect = document.getElementById("requestTypeSelect");
const specifyFieldWrap = document.getElementById("specifyFieldWrap");
const specifiedTypeInput = document.getElementById("specifiedTypeInput");
const specifiedTypeError = document.getElementById("specifiedTypeError");

const requestsTableBody = document.getElementById("requestsTableBody");
const requestForm = document.getElementById("requestForm");
const requestButton = requestForm.querySelector("button[type=\"submit\"]");

const requestSearch = document.getElementById("requestSearch");
const requestTypeFilter = document.getElementById("requestTypeFilter");
const requestStatusFilter = document.getElementById("requestStatusFilter");
const requestDateFilter = document.getElementById("requestDateFilter");
const requestManageTableBody = document.getElementById("requestManageTableBody");
const requestManagePagination = document.getElementById("requestManagePagination");

const MANAGE_PAGE_SIZE = 10;

// requests.status is a Postgres enum: pending/received/under_review/
// approved/rejected/completed. Row visibility (own requests vs.
// everyone's for osoa_eb) is already enforced server-side by RLS
// (requests_select).
const REQUEST_STATUS_LABELS = {
    pending: "Pending",
    received: "Received",
    under_review: "Under Review",
    approved: "Approved",
    rejected: "Rejected",
    completed: "Completed"
};

const REQUEST_STATUS_CLASSES = {
    pending: "pending",
    received: "received",
    under_review: "under-review",
    approved: "approved",
    rejected: "rejected",
    completed: "completed"
};

let currentProfile = null;
let canManageRequests = false;
let allRequests = [];
let manageCurrentPage = 1;

/* ================= FULL NAME / STUDENT NUMBER AUTO-FILL ================= */

async function loadIdentity(){
    currentProfile = await lingkodGetAuthedProfile();
    if(currentProfile){
        fullNameDisplay.value = currentProfile.full_name;
        studentNumberDisplay.value = currentProfile.student_number || "Not set";
    } else {
        fullNameDisplay.value = "Not available for demo accounts";
        studentNumberDisplay.value = "Not available for demo accounts";
        requestButton.disabled = true;
    }
}

/* ================= "PLEASE SPECIFY" SHOW/HIDE ================= */

requestTypeSelect.addEventListener("change", function(){
    const isOthers = requestTypeSelect.value === "Others";
    specifyFieldWrap.classList.toggle("visible", isOthers);
    specifiedTypeError.classList.remove("visible");
    if(!isOthers) specifiedTypeInput.value = "";
});

/* ================= FORMATTING HELPERS ================= */

// Shared with feedback/script.js's identical copies - see
// lingkodFormatDateTime/lingkodBuildDateTimeCell in js/common.js.
function formatRequestDateTime(isoString){
    return lingkodFormatDateTime(isoString);
}

function buildDateTimeCell(isoString){
    return lingkodBuildDateTimeCell(isoString, "request-datetime");
}

function formatRequestTypeDisplay(row){
    if(row.request_type === "Others" && row.specified_type){
        return "Others (" + row.specified_type + ")";
    }
    return row.request_type;
}

/* ================= VIEW REQUEST MODAL ================= */

function buildRequestViewBody(row){
    const wrapper = document.createElement("div");
    wrapper.className = "review-form";

    const badge = document.createElement("span");
    badge.className = "status " + (REQUEST_STATUS_CLASSES[row.status] || row.status);
    badge.textContent = REQUEST_STATUS_LABELS[row.status] || row.status;
    wrapper.appendChild(badge);

    const parts = formatRequestDateTime(row.created_at);

    const fields = [
        ["Request ID", row.request_id],
        ["Submitted By", row.full_name || "Unknown"],
        ["Student Number", row.student_number || "Not set"],
        ["Request Type", row.request_type]
    ];
    if(row.request_type === "Others" && row.specified_type){
        fields.push(["Specified Type", row.specified_type]);
    }
    fields.push(["Date Submitted", parts.date]);
    fields.push(["Time Submitted", parts.time]);

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

    const descField = document.createElement("div");
    descField.className = "view-modal-field";
    const descLabel = document.createElement("label");
    descLabel.textContent = "Request Description";
    const descValue = document.createElement("p");
    descValue.className = "request-view-description";
    descValue.textContent = row.request_description;
    descField.appendChild(descLabel);
    descField.appendChild(descValue);
    wrapper.appendChild(descField);

    if(row.remarks){
        const remarksField = document.createElement("div");
        remarksField.className = "view-modal-field";
        const remarksLabel = document.createElement("label");
        remarksLabel.textContent = "Internal Remarks";
        const remarksValue = document.createElement("span");
        remarksValue.textContent = row.remarks;
        remarksField.appendChild(remarksLabel);
        remarksField.appendChild(remarksValue);
        wrapper.appendChild(remarksField);
    }

    return wrapper;
}

// osoa_eb-only: status update + internal remarks (visible only to
// osoa_eb, not the submitter's own status table).
function buildRequestManageForm(row){
    const wrapper = document.createElement("div");
    wrapper.className = "request-manage-form";

    const statusLabel = document.createElement("label");
    statusLabel.textContent = "Update Status";
    wrapper.appendChild(statusLabel);

    const statusSelect = document.createElement("select");
    Object.keys(REQUEST_STATUS_LABELS).forEach(function(key){
        const option = document.createElement("option");
        option.value = key;
        option.textContent = REQUEST_STATUS_LABELS[key];
        if(key === row.status) option.selected = true;
        statusSelect.appendChild(option);
    });
    wrapper.appendChild(statusSelect);

    const remarksLabel = document.createElement("label");
    remarksLabel.textContent = "Internal Remarks";
    wrapper.appendChild(remarksLabel);

    const remarksInput = document.createElement("textarea");
    remarksInput.value = row.remarks || "";
    remarksInput.placeholder = "Add internal remarks (optional)...";
    wrapper.appendChild(remarksInput);

    const saveBtn = document.createElement("button");
    saveBtn.type = "button";
    saveBtn.innerHTML = "<i class=\"fa-solid fa-check\"></i> Save Changes";
    saveBtn.addEventListener("click", async function(){
        lingkodSetButtonLoading(saveBtn, true, "Saving...");
        const { error } = await supabaseClient
            .from("requests")
            .update({ status: statusSelect.value, remarks: remarksInput.value.trim() || null })
            .eq("id", row.id);
        lingkodSetButtonLoading(saveBtn, false);

        if(error){
            console.error("[requests] update failed:", error);
            lingkodToast("Failed to update this request: " + error.message, "error");
            return;
        }

        lingkodToast("Request updated successfully.", "success");
        lingkodCloseModal();
        await loadRequests();
    });
    wrapper.appendChild(saveBtn);

    return wrapper;
}

function openRequestViewModal(row){
    const wrapper = document.createElement("div");
    wrapper.className = "view-modal";
    wrapper.appendChild(buildRequestViewBody(row));

    if(canManageRequests){
        wrapper.appendChild(buildRequestManageForm(row));
    }

    lingkodOpenModal("Request " + row.request_id, wrapper);
}

/* ================= REQUEST TRACKING (shared table) ================= */

function buildViewActionCell(row){
    const td = document.createElement("td");
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "view-btn";
    btn.innerHTML = "<i class=\"fa-solid fa-eye\"></i> View";
    btn.addEventListener("click", function(){ openRequestViewModal(row); });
    td.appendChild(btn);
    return td;
}

function renderRequests(rows){
    requestsTableBody.innerHTML = "";

    if(rows.length === 0){
        requestsTableBody.appendChild(lingkodCreateEmptyRow("No requests found.", 7));
        return;
    }

    rows.forEach(function(row){
        const statusClass = REQUEST_STATUS_CLASSES[row.status] || row.status;
        const statusLabel = REQUEST_STATUS_LABELS[row.status] || row.status;

        const tr = document.createElement("tr");
        tr.appendChild(lingkodCreateCell(row.request_id));
        tr.appendChild(lingkodCreateCell(row.full_name || "Unknown"));
        tr.appendChild(lingkodCreateCell(row.organization || "Not set"));
        tr.appendChild(lingkodCreateCell(formatRequestTypeDisplay(row)));
        tr.appendChild(buildDateTimeCell(row.created_at));
        tr.appendChild(lingkodCreateStatusCell(statusClass, { [statusClass]: statusLabel }));
        tr.appendChild(buildViewActionCell(row));
        requestsTableBody.appendChild(tr);
    });
}

/* ================= REQUEST MANAGEMENT (osoa_eb only) ================= */

function getFilteredManageRequests(){
    const query = requestSearch.value.trim().toLowerCase();
    const typeFilter = requestTypeFilter.value;
    const statusFilter = requestStatusFilter.value;
    const dateFilter = requestDateFilter.value;

    return allRequests.filter(function(row){
        if(typeFilter !== "all" && row.request_type !== typeFilter) return false;
        if(statusFilter !== "all" && row.status !== statusFilter) return false;
        if(!lingkodMatchesCalendarDateFilter(row.created_at, dateFilter)) return false;

        if(query){
            const haystack = [row.request_id, row.full_name].filter(Boolean).join(" ").toLowerCase();
            if(!haystack.includes(query)) return false;
        }

        return true;
    });
}

function renderManageTable(rows){
    requestManageTableBody.innerHTML = "";

    if(rows.length === 0){
        requestManageTableBody.appendChild(lingkodCreateEmptyRow("No requests match these filters.", 7));
        return;
    }

    rows.forEach(function(row){
        const statusClass = REQUEST_STATUS_CLASSES[row.status] || row.status;
        const statusLabel = REQUEST_STATUS_LABELS[row.status] || row.status;

        const tr = document.createElement("tr");
        tr.appendChild(lingkodCreateCell(row.request_id));
        tr.appendChild(lingkodCreateCell(row.full_name || "Unknown"));
        tr.appendChild(lingkodCreateCell(row.organization || "Not set"));
        tr.appendChild(lingkodCreateCell(formatRequestTypeDisplay(row)));
        tr.appendChild(buildDateTimeCell(row.created_at));
        tr.appendChild(lingkodCreateStatusCell(statusClass, { [statusClass]: statusLabel }));
        tr.appendChild(buildViewActionCell(row));
        requestManageTableBody.appendChild(tr);
    });
}

function renderManagePage(){
    const filtered = getFilteredManageRequests();
    const totalPages = Math.max(1, Math.ceil(filtered.length / MANAGE_PAGE_SIZE));
    if(manageCurrentPage > totalPages) manageCurrentPage = totalPages;

    const start = (manageCurrentPage - 1) * MANAGE_PAGE_SIZE;
    renderManageTable(filtered.slice(start, start + MANAGE_PAGE_SIZE));
    lingkodRenderPagination(requestManagePagination, manageCurrentPage, totalPages, function(page){
        manageCurrentPage = page;
        renderManagePage();
    });
}

[requestSearch, requestTypeFilter, requestStatusFilter, requestDateFilter].forEach(function(el){
    if(!el) return;
    el.addEventListener(el.tagName === "SELECT" ? "change" : "input", function(){
        manageCurrentPage = 1;
        renderManagePage();
    });
});

/* ================= LOAD ================= */

async function loadRequests(){
    const session = lingkodGetSession();
    canManageRequests = !!session && session.role === "admin";

    let query = supabaseClient
        .from("requests")
        .select("id, request_id, user_id, full_name, student_number, organization, request_type, specified_type, request_description, remarks, status, created_at")
        .order("created_at", { ascending: false });

    if(!canManageRequests){
        if(!currentProfile){
            renderRequests([]);
            return;
        }
        query = query.eq("user_id", currentProfile.id);
    }

    const { data, error } = await query;

    if(error){
        console.error("[requests] load failed:", error);
        requestsTableBody.innerHTML = "";
        requestsTableBody.appendChild(lingkodCreateEmptyRow("Couldn't load requests (" + error.message + ").", 6));
        return;
    }

    allRequests = data;
    renderRequests(data);

    if(canManageRequests && requestManageTableBody){
        renderManagePage();
    }
}

/* ================= SUBMIT ================= */

requestForm.addEventListener("submit", async function(e){
    e.preventDefault();

    const requestType = requestTypeSelect.value;
    const specifiedType = specifiedTypeInput.value.trim();
    const description = requestForm.elements.description.value.trim();

    if(!requestType){
        lingkodToast("Please select a request type.", "error");
        return;
    }

    if(requestType === "Others" && !specifiedType){
        specifiedTypeError.textContent = "Please specify your request type.";
        specifiedTypeError.classList.add("visible");
        specifiedTypeInput.focus();
        return;
    }
    specifiedTypeError.classList.remove("visible");

    if(!description){
        lingkodToast("Please describe your request before submitting.", "error");
        return;
    }

    if(!currentProfile){
        lingkodToast("Please log in with a registered account to submit a request.", "error");
        return;
    }

    lingkodSetButtonLoading(requestButton, true, "Submitting...");

    try {
        const { error } = await supabaseClient
            .from("requests")
            .insert({
                user_id: currentProfile.id,
                request_type: requestType,
                specified_type: requestType === "Others" ? specifiedType : null,
                request_description: description
            });

        if(error){
            console.error("[requests] submit failed:", error);
            lingkodToast("Your request could not be submitted: " + error.message, "error");
            return;
        }

        requestForm.reset();
        fullNameDisplay.value = currentProfile.full_name;
        studentNumberDisplay.value = currentProfile.student_number || "Not set";
        specifyFieldWrap.classList.remove("visible");

        lingkodToast("Your request has been submitted!", "success");
        await loadRequests();
    } finally {
        lingkodSetButtonLoading(requestButton, false);
    }
});

document.addEventListener("DOMContentLoaded", async function(){
    await loadIdentity();
    await loadRequests();
});

// Live updates: a new submission, or an osoa_eb status/remarks change,
// refreshes both tables on this page for anyone with it open - no reload.
supabaseClient
    .channel("requests_page_changes")
    .on("postgres_changes", { event: "*", schema: "public", table: "requests" }, function(){
        loadRequests();
    })
    .subscribe();
