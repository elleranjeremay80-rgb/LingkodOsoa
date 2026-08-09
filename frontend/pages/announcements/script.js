const announcementSearch = document.getElementById("announcementSearch");
const announcementDateFilter = document.getElementById("announcementDateFilter");
const announcementVisibilityFilter = document.getElementById("announcementVisibilityFilter");
const announcementSort = document.getElementById("announcementSort");
const announcementContainer = document.getElementById("announcementContainer");
const announcementPagination = document.getElementById("announcementPagination");
const announcementForm = document.getElementById("announcementForm");

const PAGE_SIZE = 10;

// In-memory copies of the last load, so search/filter/sort/pagination can
// all run client-side without hitting Supabase again on every keystroke.
let allAnnouncements = [];
let posterInfoById = {};
let currentPage = 1;
let editingAnnouncementId = null;

// Resolved once at load: who's looking at this page, and (for real
// Supabase accounts only) their actual auth.uid() - passed into the
// shared lingkodCanManageAnnouncement() check.
let viewerSession = null;
let viewerProfileId = null;

function renderAnnouncements(rows){
    announcementContainer.innerHTML = "";

    if(rows.length === 0){
        lingkodRenderAnnouncementEmptyState(announcementContainer, "No announcements available.");
        return;
    }

    rows.forEach(function(row){
        announcementContainer.appendChild(lingkodBuildAnnouncementCard(row, {
            posterInfo: posterInfoById,
            canManage: function(r){ return lingkodCanManageAnnouncement(r, viewerSession, viewerProfileId); },
            onEdit: enterEditMode,
            onDelete: async function(r, button){
                const ok = await lingkodDeleteAnnouncementRow(r.id, button);
                if(ok) await loadAnnouncements();
            }
        }));
    });
}

function renderPagination(totalItems, totalPages){
    lingkodRenderPagination(announcementPagination, currentPage, totalPages, function(page){
        currentPage = page;
        renderPage();
    });
}

// Date filter matches Requests/Feedback's calendar-aligned semantics
// (see lingkodMatchesCalendarDateFilter in js/common.js) - "This Week"
// means since Sunday, "This Month" means since the 1st, not a rolling
// last-7-days/last-30-days window. This used to be its own, different
// (rolling-window) implementation; standardized so the same filter
// label means the same thing on every page in the app.
function getFilteredSortedAnnouncements(){
    const query = announcementSearch.value.trim().toLowerCase();
    const dateFilter = announcementDateFilter.value;
    const visibilityFilter = announcementVisibilityFilter.value;
    const sort = announcementSort.value;

    let rows = allAnnouncements.filter(function(row){
        if(visibilityFilter !== "all" && row.visibility !== visibilityFilter) return false;
        if(!lingkodMatchesCalendarDateFilter(row.created_at, dateFilter)) return false;

        if(query){
            const poster = posterInfoById[row.created_by];
            const haystack = [row.title, row.content, row.event_location, row.event_who, poster && poster.full_name]
                .filter(Boolean)
                .join(" ")
                .toLowerCase();
            if(!haystack.includes(query)) return false;
        }

        return true;
    });

    rows.sort(function(a, b){
        const diff = new Date(a.created_at) - new Date(b.created_at);
        return sort === "oldest" ? diff : -diff;
    });

    return rows;
}

function renderPage(){
    const filtered = getFilteredSortedAnnouncements();
    const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
    if(currentPage > totalPages) currentPage = totalPages;

    const start = (currentPage - 1) * PAGE_SIZE;
    renderAnnouncements(filtered.slice(start, start + PAGE_SIZE));
    renderPagination(filtered.length, totalPages);
}

async function loadAnnouncements(){
    const { data, error } = await supabaseClient
        .from("announcements")
        .select("id, title, content, event_date, event_location, event_who, visibility, organization, created_by, created_at")
        .eq("is_published", true)
        .order("created_at", { ascending: false });

    if(error){
        console.error("[announcements] load failed:", error);
        lingkodRenderAnnouncementEmptyState(announcementContainer, "Couldn't load announcements (" + error.message + ").");
        lingkodToast("Couldn't load announcements. Check your internet connection.", "error");
        return;
    }

    allAnnouncements = data;
    posterInfoById = await lingkodFetchProfilesById(data.map(function(row){ return row.created_by; }));
    renderPage();
}

