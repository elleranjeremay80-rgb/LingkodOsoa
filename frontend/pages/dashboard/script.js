// projects_activities.status/category are Postgres enums, but the
// dashboard only ever needs the four category buckets below (each has
// its own preview panel) - row visibility itself is handled by RLS
// (projects_select lets any signed-in user read them; projects_write
// restricts create/edit/delete to is_osoa_eb() or the owning org's
// president, enforced the same way on every project page).

const DASHBOARD_SUBMISSION_STATUS_LABELS = {
    pending: "Pending Review",
    approved: "Approved",
    rejected: "Rejected",
    needs_revision: "Needs Revision"
};

// Dashboard's own Submission & Tracking widget uses bare status classes
// (.pending/.approved/.rejected - see dashboard/style.css) rather than the
// "status pending" wrapper class the dedicated Submission & Tracking page
// uses, so this can't reuse common.js's lingkodCreateStatusCell as-is.
function createDashboardStatusCell(status){
    const td = document.createElement("td");
    const span = document.createElement("span");
    span.className = status;
    span.textContent = DASHBOARD_SUBMISSION_STATUS_LABELS[status] || status;
    td.appendChild(span);
    return td;
}

// Who's looking at this dashboard, and (for real Supabase accounts only)
// their actual auth.uid() - resolved once at load, passed into the shared
// lingkodCanManageAnnouncement() check for the "Latest Announcements" card.
let dashboardViewerSession = null;
let dashboardViewerProfileId = null;

function dashboardCanManageAnnouncement(row){
    return lingkodCanManageAnnouncement(row, dashboardViewerSession, dashboardViewerProfileId);
}

// The dashboard has no announcement form of its own (adding one here would
// mean redesigning the dashboard) - Edit hands off to the Announcements
// page, which already has full edit support, and deep-links straight into
// editing this row instead of just landing on the page.
function editDashboardAnnouncement(row){
    window.location.href = "../announcements/index.html?edit=" + encodeURIComponent(row.id);
}

async function deleteDashboardAnnouncement(row, button){
    const ok = await lingkodDeleteAnnouncementRow(row.id, button);
    if(ok) await loadDashboardAnnouncements();
}

// Every announcement in the table was necessarily written by osoa_eb or
// an org_president - RLS (announcements_insert) is the only insert path -
// so there's no "student-authored" row to filter out here even though the
// student widget below is student-facing.
function renderDashboardAnnouncementWidgets(rows, posterInfo){
    const adminList = document.getElementById("dashboardAnnouncementsList");
    const studentList = document.getElementById("studentAnnouncementsList");

    if(adminList){
        adminList.innerHTML = "";
        if(rows.length === 0){
            lingkodRenderAnnouncementEmptyState(adminList, "No announcements available.");
        } else {
            // "Latest Announcements" shows exactly the single most recent
            // announcement (rows are already newest-first) as a full card.
            adminList.appendChild(lingkodBuildAnnouncementCard(rows[0], {
                posterInfo: posterInfo,
                canManage: dashboardCanManageAnnouncement,
                onEdit: editDashboardAnnouncement,
                onDelete: deleteDashboardAnnouncement
            }));
        }
    }

    if(studentList){
        studentList.innerHTML = "";
        if(rows.length === 0){
            lingkodRenderAnnouncementEmptyState(studentList, "No announcements available.");
        } else {
            // Students can only view (RLS + lingkodCanManageAnnouncement
            // both agree - role "student" is never manage-able), so no
            // canManage/onEdit/onDelete here at all.
            rows.forEach(function(row){
                studentList.appendChild(lingkodBuildAnnouncementCard(row, { posterInfo: posterInfo }));
            });
        }
    }
}

async function loadDashboardAnnouncements(){
    const adminList = document.getElementById("dashboardAnnouncementsList");
    const studentList = document.getElementById("studentAnnouncementsList");
    if(!adminList && !studentList) return;

    const { data, error } = await supabaseClient
        .from("announcements")
        .select("id, title, content, event_date, event_location, event_who, visibility, created_by, created_at")
        .eq("is_published", true)
        .order("created_at", { ascending: false })
        .limit(10);

    if(error){
        console.error("[dashboard] announcements load failed:", error);
        if(adminList) lingkodRenderAnnouncementEmptyState(adminList, "Couldn't load announcements.");
        if(studentList) lingkodRenderAnnouncementEmptyState(studentList, "Couldn't load announcements.");
        return;
    }

    const posterInfo = await lingkodFetchProfilesById(data.map(function(row){ return row.created_by; }));
    renderDashboardAnnouncementWidgets(data, posterInfo);
}

