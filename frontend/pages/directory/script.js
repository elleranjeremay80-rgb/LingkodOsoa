/* ===================================================
   LINGKOD Meneses - Directory
   Org-first layout, shown to every role: one panel per organization
   (OSOA included), each panel showing that org's full roster together -
   president, officers, then members - instead of four fixed sections
   spanning every organization. Which panels actually appear, and what's
   inside each one, is driven entirely by what the two visibility RPCs
   below return for the calling user (get_directory_visible_profiles /
   get_directory_visible_officers - see the 20260801010000 migration):
   osoa_eb gets every organization's full roster; org_president/student
   get OSOA's panel, every organization's President row, and their OWN
   organization's full roster. The render function itself does almost no
   role-branching - it just builds a panel for any organization that has
   visible roster data (or that the viewer can manage). Search/filter
   work the same way for everyone; what differs by role is only WHICH
   cards get a manage (three-dot) menu - see canManageOrg() below.
   That's a client-side convenience only - organization_officers' RLS
   policies (osoa_eb any row, org_president own organization_id only -
   see the 20260723030000/20260723040000 migrations) are the real
   enforcement, so even a direct API call can't write past what
   canManageOrg() already reflects here.

   Profile Picture/Position/Organization always show (even on a private
   profile) - only the deeper detail grid (student number, department,
   email, date registered, bio) is gated by that person's own "Show
   Profile Information" setting, via the same profile_visibility_
   allowed(uuid) RPC the Messages page's View Profile action relies on.
   =================================================== */

let viewerProfile = null;
let myProfileId = null;

function roleLabel(dbRole){
    const uiRole = LINGKOD_DB_ROLE_TO_UI_ROLE[dbRole] || dbRole;
    return LINGKOD_ROLE_LABELS[uiRole] || uiRole;
}

// osoa_eb can manage any organization's roster; org_president only their
// own; everyone else (Members) can't manage anything. This mirrors
// organization_officers_insert/update/delete's RLS rule exactly (see the
// migration header comment above) - it only decides whether this client
// shows a manage menu, never the actual permission. Delegates to the
// shared js/common.js rule (also used by List of Members) so this and
// Organization Information's own logo-upload gate can never drift back
// into two different comparison strategies again.
function canManageOrg(orgId){
    return lingkodCanManageOrganization(viewerProfile, orgId);
}

/* ================= SEARCH / FILTER BAR =================
   One shared bar above every organization's panel, for every role. The
   "section" filter (All Sections / OSOA Executive Board / Organization
   Presidents / Organization Officers / Organization Members) used to
   pick which of the four fixed sections to show; now that there's one
   panel per organization, it instead narrows WHICH cards render inside
   every panel (see renderDirectorySections below) - "osoa_eb" isolates
   the OSOA panel entirely, the other three narrow every panel down to
   just that card category. Grouped cards don't come from one flat query,
   so filtering happens client-side against the same data already loaded
   for rendering (see officerMatchesFilters/renderDirectorySections
   below), not a new request per keystroke. */

const directorySearch = document.getElementById("directorySearch");
const directoryRoleFilter = document.getElementById("directoryRoleFilter");
const directoryOrgFilter = document.getElementById("directoryOrgFilter");
const directoryPositionFilter = document.getElementById("directoryPositionFilter");
const directoryNoResultsEl = document.getElementById("directoryNoResults");

const directoryOrgPanelsEl = document.getElementById("directoryOrgPanels");

const manageDirectoryBtn = document.getElementById("manageDirectoryBtn");

function getDirectoryFilters(){
    return {
        query: directorySearch.value.trim().toLowerCase(),
        orgId: directoryOrgFilter.value,
        position: directoryPositionFilter.value,
        section: directoryRoleFilter.value // "", "osoa_eb", "president", "officer", "member"
    };
}

function officerMatchesFilters(officer, org, filters){
    if(filters.orgId && org.id !== filters.orgId) return false;
    if(filters.position && (officer.position || "").trim().toLowerCase() !== filters.position.trim().toLowerCase()) return false;
    if(filters.query){
        const haystack = ((officer.full_name || "") + " " + (officer.position || "") + " " + org.name).toLowerCase();
        if(!haystack.includes(filters.query)) return false;
    }
    return true;
}

// Rebuilt from whatever organizations/positions are actually loaded right
// now (fetchDirectoryManagementData) rather than a fixed list, so a newly
// registered organization or a freshly typed position shows up in the
// filters the moment it exists - no hardcoded options anywhere.
function refreshOrgFilterOptions(){
    const current = directoryOrgFilter.value;
    directoryOrgFilter.innerHTML = "<option value=\"\">All Organizations</option>";
    getOrderedOrganizations().forEach(function(org){
        const opt = document.createElement("option");
        opt.value = org.id;
        opt.textContent = org.name;
        directoryOrgFilter.appendChild(opt);
    });
    if(Array.from(directoryOrgFilter.options).some(function(o){ return o.value === current; })){
        directoryOrgFilter.value = current;
    }
}

function refreshPositionFilterOptions(){
    const current = directoryPositionFilter.value;
    const positions = new Set();
    osoaOfficers.forEach(function(o){ if(o.position) positions.add(o.position.trim()); });
    osoaRegisteredOfficers.forEach(function(p){ if(p.position) positions.add(p.position.trim()); });

    directoryPositionFilter.innerHTML = "<option value=\"\">All Positions</option>";
    Array.from(positions).sort(function(a, b){ return a.localeCompare(b); }).forEach(function(pos){
        const opt = document.createElement("option");
        opt.value = pos;
        opt.textContent = pos;
        directoryPositionFilter.appendChild(opt);
    });
    if(Array.from(positions).includes(current)) directoryPositionFilter.value = current;
}

[directorySearch, directoryRoleFilter, directoryOrgFilter, directoryPositionFilter].forEach(function(el){
    el.addEventListener(el === directorySearch ? "input" : "change", renderDirectorySections);
});

/* ================= 3D FLOATING PROFILE MODAL =================
   Its own overlay/card (not js/common.js's shared lingkodOpenModal,
   which every other page's modal reuses) - the animation and
   glassmorphism here are specific to this one interaction. Opened for
   registered-account cards (source === "profile") in any of the four
   sections, from any viewer role. */

const DEFAULT_RESPONSIBILITIES = {
    osoa_eb: "Responsible for overseeing student organizations, approving activities, monitoring compliance, and supporting organizational development.",
    org_president: "Leads the organization, coordinates officers, manages projects, and represents members.",
    student: "Registered member of the LINGKOD E-Governance Platform."
};

let directoryModalOverlay = null;
let directoryModalCard = null;
let directoryModalOpen = false;
let directoryModalCloseTimer = null;
let directoryModalActiveRowId = null;
let detachTiltEffect = null;

// Built once on first use, then just its content is replaced on every
// later open - same lazy-singleton pattern as js/common.js's own modal.
function ensureDirectoryModal(){
    if(directoryModalOverlay) return;

    directoryModalOverlay = document.createElement("div");
    directoryModalOverlay.className = "directory-modal-overlay";

    directoryModalCard = document.createElement("div");
    directoryModalCard.className = "directory-modal-card";
    directoryModalCard.id = "directoryModalCard";

    const closeBtn = document.createElement("button");
    closeBtn.type = "button";
    closeBtn.className = "directory-modal-close";
    closeBtn.setAttribute("aria-label", "Close");
    closeBtn.innerHTML = "<i class=\"fa-solid fa-xmark\"></i>";
    closeBtn.addEventListener("click", closeProfileModal);

    directoryModalCard.appendChild(closeBtn);
    directoryModalOverlay.appendChild(directoryModalCard);
    document.body.appendChild(directoryModalOverlay);

    directoryModalOverlay.addEventListener("click", function(e){
        if(e.target === directoryModalOverlay) closeProfileModal();
    });

    document.addEventListener("keydown", function(e){
        if(e.key === "Escape" && directoryModalOpen) closeProfileModal();
    });
}

