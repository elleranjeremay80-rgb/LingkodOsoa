/* ===================================================
   LINGKOD Meneses - Registered Users (OSOA EB only)
   Search/filter/sort a live list of every profiles row, with View/Edit/
   Deactivate actions. Sidebar visibility (data-roles="admin" on the nav
   link) is only the client-side half of this feature's access control -
   the real enforcement is server-side: profiles_admin_update (RLS) and
   the widened column grant only let an osoa_eb-role account touch
   another person's row at all, and trg_guard_profile_admin_fields
   blocks every other authenticated user from touching the admin-only
   fields even on their own row - see the
   20260728030000_registered_users_admin_management.sql migration. A
   non-osoa_eb visitor who reaches this page directly (or calls the API
   by hand) gets a real RLS/trigger rejection, not just a hidden button.

   "Delete" is a deactivate + anonymize, not a real account deletion -
   see that same migration's header comment for why (no service-role key
   is ever shipped to this static site, so the Supabase Admin API that
   actually removes an auth.users row isn't reachable from here). The
   login flow (login/script.js) already rejects any non-'active' account,
   so this is a genuinely working access revocation, just not a literal
   erasure of the underlying login row.
   =================================================== */

const USERS_PAGE_SIZE = 10;

const usersSearch = document.getElementById("usersSearch");
const usersOrgFilter = document.getElementById("usersOrgFilter");
const usersRoleFilter = document.getElementById("usersRoleFilter");
const usersStatusFilter = document.getElementById("usersStatusFilter");
const usersSort = document.getElementById("usersSort");
const usersTableBody = document.getElementById("usersTableBody");
const usersPagination = document.getElementById("usersPagination");

let viewerProfile = null;
let allUsers = [];
let usersCurrentPage = 1;

function roleLabel(dbRole){
    const uiRole = LINGKOD_DB_ROLE_TO_UI_ROLE[dbRole] || dbRole;
    return LINGKOD_ROLE_LABELS[uiRole] || uiRole;
}

async function loadOrgFilterOptions(){
    const { data, error } = await supabaseClient
        .from("organizations")
        .select("name")
        .order("name");

    if(error){
        console.error("[registered-users] organization list load failed:", error);
        return;
    }

    (data || []).forEach(function(org){
        const opt = document.createElement("option");
        opt.value = org.name;
        opt.textContent = org.name;
        usersOrgFilter.appendChild(opt);
    });
}

/* ================= LOAD / FILTER / SORT / PAGINATE ================= */

async function loadUsers(){
    const { data, error } = await supabaseClient
        .from("profiles")
        .select("id, full_name, last_name, first_name, middle_name, student_number, email, organization, organization_id, position, department, department_id, role, status, avatar_url, bio, contact_number, created_at");

    if(error){
        console.error("[registered-users] load failed:", error);
        usersTableBody.innerHTML = "";
        usersTableBody.appendChild(lingkodCreateEmptyRow("Couldn't load registered users (" + error.message + ").", 10));
        return;
    }

    allUsers = data;
    renderUsersPage();
}

function getFilteredSortedUsers(){
    const query = usersSearch.value.trim().toLowerCase();
    const orgFilter = usersOrgFilter.value;
    const roleFilter = usersRoleFilter.value;
    const statusFilter = usersStatusFilter.value;

    let filtered = allUsers.filter(function(u){
        if(orgFilter && u.organization !== orgFilter) return false;
        if(roleFilter && u.role !== roleFilter) return false;
        if(statusFilter && u.status !== statusFilter) return false;

        if(query){
            const haystack = [u.full_name, u.student_number, u.email, u.organization, u.position]
                .filter(Boolean).join(" ").toLowerCase();
            if(haystack.indexOf(query) === -1) return false;
        }

        return true;
    });

    const sortBy = usersSort.value;
    filtered = filtered.slice().sort(function(a, b){
        if(sortBy === "organization"){
            return (a.organization || "").localeCompare(b.organization || "");
        }
        if(sortBy === "role"){
            return roleLabel(a.role).localeCompare(roleLabel(b.role));
        }
        if(sortBy === "recent"){
            return new Date(b.created_at) - new Date(a.created_at);
        }
        return (a.full_name || "").localeCompare(b.full_name || "");
    });

    return filtered;
}