// Shared with submission/script.js's identical map - see
// LINGKOD_SUBMISSION_CATEGORY_LABELS in js/common.js.
const DASHBOARD_SUBMISSION_CATEGORY_LABELS = LINGKOD_SUBMISSION_CATEGORY_LABELS;

function buildSubmissionPreviewItem(row){
    const item = document.createElement("div");
    item.className = "preview-item";

    const h4 = document.createElement("h4");
    h4.textContent = row.document_title;
    item.appendChild(h4);

    const meta = document.createElement("span");
    meta.className = "preview-meta";
    const icon = document.createElement("i");
    icon.className = "fa-solid fa-circle-check";
    meta.appendChild(icon);
    meta.appendChild(document.createTextNode(
        " " + (DASHBOARD_SUBMISSION_CATEGORY_LABELS[row.category] || row.category)
        + " · Approved " + lingkodFormatDate(row.updated_at || row.created_at)
    ));
    item.appendChild(meta);

    if(row.file_path){
        const downloadBtn = document.createElement("button");
        downloadBtn.type = "button";
        downloadBtn.className = "file-action-btn";
        downloadBtn.innerHTML = "<i class=\"fa-solid fa-download\"></i> Download";
        downloadBtn.addEventListener("click", function(){ lingkodDownloadFile(row, downloadBtn); });
        item.appendChild(downloadBtn);
    }

    return item;
}

function renderStudentSubmissionsPreview(rows, errorMessage){
    const panel = document.querySelector('.preview-panel[data-preview="submissions"]');
    if(!panel) return;

    const heading = panel.querySelector("h2");
    panel.innerHTML = "";
    panel.appendChild(heading);

    if(errorMessage){
        const p = document.createElement("p");
        p.className = "preview-empty";
        p.textContent = errorMessage;
        panel.appendChild(p);
        return;
    }

    if(rows.length === 0){
        const p = document.createElement("p");
        p.className = "preview-empty";
        p.textContent = "No approved submissions yet.";
        panel.appendChild(p);
        return;
    }

    const list = document.createElement("div");
    list.className = "preview-panel-list";
    rows.forEach(function(row){
        list.appendChild(buildSubmissionPreviewItem(row));
    });
    panel.appendChild(list);
}

// Only *approved* submissions ever reach the student "Approved
// Submissions" preview panel - pending/rejected/needs-revision documents
// stay confined to the submitter's own Submission & Tracking page and
// OSOA EB's review page (RLS (submissions_select) already only exposes
// approved rows platform-wide to non-owners, but this filter is what
// actually narrows the query to them for this specific, explicitly-
// labeled "approved only" widget).
async function loadDashboardSubmissions(){
    const studentPanel = document.querySelector('.preview-panel[data-preview="submissions"]');
    if(!studentPanel) return;

    const { data, error } = await supabaseClient
        .from("submissions")
        .select("id, document_title, category, status, created_at, updated_at, file_name, file_path, storage_bucket, file_type, file_size")
        .eq("status", "approved")
        .order("updated_at", { ascending: false })
        .limit(4);

    if(error){
        console.error("[dashboard] submissions load failed:", error);
        renderStudentSubmissionsPreview([], "Couldn't load submissions.");
        return;
    }

    renderStudentSubmissionsPreview(data);
}

// The "Submission & Tracking" widget (admin/staff view) is a different
// thing entirely: a recent-activity feed, not a public showcase - no
// status filter here, so RLS (submissions_select) decides what each
// viewer actually gets back: osoa_eb sees every recent submission
// (any status, since reviewing them is their job); org_president sees
// their own recent uploads (any status) plus other orgs' approved ones.
// Either way it's capped at 5 most recent. "Review" doesn't duplicate the
// approve/reject/view-modal logic here - it's a plain link to the real
// Submission & Tracking page, which already has all of that.
async function loadRecentSubmissionsWidget(){
    const body = document.getElementById("dashboardSubmissionsBody");
    if(!body) return;

    const { data, error } = await supabaseClient
        .from("submissions")
        .select("id, document_title, status, created_at")
        .order("created_at", { ascending: false })
        .limit(5);

    body.innerHTML = "";

    if(error){
        console.error("[dashboard] recent submissions load failed:", error);
        body.appendChild(lingkodCreateEmptyRow("Couldn't load submissions.", 4));
        return;
    }

    if(data.length === 0){
        body.appendChild(lingkodCreateEmptyRow("No submissions available.", 4));
        return;
    }

    data.forEach(function(row){
        const tr = document.createElement("tr");
        tr.appendChild(lingkodCreateCell(row.document_title));
        tr.appendChild(createDashboardStatusCell(row.status));
        tr.appendChild(lingkodCreateCell(lingkodFormatDate(row.created_at)));

        const actionTd = document.createElement("td");
        const reviewLink = document.createElement("a");
        reviewLink.className = "quick-review-link";
        reviewLink.href = "../submission/index.html";
        reviewLink.innerHTML = "<i class=\"fa-solid fa-magnifying-glass\"></i> Review";
        actionTd.appendChild(reviewLink);
        tr.appendChild(actionTd);

        body.appendChild(tr);
    });
}