// Subtle 3D tilt that tracks the cursor while the card is hovered - moves
// are applied instantly (no transition) so it tracks the mouse without
// lag; leaving re-enables a transition so it springs back smoothly. Only
// transform/opacity are touched throughout, never layout properties.
function attachTiltEffect(card){
    const maxTilt = 7;

    function handleMove(e){
        const rect = card.getBoundingClientRect();
        const px = (e.clientX - rect.left) / rect.width;
        const py = (e.clientY - rect.top) / rect.height;
        const rotateY = (px - 0.5) * 2 * maxTilt;
        const rotateX = (0.5 - py) * 2 * maxTilt;
        card.style.transition = "none";
        card.style.transform = "translateY(0) scale(1.015) rotateX(" + rotateX.toFixed(2) + "deg) rotateY(" + rotateY.toFixed(2) + "deg)";
    }

    function handleLeave(){
        card.style.transition = "transform .4s cubic-bezier(.34,1.56,.64,1)";
        card.style.transform = "";
    }

    card.addEventListener("mousemove", handleMove);
    card.addEventListener("mouseleave", handleLeave);

    return function detach(){
        card.removeEventListener("mousemove", handleMove);
        card.removeEventListener("mouseleave", handleLeave);
        card.style.transition = "";
        card.style.transform = "";
    };
}

// Shared with messages/registered-users/reports' identical copies -
// see lingkodBuildProfileViewRow in js/common.js.
function buildProfileRow(label, value){
    return lingkodBuildProfileViewRow(label, value);
}

function goMessageUser(row){
    closeProfileModal();
    window.location.href = "../messages/index.html?user=" + encodeURIComponent(row.id);
}

function closeProfileModal(){
    if(!directoryModalOpen || !directoryModalOverlay) return;

    directoryModalOpen = false;
    directoryModalActiveRowId = null;
    directoryModalOverlay.classList.remove("open");
    directoryModalOverlay.classList.add("closing");
    document.body.style.overflow = "";

    if(detachTiltEffect){
        detachTiltEffect();
        detachTiltEffect = null;
    }

    clearTimeout(directoryModalCloseTimer);
    directoryModalCloseTimer = setTimeout(function(){
        directoryModalOverlay.classList.remove("closing");
        directoryModalOverlay.style.display = "none";
    }, 420);
}

// Header (avatar/name/position/org) plus the Message/Close actions never
// need to wait on the privacy RPC - built and shown synchronously so the
// pop-in animation fires immediately on click, not after a network
// round-trip. detailSlot is where the async part below inserts the
// privacy-gated grid, once it resolves.
function buildProfileHeader(row){
    const wrap = document.createElement("div");
    wrap.className = "profile-view";

    wrap.appendChild(lingkodBuildAvatarElement(row, "profile-view-avatar"));

    const name = document.createElement("h3");
    name.className = "profile-view-name";
    name.textContent = row.full_name;
    wrap.appendChild(name);

    const position = document.createElement("p");
    position.className = "profile-view-position";
    position.textContent = row.position || roleLabel(row.role);
    wrap.appendChild(position);

    const org = document.createElement("p");
    org.className = "profile-view-org";
    org.textContent = row.organization || roleLabel(row.role);
    wrap.appendChild(org);

    const divider = document.createElement("div");
    divider.className = "profile-view-divider";
    wrap.appendChild(divider);

    const detailSlot = document.createElement("div");
    detailSlot.className = "profile-view-detail-slot";
    wrap.appendChild(detailSlot);

    const isMe = row.id === myProfileId;
    const actions = document.createElement("div");
    actions.className = "profile-view-actions";

    if(!isMe){
        const messageBtn = document.createElement("button");
        messageBtn.type = "button";
        messageBtn.innerHTML = "<i class=\"fa-solid fa-message\"></i> Message";
        messageBtn.addEventListener("click", function(){ goMessageUser(row); });
        actions.appendChild(messageBtn);
    }

    const closeBtn = document.createElement("button");
    closeBtn.type = "button";
    closeBtn.className = "btn-secondary";
    closeBtn.textContent = "Close";
    closeBtn.addEventListener("click", closeProfileModal);
    actions.appendChild(closeBtn);

    wrap.appendChild(actions);

    return { wrap: wrap, detailSlot: detailSlot };
}

async function fillProfileModalDetails(detailSlot, row){
    const isMe = row.id === myProfileId;

    // Own profile is always fully visible to yourself - no need to ask.
    let isVisible = true;
    if(!isMe){
        const { data, error } = await supabaseClient.rpc("profile_visibility_allowed", { target_id: row.id });
        isVisible = error ? true : data !== false;
    }

    // The user could have closed the modal or opened a different profile
    // entirely while this was in flight - never paint a stale result over
    // whatever's actually open now.
    if(directoryModalActiveRowId !== row.id) return;

    if(!isVisible){
        const note = document.createElement("p");
        note.className = "profile-view-private-note";
        note.textContent = "This user has limited who can see their full profile details.";
        detailSlot.appendChild(note);
        return;
    }

    const grid = document.createElement("div");
    grid.className = "profile-view-grid";
    grid.appendChild(buildProfileRow("Student Number", row.student_number));
    grid.appendChild(buildProfileRow("Department", row.department));
    grid.appendChild(buildProfileRow("Email Address", row.email));
    grid.appendChild(buildProfileRow("Contact Number", row.contact_number));
    grid.appendChild(buildProfileRow("Date Registered", row.created_at ? lingkodFormatDate(row.created_at) : null));
    grid.appendChild(buildProfileRow("Account Status", row.status === "inactive" ? "Inactive" : "Active"));
    detailSlot.appendChild(grid);

    const responsibilities = document.createElement("div");
    responsibilities.className = "profile-view-responsibilities";
    const respLabel = document.createElement("span");
    respLabel.className = "profile-view-responsibilities-label";
    respLabel.textContent = "Responsibilities";
    responsibilities.appendChild(respLabel);
    responsibilities.appendChild(document.createTextNode(
        row.bio || DEFAULT_RESPONSIBILITIES[row.role] || DEFAULT_RESPONSIBILITIES.student
    ));
    detailSlot.appendChild(responsibilities);
}

function openProfileModal(row){
    ensureDirectoryModal();
    clearTimeout(directoryModalCloseTimer);

    directoryModalActiveRowId = row.id;

    const closeIconBtn = directoryModalCard.querySelector(".directory-modal-close");
    directoryModalCard.innerHTML = "";
    directoryModalCard.appendChild(closeIconBtn);

    const built = buildProfileHeader(row);
    directoryModalCard.appendChild(built.wrap);

    directoryModalOverlay.classList.remove("closing");
    directoryModalOverlay.style.display = "flex";
    document.body.style.overflow = "hidden";

    // Two rAFs: guarantees the browser has painted the "closed" resting
    // transform at least once before .open is added, so the transition
    // actually animates instead of jumping straight to its end state.
    requestAnimationFrame(function(){
        requestAnimationFrame(function(){
            directoryModalOverlay.classList.add("open");
        });
    });

    directoryModalOpen = true;

    if(detachTiltEffect) detachTiltEffect();
    detachTiltEffect = attachTiltEffect(directoryModalCard);

    fillProfileModalDetails(built.detailSlot, row);
}

// If the profile currently open in the floating modal is the one that
// just changed, refresh its content in place - matches everything else
// on this page already updating live, without replaying the open
// animation (the modal itself isn't being reopened, just its data).
async function refreshOpenModalIfMatches(changedId){
    if(!directoryModalOpen || directoryModalActiveRowId !== changedId) return;

    const { data, error } = await supabaseClient
        .from("profiles")
        .select("id, full_name, student_number, organization, department, position, role, status, email, contact_number, avatar_url, bio, created_at")
        .eq("id", changedId)
        .maybeSingle();

    if(error || !data || directoryModalActiveRowId !== changedId) return;

    const closeIconBtn = directoryModalCard.querySelector(".directory-modal-close");
    directoryModalCard.innerHTML = "";
    directoryModalCard.appendChild(closeIconBtn);

    const built = buildProfileHeader(data);
    directoryModalCard.appendChild(built.wrap);
    fillProfileModalDetails(built.detailSlot, data);
}

