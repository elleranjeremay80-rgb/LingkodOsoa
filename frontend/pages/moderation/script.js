/* ===================================================
   LINGKOD Meneses - Moderation
   OSOA EB-only inbox for message_reports (submitted from the Messages
   module's "Report User" action - see messages/script.js's
   menuReportUser). Read access is already RLS-gated to osoa_eb via
   message_reports_select_admin (20260719030000_messaging_conversation_
   options.sql) - the sidebar link is hidden for every other role as the
   client-side half of that same restriction, same "hide the button, RLS
   is the real enforcement" pattern used everywhere else in this app.

   Moved here from frontend/pages/reports/ (unchanged otherwise) once
   "Reports" became a separate, unrelated feature - a document/report
   submission workflow open to every role, not this moderation queue.

   This is deliberately a read-only inbox (view reports, view the
   reported user's profile) - no resolve/dismiss workflow, since
   message_reports has no status column and none was asked for.
   =================================================== */

const REPORTS_PAGE_SIZE = 10;

const reportsTableBody = document.getElementById("reportsTableBody");
const reportsPagination = document.getElementById("reportsPagination");

let allReports = [];
let reportProfilesById = {};
let reportsCurrentPage = 1;

function buildReportActionCell(report){
    const td = document.createElement("td");

    const viewBtn = document.createElement("button");
    viewBtn.type = "button";
    viewBtn.className = "btn-secondary";
    viewBtn.innerHTML = "<i class=\"fa-solid fa-user\"></i> View Profile";
    viewBtn.addEventListener("click", function(){ openReportedProfileModal(report.reported_user_id); });
    td.appendChild(viewBtn);

    return td;
}

function buildReportRow(report){
    const reporter = reportProfilesById[report.reporter_id];
    const reported = reportProfilesById[report.reported_user_id];

    const tr = document.createElement("tr");
    tr.appendChild(lingkodCreateCell(reporter ? reporter.full_name : "Unknown user"));
    tr.appendChild(lingkodCreateCell(reported ? reported.full_name : "Unknown user"));
    tr.appendChild(lingkodCreateCell(report.reason));
    tr.appendChild(lingkodCreateCell(report.description || "—"));
    tr.appendChild(lingkodCreateCell(lingkodFormatDate(report.created_at)));
    tr.appendChild(buildReportActionCell(report));
    return tr;
}

function renderReportsPage(){
    reportsTableBody.innerHTML = "";

    if(allReports.length === 0){
        reportsTableBody.appendChild(lingkodCreateEmptyRow("No reports have been submitted.", 6));
        reportsPagination.innerHTML = "";
        return;
    }

    const totalPages = Math.max(1, Math.ceil(allReports.length / REPORTS_PAGE_SIZE));
    if(reportsCurrentPage > totalPages) reportsCurrentPage = totalPages;

    const start = (reportsCurrentPage - 1) * REPORTS_PAGE_SIZE;
    allReports.slice(start, start + REPORTS_PAGE_SIZE).forEach(function(report){
        reportsTableBody.appendChild(buildReportRow(report));
    });

    lingkodRenderPagination(reportsPagination, reportsCurrentPage, totalPages, function(page){
        reportsCurrentPage = page;
        renderReportsPage();
    });
}

async function loadReports(){
    const { data, error } = await supabaseClient
        .from("message_reports")
        .select("id, reporter_id, reported_user_id, conversation_id, reason, description, created_at")
        .order("created_at", { ascending: false });

    if(error){
        console.error("[moderation] load failed:", error);
        reportsTableBody.innerHTML = "";
        reportsTableBody.appendChild(lingkodCreateEmptyRow("Couldn't load reports (" + error.message + ").", 6));
        return;
    }

    allReports = data;
    reportProfilesById = await lingkodFetchProfilesById(
        data.flatMap(function(r){ return [r.reporter_id, r.reported_user_id]; })
    );

    renderReportsPage();
}

/* ================= REPORTED USER PROFILE MODAL =================
   Deliberately skips the profile_visibility_allowed() privacy check
   messages/script.js's own View Profile action respects for peer-to-peer
   viewing - an OSOA EB member reviewing a report is acting in a
   moderation capacity, not browsing the directory, so the reported
   user's own "Show Profile Information" preference shouldn't be able to
   hide their details from the report they're the subject of. */

// Shared with messages/directory/registered-users' identical copies -
// see lingkodBuildProfileViewRow in js/common.js.
function buildReportProfileRow(label, value){
    return lingkodBuildProfileViewRow(label, value);
}

async function openReportedProfileModal(profileId){
    const { data, error } = await supabaseClient
        .from("profiles")
        .select("full_name, email, student_number, department, organization, position, role, status, avatar_url")
        .eq("id", profileId)
        .maybeSingle();

    if(error || !data){
        console.error("[moderation] profile load failed:", error);
        lingkodToast("Couldn't load this user's profile.", "error");
        return;
    }

    const wrap = document.createElement("div");
    wrap.className = "profile-view";

    wrap.appendChild(lingkodBuildAvatarElement(data, "profile-view-avatar"));

    const name = document.createElement("h3");
    name.className = "profile-view-name";
    name.textContent = data.full_name;
    wrap.appendChild(name);

    const roleTag = document.createElement("p");
    roleTag.className = "profile-view-role";
    roleTag.textContent = LINGKOD_ROLE_LABELS[LINGKOD_DB_ROLE_TO_UI_ROLE[data.role] || data.role] || data.role;
    wrap.appendChild(roleTag);

    const grid = document.createElement("div");
    grid.className = "profile-view-grid";
    grid.appendChild(buildReportProfileRow("Student Number", data.student_number));
    grid.appendChild(buildReportProfileRow("Department", data.department));
    grid.appendChild(buildReportProfileRow("Organization", data.organization));
    grid.appendChild(buildReportProfileRow("Position", data.position));
    grid.appendChild(buildReportProfileRow("Email", data.email));
    grid.appendChild(buildReportProfileRow("Account Status", data.status ? data.status.charAt(0).toUpperCase() + data.status.slice(1) : null));
    wrap.appendChild(grid);

    lingkodOpenModal("Reported User", wrap);
}

document.addEventListener("DOMContentLoaded", loadReports);

supabaseClient
    .channel("reports_page_changes")
    .on("postgres_changes", { event: "*", schema: "public", table: "message_reports" }, function(){
        loadReports();
    })
    .subscribe();