/* ================= CALENDAR ================= */
// Both the admin section and the student section render their own
// ".calendar-panel" copy (only one is ever visible at a time - common.js's
// data-role-view gate hides the other), but they always show the same
// data, so a single shared month cursor drives every panel found on the
// page rather than tracking per-panel state.

const CALENDAR_VISIBILITY_LABELS = {
    public: "Public",
    organization: "Organization",
    department: "Department"
};

let calendarViewDate = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
let calendarAnnouncements = [];
let calendarPosterInfo = {};

function calendarDateKey(year, month, day){
    return year + "-" + String(month + 1).padStart(2, "0") + "-" + String(day).padStart(2, "0");
}

function buildCalendarDayMap(rows){
    const map = {};
    rows.forEach(function(row){
        if(!row.event_date) return;
        if(!map[row.event_date]) map[row.event_date] = [];
        map[row.event_date].push(row);
    });
    return map;
}

function buildCalendarDetailLine(iconClass, label, value){
    const span = document.createElement("span");
    const icon = document.createElement("i");
    icon.className = iconClass;
    span.appendChild(icon);
    const strong = document.createElement("strong");
    strong.textContent = label + ": ";
    span.appendChild(strong);
    span.appendChild(document.createTextNode(value || "Not specified"));
    return span;
}

function buildCalendarAnnouncementCard(row){
    const card = document.createElement("div");
    card.className = "modal-announcement";

    const badge = document.createElement("span");
    badge.className = "badge";
    badge.textContent = CALENDAR_VISIBILITY_LABELS[row.visibility] || row.visibility;
    card.appendChild(badge);

    const h3 = document.createElement("h3");
    h3.textContent = row.title;
    card.appendChild(h3);

    const eventDate = new Date(row.event_date + "T00:00:00").toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });

    const details = document.createElement("div");
    details.className = "modal-announcement-details";
    details.appendChild(buildCalendarDetailLine("fa-solid fa-calendar-day", "Event Date", eventDate));
    details.appendChild(buildCalendarDetailLine("fa-solid fa-location-dot", "Venue", row.event_location));
    details.appendChild(buildCalendarDetailLine("fa-solid fa-users", "Audience", row.event_who));
    card.appendChild(details);

    const desc = document.createElement("p");
    desc.className = "modal-announcement-desc";
    desc.textContent = row.content;
    card.appendChild(desc);

    const poster = calendarPosterInfo[row.created_by];
    const posterRoleLabel = poster
        ? (LINGKOD_ROLE_LABELS[LINGKOD_DB_ROLE_TO_UI_ROLE[poster.role]] || poster.role)
        : "—";

    const meta = document.createElement("div");
    meta.className = "modal-announcement-meta";
    meta.appendChild(buildCalendarDetailLine("fa-solid fa-user", "Posted By", poster ? poster.full_name : "OSOA"));
    meta.appendChild(buildCalendarDetailLine("fa-solid fa-id-badge", "Role", posterRoleLabel));
    meta.appendChild(buildCalendarDetailLine("fa-solid fa-clock", "Posted", lingkodFormatDate(row.created_at)));
    card.appendChild(meta);

    return card;
}

function openCalendarDayModal(dateKey, rows){
    const list = document.createElement("div");
    list.className = "modal-announcement-list";
    rows.forEach(function(row){
        list.appendChild(buildCalendarAnnouncementCard(row));
    });

    const titleText = new Date(dateKey + "T00:00:00").toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric" });
    lingkodOpenModal(titleText, list);
}