/* ================= DIRECTORY DATA (shared by every role) =================
   organization_officers is a separate, manually-curated roster rather
   than profiles - a profile can't exist without a real auth.users
   account, so there's no "Add Officer" against profiles, and no way to
   truly delete an account from the client at all (per this feature's own
   product decision: registered accounts stay read-only in Directory,
   view-only "Registered Account" badge, same as before). RLS backs up
   the same organization-scoped write restriction server-side regardless
   of what the client attempts - see the 20260723030000/20260723040000
   migrations. */

const OFFICER_PHOTOS_BUCKET = "officer-photos";

let osoaOrganizations = [];
let osoaPositionOrderByOrg = {};
let osoaPositionRoleByOrg = {};
let osoaOfficers = [];
let osoaRegisteredOfficers = [];

// Registered accounts (profiles) show up here automatically whenever
// someone picks a real position at registration - "Member" is the one
// position every organization's dropdown always includes for regular
// members (see organization_positions' seed data), so anything else
// means they registered as an officer. These cards are read-only (no
// manage menu) since a profile can't be edited/deleted the way a
// manually-added organization_officers row can. The extra fields kept
// here (student_number/email/created_at/status/organization name) let a
// "profile" officer be handed straight to openProfileModal on click,
// without a second lookup back into osoaRegisteredOfficers.
function normalizeOfficer(row, source){
    if(source === "profile"){
        return {
            id: row.id,
            source: "profile",
            organization_id: row.organization_id,
            organization: row.organization,
            full_name: row.full_name,
            student_number: row.student_number,
            position: row.position,
            department: row.department,
            course: null,
            year_level: null,
            photo_url: row.avatar_url,
            avatar_url: row.avatar_url,
            description: row.bio,
            bio: row.bio,
            contact_number: row.contact_number,
            email: row.email,
            created_at: row.created_at,
            status: row.status,
            role: row.role
        };
    }

    return {
        id: row.id,
        source: "manual",
        organization_id: row.organization_id,
        full_name: row.full_name,
        position: row.position,
        department: row.department,
        course: row.course,
        year_level: row.year_level,
        photo_url: row.photo_url,
        description: row.description,
        contact_number: row.contact_number,
        email: row.email,
        role: null
    };
}

// "Member" is the one position name every organization's roster always
// includes for regular (non-officer) members - see organization_positions'
// seed data - so this is the rule Section 3 (Officers) vs Section 4
// (Members) splits on.
function isMemberPosition(position){
    return (position || "").trim().toLowerCase() === "member";
}

// A registered account's role already says directly whether it's the
// organization's president (no string-matching needed - see
// current_profile_role()'s own reasoning for why role lives in a real
// column instead). A manually-added organization_officers row has no
// role column, so its Position text is matched against
// organization_positions' system_role for that organization instead.
function isPresidentOfficer(officer, orgId){
    if(officer.source === "profile") return officer.role === "org_president";
    const orgMap = osoaPositionRoleByOrg[orgId];
    const key = (officer.position || "").trim().toLowerCase();
    return !!orgMap && orgMap[key] === "org_president";
}

function buildOfficerCard(officer, org, canManage, cardOptions){
    const opts = cardOptions || {};
    const card = document.createElement("div");
    card.className = "item-card officer-card";

    if(opts.showOrgLogo){
        card.appendChild(lingkodBuildOrgLogoElement(org, "officer-card-org-logo"));
    }

    card.appendChild(lingkodBuildAvatarElement(
        { avatar_url: officer.photo_url, full_name: officer.full_name },
        "directory-card-cover"
    ));

    const body = document.createElement("div");
    body.className = "item-card-body";

    const name = document.createElement("h3");
    name.textContent = officer.full_name;
    body.appendChild(name);

    const position = document.createElement("p");
    position.className = "directory-card-position";
    position.textContent = officer.position;
    body.appendChild(position);

    if(!opts.hideOrgLine){
        const orgLine = document.createElement("p");
        orgLine.className = "item-org";
        const orgIcon = document.createElement("i");
        orgIcon.className = "fa-solid fa-building";
        orgLine.appendChild(orgIcon);
        orgLine.appendChild(document.createTextNode(" " + org.name));
        body.appendChild(orgLine);
    }

    if(officer.department){
        const dept = document.createElement("p");
        dept.className = "directory-card-dept";
        dept.textContent = officer.department;
        body.appendChild(dept);
    }

    if(officer.course || officer.year_level){
        const courseYear = document.createElement("p");
        courseYear.className = "directory-card-dept";
        courseYear.textContent = [officer.course, officer.year_level].filter(Boolean).join(" · ");
        body.appendChild(courseYear);
    }

    if(officer.source === "profile"){
        const badge = document.createElement("p");
        badge.className = "officer-registered-badge";
        badge.innerHTML = "<i class=\"fa-solid fa-circle-check\"></i> Registered Account";
        body.appendChild(badge);
    }

    card.appendChild(body);

    if(officer.source === "manual" && canManage){
        const includePosition = opts.includePosition !== false;
        const entityLabel = includePosition ? "officer" : "member";

        card.appendChild(lingkodBuildCardMenuButton([
            {
                label: "Edit",
                icon: "fa-pen",
                onClick: function(){ openEditOfficerModal(officer, org, { includePosition: includePosition }); }
            },
            {
                label: "Remove",
                icon: "fa-trash",
                destructive: true,
                onClick: function(){ deleteOfficer(officer, entityLabel); }
            }
        ]));
    }

    card.addEventListener("click", function(){
        if(officer.source === "profile") openProfileModal(officer);
        else openOfficerDetailModal(officer, org);
    });

    return card;
}

// One box per organization, holding its whole visible roster - opts
// controls the parts that differ between viewers: whether the Edit/
// Delete ORGANIZATION controls show at all (osoa_eb only - see
// renderDirectorySections), which Add buttons appear (addActions, an
// array so a panel can offer both "Add Officer" and "Add Member" at
// once; omitted/empty for orgs the viewer can't manage), and whether
// each card gets a manage menu (canManage, already narrowed by the
// caller to "is this an org the viewer can manage").
function buildManagedOrgSection(org, officers, opts){
    const section = document.createElement("div");
    section.className = "osoa-directory-section";

    const header = document.createElement("div");
    header.className = "osoa-org-header";

    header.appendChild(lingkodBuildOrgLogoElement(org, "osoa-org-header-logo"));

    const textWrap = document.createElement("div");
    textWrap.className = "osoa-org-header-text";
    const h3 = document.createElement("h3");
    h3.textContent = org.name;
    textWrap.appendChild(h3);
    if(org.description){
        const desc = document.createElement("p");
        desc.className = "osoa-org-description";
        desc.textContent = org.description;
        textWrap.appendChild(desc);
    }
    header.appendChild(textWrap);

    const headerActions = document.createElement("div");
    headerActions.className = "osoa-org-header-actions";

    (opts.addActions || []).forEach(function(action){
        const addBtn = document.createElement("button");
        addBtn.type = "button";
        addBtn.className = "btn-secondary";
        addBtn.innerHTML = "<i class=\"fa-solid fa-user-plus\"></i> " + action.label;
        addBtn.addEventListener("click", action.onClick);
        headerActions.appendChild(addBtn);
    });

    if(opts.showOrgCrud){
        const editOrgBtn = document.createElement("button");
        editOrgBtn.type = "button";
        editOrgBtn.className = "icon-btn";
        editOrgBtn.setAttribute("aria-label", "Edit " + org.name);
        editOrgBtn.innerHTML = "<i class=\"fa-solid fa-pen\"></i>";
        editOrgBtn.addEventListener("click", function(){ openEditOrganizationModal(org); });
        headerActions.appendChild(editOrgBtn);

        const deleteOrgBtn = document.createElement("button");
        deleteOrgBtn.type = "button";
        deleteOrgBtn.className = "icon-btn icon-btn-danger";
        deleteOrgBtn.setAttribute("aria-label", "Delete " + org.name);
        deleteOrgBtn.innerHTML = "<i class=\"fa-solid fa-trash\"></i>";
        deleteOrgBtn.addEventListener("click", function(){ deleteOrganization(org); });
        headerActions.appendChild(deleteOrgBtn);
    }

    header.appendChild(headerActions);
    section.appendChild(header);

    const divider = document.createElement("div");
    divider.className = "osoa-org-divider";
    section.appendChild(divider);

    if(officers.length === 0){
        const empty = document.createElement("p");
        empty.className = "osoa-officer-empty";
        empty.textContent = opts.emptyText;
        section.appendChild(empty);
    } else {
        const grid = document.createElement("div");
        grid.className = "items-grid osoa-officer-grid";
        officers.forEach(function(officer){
            grid.appendChild(buildOfficerCard(officer, org, opts.canManage));
        });
        section.appendChild(grid);
    }

    return section;
}

