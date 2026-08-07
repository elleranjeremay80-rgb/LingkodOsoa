const ratingStars = document.querySelectorAll("#rating i");
let selectedRating = 4;

ratingStars.forEach(function(star){
    star.addEventListener("click", function(){
        selectedRating = Number(star.dataset.value);

        ratingStars.forEach(function(s){
            const isFilled = Number(s.dataset.value) <= selectedRating;
            s.className = isFilled ? "fa-solid fa-star" : "fa-regular fa-star";
        });
    });
});

const fullNameDisplay = document.getElementById("fullNameDisplay");
const feedbackTypeSelect = document.getElementById("feedbackTypeSelect");
const specifyFieldWrap = document.getElementById("specifyFieldWrap");
const specifiedTypeInput = document.getElementById("specifiedTypeInput");
const specifiedTypeError = document.getElementById("specifiedTypeError");

const feedbackTableBody = document.getElementById("feedbackTableBody");
const feedbackForm = document.getElementById("feedbackForm");
const feedbackButton = feedbackForm.querySelector("button[type=\"submit\"]");

const feedbackSearch = document.getElementById("feedbackSearch");
const feedbackTypeFilter = document.getElementById("feedbackTypeFilter");
const feedbackStatusFilter = document.getElementById("feedbackStatusFilter");
const feedbackDateFilter = document.getElementById("feedbackDateFilter");
const feedbackManageTableBody = document.getElementById("feedbackManageTableBody");
const feedbackManagePagination = document.getElementById("feedbackManagePagination");

const MANAGE_PAGE_SIZE = 10;

const FEEDBACK_TYPE_LABELS = {
    complaint: "Complaint",
    suggestion: "Suggestion",
    inquiry: "Inquiry",
    appreciation: "Appreciation",
    bug_report: "Bug Report",
    others: "Others"
};

// feedback.status is a Postgres enum: new/reviewed/in_progress/resolved/
// completed. Row visibility (own feedback vs. everyone's for osoa_eb) is
// already enforced server-side by RLS (feedback_select).
const FEEDBACK_STATUS_LABELS = {
    pending: "Pending",
    under_review: "Under Review",
    approved: "Approved",
    rejected: "Rejected",
    completed: "Completed"
};

const FEEDBACK_STATUS_CLASSES = {
    pending: "pending",
    under_review: "under-review",
    approved: "approved",
    rejected: "rejected",
    completed: "completed"
};

let currentProfile = null;
let canManageFeedback = false;
let allFeedback = [];
let manageCurrentPage = 1;

/* ================= FULL NAME AUTO-FILL ================= */

async function loadFullName(){
    currentProfile = await lingkodGetAuthedProfile();
    fullNameDisplay.value = currentProfile ? currentProfile.full_name : "Not available for demo accounts";
    if(!currentProfile) feedbackButton.disabled = true;
}

/* ================= "PLEASE SPECIFY" SHOW/HIDE ================= */

feedbackTypeSelect.addEventListener("change", function(){
    const isOthers = feedbackTypeSelect.value === "others";
    specifyFieldWrap.classList.toggle("visible", isOthers);
    specifiedTypeError.classList.remove("visible");
    if(!isOthers) specifiedTypeInput.value = "";
});

/* ================= FORMATTING HELPERS ================= */

// Shared with requests/script.js's identical copies - see
// lingkodFormatDateTime/lingkodBuildDateTimeCell in js/common.js.
function formatFeedbackDateTime(isoString){
    return lingkodFormatDateTime(isoString);
}

function buildDateTimeCell(isoString){
    return lingkodBuildDateTimeCell(isoString, "feedback-datetime");
}

function formatFeedbackTypeDisplay(row){
    const label = FEEDBACK_TYPE_LABELS[row.feedback_type] || row.feedback_type;
    if(row.feedback_type === "others" && row.specified_type){
        return label + " (" + row.specified_type + ")";
    }
    return label;
}

function buildStarsText(rating){
    const n = Math.max(0, Math.min(5, Number(rating) || 0));
    return "★".repeat(n) + "☆".repeat(5 - n);
}

/* ================= VIEW FEEDBACK MODAL ================= */