function renderCalendarGrid(gridEl, year, month, dayMap, todayKey){
    gridEl.querySelectorAll(".day").forEach(function(el){ el.remove(); });

    const startWeekday = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const fragment = document.createDocumentFragment();

    for(let i = 0; i < startWeekday; i++){
        const empty = document.createElement("span");
        empty.className = "day empty";
        fragment.appendChild(empty);
    }

    for(let day = 1; day <= daysInMonth; day++){
        const key = calendarDateKey(year, month, day);
        const span = document.createElement("span");
        span.className = "day";
        span.textContent = String(day);

        if(key === todayKey) span.classList.add("today");

        if(dayMap[key]){
            span.classList.add("event");
            span.setAttribute("role", "button");
            span.setAttribute("tabindex", "0");
            span.addEventListener("click", function(){ openCalendarDayModal(key, dayMap[key]); });
            span.addEventListener("keydown", function(e){
                if(e.key === "Enter") openCalendarDayModal(key, dayMap[key]);
            });
        }

        fragment.appendChild(span);
    }

    const trailing = (7 - ((startWeekday + daysInMonth) % 7)) % 7;
    for(let i = 0; i < trailing; i++){
        const empty = document.createElement("span");
        empty.className = "day empty";
        fragment.appendChild(empty);
    }

    gridEl.appendChild(fragment);
}

function renderCalendarLegend(legendEl, year, month, dayMap){
    legendEl.innerHTML = "";

    const monthPrefix = year + "-" + String(month + 1).padStart(2, "0");
    const monthKeys = Object.keys(dayMap).filter(function(key){ return key.startsWith(monthPrefix); }).sort();

    if(monthKeys.length === 0){
        const li = document.createElement("li");
        li.textContent = "No announcements scheduled this month.";
        legendEl.appendChild(li);
        return;
    }

    monthKeys.forEach(function(key){
        dayMap[key].forEach(function(row){
            const li = document.createElement("li");
            li.className = "calendar-legend-item";

            const dot = document.createElement("span");
            dot.className = "dot";
            li.appendChild(dot);

            const shortDate = new Date(key + "T00:00:00").toLocaleDateString("en-US", { month: "long", day: "numeric" });
            li.appendChild(document.createTextNode(shortDate + " — " + row.title));

            li.addEventListener("click", function(){ openCalendarDayModal(key, dayMap[key]); });
            legendEl.appendChild(li);
        });
    });
}

function renderCalendars(){
    const panels = document.querySelectorAll(".calendar-panel");
    if(panels.length === 0) return;

    const year = calendarViewDate.getFullYear();
    const month = calendarViewDate.getMonth();
    const dayMap = buildCalendarDayMap(calendarAnnouncements);

    const today = new Date();
    const todayKey = calendarDateKey(today.getFullYear(), today.getMonth(), today.getDate());
    const monthLabel = calendarViewDate.toLocaleDateString("en-US", { month: "long", year: "numeric" });

    panels.forEach(function(panel){
        const titleText = panel.querySelector(".calendar-title-text");
        if(titleText) titleText.textContent = monthLabel;

        const grid = panel.querySelector(".calendar-grid");
        if(grid) renderCalendarGrid(grid, year, month, dayMap, todayKey);

        const legend = panel.querySelector(".calendar-legend");
        if(legend) renderCalendarLegend(legend, year, month, dayMap);
    });
}

async function loadCalendarAnnouncements(){
    if(document.querySelectorAll(".calendar-panel").length === 0) return;

    const { data, error } = await supabaseClient
        .from("announcements")
        .select("id, title, content, event_date, event_location, event_who, visibility, created_by, created_at")
        .eq("is_published", true)
        .not("event_date", "is", null)
        .order("event_date", { ascending: true });

    if(error){
        console.error("[dashboard] calendar load failed:", error);
        return;
    }

    calendarAnnouncements = data;
    calendarPosterInfo = await lingkodFetchProfilesById(data.map(function(row){ return row.created_by; }));
    renderCalendars();
}

document.querySelectorAll(".calendar-nav").forEach(function(btn){
    btn.addEventListener("click", function(){
        const direction = btn.dataset.nav === "prev" ? -1 : 1;
        calendarViewDate = new Date(calendarViewDate.getFullYear(), calendarViewDate.getMonth() + direction, 1);
        renderCalendars();
    });
});

const PROJECT_CATEGORY_MAP = {
    upcoming: "upcoming_activity",
    implemented: "implemented",
    income: "income_generating"
};

const PROJECT_EMPTY_TEXT = {
    upcoming: "No upcoming activities available.",
    implemented: "No implemented activities available.",
    income: "No income-generating projects available."
};