// organization_positions already encodes each organization's real
// officer hierarchy via display_order (see the per-org roster seed
// migrations) - reused here instead of a second, hand-maintained
// ordering, so this stays correct if a roster is ever changed. Matched
// on trimmed/lower-cased position text since organization_officers'
// Position field is free text (typed by OSOA EB/an org president, not
// picked from the registration dropdown) and could differ in casing/
// whitespace from the seeded position_name. Anything that doesn't match
// a known position for that organization sorts to the end.
function getOfficerSortOrder(orgId, position){
    const orgMap = osoaPositionOrderByOrg[orgId];
    const key = (position || "").trim().toLowerCase();
    if(!orgMap || !Object.prototype.hasOwnProperty.call(orgMap, key)){
        return Number.MAX_SAFE_INTEGER;
    }
    return orgMap[key];
}

// OSOA always first, everyone else alphabetical - shared ordering rule
// for every section that lists organizations.
function getOrderedOrganizations(){
    const osoa = osoaOrganizations.find(function(o){ return o.slug === "osoa-meneses"; });
    const others = osoaOrganizations
        .filter(function(o){ return o.slug !== "osoa-meneses"; })
        .slice()
        .sort(function(a, b){ return a.name.localeCompare(b.name); });
    return osoa ? [osoa].concat(others) : others;
}

// Every organization_officers row AND registered profile for one
// organization - officers and members together, hierarchy-sorted. Split
// into officers-only / members-only by the caller via isMemberPosition(),
// since that's the only thing that actually distinguishes them.
function getAllForOrg(org){
    const manual = osoaOfficers
        .filter(function(o){ return o.organization_id === org.id; })
        .map(function(o){ return normalizeOfficer(o, "manual"); });
    const registered = osoaRegisteredOfficers
        .filter(function(p){ return p.organization_id === org.id; })
        .map(function(p){ return normalizeOfficer(p, "profile"); });

    return registered.concat(manual).sort(function(a, b){
        const orderA = getOfficerSortOrder(org.id, a.position);
        const orderB = getOfficerSortOrder(org.id, b.position);
        if(orderA !== orderB) return orderA - orderB;
        return (a.full_name || "").localeCompare(b.full_name || "");
    });
}

// Fetches every organization, every manually-added organization_officers
// row (officers AND members - the two are only ever split apart at
// render time, by position text), every registered account with an
// organization assigned (same), and the position hierarchy/role lookup.
// The officer/profile rows come from the get_directory_visible_officers/
// get_directory_visible_profiles security-definer RPCs (see the
// 20260801010000 migration) rather than a plain .from().select() -
// those two already apply Directory's visibility rule server-side
// (osoa_eb sees every row; org_president/student see OSOA's roster,
// every org's President row, and their own organization's full roster),
// so this client only re-applies the same "does this row actually
// belong on a directory card" shape-filtering it always did (non-null
// organization_id/position) and the same client-side sort .order() used
// to do, since RPC calls here return the full unordered table shape
// rather than a query-shaped result. Populated into shared module-level
// state rather than returned, since both the initial load and every
// realtime update funnel through this one function.
async function fetchDirectoryManagementData(){
    const [orgsResult, officersResult, registeredResult, positionsResult] = await Promise.all([
        supabaseClient.from("organizations").select("id, slug, name, logo_url, description, theme_color").order("name"),
        supabaseClient.rpc("get_directory_visible_officers"),
        supabaseClient.rpc("get_directory_visible_profiles"),
        supabaseClient.from("organization_positions").select("organization_id, position_name, display_order, system_role")
    ]);

    if(orgsResult.error){
        console.error("[directory] organizations load failed:", orgsResult.error);
        lingkodToast("Couldn't load organizations: " + orgsResult.error.message, "error");
        return false;
    }
    if(officersResult.error){
        console.error("[directory] officers load failed:", officersResult.error);
        lingkodToast("Couldn't load officers: " + officersResult.error.message, "error");
        return false;
    }
    if(registeredResult.error){
        console.error("[directory] registered officers load failed:", registeredResult.error);
        lingkodToast("Couldn't load registered members: " + registeredResult.error.message, "error");
        return false;
    }
    if(positionsResult.error){
        console.error("[directory] position order load failed:", positionsResult.error);
        // Non-fatal - officers just fall back to alphabetical order below.
    }

    osoaOrganizations = orgsResult.data;

    // organization_officers rows the RPC returned are already scoped to
    // what this viewer may see - just restore the .order("full_name")
    // a plain select() used to give us for free.
    osoaOfficers = (officersResult.data || []).slice().sort(function(a, b){
        return (a.full_name || "").localeCompare(b.full_name || "");
    });

    // profiles rows the RPC returned span every profile this viewer may
    // see under Directory's visibility rule (e.g. osoa_eb gets literally
    // everyone) - narrow that down to the subset that actually belongs on
    // a directory card (has an organization + position assigned, same as
    // the old .not("organization_id","is",null).not("position","is",null)
    // filter) and isn't a deactivated account, then restore full_name order.
    osoaRegisteredOfficers = (registeredResult.data || [])
        .filter(function(p){ return p.organization_id && p.position; })
        .filter(function(p){ return p.status !== "inactive"; })
        .sort(function(a, b){ return (a.full_name || "").localeCompare(b.full_name || ""); });

    osoaPositionOrderByOrg = {};
    osoaPositionRoleByOrg = {};
    (positionsResult.data || []).forEach(function(row){
        const key = (row.position_name || "").trim().toLowerCase();
        if(!osoaPositionOrderByOrg[row.organization_id]) osoaPositionOrderByOrg[row.organization_id] = {};
        if(!osoaPositionRoleByOrg[row.organization_id]) osoaPositionRoleByOrg[row.organization_id] = {};
        osoaPositionOrderByOrg[row.organization_id][key] = row.display_order;
        osoaPositionRoleByOrg[row.organization_id][key] = row.system_role;
    });

    return true;
}

/* ================= ROLE-TIER RENDER (every role) =================
   Four panels spanning every visible organization - OSOA EB Officers,
   Organization Presidents, Organization Officers, Organization Members -
   instead of one panel per organization. Officers/Members are further
   grouped by organization inside their own tier (a compact sub-header per
   org - buildDirectoryOrgSubgroup below), so which organization each card
   belongs to stays obvious once more than one shows up in the same tier.

   Still deliberately almost no role-branching: get_directory_visible_
   officers/get_directory_visible_profiles (see fetchDirectoryManagementData
   above) already trimmed osoaOfficers/osoaRegisteredOfficers down to
   exactly what this viewer may see before this function ever runs - an
   org_president/student's getAllForOrg(someOtherOrg) can only ever contain
   that org's President row, so a plain "does this org have a visible
   president/officer/member row" pass naturally reproduces the spec's
   visibility rule (every viewer sees every org's President; only the
   viewer's own org ever contributes to Officers/Members) without checking
   viewerProfile.role anywhere below. The one exception is the Officers/
   Members sub-groups: one still renders (empty, with an Add button) when
   the viewer can manage that org - same "the org's own president/EB needs
   a place to add its first entry" reason the old org-first panels kept -
   see collectGroupedTierEntries.

   The "section" filter (All Sections / OSOA Executive Board / Organization
   Presidents / Organization Officers / Organization Members) now isolates
   one tier panel outright instead of narrowing cards inside every org
   panel - the four values already map 1:1 onto DIRECTORY_TIERS below.
   Search/org/position filters still narrow which cards/sub-groups appear
   inside whichever tier(s) are showing, via the same officerMatchesFilters()
   as before. */

