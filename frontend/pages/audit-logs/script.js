/* ===================================================
   LINGKOD Meneses - Audit Logs (OSOA EB only)
   Read-only view of audit_logs - every row there was written by a
   security-definer trigger (see the 20260728040000 migration's
   log_profile_admin_change/log_organization_change/log_officer_change),
   never by a client, so nothing on this page ever writes back. RLS
   (audit_logs_select_admin) already restricts SELECT to osoa_eb - the
   sidebar link is just the client-side half of that same restriction.
   =================================================== */

const AUDIT_PAGE_SIZE = 15;

const AUDIT_ACTION_LABELS = {
    "user.deactivate": "Deactivated User",
    "user.reactivate": "Reactivated User",
    "user.role_change": "Changed User Role",
    "user.update": "Updated User",
    "organization.update": "Updated Organization",
    "organization.delete": "Deleted Organization",
    "officer.add": "Added Officer/Member",
    "officer.update": "Updated Officer/Member",
    "officer.remove": "Removed Officer/Member"
};

const AUDIT_DESTRUCTIVE_ACTIONS = ["user.deactivate", "organization.delete", "officer.remove"];

const auditSearch = document.getElementById("auditSearch");
const auditActionFilter = document.getElementById("auditActionFilter");
const auditTableBody = document.getElementById("auditTableBody");
const auditPagination = document.getElementById("auditPagination");

let allLogs = [];
let actorProfilesById = {};
let auditCurrentPage = 1;

function auditActionLabel(action){
    return AUDIT_ACTION_LABELS[action] || action;
}

function targetDisplayName(log){
    if(log.details && (log.details.full_name || log.details.name)){
        return log.details.full_name || log.details.name;
    }
    return log.target_id ? log.target_id.slice(0, 8) + "…" : "—";
}

function formatDetails(log){
    if(!log.details || Object.keys(log.details).length === 0) return "—";
    return Object.keys(log.details)
        .filter(function(key){ return key !== "full_name" && key !== "name"; })
        .map(function(key){ return key + ": " + (log.details[key] === null ? "—" : log.details[key]); })
        .join(", ") || "—";
}

function populateActionFilterOptions(){
    const current = auditActionFilter.value;
    const actionsInUse = Array.from(new Set(allLogs.map(function(l){ return l.action; }))).sort();

    auditActionFilter.innerHTML = "<option value=\"\">All Actions</option>";
    actionsInUse.forEach(function(action){
        const opt = document.createElement("option");
        opt.value = action;
        opt.textContent = auditActionLabel(action);
        auditActionFilter.appendChild(opt);
    });
    if(actionsInUse.includes(current)) auditActionFilter.value = current;
}

function buildAuditRow(log){
    const tr = document.createElement("tr");

    tr.appendChild(lingkodCreateCell(lingkodFormatDate(log.created_at) + " " + new Date(log.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })));

    const actor = actorProfilesById[log.actor_id];
    tr.appendChild(lingkodCreateCell(actor ? actor.full_name : "System"));

    const actionCell = document.createElement("td");
    const badge = document.createElement("span");
    badge.className = "audit-action-badge" + (AUDIT_DESTRUCTIVE_ACTIONS.includes(log.action) ? " destructive" : "");
    badge.textContent = auditActionLabel(log.action);
    actionCell.appendChild(badge);
    tr.appendChild(actionCell);

    tr.appendChild(lingkodCreateCell(log.target_table + " — " + targetDisplayName(log)));

    const detailsCell = document.createElement("td");
    detailsCell.className = "audit-details";
    detailsCell.textContent = formatDetails(log);
    tr.appendChild(detailsCell);

    return tr;
}

function renderAuditPage(){
    const query = auditSearch.value.trim().toLowerCase();
    const actionFilter = auditActionFilter.value;

    const filtered = allLogs.filter(function(log){
        if(actionFilter && log.action !== actionFilter) return false;

        if(query){
            const actor = actorProfilesById[log.actor_id];
            const haystack = [
                actor ? actor.full_name : "",
                log.action,
                log.target_table,
                targetDisplayName(log)
            ].join(" ").toLowerCase();
            if(haystack.indexOf(query) === -1) return false;
        }

        return true;
    });

    auditTableBody.innerHTML = "";

    if(filtered.length === 0){
        auditTableBody.appendChild(lingkodCreateEmptyRow("No audit log entries match your search/filters.", 5));
        auditPagination.innerHTML = "";
        return;
    }

    const totalPages = Math.max(1, Math.ceil(filtered.length / AUDIT_PAGE_SIZE));
    if(auditCurrentPage > totalPages) auditCurrentPage = totalPages;

    const start = (auditCurrentPage - 1) * AUDIT_PAGE_SIZE;
    filtered.slice(start, start + AUDIT_PAGE_SIZE).forEach(function(log){
        auditTableBody.appendChild(buildAuditRow(log));
    });

    lingkodRenderPagination(auditPagination, auditCurrentPage, totalPages, function(page){
        auditCurrentPage = page;
        renderAuditPage();
    });
}

async function loadAuditLogs(){
    const { data, error } = await supabaseClient
        .from("audit_logs")
        .select("id, actor_id, action, target_table, target_id, details, created_at")
        .order("created_at", { ascending: false })
        .limit(500);

    if(error){
        console.error("[audit-logs] load failed:", error);
        auditTableBody.innerHTML = "";
        auditTableBody.appendChild(lingkodCreateEmptyRow("Couldn't load audit logs (" + error.message + ").", 5));
        return;
    }

    allLogs = data;
    actorProfilesById = await lingkodFetchProfilesById(data.map(function(l){ return l.actor_id; }));

    populateActionFilterOptions();
    renderAuditPage();
}

[auditSearch, auditActionFilter].forEach(function(el){
    el.addEventListener(el === auditSearch ? "input" : "change", function(){
        auditCurrentPage = 1;
        renderAuditPage();
    });
});

document.addEventListener("DOMContentLoaded", loadAuditLogs);

supabaseClient
    .channel("audit_logs_page_changes")
    .on("postgres_changes", { event: "INSERT", schema: "public", table: "audit_logs" }, function(){
        loadAuditLogs();
    })
    .subscribe();