function buildPreviewItem(previewType, row){
    const item = document.createElement("div");
    item.className = "preview-item";

    // All four categories share the same image_url column now (Ongoing
    // Projects, Upcoming Activities, Implemented Activities, and
    // Income-Generating Projects each have their own upload field - see
    // js/common.js's "SQUARE COVER IMAGES" section) - the public Storage
    // URL is safe to render directly for every role, including students,
    // with no signing needed.
    if(row.image_url){
        const cover = document.createElement("img");
        cover.className = "preview-item-cover";
        cover.src = row.image_url;
        cover.alt = row.title + " cover image";
        item.appendChild(cover);
    }

    const h4 = document.createElement("h4");
    h4.textContent = row.title;
    item.appendChild(h4);

    const meta = document.createElement("span");
    meta.className = "preview-meta";

    if(previewType === "upcoming"){
        const icon = document.createElement("i");
        icon.className = "fa-solid fa-calendar";
        meta.appendChild(icon);
        meta.appendChild(document.createTextNode(" " + (row.start_date ? lingkodFormatDate(row.start_date) : "Date to be announced")));
    } else if(previewType === "implemented"){
        const icon = document.createElement("i");
        icon.className = "fa-solid fa-calendar-check";
        meta.appendChild(icon);
        const completedLabel = row.end_date
            ? "Completed " + new Date(row.end_date).toLocaleDateString("en-US", { year: "numeric", month: "long" })
            : "Completed";
        meta.appendChild(document.createTextNode(" " + completedLabel));
    } else if(previewType === "income"){
        const amount = row.price != null ? Number(row.price).toLocaleString("en-US") : "0";
        meta.textContent = (row.organization || "Unspecified Organization") + " · ₱" + amount;
    }

    item.appendChild(meta);
    return item;
}

/* ================= ONGOING PROJECTS (dedicated full-width section) =================
   Its own card grid, not the compact 4-item preview list the other three
   categories use below - status-filtered to "ongoing" only (a project
   marked Not Yet Started or Done doesn't belong in this section per the
   brief), and not capped at 4 since this is meant to be the dashboard's
   primary showcase for in-progress work rather than a small preview. */

const ONGOING_STATUS_LABELS = {
    not_started: "Not Yet Started",
    ongoing: "On Going",
    completed: "Done"
};

const ONGOING_STATUS_CLASSES = {
    not_started: "not-started",
    ongoing: "ongoing",
    completed: "done"
};

const ONGOING_PROJECTS_LIMIT = 6;

function buildOngoingProjectCard(row){
    const card = document.createElement("div");
    card.className = "ongoing-project-card";

    if(row.image_url){
        const img = document.createElement("img");
        img.className = "ongoing-project-cover";
        img.src = row.image_url;
        img.alt = row.title + " cover image";
        card.appendChild(img);
    } else {
        const placeholder = document.createElement("div");
        placeholder.className = "ongoing-project-cover-placeholder";
        placeholder.innerHTML = "<i class=\"fa-solid fa-diagram-project\"></i>";
        card.appendChild(placeholder);
    }

    const body = document.createElement("div");
    body.className = "ongoing-project-body";

    const h3 = document.createElement("h3");
    h3.textContent = row.title;
    body.appendChild(h3);

    const p = document.createElement("p");
    p.textContent = row.description || "No description provided.";
    body.appendChild(p);

    const org = document.createElement("div");
    org.className = "ongoing-project-org";
    const orgIcon = document.createElement("i");
    orgIcon.className = "fa-solid fa-users";
    org.appendChild(orgIcon);
    org.appendChild(document.createTextNode(" " + (row.organization || "Unspecified Organization")));
    body.appendChild(org);

    const statusRow = document.createElement("div");
    statusRow.className = "ongoing-project-status-row";
    const statusLabel = document.createElement("span");
    statusLabel.className = "ongoing-project-status-label";
    statusLabel.textContent = "Status:";
    const statusBadge = document.createElement("span");
    statusBadge.className = "status " + (ONGOING_STATUS_CLASSES[row.status] || "ongoing");
    statusBadge.textContent = ONGOING_STATUS_LABELS[row.status] || "On Going";
    statusRow.appendChild(statusLabel);
    statusRow.appendChild(statusBadge);
    body.appendChild(statusRow);

    card.appendChild(body);
    return card;
}