[announcementSearch].forEach(function(el){
    el.addEventListener("input", function(){
        currentPage = 1;
        renderPage();
    });
});

[announcementDateFilter, announcementVisibilityFilter, announcementSort].forEach(function(el){
    el.addEventListener("change", function(){
        currentPage = 1;
        renderPage();
    });
});

function enterEditMode(row){
    editingAnnouncementId = row.id;

    announcementForm.elements.what.value = row.title;
    announcementForm.elements.when.value = row.event_date || "";
    announcementForm.elements.where.value = row.event_location || "";
    announcementForm.elements.who.value = row.event_who || "";
    announcementForm.elements.description.value = row.content;
    announcementForm.elements.visibility.value = row.visibility;

    const submitBtn = announcementForm.querySelector("button[type=submit]");
    submitBtn.innerHTML = "<i class=\"fa-solid fa-pen\"></i> Update Announcement";

    if(!document.getElementById("cancelEditBtn")){
        const cancelBtn = document.createElement("button");
        cancelBtn.type = "button";
        cancelBtn.id = "cancelEditBtn";
        cancelBtn.className = "cancel-edit-btn";
        cancelBtn.textContent = "Cancel Edit";
        cancelBtn.addEventListener("click", exitEditMode);
        submitBtn.insertAdjacentElement("afterend", cancelBtn);
    }

    announcementForm.scrollIntoView({ behavior: "smooth", block: "center" });
}

function exitEditMode(){
    editingAnnouncementId = null;
    announcementForm.reset();

    const submitBtn = announcementForm.querySelector("button[type=submit]");
    submitBtn.innerHTML = "<i class=\"fa-solid fa-plus\"></i> Post Announcement";

    const cancelBtn = document.getElementById("cancelEditBtn");
    if(cancelBtn) cancelBtn.remove();
}

// Mirrors lingkodConfirmAction's own shell (js/common.js) - same classes,
// same Cancel/Confirm wiring, same "stay open + re-arm buttons on a
// thrown error" behavior - but with structured Title/Description preview
// rows instead of one flat message string, since the requested confirm
// step needs to show the actual entered content back to the user before
// it goes live. Not built as a bespoke modal from scratch: reuses
// .confirm-modal/.confirm-modal-actions (common.css) and .view-modal-field
// (this page's own style.css) so it looks identical to every other
// confirm modal in the app.
function openAnnouncementConfirmModal(payload, isEditing, onConfirmed){
    const wrap = document.createElement("div");
    wrap.className = "confirm-modal";

    const icon = document.createElement("div");
    icon.className = "confirm-modal-icon confirm-modal-icon-neutral";
    icon.innerHTML = "<i class=\"fa-solid fa-bullhorn\"></i>";
    wrap.appendChild(icon);

    const message = document.createElement("p");
    message.className = "confirm-modal-message";
    message.textContent = "Are you sure you want to " + (isEditing ? "update" : "post") + " this announcement?";
    wrap.appendChild(message);

    const fields = document.createElement("div");
    fields.className = "announcement-confirm-fields";

    const titleField = document.createElement("div");
    titleField.className = "view-modal-field";
    const titleLabel = document.createElement("label");
    titleLabel.textContent = "Title";
    const titleValue = document.createElement("span");
    titleValue.textContent = payload.title;
    titleField.appendChild(titleLabel);
    titleField.appendChild(titleValue);
    fields.appendChild(titleField);

    const descField = document.createElement("div");
    descField.className = "view-modal-field";
    const descLabel = document.createElement("label");
    descLabel.textContent = "Description";
    const descValue = document.createElement("p");
    descValue.className = "announcement-confirm-description";
    descValue.textContent = payload.content;
    descField.appendChild(descLabel);
    descField.appendChild(descValue);
    fields.appendChild(descField);

    wrap.appendChild(fields);

    const visibilityNote = document.createElement("p");
    visibilityNote.className = "confirm-modal-message";
    visibilityNote.textContent = "This announcement will be visible to "
        + (payload.visibility === "public" ? "everyone" : "the users who have access to it") + ".";
    wrap.appendChild(visibilityNote);

    const actions = document.createElement("div");
    actions.className = "confirm-modal-actions";

    const cancelBtn = document.createElement("button");
    cancelBtn.type = "button";
    cancelBtn.className = "btn-secondary";
    cancelBtn.textContent = "Cancel";
    cancelBtn.addEventListener("click", lingkodCloseModal);

    const confirmBtn = document.createElement("button");
    confirmBtn.type = "button";
    confirmBtn.className = "btn-primary-action";
    confirmBtn.textContent = isEditing ? "Confirm & Update" : "Confirm & Post";
    confirmBtn.addEventListener("click", async function(){
        lingkodSetButtonLoading(confirmBtn, true, isEditing ? "Updating..." : "Posting...");
        cancelBtn.disabled = true;
        try {
            await onConfirmed();
            lingkodCloseModal();
        } catch(err){
            lingkodSetButtonLoading(confirmBtn, false);
            cancelBtn.disabled = false;
        }
    });

    actions.appendChild(cancelBtn);
    actions.appendChild(confirmBtn);
    wrap.appendChild(actions);

    lingkodOpenModal(isEditing ? "Confirm Update" : "Confirm Announcement", wrap, "modal-confirm");
}

