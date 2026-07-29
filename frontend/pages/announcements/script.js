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

        const submitBtn = announcementForm.querySelector("button[type=submit]");
        const isEditing = !!editingAnnouncementId;
        lingkodSetButtonLoading(submitBtn, true, isEditing ? "Updating..." : "Posting...");

        const payload = {
            title: what,
            content: description,
            event_date: when,
            event_location: where || null,
            event_who: who || null,
            visibility: visibility,
            organization: visibility === "public" ? null : profile.organization
        };

        const { error } = isEditing
            ? await supabaseClient.from("announcements").update(payload).eq("id", editingAnnouncementId)
            : await supabaseClient.from("announcements").insert(Object.assign({ created_by: profile.id }, payload));

        lingkodSetButtonLoading(submitBtn, false);

        if(error){
            console.error("[announcements] save failed:", error);
            lingkodToast("Failed to save announcement: " + error.message, "error");
            return;
        }

        lingkodToast(isEditing ? "Announcement Updated Successfully" : "Announcement Posted Successfully", "success");
        exitEditMode();
        await loadAnnouncements();
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