async function loadOngoingProjectsSection(){
    const grids = document.querySelectorAll(".ongoing-projects-grid");
    if(grids.length === 0) return;

    const selectColumns = projectsSupportImageColumn
        ? "id, title, description, organization, status, image_url, created_at"
        : "id, title, description, organization, status, created_at";

    let { data, error } = await supabaseClient
        .from("projects_activities")
        .select(selectColumns)
        .eq("category", "ongoing_project")
        .eq("status", "ongoing")
        .order("created_at", { ascending: false })
        .limit(ONGOING_PROJECTS_LIMIT);

    if(error && projectsSupportImageColumn && (error.code === "42703" || /column .* does not exist/i.test(error.message || ""))){
        console.error("[dashboard] image_url unavailable - has 20260720010000_project_cover_images.sql been run?", error);
        projectsSupportImageColumn = false;
        const retry = await supabaseClient
            .from("projects_activities")
            .select("id, title, description, organization, status, created_at")
            .eq("category", "ongoing_project")
            .eq("status", "ongoing")
            .order("created_at", { ascending: false })
            .limit(ONGOING_PROJECTS_LIMIT);
        data = retry.data;
        error = retry.error;
    }

    grids.forEach(function(grid){
        grid.innerHTML = "";

        if(error){
            console.error("[dashboard] ongoing projects load failed:", error);
            const p = document.createElement("p");
            p.className = "preview-empty";
            p.textContent = "Couldn't load this section.";
            grid.appendChild(p);
            return;
        }

        if(data.length === 0){
            const p = document.createElement("p");
            p.className = "preview-empty";
            p.textContent = "No ongoing projects available.";
            grid.appendChild(p);
            return;
        }

        data.forEach(function(row){
            grid.appendChild(buildOngoingProjectCard(row));
        });
    });
}

const PROJECT_PREVIEW_BASE_COLUMNS = "id, title, organization, start_date, end_date, price, created_at";
// Flips to false the first time image_url turns out not to exist yet (the
// project-cover-images migration hasn't been run on this project) - every
// subsequent load then skips straight to the safe query. This single
// select is reused for all four categories in the loop below, so without
// this fallback a missing column would take down every one of them, not
// just Ongoing Projects.
let projectsSupportImageColumn = true;

async function loadProjectPreviews(){
    for (const previewType of Object.keys(PROJECT_CATEGORY_MAP)) {
        const panels = document.querySelectorAll('.preview-panel[data-preview="' + previewType + '"]');
        if(panels.length === 0) continue;

        const selectColumns = projectsSupportImageColumn
            ? PROJECT_PREVIEW_BASE_COLUMNS + ", image_url"
            : PROJECT_PREVIEW_BASE_COLUMNS;

        let { data, error } = await supabaseClient
            .from("projects_activities")
            .select(selectColumns)
            .eq("category", PROJECT_CATEGORY_MAP[previewType])
            .order("created_at", { ascending: false })
            .limit(4);

        if(error && projectsSupportImageColumn && (error.code === "42703" || /column .* does not exist/i.test(error.message || ""))){
            console.error("[dashboard] image_url unavailable - has 20260720010000_project_cover_images.sql been run?", error);
            projectsSupportImageColumn = false;
            const retry = await supabaseClient
                .from("projects_activities")
                .select(PROJECT_PREVIEW_BASE_COLUMNS)
                .eq("category", PROJECT_CATEGORY_MAP[previewType])
                .order("created_at", { ascending: false })
                .limit(4);
            data = retry.data;
            error = retry.error;
        }

        panels.forEach(function(panel){
            // Every panel keeps its own <h2> header - only the dynamic
            // content below it gets replaced.
            const heading = panel.querySelector("h2");
            panel.innerHTML = "";
            panel.appendChild(heading);

            if(error){
                console.error("[dashboard] " + previewType + " preview load failed:", error);
                const p = document.createElement("p");
                p.className = "preview-empty";
                p.textContent = "Couldn't load this section.";
                panel.appendChild(p);
                return;
            }

            if(data.length === 0){
                const p = document.createElement("p");
                p.className = "preview-empty";
                p.textContent = PROJECT_EMPTY_TEXT[previewType];
                panel.appendChild(p);
                return;
            }

            const list = document.createElement("div");
            list.className = "preview-panel-list";
            data.forEach(function(row){
                list.appendChild(buildPreviewItem(previewType, row));
            });
            panel.appendChild(list);
        });
    }
}

function renderTopbarAvatar(profile){
    const wrap = document.getElementById("topbarAvatar");
    if(!wrap) return;
    wrap.innerHTML = "";
    wrap.appendChild(lingkodBuildAvatarElement(profile, "topbar-avatar"));
}