function buildFeedbackViewBody(row){
    const wrapper = document.createElement("div");
    wrapper.className = "review-form";

    const badge = document.createElement("span");
    badge.className = "status " + (FEEDBACK_STATUS_CLASSES[row.status] || row.status);
    badge.textContent = FEEDBACK_STATUS_LABELS[row.status] || row.status;
    wrapper.appendChild(badge);

    const parts = formatFeedbackDateTime(row.created_at);

    const fields = [
        ["Feedback ID", row.feedback_id],
        ["Submitted By", row.full_name || "Unknown"],
        ["Feedback Type", FEEDBACK_TYPE_LABELS[row.feedback_type] || row.feedback_type]
    ];
    if(row.feedback_type === "others" && row.specified_type){
        fields.push(["Specified Type", row.specified_type]);
    }
    fields.push(["Date Submitted", parts.date]);
    fields.push(["Time", parts.time]);

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

    const ratingField = document.createElement("div");
    ratingField.className = "view-modal-field";
    const ratingLabel = document.createElement("label");
    ratingLabel.textContent = "Rating";
    const ratingValue = document.createElement("span");
    ratingValue.className = "feedback-view-rating";
    ratingValue.textContent = buildStarsText(row.rating);
    ratingField.appendChild(ratingLabel);
    ratingField.appendChild(ratingValue);
    wrapper.appendChild(ratingField);

    const messageField = document.createElement("div");
    messageField.className = "view-modal-field";
    const messageLabel = document.createElement("label");
    messageLabel.textContent = "Feedback";
    const messageValue = document.createElement("p");
    messageValue.className = "feedback-view-message";
    messageValue.textContent = row.feedback_message;
    messageField.appendChild(messageLabel);
    messageField.appendChild(messageValue);
    wrapper.appendChild(messageField);

    return wrapper;
}

// osoa_eb-only: status update + a reply box that's wired up in the UI but
// doesn't send anything yet - matches how other not-yet-built channels
// (e.g. Settings' SMS toggle) are handled: functional-looking, clearly
// labeled, and never throws.
function buildFeedbackManageForm(row){
    const wrapper = document.createElement("div");
    wrapper.className = "feedback-manage-form";

    const statusLabel = document.createElement("label");
    statusLabel.textContent = "Update Status";
    wrapper.appendChild(statusLabel);

    const statusSelect = document.createElement("select");
    Object.keys(FEEDBACK_STATUS_LABELS).forEach(function(key){
        const option = document.createElement("option");
        option.value = key;
        option.textContent = FEEDBACK_STATUS_LABELS[key];
        if(key === row.status) option.selected = true;
        statusSelect.appendChild(option);
    });
    wrapper.appendChild(statusSelect);

    const saveBtn = document.createElement("button");
    saveBtn.type = "button";
    saveBtn.innerHTML = "<i class=\"fa-solid fa-check\"></i> Save Status";
    saveBtn.addEventListener("click", async function(){
        if(statusSelect.value === row.status){
            lingkodCloseModal();
            return;
        }

        lingkodSetButtonLoading(saveBtn, true, "Saving...");
        const { error } = await supabaseClient
            .from("feedback")
            .update({ status: statusSelect.value })
            .eq("id", row.id);
        lingkodSetButtonLoading(saveBtn, false);

        if(error){
            console.error("[feedback] status update failed:", error);
            lingkodToast("Failed to update status: " + error.message, "error");
            return;
        }

        lingkodToast("Feedback status updated.", "success");
        lingkodCloseModal();
        await loadFeedback();
    });
    wrapper.appendChild(saveBtn);

    const replyLabel = document.createElement("label");
    replyLabel.textContent = "Reply";
    wrapper.appendChild(replyLabel);

    const replyInput = document.createElement("textarea");
    replyInput.placeholder = "Write a reply to the submitter...";
    wrapper.appendChild(replyInput);

    const replyNote = document.createElement("small");
    replyNote.className = "feedback-reply-note";
    replyNote.textContent = "Replies will be available in a future update.";
    wrapper.appendChild(replyNote);

    const replyBtn = document.createElement("button");
    replyBtn.type = "button";
    replyBtn.className = "btn-secondary";
    replyBtn.innerHTML = "<i class=\"fa-solid fa-reply\"></i> Send Reply";
    replyBtn.addEventListener("click", function(){
        lingkodToast("Replying to feedback will be available in a future update.", "success");
    });
    wrapper.appendChild(replyBtn);

    return wrapper;
}