function buildUserRow(user){
    const tr = document.createElement("tr");

    const avatarCell = document.createElement("td");
    const avatarWrap = document.createElement("div");
    avatarWrap.className = "user-row-avatar";
    if(user.avatar_url){
        const img = document.createElement("img");
        img.src = user.avatar_url;
        img.alt = user.full_name + " avatar";
        avatarWrap.appendChild(img);
    } else {
        avatarWrap.textContent = (user.full_name || "?").trim().charAt(0).toUpperCase();
    }
    avatarCell.appendChild(avatarWrap);
    tr.appendChild(avatarCell);

    tr.appendChild(lingkodCreateCell(user.full_name || "Deleted User"));
    tr.appendChild(lingkodCreateCell(user.student_number || "—"));
    tr.appendChild(lingkodCreateCell(user.email || "—"));
    tr.appendChild(lingkodCreateCell(user.organization || "—"));
    tr.appendChild(lingkodCreateCell(user.position || "—"));
    tr.appendChild(lingkodCreateCell(roleLabel(user.role)));
    tr.appendChild(lingkodCreateCell(user.created_at ? lingkodFormatDate(user.created_at) : "—"));
    tr.appendChild(lingkodCreateStatusCell(user.status, { active: "Active", inactive: "Inactive" }));

    const actionsCell = document.createElement("td");
    const actions = document.createElement("div");
    actions.className = "user-row-actions";

    const viewBtn = document.createElement("button");
    viewBtn.type = "button";
    viewBtn.className = "icon-btn";
    viewBtn.setAttribute("aria-label", "View Profile");
    viewBtn.title = "View Profile";
    viewBtn.innerHTML = "<i class=\"fa-solid fa-eye\"></i>";
    viewBtn.addEventListener("click", function(){ openViewUserModal(user); });
    actions.appendChild(viewBtn);

    const editBtn = document.createElement("button");
    editBtn.type = "button";
    editBtn.className = "icon-btn";
    editBtn.setAttribute("aria-label", "Edit User");
    editBtn.title = "Edit User";
    editBtn.innerHTML = "<i class=\"fa-solid fa-pen\"></i>";
    editBtn.addEventListener("click", function(){ openEditUserModal(user); });
    actions.appendChild(editBtn);

    const removeBtn = document.createElement("button");
    removeBtn.type = "button";
    removeBtn.className = "icon-btn icon-btn-danger";
    removeBtn.setAttribute("aria-label", "Remove User");
    removeBtn.title = "Remove User";
    removeBtn.innerHTML = "<i class=\"fa-solid fa-trash\"></i>";
    removeBtn.addEventListener("click", function(){ openRemoveUserModal(user); });
    actions.appendChild(removeBtn);

    // Only ever shown for an already-removed (inactive) account - a
    // separate, rarer, and genuinely irreversible action from Remove
    // User above (see openPermanentlyEraseModal()'s own comment for why
    // these two are kept apart rather than merged into one button).
    if(user.status === "inactive"){
        const eraseBtn = document.createElement("button");
        eraseBtn.type = "button";
        eraseBtn.className = "icon-btn icon-btn-danger";
        eraseBtn.setAttribute("aria-label", "Permanently Erase Account");
        eraseBtn.title = "Permanently Erase Account";
        eraseBtn.innerHTML = "<i class=\"fa-solid fa-user-xmark\"></i>";
        eraseBtn.addEventListener("click", function(){ openPermanentlyEraseModal(user); });
        actions.appendChild(eraseBtn);
    }

    actionsCell.appendChild(actions);
    tr.appendChild(actionsCell);

    return tr;
}

function renderUsersPage(){
    const filtered = getFilteredSortedUsers();

    usersTableBody.innerHTML = "";

    if(filtered.length === 0){
        usersTableBody.appendChild(lingkodCreateEmptyRow("No registered users match your search/filters.", 10));
        usersPagination.innerHTML = "";
        return;
    }

    const totalPages = Math.max(1, Math.ceil(filtered.length / USERS_PAGE_SIZE));
    if(usersCurrentPage > totalPages) usersCurrentPage = totalPages;

    const start = (usersCurrentPage - 1) * USERS_PAGE_SIZE;
    filtered.slice(start, start + USERS_PAGE_SIZE).forEach(function(user){
        usersTableBody.appendChild(buildUserRow(user));
    });

    lingkodRenderPagination(usersPagination, usersCurrentPage, totalPages, function(page){
        usersCurrentPage = page;
        renderUsersPage();
    });
}

[usersSearch, usersOrgFilter, usersRoleFilter, usersStatusFilter, usersSort].forEach(function(el){
    el.addEventListener(el === usersSearch ? "input" : "change", function(){
        usersCurrentPage = 1;
        renderUsersPage();
    });
});