/* ================= WELCOME BANNER + STATISTICS =================
   OSOA EB and Organization President share the same welcome/stats
   markup structure but not its content - a single .welcome banner
   (personalized here regardless of role) plus two separate .stats-row
   blocks in the HTML (data-role-view="admin"/"staff"), each already
   built for its own role's numbers. Only the one matching the viewer's
   actual role is ever visible; the other's load function below just
   returns immediately since its own DOM elements aren't present/aren't
   relevant. */

function renderWelcomeGreeting(profile){
    const headingEl = document.getElementById("dashboardWelcomeHeading");
    const subtitleEl = document.getElementById("dashboardWelcomeSubtitle");
    if(!profile || !headingEl) return;

    // full_name is generated as "LAST, FIRST MIDDLE" (see
    // 20260717000000_registration_name_split_and_validation.sql) - not
    // "FIRST LAST", so splitting it on whitespace grabs the last name
    // (comma included) instead. first_name is a real, separate column;
    // use it directly rather than trying to parse it back out.
    const firstName = (profile.first_name || "").trim() || "there";
    headingEl.textContent = "Welcome back, " + firstName + "!";

    if(subtitleEl){
        subtitleEl.textContent = profile.role === "org_president" && profile.organization
            ? "Here's what's happening in " + profile.organization + " today."
            : "Here's what's happening in OSOA - Meneses Campus today.";
    }
}

// osoa_eb only - platform-wide counts. Row counts only (head:true), not
// full row fetches, since nothing here needs the actual data.
async function loadOsoaStats(profile){
    const el = document.getElementById("statTotalOrganizations");
    if(!el || !profile || profile.role !== "osoa_eb") return;

    const [orgsResult, membersResult, usersResult, pendingResult] = await Promise.all([
        supabaseClient.from("organizations").select("id", { count: "exact", head: true }),
        supabaseClient.from("profiles").select("id", { count: "exact", head: true })
            .eq("status", "active").not("organization_id", "is", null),
        supabaseClient.from("profiles").select("id", { count: "exact", head: true })
            .eq("status", "active"),
        supabaseClient.from("requests").select("id", { count: "exact", head: true })
            .eq("status", "pending")
    ]);

    document.getElementById("statTotalOrganizations").textContent = orgsResult.count != null ? orgsResult.count : "—";
    document.getElementById("statTotalMembers").textContent = membersResult.count != null ? membersResult.count : "—";
    document.getElementById("statTotalUsers").textContent = usersResult.count != null ? usersResult.count : "—";
    document.getElementById("statPendingRequests").textContent = pendingResult.count != null ? pendingResult.count : "—";

    [orgsResult, membersResult, usersResult, pendingResult].forEach(function(r){
        if(r.error) console.error("[dashboard] OSOA stat load failed:", r.error);
    });
}

// org_president only - scoped to their own organization. "Pending
// Requests" is deliberately scoped to requests THEY personally
// submitted, not their whole organization's - requests_select RLS
// (20260722020000_requests_enhancements.sql) only grants a requester
// their own rows (or osoa_eb, everything); it was never extended to let
// a president see every member's individual requests, and widening that
// is a real access-control decision this redesign shouldn't make
// silently as a side effect.
async function loadPresidentStats(profile){
    const el = document.getElementById("statOrgMembers");
    if(!el || !profile || profile.role !== "org_president" || !profile.organization_id) return;

    const [membersResult, pendingResult, activeProjectsResult, upcomingResult] = await Promise.all([
        supabaseClient.from("profiles").select("id", { count: "exact", head: true })
            .eq("status", "active").eq("organization_id", profile.organization_id),
        supabaseClient.from("requests").select("id", { count: "exact", head: true })
            .eq("status", "pending").eq("user_id", profile.id),
        supabaseClient.from("projects_activities").select("id", { count: "exact", head: true })
            .eq("category", "ongoing_project").eq("status", "ongoing").eq("organization", profile.organization),
        supabaseClient.from("projects_activities").select("id", { count: "exact", head: true })
            .eq("category", "upcoming_activity").eq("organization", profile.organization)
    ]);

    document.getElementById("statOrgMembers").textContent = membersResult.count != null ? membersResult.count : "—";
    document.getElementById("statOrgPendingRequests").textContent = pendingResult.count != null ? pendingResult.count : "—";
    document.getElementById("statOrgActiveProjects").textContent = activeProjectsResult.count != null ? activeProjectsResult.count : "—";
    document.getElementById("statOrgUpcomingActivities").textContent = upcomingResult.count != null ? upcomingResult.count : "—";

    [membersResult, pendingResult, activeProjectsResult, upcomingResult].forEach(function(r){
        if(r.error) console.error("[dashboard] president stat load failed:", r.error);
    });
}