function cardCategory(officer, orgId){
    if(isPresidentOfficer(officer, orgId)) return "president";
    if(isMemberPosition(officer.position)) return "member";
    return "officer";
}

const DIRECTORY_TIERS = [
    { key: "president", title: "Organization Presidents", icon: "fa-user-tie" },
    { key: "officer", title: "Organization Officers", icon: "fa-users-gear" },
    { key: "member", title: "Organization Members", icon: "fa-users" }
];

// Cards shown per flat tier (Presidents) / organization sub-groups shown
// per grouped tier (Officers, Members) before collapsing behind "View All".
const DIRECTORY_TIER_CARD_LIMIT = 10;
const DIRECTORY_TIER_GROUP_LIMIT = 3;

// OSOA EB Officers is just the OSOA organization's own panel - reuses
// buildManagedOrgSection exactly as the old org-first render already did
// for it (unchanged), wrapped in the same .directory-section title/View
// All shell every other tier gets. No cap/View All here: an executive
// board is inherently small, unlike an organization's full member roster.
function buildDirectoryOsoaTier(filters, isFiltering){
    const osoaOrg = getOrderedOrganizations().find(function(o){ return o.slug === "osoa-meneses"; });
    if(!osoaOrg) return null;

    const roster = getAllForOrg(osoaOrg).filter(function(o){ return officerMatchesFilters(o, osoaOrg, filters); });
    const canManage = canManageOrg(osoaOrg.id);

    if(roster.length === 0 && (isFiltering || !canManage)) return null;

    const addActions = canManage ? [
        { label: "Add Officer", onClick: function(){ openAddOfficerModal(osoaOrg, { includePosition: true }); } },
        { label: "Add Member", onClick: function(){ openAddOfficerModal(osoaOrg, { includePosition: false }); } }
    ] : [];

    const section = document.createElement("div");
    section.className = "directory-section";

    const header = document.createElement("div");
    header.className = "directory-section-header";
    const h2 = document.createElement("h2");
    h2.innerHTML = "<i class=\"fa-solid fa-user-shield\"></i> OSOA EB Officers";
    header.appendChild(h2);
    section.appendChild(header);

    section.appendChild(buildManagedOrgSection(osoaOrg, roster, {
        showOrgCrud: !!(viewerProfile && viewerProfile.role === "osoa_eb"),
        addActions: addActions,
        canManage: canManage,
        emptyText: "No OSOA Executive Board members have been added yet."
    }));

    return { section: section, count: roster.length };
}

// Flat {officer, org} pairs for a tier that doesn't group by organization
// (Organization Presidents) - every visible organization contributes at
// most its President row(s).
function collectFlatTierEntries(tierKey, filters){
    const entries = [];

    getOrderedOrganizations().forEach(function(org){
        if(org.slug === "osoa-meneses") return;

        getAllForOrg(org).forEach(function(officer){
            if(!officerMatchesFilters(officer, org, filters)) return;
            if(cardCategory(officer, org.id) !== tierKey) return;
            entries.push({ officer: officer, org: org });
        });
    });

    return entries;
}

// One sub-group per organization for a tier that DOES group by
// organization (Organization Officers, Organization Members) - mirrors
// the exact "show it if it has visible rows, or if the viewer can manage
// this org and isn't mid-filter" guard the old org-first panels used.
function collectGroupedTierEntries(tierKey, filters, isFiltering){
    const groups = [];

    getOrderedOrganizations().forEach(function(org){
        if(org.slug === "osoa-meneses") return;

        const roster = getAllForOrg(org).filter(function(officer){
            if(!officerMatchesFilters(officer, org, filters)) return false;
            return cardCategory(officer, org.id) === tierKey;
        });

        const canManage = canManageOrg(org.id);
        if(roster.length === 0 && (isFiltering || !canManage)) return;

        groups.push({ org: org, roster: roster, canManage: canManage });
    });

    return groups;
}

function buildDirectoryFlatGrid(entries){
    const grid = document.createElement("div");
    grid.className = "items-grid osoa-officer-grid";
    entries.forEach(function(entry){
        grid.appendChild(buildOfficerCard(entry.officer, entry.org, canManageOrg(entry.org.id)));
    });
    return grid;
}

function buildDirectoryOrgSubgroup(group, tierKey){
    const wrap = document.createElement("div");
    wrap.className = "directory-org-subgroup";

    const header = document.createElement("div");
    header.className = "directory-org-subgroup-header";
    header.appendChild(lingkodBuildOrgLogoElement(group.org, "directory-org-subgroup-logo"));

    const name = document.createElement("h4");
    name.textContent = group.org.name;
    header.appendChild(name);

    if(group.canManage){
        const includePosition = tierKey === "officer";
        const addBtn = document.createElement("button");
        addBtn.type = "button";
        addBtn.className = "btn-secondary directory-org-subgroup-add";
        addBtn.innerHTML = "<i class=\"fa-solid fa-user-plus\"></i> " + (includePosition ? "Add Officer" : "Add Member");
        addBtn.addEventListener("click", function(){ openAddOfficerModal(group.org, { includePosition: includePosition }); });
        header.appendChild(addBtn);
    }

    wrap.appendChild(header);

    if(group.roster.length === 0){
        const empty = document.createElement("p");
        empty.className = "osoa-officer-empty";
        empty.textContent = tierKey === "officer"
            ? "No officers have been added yet."
            : "No members have been added yet.";
        wrap.appendChild(empty);
    } else {
        const grid = document.createElement("div");
        grid.className = "items-grid osoa-officer-grid";
        group.roster.forEach(function(officer){
            // hideOrgLine: the sub-group header right above already names
            // this organization - repeating it on every card would be
            // redundant (unlike the Presidents tier, where each card's own
            // org line is the only thing saying which org it belongs to).
            grid.appendChild(buildOfficerCard(officer, group.org, group.canManage, { hideOrgLine: true }));
        });
        wrap.appendChild(grid);
    }

    return wrap;
}

// Builds one tier's full, uncapped body - called once for the capped
// main-page render and again (uncapped) if "View All" is clicked.
function buildDirectoryTierBody(tier, filters, isFiltering){
    if(tier.key === "president"){
        const entries = collectFlatTierEntries(tier.key, filters);
        return { count: entries.length, build: function(cap){
            return buildDirectoryFlatGrid(cap != null ? entries.slice(0, cap) : entries);
        } };
    }

    const groups = collectGroupedTierEntries(tier.key, filters, isFiltering);
    return { count: groups.length, build: function(cap){
        const wrap = document.createElement("div");
        wrap.className = "directory-org-subgroups";
        (cap != null ? groups.slice(0, cap) : groups).forEach(function(group){
            wrap.appendChild(buildDirectoryOrgSubgroup(group, tier.key));
        });
        return wrap;
    } };
}

function openDirectoryTierViewAllModal(tier, filters, isFiltering){
    const body = buildDirectoryTierBody(tier, filters, isFiltering);
    lingkodOpenModal(tier.title, body.build(null), "modal-wide");
}