/* ================= VIEW PROFILE (read-only) ================= */

// Shared with messages/directory/reports' identical copies - see
// lingkodBuildProfileViewRow in js/common.js.
function buildUserProfileRow(label, value){
    return lingkodBuildProfileViewRow(label, value);
}

function openViewUserModal(user){
    const wrap = document.createElement("div");
    wrap.className = "profile-view";

    wrap.appendChild(lingkodBuildAvatarElement(user, "profile-view-avatar"));

    const name = document.createElement("h3");
    name.className = "profile-view-name";
    name.textContent = user.full_name || "Deleted User";
    wrap.appendChild(name);

    const roleTag = document.createElement("p");
    roleTag.className = "profile-view-role";
    roleTag.textContent = roleLabel(user.role);
    wrap.appendChild(roleTag);

    const divider = document.createElement("div");
    divider.className = "profile-view-divider";
    wrap.appendChild(divider);

    const grid = document.createElement("div");
    grid.className = "profile-view-grid";
    grid.appendChild(buildUserProfileRow("Student Number", user.student_number));
    grid.appendChild(buildUserProfileRow("Email", user.email));
    grid.appendChild(buildUserProfileRow("Organization", user.organization));
    grid.appendChild(buildUserProfileRow("Position", user.position));
    grid.appendChild(buildUserProfileRow("Department", user.department));
    grid.appendChild(buildUserProfileRow("Registration Date", user.created_at ? lingkodFormatDate(user.created_at) : null));
    grid.appendChild(buildUserProfileRow("Account Status", user.status === "inactive" ? "Inactive" : "Active"));
    wrap.appendChild(grid);

    lingkodOpenModal("User Profile", wrap);
}

/* ================= EDIT USER ================= */