function openFeedbackViewModal(row){
    const wrapper = document.createElement("div");
    wrapper.className = "view-modal";
    wrapper.appendChild(buildFeedbackViewBody(row));

    if(canManageFeedback){
        wrapper.appendChild(buildFeedbackManageForm(row));
    }

    lingkodOpenModal("Feedback " + row.feedback_id, wrapper);
}

/* ================= RECENT FEEDBACK STATUS (shared table) ================= */

function buildViewActionCell(row){
    const td = document.createElement("td");
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "view-btn";
    btn.innerHTML = "<i class=\"fa-solid fa-eye\"></i> View";
    btn.addEventListener("click", function(){ openFeedbackViewModal(row); });
    td.appendChild(btn);
    return td;
}

function renderFeedback(rows){
    feedbackTableBody.innerHTML = "";

    if(rows.length === 0){
        feedbackTableBody.appendChild(lingkodCreateEmptyRow("No feedback submitted yet.", 7));
        return;
    }

    rows.forEach(function(row){
        const statusClass = FEEDBACK_STATUS_CLASSES[row.status] || row.status;
        const statusLabel = FEEDBACK_STATUS_LABELS[row.status] || row.status;

        const tr = document.createElement("tr");
        tr.appendChild(lingkodCreateCell(row.feedback_id));
        tr.appendChild(lingkodCreateCell(row.full_name || "Unknown"));
        tr.appendChild(lingkodCreateCell(row.organization || "Not set"));
        tr.appendChild(lingkodCreateCell(formatFeedbackTypeDisplay(row)));
        tr.appendChild(buildDateTimeCell(row.created_at));
        tr.appendChild(lingkodCreateStatusCell(statusClass, { [statusClass]: statusLabel }));
        tr.appendChild(buildViewActionCell(row));
        feedbackTableBody.appendChild(tr);
    });
}

/* ================= FEEDBACK MANAGEMENT (osoa_eb only) ================= */

function getFilteredManageFeedback(){
    const query = feedbackSearch.value.trim().toLowerCase();
    const typeFilter = feedbackTypeFilter.value;
    const statusFilter = feedbackStatusFilter.value;
    const dateFilter = feedbackDateFilter.value;

    return allFeedback.filter(function(row){
        if(typeFilter !== "all" && row.feedback_type !== typeFilter) return false;
        if(statusFilter !== "all" && row.status !== statusFilter) return false;
        if(!lingkodMatchesCalendarDateFilter(row.created_at, dateFilter)) return false;

        if(query){
            const haystack = [row.feedback_id, row.full_name].filter(Boolean).join(" ").toLowerCase();
            if(!haystack.includes(query)) return false;
        }

        return true;
    });
}

function renderManageTable(rows){
    feedbackManageTableBody.innerHTML = "";

    if(rows.length === 0){
        feedbackManageTableBody.appendChild(lingkodCreateEmptyRow("No feedback matches these filters.", 7));
        return;
    }

    rows.forEach(function(row){
        const statusClass = FEEDBACK_STATUS_CLASSES[row.status] || row.status;
        const statusLabel = FEEDBACK_STATUS_LABELS[row.status] || row.status;

        const tr = document.createElement("tr");
        tr.appendChild(lingkodCreateCell(row.feedback_id));
        tr.appendChild(lingkodCreateCell(row.full_name || "Unknown"));
        tr.appendChild(lingkodCreateCell(row.organization || "Not set"));
        tr.appendChild(lingkodCreateCell(formatFeedbackTypeDisplay(row)));
        tr.appendChild(buildDateTimeCell(row.created_at));
        tr.appendChild(lingkodCreateStatusCell(statusClass, { [statusClass]: statusLabel }));
        tr.appendChild(buildViewActionCell(row));
        feedbackManageTableBody.appendChild(tr);
    });
}