function buildDirectoryTierPanel(tier, filters, isFiltering){
    const body = buildDirectoryTierBody(tier, filters, isFiltering);
    if(body.count === 0) return null;

    const isGrouped = tier.key === "officer" || tier.key === "member";
    const limit = isGrouped ? DIRECTORY_TIER_GROUP_LIMIT : DIRECTORY_TIER_CARD_LIMIT;

    const section = document.createElement("div");
    section.className = "directory-section";

    const header = document.createElement("div");
    header.className = "directory-section-header";

    const h2 = document.createElement("h2");
    h2.innerHTML = "<i class=\"fa-solid " + tier.icon + "\"></i> " + tier.title;
    header.appendChild(h2);

    if(body.count > limit){
        const viewAllBtn = document.createElement("button");
        viewAllBtn.type = "button";
        viewAllBtn.className = "btn-secondary directory-view-all-btn";
        viewAllBtn.textContent = "View All";
        viewAllBtn.addEventListener("click", function(){ openDirectoryTierViewAllModal(tier, filters, isFiltering); });
        header.appendChild(viewAllBtn);
    }

    section.appendChild(header);
    section.appendChild(body.build(limit));

    return { section: section, count: body.count };
}

function renderDirectorySections(){
    const filters = getDirectoryFilters();
    const isFiltering = !!(filters.query || filters.orgId || filters.position || filters.section);
    let totalCards = 0;

    directoryOrgPanelsEl.innerHTML = "";

    if(!filters.section || filters.section === "osoa_eb"){
        const osoaTier = buildDirectoryOsoaTier(filters, isFiltering);
        if(osoaTier){
            totalCards += osoaTier.count;
            directoryOrgPanelsEl.appendChild(osoaTier.section);
        }
    }

    DIRECTORY_TIERS.forEach(function(tier){
        if(filters.section && filters.section !== tier.key) return;

        const built = buildDirectoryTierPanel(tier, filters, isFiltering);
        if(!built) return;

        totalCards += built.count;
        directoryOrgPanelsEl.appendChild(built.section);
    });

    directoryNoResultsEl.hidden = !(isFiltering && totalCards === 0);
}

async function loadDirectoryData(){
    if(!(await fetchDirectoryManagementData())) return;
    refreshOrgFilterOptions();
    refreshPositionFilterOptions();
    renderDirectorySections();
}

/* ================= OFFICER ADD / EDIT / DELETE ================= */

function buildOfficerForm(existingOfficer, onSave, formOptions){
    const opts = formOptions || {};
    const includePosition = opts.includePosition !== false;

    const form = document.createElement("form");
    form.className = "edit-profile-form";

    const nameInput = document.createElement("input");
    nameInput.type = "text";
    nameInput.required = true;
    nameInput.value = existingOfficer ? existingOfficer.full_name : "";
    form.appendChild(lingkodBuildFormField("Full Name", nameInput));

    let positionInput = null;
    if(includePosition){
        positionInput = document.createElement("input");
        positionInput.type = "text";
        positionInput.required = true;
        positionInput.value = existingOfficer ? existingOfficer.position : "";
        form.appendChild(lingkodBuildFormField("Position", positionInput));
    }

    const deptInput = document.createElement("input");
    deptInput.type = "text";
    deptInput.value = existingOfficer ? (existingOfficer.department || "") : "";
    form.appendChild(lingkodBuildFormField("College / Department", deptInput));

    const courseInput = document.createElement("input");
    courseInput.type = "text";
    courseInput.value = existingOfficer ? (existingOfficer.course || "") : "";
    form.appendChild(lingkodBuildFormField("Course (optional)", courseInput));

    const yearInput = document.createElement("input");
    yearInput.type = "text";
    yearInput.value = existingOfficer ? (existingOfficer.year_level || "") : "";
    form.appendChild(lingkodBuildFormField("Year Level (optional)", yearInput));

    const emailInput = document.createElement("input");
    emailInput.type = "email";
    emailInput.value = existingOfficer ? (existingOfficer.email || "") : "";
    form.appendChild(lingkodBuildFormField("Email (optional)", emailInput));

    const contactInput = document.createElement("input");
    contactInput.type = "text";
    contactInput.value = existingOfficer ? (existingOfficer.contact_number || "") : "";
    form.appendChild(lingkodBuildFormField("Contact Number (optional)", contactInput));

    const descInput = document.createElement("textarea");
    descInput.rows = 3;
    descInput.value = existingOfficer ? (existingOfficer.description || "") : "";
    form.appendChild(lingkodBuildFormField("Description / Responsibilities", descInput));

    const imageField = document.createElement("div");
    imageField.className = "image-field";
    const imageLabel = document.createElement("label");
    imageLabel.className = "field-label";
    imageLabel.textContent = "Profile Picture";
    imageField.appendChild(imageLabel);

    const previewWrap = document.createElement("div");
    previewWrap.className = "image-preview";
    previewWrap.hidden = !(existingOfficer && existingOfficer.photo_url);
    const previewImg = document.createElement("img");
    if(existingOfficer && existingOfficer.photo_url) previewImg.src = existingOfficer.photo_url;
    previewWrap.appendChild(previewImg);

    let removeExistingPhoto = false;
    let newPhotoBlob = null;

    const removeBtn = document.createElement("button");
    removeBtn.type = "button";
    removeBtn.className = "image-preview-remove";
    removeBtn.setAttribute("aria-label", "Remove profile picture");
    removeBtn.innerHTML = "<i class=\"fa-solid fa-xmark\"></i>";
    removeBtn.addEventListener("click", function(){
        removeExistingPhoto = true;
        newPhotoBlob = null;
        previewWrap.hidden = true;
        photoFileInput.value = "";
    });
    previewWrap.appendChild(removeBtn);
    imageField.appendChild(previewWrap);

    const photoFileInput = document.createElement("input");
    photoFileInput.type = "file";
    photoFileInput.accept = ".jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp";
    imageField.appendChild(photoFileInput);

    lingkodWireSquareImageInput({
        fileInput: photoFileInput,
        previewWrap: previewWrap,
        previewImg: previewImg,
        onReady: function(blob){
            newPhotoBlob = blob;
            removeExistingPhoto = false;
        }
    });

    const imageHint = document.createElement("small");
    imageHint.className = "field-hint";
    imageHint.textContent = "Recommended image size: 1080 × 1080 pixels (Square). JPG, PNG, or WEBP. Max 10 MB.";
    imageField.appendChild(imageHint);

    form.appendChild(imageField);

    const saveBtn = document.createElement("button");
    saveBtn.type = "submit";
    saveBtn.textContent = existingOfficer ? "Save Changes" : (includePosition ? "Add Officer" : "Add Member");
    form.appendChild(saveBtn);

    form.addEventListener("submit", async function(e){
        e.preventDefault();

        const fullName = nameInput.value.trim();
        const position = includePosition ? positionInput.value.trim() : "Member";
        if(!fullName || (includePosition && !position)){
            lingkodToast(includePosition ? "Full Name and Position are required." : "Full Name is required.", "error");
            return;
        }

        lingkodSetButtonLoading(saveBtn, true, existingOfficer ? "Saving..." : "Adding...");

        try {
            await onSave({
                full_name: fullName,
                position: position,
                department: deptInput.value.trim() || null,
                course: courseInput.value.trim() || null,
                year_level: yearInput.value.trim() || null,
                email: emailInput.value.trim() || null,
                contact_number: contactInput.value.trim() || null,
                description: descInput.value.trim() || null
            }, newPhotoBlob, removeExistingPhoto);
        } finally {
            lingkodSetButtonLoading(saveBtn, false);
        }
    });

    return form;
}