if(announcementForm){
    announcementForm.addEventListener("submit", async function(e){
        e.preventDefault();

        const what = announcementForm.elements.what.value.trim();
        const when = announcementForm.elements.when.value || null;
        const where = announcementForm.elements.where.value.trim();
        const who = announcementForm.elements.who.value.trim();
        const description = announcementForm.elements.description.value.trim();
        const visibility = announcementForm.elements.visibility.value;

        if(!what || !description){
            lingkodToast("Please fill in at least the \"What\" and \"Description\" fields.", "error");
            return;
        }

        const profile = await lingkodGetAuthedProfile();
        if(!profile){
            lingkodToast("Please log in with a registered account to post an announcement.", "error");
            return;
        }

        const isEditing = !!editingAnnouncementId;

        const payload = {
            title: what,
            content: description,
            event_date: when,
            event_location: where || null,
            event_who: who || null,
            visibility: visibility,
            organization: visibility === "public" ? null : profile.organization
        };

        // The form's own values already live in `payload` by this point -
        // Cancel just closes the modal (lingkodCloseModal, wired above)
        // and leaves the form exactly as the user left it; nothing is
        // saved/published until Confirm actually runs this callback.
        openAnnouncementConfirmModal(payload, isEditing, async function(){
            const { error } = isEditing
                ? await supabaseClient.from("announcements").update(payload).eq("id", editingAnnouncementId)
                : await supabaseClient.from("announcements").insert(Object.assign({ created_by: profile.id }, payload));

            if(error){
                console.error("[announcements] save failed:", error);
                lingkodToast("Failed to save announcement: " + error.message, "error");
                throw error;
            }

            lingkodToast(isEditing ? "Announcement Updated Successfully" : "Announcement Posted Successfully", "success");
            exitEditMode();
            await loadAnnouncements();
        });
    });
}

document.addEventListener("DOMContentLoaded", async function(){
    viewerSession = lingkodGetSession();
    const authedProfile = await lingkodGetAuthedProfile();
    viewerProfileId = authedProfile ? authedProfile.id : null;

    await loadAnnouncements();

    // Deep link from the dashboard's Edit button (?edit=<id>) jumps
    // straight into editing that announcement instead of just landing on
    // this page and making the user find + click Edit themselves.
    const editId = new URLSearchParams(location.search).get("edit");
    if(editId){
        const row = allAnnouncements.find(function(r){ return r.id === editId; });
        if(row && lingkodCanManageAnnouncement(row, viewerSession, viewerProfileId)){
            enterEditMode(row);
        }
    }
});

// Live updates: any insert/update/delete on announcements (from this tab,
// another tab, or another user entirely) refreshes the list automatically
// - no page reload needed anywhere it's open.
supabaseClient
    .channel("announcements_page_changes")
    .on("postgres_changes", { event: "*", schema: "public", table: "announcements" }, function(){
        loadAnnouncements();
    })
    .subscribe();