function renderManagePage(){
    const filtered = getFilteredManageFeedback();
    const totalPages = Math.max(1, Math.ceil(filtered.length / MANAGE_PAGE_SIZE));
    if(manageCurrentPage > totalPages) manageCurrentPage = totalPages;

    const start = (manageCurrentPage - 1) * MANAGE_PAGE_SIZE;
    renderManageTable(filtered.slice(start, start + MANAGE_PAGE_SIZE));
    lingkodRenderPagination(feedbackManagePagination, manageCurrentPage, totalPages, function(page){
        manageCurrentPage = page;
        renderManagePage();
    });
}

[feedbackSearch, feedbackTypeFilter, feedbackStatusFilter, feedbackDateFilter].forEach(function(el){
    if(!el) return;
    el.addEventListener(el.tagName === "SELECT" ? "change" : "input", function(){
        manageCurrentPage = 1;
        renderManagePage();
    });
});

/* ================= LOAD ================= */

async function loadFeedback(){
    const session = lingkodGetSession();
    canManageFeedback = !!session && session.role === "admin";

    let query = supabaseClient
        .from("feedback")
        .select("id, feedback_id, user_id, full_name, organization, feedback_type, specified_type, feedback_message, rating, status, created_at")
        .order("created_at", { ascending: false });

    if(!canManageFeedback){
        if(!currentProfile){
            renderFeedback([]);
            return;
        }
        query = query.eq("user_id", currentProfile.id);
    }

    const { data, error } = await query;

    if(error){
        console.error("[feedback] load failed:", error);
        feedbackTableBody.innerHTML = "";
        feedbackTableBody.appendChild(lingkodCreateEmptyRow("Couldn't load feedback (" + error.message + ").", 6));
        return;
    }

    allFeedback = data;
    renderFeedback(data);

    if(canManageFeedback && feedbackManageTableBody){
        renderManagePage();
    }
}

/* ================= SUBMIT ================= */

feedbackForm.addEventListener("submit", async function(e){
    e.preventDefault();

    const feedbackType = feedbackTypeSelect.value;
    const specifiedType = specifiedTypeInput.value.trim();
    const message = feedbackForm.elements.message.value.trim();

    if(!feedbackType){
        lingkodToast("Please select a feedback type.", "error");
        return;
    }

    if(feedbackType === "others" && !specifiedType){
        specifiedTypeError.textContent = "Please specify your feedback type.";
        specifiedTypeError.classList.add("visible");
        specifiedTypeInput.focus();
        return;
    }
    specifiedTypeError.classList.remove("visible");

    if(!message){
        lingkodToast("Please write your feedback before submitting.", "error");
        return;
    }

    if(!currentProfile){
        lingkodToast("Please log in with a registered account to submit feedback.", "error");
        return;
    }

    lingkodSetButtonLoading(feedbackButton, true, "Submitting...");

    try {
        const { error } = await supabaseClient
            .from("feedback")
            .insert({
                user_id: currentProfile.id,
                feedback_type: feedbackType,
                specified_type: feedbackType === "others" ? specifiedType : null,
                feedback_message: message,
                rating: selectedRating
            });

        if(error){
            console.error("[feedback] submit failed:", error);
            lingkodToast("Your feedback could not be submitted: " + error.message, "error");
            return;
        }

        feedbackForm.reset();
        fullNameDisplay.value = currentProfile.full_name;
        specifyFieldWrap.classList.remove("visible");
        ratingStars.forEach(function(s){
            const isFilled = Number(s.dataset.value) <= 4;
            s.className = isFilled ? "fa-solid fa-star" : "fa-regular fa-star";
        });
        selectedRating = 4;

        lingkodToast("Thank you for your feedback!", "success");
        await loadFeedback();
    } finally {
        lingkodSetButtonLoading(feedbackButton, false);
    }
});

document.addEventListener("DOMContentLoaded", async function(){
    await loadFullName();
    await loadFeedback();
});

// Live updates: a new submission, or an osoa_eb status change, refreshes
// both tables on this page for anyone with it open - no reload.
supabaseClient
    .channel("feedback_page_changes")
    .on("postgres_changes", { event: "*", schema: "public", table: "feedback" }, function(){
        loadFeedback();
    })
    .subscribe();