// entityLabel is "Officer" or "Member" purely for modal titles/toasts -
// both are stored as organization_officers rows either way (a "Member" is
// just a row whose position is the literal text "Member"), so there's no
// behavioral difference beyond the form's includePosition option and the
// storage-path/RLS scoping to the caller's own organization for
// org_president (osoa_eb has no such restriction).
function openAddOfficerModal(org, entityOptions){
    const opts = entityOptions || {};
    const includePosition = opts.includePosition !== false;
    const entityLabel = includePosition ? "Officer" : "Member";

    const form = buildOfficerForm(null, async function(patch, newPhotoBlob){
        const newId = crypto.randomUUID();
        let photoUrl = null;

        try {
            if(newPhotoBlob){
                photoUrl = await lingkodUploadPublicImage(OFFICER_PHOTOS_BUCKET, org.id, newPhotoBlob);
            }
        } catch(err){
            console.error("[directory] officer photo upload failed:", err);
            lingkodToast("Couldn't upload the profile picture: " + err.message, "error");
            return;
        }

        const { error } = await supabaseClient.from("organization_officers").insert({
            id: newId,
            organization_id: org.id,
            full_name: patch.full_name,
            position: patch.position,
            department: patch.department,
            course: patch.course,
            year_level: patch.year_level,
            email: patch.email,
            contact_number: patch.contact_number,
            description: patch.description,
            photo_url: photoUrl
        });

        if(error){
            if(photoUrl) lingkodDeletePublicImage(OFFICER_PHOTOS_BUCKET, photoUrl);
            console.error("[directory] add " + entityLabel.toLowerCase() + " failed:", error);
            lingkodToast("Couldn't add this " + entityLabel.toLowerCase() + ": " + error.message, "error");
            return;
        }

        lingkodCloseModal();
        lingkodToast(entityLabel + " added successfully.", "success");
        await loadDirectoryData();
    }, { includePosition: includePosition });

    lingkodOpenModal("Add " + entityLabel + " — " + org.name, form);
}

function openEditOfficerModal(officer, org, entityOptions){
    const opts = entityOptions || {};
    const includePosition = opts.includePosition !== false;
    const entityLabel = includePosition ? "Officer" : "Member";

    const form = buildOfficerForm(officer, async function(patch, newPhotoBlob, removeExistingPhoto){
        let uploadedUrl = null;

        try {
            if(newPhotoBlob){
                uploadedUrl = await lingkodUploadPublicImage(OFFICER_PHOTOS_BUCKET, org.id, newPhotoBlob);
                patch.photo_url = uploadedUrl;
            } else if(removeExistingPhoto){
                patch.photo_url = null;
            }
        } catch(err){
            console.error("[directory] officer photo upload failed:", err);
            lingkodToast("Couldn't upload the profile picture: " + err.message, "error");
            return;
        }

        const { error } = await supabaseClient
            .from("organization_officers")
            .update(patch)
            .eq("id", officer.id);

        if(error){
            if(uploadedUrl) lingkodDeletePublicImage(OFFICER_PHOTOS_BUCKET, uploadedUrl);
            console.error("[directory] update " + entityLabel.toLowerCase() + " failed:", error);
            lingkodToast("Couldn't update this " + entityLabel.toLowerCase() + ": " + error.message, "error");
            return;
        }

        if((newPhotoBlob || removeExistingPhoto) && officer.photo_url){
            lingkodDeletePublicImage(OFFICER_PHOTOS_BUCKET, officer.photo_url);
        }

        lingkodCloseModal();
        lingkodToast(entityLabel + " updated successfully.", "success");
        await loadDirectoryData();
    }, { includePosition: includePosition });

    lingkodOpenModal("Edit " + entityLabel + " — " + org.name, form);
}

function deleteOfficer(officer, entityLabel){
    const label = entityLabel || "officer";

    lingkodConfirmDelete({
        title: "Remove Directory Entry?",
        message: "Are you sure you want to remove this user from the directory? This action cannot be undone.",
        confirmLabel: "Remove",
        onConfirm: async function(){
            const { error } = await supabaseClient.from("organization_officers").delete().eq("id", officer.id);

            if(error){
                console.error("[directory] remove " + label + " failed:", error);
                lingkodToast("Couldn't remove this " + label + ": " + error.message, "error");
                throw error;
            }

            if(officer.photo_url) lingkodDeletePublicImage(OFFICER_PHOTOS_BUCKET, officer.photo_url);

            lingkodToast(label.charAt(0).toUpperCase() + label.slice(1) + " removed successfully.", "success");
            await loadDirectoryData();
        }
    });
}

/* ================= ORGANIZATION ADD / EDIT / DELETE (osoa_eb only) ================= */

function slugifyOrgName(name){
    return name.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "") || "org-" + Date.now();
}

function buildOrganizationForm(existingOrg, onSave){
    const form = document.createElement("form");
    form.className = "edit-profile-form";

    const nameInput = document.createElement("input");
    nameInput.type = "text";
    nameInput.required = true;
    nameInput.value = existingOrg ? existingOrg.name : "";
    form.appendChild(lingkodBuildFormField("Organization Name", nameInput));

    const descInput = document.createElement("textarea");
    descInput.rows = 3;
    descInput.value = existingOrg ? (existingOrg.description || "") : "";
    form.appendChild(lingkodBuildFormField("Description (optional)", descInput));

    const colorInput = document.createElement("input");
    colorInput.type = "color";
    colorInput.value = (existingOrg && existingOrg.theme_color) || "#362A5D";
    form.appendChild(lingkodBuildFormField("Theme Color (optional)", colorInput));

    const imageField = document.createElement("div");
    imageField.className = "image-field";
    const imageLabel = document.createElement("label");
    imageLabel.className = "field-label";
    imageLabel.textContent = "Organization Logo";
    imageField.appendChild(imageLabel);

    const previewWrap = document.createElement("div");
    previewWrap.className = "image-preview";
    previewWrap.hidden = !(existingOrg && existingOrg.logo_url);
    const previewImg = document.createElement("img");
    if(existingOrg && existingOrg.logo_url) previewImg.src = existingOrg.logo_url;
    previewWrap.appendChild(previewImg);

    let removeExistingLogo = false;
    let newLogoProcessed = null;

    const removeBtn = document.createElement("button");
    removeBtn.type = "button";
    removeBtn.className = "image-preview-remove";
    removeBtn.setAttribute("aria-label", "Remove logo");
    removeBtn.innerHTML = "<i class=\"fa-solid fa-xmark\"></i>";
    removeBtn.addEventListener("click", function(){
        removeExistingLogo = true;
        newLogoProcessed = null;
        previewWrap.hidden = true;
        logoFileInput.value = "";
    });
    previewWrap.appendChild(removeBtn);
    imageField.appendChild(previewWrap);

    const logoFileInput = document.createElement("input");
    logoFileInput.type = "file";
    logoFileInput.accept = ".jpg,.jpeg,.png,.webp,.svg,image/jpeg,image/png,image/webp,image/svg+xml";
    imageField.appendChild(logoFileInput);

    logoFileInput.addEventListener("change", async function(){
        const file = logoFileInput.files[0];
        if(!file) return;

        const validationError = lingkodValidateOrgLogoFile(file);
        if(validationError){
            lingkodToast(validationError, "error");
            logoFileInput.value = "";
            return;
        }

        try {
            const processed = await lingkodProcessOrgLogoFile(file);
            newLogoProcessed = processed;
            removeExistingLogo = false;
            previewImg.src = processed.objectUrl;
            previewWrap.hidden = false;
        } catch(err){
            console.error("[directory] logo processing failed:", err);
            lingkodToast("Couldn't process this image.", "error");
        }
    });

    imageField.appendChild(logoFileInput);

    const imageHint = document.createElement("small");
    imageHint.className = "field-hint";
    imageHint.textContent = "JPG, PNG, WEBP, or SVG. Max 10 MB.";
    imageField.appendChild(imageHint);

    form.appendChild(imageField);

    const saveBtn = document.createElement("button");
    saveBtn.type = "submit";
    saveBtn.textContent = existingOrg ? "Save Changes" : "Add Organization";
    form.appendChild(saveBtn);

    form.addEventListener("submit", async function(e){
        e.preventDefault();

        const name = nameInput.value.trim();
        if(!name){
            lingkodToast("Organization name is required.", "error");
            return;
        }

        lingkodSetButtonLoading(saveBtn, true, existingOrg ? "Saving..." : "Adding...");

        try {
            await onSave({
                name: name,
                description: descInput.value.trim() || null,
                theme_color: colorInput.value || null
            }, newLogoProcessed, removeExistingLogo);
        } finally {
            lingkodSetButtonLoading(saveBtn, false);
        }
    });

    return form;
}