// Full Name isn't directly editable - profiles.full_name is a GENERATED
// column (computed from last_name/first_name/middle_name, see
// 20260717000000_registration_name_split_and_validation.sql), so Postgres
// rejects any direct write to it. This edits the three real name columns
// instead, same as every other name-editing form in this app already
// does (Profile page's own Edit Profile form).
function openEditUserModal(user){
    const form = document.createElement("form");
    form.className = "edit-profile-form";

    const lastNameInput = document.createElement("input");
    lastNameInput.type = "text";
    lastNameInput.value = user.last_name || "";
    form.appendChild(lingkodBuildFormField("Last Name", lastNameInput));

    const firstNameInput = document.createElement("input");
    firstNameInput.type = "text";
    firstNameInput.value = user.first_name || "";
    form.appendChild(lingkodBuildFormField("First Name", firstNameInput));

    const middleNameInput = document.createElement("input");
    middleNameInput.type = "text";
    middleNameInput.value = user.middle_name || "";
    form.appendChild(lingkodBuildFormField("Middle Name (optional)", middleNameInput));

    const emailInput = document.createElement("input");
    emailInput.type = "email";
    emailInput.value = user.email || "";
    const emailField = lingkodBuildFormField("Email", emailInput);
    const emailHint = document.createElement("small");
    emailHint.className = "field-hint";
    emailHint.textContent = "Updates their displayed contact email only - it does not change their login email.";
    emailField.appendChild(emailHint);
    form.appendChild(emailField);

    const orgSelect = document.createElement("select");
    form.appendChild(lingkodBuildFormField("Organization", orgSelect));

    // profiles_department_required (see 20260717000000_registration_
    // name_split_and_validation.sql) means department_id can never be
    // null - previously this modal had no way to set it at all, so any
    // account whose department_id was ever null (e.g. an account that
    // predates this constraint) could never be edited here either,
    // since Postgres re-validates the WHOLE row against every
    // constraint on any update, not just the columns actually changed.
    const deptSelect = document.createElement("select");
    form.appendChild(lingkodBuildFormField("Department", deptSelect));

    const positionInput = document.createElement("input");
    positionInput.type = "text";
    positionInput.value = user.position || "";
    form.appendChild(lingkodBuildFormField("Position", positionInput));

    const roleSelect = document.createElement("select");
    [
        { value: "osoa_eb", label: "OSOA Executive Board" },
        { value: "org_president", label: "Organization President" },
        { value: "student", label: "Member" }
    ].forEach(function(opt){
        const option = document.createElement("option");
        option.value = opt.value;
        option.textContent = opt.label;
        if(user.role === opt.value) option.selected = true;
        roleSelect.appendChild(option);
    });
    form.appendChild(lingkodBuildFormField("Role", roleSelect));

    const statusSelect = document.createElement("select");
    [{ value: "active", label: "Active" }, { value: "inactive", label: "Inactive" }].forEach(function(opt){
        const option = document.createElement("option");
        option.value = opt.value;
        option.textContent = opt.label;
        if(user.status === opt.value) option.selected = true;
        statusSelect.appendChild(option);
    });
    form.appendChild(lingkodBuildFormField("Account Status", statusSelect));

    const saveBtn = document.createElement("button");
    saveBtn.type = "submit";
    saveBtn.textContent = "Save Changes";
    form.appendChild(saveBtn);

    lingkodPopulateOrganizationSelectById(orgSelect, user.organization_id);
    lingkodPopulateDepartmentSelect(deptSelect, user.department_id);

    form.addEventListener("submit", async function(e){
        e.preventDefault();

        const lastName = lastNameInput.value.trim();
        const firstName = firstNameInput.value.trim();
        if(!lastName || !firstName){
            lingkodToast("Last Name and First Name are required.", "error");
            return;
        }

        if(emailInput.value.trim() && !lingkodIsEmailValid(emailInput.value)){
            lingkodToast(LINGKOD_EMAIL_MESSAGE, "error");
            return;
        }

        // organization_id/department_id/position are all NOT NULL/CHECK-
        // constrained on profiles (profiles_organization_required,
        // profiles_department_required, profiles_position_required - see
        // 20260717000000_registration_name_split_and_validation.sql).
        // Validated here, before ever reaching Supabase, so clearing one
        // of these shows a clear message instead of a raw constraint-
        // violation error - the frontend and database now agree on what
        // "required" means for these three fields, same as they already
        // did for Last/First Name above.
        if(!orgSelect.value){
            lingkodToast("Please select an Organization.", "error");
            return;
        }
        if(!deptSelect.value){
            lingkodToast("Please select a Department.", "error");
            return;
        }
        if(!positionInput.value.trim()){
            lingkodToast("Position is required.", "error");
            return;
        }

        if(statusSelect.value === "inactive" && user.status !== "inactive"){
            const blockReason = explainWhyUserCantBeDeactivated(user);
            if(blockReason){
                lingkodToast(blockReason, "error");
                return;
            }
        }

        lingkodSetButtonLoading(saveBtn, true, "Saving...");

        const selectedOrgOption = orgSelect.options[orgSelect.selectedIndex];
        const selectedDeptOption = deptSelect.options[deptSelect.selectedIndex];

        const { error } = await supabaseClient
            .from("profiles")
            .update({
                last_name: lastName,
                first_name: firstName,
                middle_name: middleNameInput.value.trim() || null,
                email: emailInput.value.trim() || null,
                organization: selectedOrgOption.textContent,
                organization_id: orgSelect.value,
                department: selectedDeptOption.textContent,
                department_id: deptSelect.value,
                position: positionInput.value.trim(),
                role: roleSelect.value,
                status: statusSelect.value
            })
            .eq("id", user.id);

        lingkodSetButtonLoading(saveBtn, false);

        if(error){
            console.error("[registered-users] update failed:", error);
            lingkodToast("Couldn't save changes: " + error.message, "error");
            return;
        }

        lingkodCloseModal();
        lingkodToast("User updated successfully.", "success");
        await loadUsers();
    });

    lingkodOpenModal("Edit User — " + (user.full_name || "Deleted User"), form);
}

/* ================= REMOVE USER (deactivate + anonymize) ================= */

function hasAnotherActiveOsoaEb(excludingId){
    return allUsers.some(function(u){
        return u.role === "osoa_eb" && u.status === "active" && u.id !== excludingId;
    });
}

// Shared by both entry points into deactivation - Edit User's Account
// Status dropdown and the dedicated Remove User action enforce the same
// two restrictions, since they're really the same underlying operation
// (see removeUser()/the profiles.status='inactive' write both paths
// eventually make). Returns null when deactivation is allowed, or the
// user-facing reason it isn't - the trigger in
// 20260728030000_registered_users_admin_management.sql enforces both
// server-side too, so this is the friendly client-side echo of that,
// not the real security boundary.
function explainWhyUserCantBeDeactivated(user){
    if(user.id === viewerProfile.id){
        return "You cannot delete your own administrator account.";
    }
    if(user.role === "osoa_eb" && !hasAnotherActiveOsoaEb(user.id)){
        return "At least one OSOA Executive Board account must remain active.";
    }
    return null;
}