function buildOrgOverviewRow(label, value){
    const row = document.createElement("div");
    row.className = "profile-view-row";
    const dt = document.createElement("span");
    dt.className = "profile-view-label";
    dt.textContent = label;
    const dd = document.createElement("span");
    dd.className = "profile-view-value";
    dd.textContent = value || "Not set";
    row.appendChild(dt);
    row.appendChild(dd);
    return row;
}

// org_president only - the organizations row already carries everything
// Organization Information (list-of-members) collects (acronym,
// category, president_name, adviser, member_count - see
// 20260724000000_organization_information.sql), reused here read-only
// rather than duplicating that page's own edit form.
async function loadOrgOverview(profile){
    const grid = document.getElementById("dashboardOrgOverviewGrid");
    if(!grid || !profile || profile.role !== "org_president" || !profile.organization_id) return;

    const { data: org, error } = await supabaseClient
        .from("organizations")
        .select("name, acronym, category, president_name, adviser, member_count")
        .eq("id", profile.organization_id)
        .single();

    grid.innerHTML = "";

    if(error || !org){
        console.error("[dashboard] organization overview load failed:", error);
        const p = document.createElement("p");
        p.className = "preview-empty";
        p.textContent = "Couldn't load your organization's info.";
        grid.appendChild(p);
        return;
    }

    grid.appendChild(buildOrgOverviewRow("Organization Name", org.name));
    grid.appendChild(buildOrgOverviewRow("Acronym", org.acronym));
    grid.appendChild(buildOrgOverviewRow("Category", org.category));
    grid.appendChild(buildOrgOverviewRow("President", org.president_name));
    grid.appendChild(buildOrgOverviewRow("Adviser", org.adviser));
    grid.appendChild(buildOrgOverviewRow("Members", org.member_count != null ? String(org.member_count) : null));
}

document.addEventListener("DOMContentLoaded", async function(){
    dashboardViewerSession = lingkodGetSession();
    const authedProfile = await lingkodGetAuthedProfile();
    dashboardViewerProfileId = authedProfile ? authedProfile.id : null;

    if(authedProfile){
        renderTopbarAvatar(authedProfile);
        renderWelcomeGreeting(authedProfile);
        loadOsoaStats(authedProfile);
        loadPresidentStats(authedProfile);
        loadOrgOverview(authedProfile);

        // Live update: if the user changes their profile photo (from
        // this dashboard in another tab, or from the Profile page),
        // the topbar avatar picks it up immediately without a reload.
        supabaseClient
            .channel("dashboard_own_profile_changes")
            .on("postgres_changes", {
                event: "UPDATE",
                schema: "public",
                table: "profiles",
                filter: "id=eq." + authedProfile.id
            }, function(payload){
                renderTopbarAvatar(payload.new);
            })
            .subscribe();
    }

    loadDashboardAnnouncements();
    loadCalendarAnnouncements();
    loadDashboardSubmissions();
    loadRecentSubmissionsWidget();
    loadOngoingProjectsSection();
    loadProjectPreviews();
});

// Live updates: a new/edited/deleted announcement refreshes the list
// widgets above (whichever is present - admin's <ul> or the student
// view's scroll-list) *and* the calendar (event added/moved/removed),
// without a page reload, for any signed-in viewer - not just whoever
// made the change. One subscription drives both, rather than opening a
// second one just for the calendar.
supabaseClient
    .channel("dashboard_announcements_changes")
    .on("postgres_changes", { event: "*", schema: "public", table: "announcements" }, function(){
        loadDashboardAnnouncements();
        loadCalendarAnnouncements();
    })
    .subscribe();

// Separate channel (different table) so an approval elsewhere refreshes
// the Submission & Tracking widgets immediately - e.g. OSOA EB approving
// a document should make it appear on every dashboard without anyone
// needing to refresh.
supabaseClient
    .channel("dashboard_submissions_changes")
    .on("postgres_changes", { event: "*", schema: "public", table: "submissions" }, function(){
        loadDashboardSubmissions();
        loadRecentSubmissionsWidget();
    })
    .subscribe();

// A project/activity added, edited, or deleted by the OSOA Executive Board
// (or an org president, for their own org) should reach every open
// Org President / Student dashboard immediately, without a manual refresh.
supabaseClient
    .channel("dashboard_projects_changes")
    .on("postgres_changes", { event: "*", schema: "public", table: "projects_activities" }, function(){
        loadOngoingProjectsSection();
        loadProjectPreviews();
    })
    .subscribe();