function openAddOrganizationModal(){
    const form = buildOrganizationForm(null, async function(patch, newLogoProcessed){
        const newId = crypto.randomUUID();
        let logoUrl = null;

        try {
            if(newLogoProcessed){
                logoUrl = await lingkodUploadOrgLogo(newId, newLogoProcessed);
            }
        } catch(err){
            console.error("[directory] org logo upload failed:", err);
            lingkodToast("Couldn't upload the logo: " + err.message, "error");
            return;
        }

        const { error } = await supabaseClient.from("organizations").insert({
            id: newId,
            slug: slugifyOrgName(patch.name),
            name: patch.name,
            description: patch.description,
            theme_color: patch.theme_color,
            logo_url: logoUrl
        });

        if(error){
            if(logoUrl) lingkodRemoveOrgLogo(newId);
            console.error("[directory] add organization failed:", error);
            lingkodToast("Couldn't add this organization: " + error.message, "error");
            return;
        }

        lingkodCloseModal();
        lingkodToast("Organization added successfully. Note: it won't appear on the Registration page's organization list until that's updated separately.", "success");
        await loadDirectoryData();
    });

    lingkodOpenModal("Add Organization", form);
}

function openEditOrganizationModal(org){
    const form = buildOrganizationForm(org, async function(patch, newLogoProcessed, removeExistingLogo){
        let uploadedUrl = null;

        try {
            if(newLogoProcessed){
                uploadedUrl = await lingkodUploadOrgLogo(org.id, newLogoProcessed);
                patch.logo_url = uploadedUrl;
            } else if(removeExistingLogo){
                await lingkodRemoveOrgLogo(org.id);
                patch.logo_url = null;
            }
        } catch(err){
            console.error("[directory] org logo upload failed:", err);
            lingkodToast("Couldn't upload the logo: " + err.message, "error");
            return;
        }

        const { error } = await supabaseClient
            .from("organizations")
            .update(patch)
            .eq("id", org.id);

        if(error){
            console.error("[directory] update organization failed:", error);
            lingkodToast("Couldn't update this organization: " + error.message, "error");
            return;
        }

        lingkodCloseModal();
        lingkodToast("Organization updated successfully.", "success");
        await loadDirectoryData();
    });

    lingkodOpenModal("Edit Organization", form);
}

function deleteOrganization(org){
    const manualCount = osoaOfficers.filter(function(o){ return o.organization_id === org.id; }).length;
    const registeredCount = osoaRegisteredOfficers.filter(function(p){ return p.organization_id === org.id; }).length;

    if(manualCount > 0){
        lingkodToast("This organization still has " + manualCount + " officer(s). Remove them first before deleting the organization.", "error");
        return;
    }
    if(registeredCount > 0){
        lingkodToast("This organization still has " + registeredCount + " registered member(s). They need to be reassigned or deactivated before deleting the organization.", "error");
        return;
    }

    lingkodConfirmDelete({
        title: "Delete Organization?",
        message: "Are you sure you want to delete " + org.name + "? This action cannot be undone.",
        confirmLabel: "Delete",
        onConfirm: async function(){
            const { error } = await supabaseClient.from("organizations").delete().eq("id", org.id);

            if(error){
                console.error("[directory] delete organization failed:", error);
                // 23503 = foreign_key_violation - most likely registered members
                // still point at this organization (profiles.organization_id).
                const message = error.code === "23503"
                    ? "This organization still has registered members or other linked records. Remove or reassign them first."
                    : error.message;
                lingkodToast("Couldn't delete this organization: " + message, "error");
                throw error;
            }

            await lingkodRemoveOrgLogo(org.id);
            lingkodToast("Organization deleted successfully.", "success");
            await loadDirectoryData();
        }
    });
}

if(manageDirectoryBtn){
    manageDirectoryBtn.addEventListener("click", openAddOrganizationModal);
}

/* ================= OFFICER DETAILS POPUP (reuses the same glassmorphism modal) ================= */

function buildOfficerRow(label, value){
    return buildProfileRow(label, value);
}

function openOfficerDetailModal(officer, org){
    ensureDirectoryModal();
    clearTimeout(directoryModalCloseTimer);

    directoryModalActiveRowId = officer.id;

    const closeIconBtn = directoryModalCard.querySelector(".directory-modal-close");
    directoryModalCard.innerHTML = "";
    directoryModalCard.appendChild(closeIconBtn);

    const wrap = document.createElement("div");
    wrap.className = "profile-view";

    wrap.appendChild(lingkodBuildAvatarElement(
        { avatar_url: officer.photo_url, full_name: officer.full_name },
        "profile-view-avatar"
    ));

    const name = document.createElement("h3");
    name.className = "profile-view-name";
    name.textContent = officer.full_name;
    wrap.appendChild(name);

    const position = document.createElement("p");
    position.className = "profile-view-position";
    position.textContent = officer.position;
    wrap.appendChild(position);

    const org_ = document.createElement("p");
    org_.className = "profile-view-org";
    org_.textContent = org.name;
    wrap.appendChild(org_);

    const divider = document.createElement("div");
    divider.className = "profile-view-divider";
    wrap.appendChild(divider);

    const grid = document.createElement("div");
    grid.className = "profile-view-grid";
    grid.appendChild(buildOfficerRow("Department", officer.department));
    grid.appendChild(buildOfficerRow("Course", officer.course));
    grid.appendChild(buildOfficerRow("Year Level", officer.year_level));
    grid.appendChild(buildOfficerRow("Email", officer.email));
    grid.appendChild(buildOfficerRow("Contact Number", officer.contact_number));
    wrap.appendChild(grid);

    const responsibilities = document.createElement("div");
    responsibilities.className = "profile-view-responsibilities";
    const respLabel = document.createElement("span");
    respLabel.className = "profile-view-responsibilities-label";
    respLabel.textContent = "Description / Responsibilities";
    responsibilities.appendChild(respLabel);
    responsibilities.appendChild(document.createTextNode(officer.description || "Not set"));
    wrap.appendChild(responsibilities);

    const closeBtn = document.createElement("button");
    closeBtn.type = "button";
    closeBtn.className = "btn-secondary";
    closeBtn.textContent = "Close";
    closeBtn.addEventListener("click", closeProfileModal);
    wrap.appendChild(closeBtn);

    directoryModalCard.appendChild(wrap);

    directoryModalOverlay.classList.remove("closing");
    directoryModalOverlay.style.display = "flex";
    document.body.style.overflow = "hidden";

    requestAnimationFrame(function(){
        requestAnimationFrame(function(){
            directoryModalOverlay.classList.add("open");
        });
    });

    directoryModalOpen = true;

    if(detachTiltEffect) detachTiltEffect();
    detachTiltEffect = attachTiltEffect(directoryModalCard);
}

/* ================= INIT (same for every role) ================= */

async function initDirectory(){
    await loadDirectoryData();

    // New registrations, position/organization changes, officer/member
    // additions or removals, and president reassignments all funnel
    // through these three tables - live for every viewer, same as the
    // dashboard's own preview widgets already do for other modules.
    supabaseClient
        .channel("directory_officers_changes")
        .on("postgres_changes", { event: "*", schema: "public", table: "organization_officers" }, function(){
            loadDirectoryData();
        })
        .subscribe();

    supabaseClient
        .channel("directory_orgs_changes")
        .on("postgres_changes", { event: "*", schema: "public", table: "organizations" }, function(){
            loadDirectoryData();
        })
        .subscribe();

    supabaseClient
        .channel("directory_profiles_changes")
        .on("postgres_changes", { event: "*", schema: "public", table: "profiles" }, function(payload){
            loadDirectoryData();
            if(payload.new && payload.new.id) refreshOpenModalIfMatches(payload.new.id);
        })
        .subscribe();
}

document.addEventListener("DOMContentLoaded", async function(){
    viewerProfile = await lingkodGetAuthedProfile();
    myProfileId = viewerProfile ? viewerProfile.id : null;

    await initDirectory();
});