async function removeUser(user){
    // Several profiles columns are required by CHECK/NOT NULL constraints
    // added in 20260717000000_registration_name_split_and_validation.sql
    // (profiles_organization_required, profiles_department_required,
    // profiles_position_required) plus email's own NOT NULL - nulling any
    // of them here throws a constraint violation instead of anonymizing
    // the row. organization_id/department_id (the FK columns) are left
    // untouched entirely rather than nulled - only their free-text mirror
    // columns (organization/department) are cleared, which have no such
    // constraint. email/position get deterministic, obviously-not-real
    // placeholders instead of null, satisfying "not null and non-empty"
    // while still reading as anonymized rather than the person's real
    // data. email's placeholder embeds the row's own id so it stays
    // unique per user even if email also carries a unique constraint.
    const { error } = await supabaseClient
        .from("profiles")
        .update({
            status: "inactive",
            last_name: "",
            first_name: "Deleted User",
            middle_name: "",
            email: "deleted-user-" + user.id + "@deleted.lingkod",
            student_number: null,
            organization: null,
            position: "N/A",
            department: null,
            bio: null,
            contact_number: null,
            avatar_url: null
        })
        .eq("id", user.id);

    if(error){
        console.error("[registered-users] remove failed:", error);
        lingkodToast("Couldn't remove this user: " + error.message, "error");
        throw error;
    }

    lingkodToast("User removed successfully.", "success");
    await loadUsers();
}

function openRemoveUserModal(user){
    const blockReason = explainWhyUserCantBeDeactivated(user);
    if(blockReason){
        lingkodToast(blockReason, "error");
        return;
    }

    lingkodConfirmDelete({
        title: "Delete Registered User?",
        message: "This will deactivate " + (user.full_name || "this user") + "'s account (they can no longer log in) and remove their personal information (name, email, student number, organization, etc.) from the platform - their message, document, and activity history is preserved for records and will display as \"Deleted User\". This action cannot be undone.",
        confirmLabel: "Delete Permanently",
        loadingLabel: "Removing...",
        onConfirm: function(){ return removeUser(user); }
    });
}

/* ================= PERMANENTLY ERASE ACCOUNT (real deletion) =================
   A separate, rarer action from Remove User above, not a replacement for
   it. Remove User anonymizes the profile but deliberately keeps the row
   alive so this person's old messages/announcements/submissions still
   show a poster as "Deleted User". profiles.id has `on delete cascade`
   back to auth.users(id), so genuinely deleting the auth account - which
   is the whole point of this action, e.g. to free up their email for
   reuse - cascades and removes the profile row too, meaning that
   historical content permanently loses this person's attribution
   entirely. That privileged deletion (auth.admin.deleteUser) needs the
   service-role key, which this static frontend never has - it's done by
   the backend/functions/permanently-erase-account Edge Function instead,
   which independently re-checks every rule below itself rather than
   trusting this client. Only ever offered for an already-removed
   (inactive) account - see buildUserRow() above. */

async function permanentlyEraseUser(user){
    const { data, error } = await supabaseClient.functions.invoke("permanently-erase-account", {
        body: { userId: user.id }
    });

    if(error || (data && data.error)){
        const message = (data && data.error) || error.message;
        console.error("[registered-users] permanent erase failed:", message);
        lingkodToast("Couldn't permanently erase this account: " + message, "error");
        throw error || new Error(message);
    }

    lingkodToast("Account permanently erased.", "success");
    await loadUsers();
}

function openPermanentlyEraseModal(user){
    const blockReason = explainWhyUserCantBeDeactivated(user);
    if(blockReason){
        lingkodToast(blockReason, "error");
        return;
    }

    lingkodConfirmDelete({
        title: "Permanently Erase This Account?",
        message: "This will completely delete " + (user.full_name || "this account") + "'s login and free up their email for reuse - unlike Remove User, this cannot be undone and their name will disappear entirely from their past messages, announcements, and submissions instead of showing as \"Deleted User\". Only do this if you specifically need the account gone with zero trace.",
        confirmLabel: "Erase Permanently",
        loadingLabel: "Erasing...",
        onConfirm: function(){ return permanentlyEraseUser(user); }
    });
}

/* ================= INIT ================= */

document.addEventListener("DOMContentLoaded", async function(){
    viewerProfile = await lingkodGetAuthedProfile();
    if(!viewerProfile) return;

    await loadOrgFilterOptions();
    await loadUsers();
});

supabaseClient
    .channel("registered_users_page_changes")
    .on("postgres_changes", { event: "*", schema: "public", table: "profiles" }, function(){
        loadUsers();
    })
    .subscribe();
