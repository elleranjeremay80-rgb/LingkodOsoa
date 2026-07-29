/* ===================================================
   LINGKOD Meneses - List of Members / List of Organizations
   Same page and script for both roles, but the flow differs: osoa_eb
   ("List of Organizations" in the sidebar) lands on the organization
   directory (cards) first, then a member table scoped to whichever
   organization was clicked. org_president ("List of Members" in the
   sidebar) never sees the directory at all - loadData() sends them
   straight into their own organization's member view, and the Back
   button is hidden for them since there's nowhere for it to go back to.
   Both the org card list AND the member rows are scoped server-side too
   (profiles_admin_org_select, organizations_update), not just filtered
   client-side. Students never reach this page's content at all -
   #membersPageContent carries data-roles="admin staff", so js/common.js
   replaces the whole page body with a locked-access note for them before
   this script's own queries would even run.
   =================================================== */

const orgDirectoryView = document.getElementById("orgDirectoryView");
const orgMembersView = document.getElementById("orgMembersView");
const orgGrid = document.getElementById("orgGrid");
const orgPagination = document.getElementById("orgPagination");
const backToOrgsBtn = document.getElementById("backToOrgsBtn");
const selectedOrgName = document.getElementById("selectedOrgName");
const selectedOrgLogoWrap = document.getElementById("selectedOrgLogoWrap");
const orgInfoGrid = document.getElementById("orgInfoGrid");

const membersSearch = document.getElementById("membersSearch");
const membersDeptFilter = document.getElementById("membersDeptFilter");
const membersPositionFilter = document.getElementById("membersPositionFilter");
const membersStatusFilter = document.getElementById("membersStatusFilter");
const membersSort = document.getElementById("membersSort");
const membersPageSize = document.getElementById("membersPageSize");
const membersTableBody = document.getElementById("membersTableBody");
const membersPagination = document.getElementById("membersPagination");
const membersLoading = document.getElementById("membersLoading");

const statTotal = document.getElementById("statTotal");
const statActive = document.getElementById("statActive");
const statInactive = document.getElementById("statInactive");

const exportPdfBtn = document.getElementById("exportPdfBtn");
const exportExcelBtn = document.getElementById("exportExcelBtn");

const MEMBER_COLUMNS = "id, full_name, username, student_number, organization, department, position, role, status, email, contact_number, avatar_url, created_at";

let allProfiles = [];
let allOrganizations = [];
let orgMembers = [];
let selectedOrg = null;
let currentPage = 1;
let viewerProfile = null;

function roleLabel(dbRole){
    const uiRole = LINGKOD_DB_ROLE_TO_UI_ROLE[dbRole] || dbRole;
    return LINGKOD_ROLE_LABELS[uiRole] || uiRole;
}

// Philippine academic years run roughly June-May - "Academic Year
// 2026-2027" for anything from June 2026 through May 2027.
function currentAcademicYearLabel(){
    const now = new Date();
    const startYear = now.getMonth() >= 5 ? now.getFullYear() : now.getFullYear() - 1;
    return "Academic Year " + startYear + "–" + (startYear + 1);
}

// Best-effort: fetches a public Storage URL and converts it to a data URL
// for jsPDF's addImage (which can't take a remote URL directly). Resolves
// null on any failure - an SVG logo, a network hiccup, a CORS issue -
// rather than letting a decorative logo failure block the whole export.
function loadImageAsDataUrl(url){
    return fetch(url)
        .then(function(res){ return res.blob(); })
        .then(function(blob){
            if(blob.type === "image/svg+xml") return null;
            return new Promise(function(resolve){
                const reader = new FileReader();
                reader.onload = function(){ resolve(reader.result); };
                reader.onerror = function(){ resolve(null); };
                reader.readAsDataURL(blob);
            });
        })
        .catch(function(){ return null; });
}

function restartAnimation(el){
    el.classList.remove("view-panel");
    void el.offsetWidth;
    el.classList.add("view-panel");
}

/* ================= ORGANIZATION LOGO MANAGEMENT ================= */
// osoa_eb manages any organization's logo; org_president only their own.
// Students (and anyone viewing an org that isn't theirs) never see the
// edit control at all - matches the RLS policy 1:1 (profiles_admin_org_
// select gates who even reaches this page, organizations_update gates
// who can actually write logo_url).

// Delegates to the shared js/common.js rule (also used by Directory) -
// this used to compare org.name against viewerProfile.organization as
// plain text, which is exactly the case/whitespace-drift bug class
// 20260722070000_org_logo_upload_rls_fix.sql already had to fix once for
// the RLS side of this same check. Comparing by organization_id (a
// stable uuid) instead means it can't happen here either.
function canManageOrgLogo(org){
    return lingkodCanManageOrganization(viewerProfile, org.id);
}

function applyOrgLogoUpdate(org, newUrl){
    org.logo_url = newUrl;
    const stored = allOrganizations.find(function(o){ return o.id === org.id; });
    if(stored) stored.logo_url = newUrl;

    // Whichever view is actually showing this organization's logo right
    // now needs to reflect the change immediately - org_president is
    // always in the member view (they never see the card grid), osoa_eb
    // could be on either.
    if(selectedOrg === org.name){
        renderSelectedOrgHeaderLogo();
    } else {
        renderOrgGrid();
    }
}

function openOrgLogoModal(org){
    const wrap = document.createElement("div");
    wrap.className = "org-logo-modal";

    const preview = document.createElement("div");
    preview.appendChild(lingkodBuildOrgLogoElement(org, "org-logo-preview"));
    wrap.appendChild(preview);

    const fileInput = document.createElement("input");
    fileInput.type = "file";
    fileInput.accept = ".jpg,.jpeg,.png,.webp,.svg,image/jpeg,image/png,image/webp,image/svg+xml";
    fileInput.hidden = true;
    wrap.appendChild(fileInput);

    const actions = document.createElement("div");
    actions.className = "org-logo-modal-actions";

    const uploadBtn = document.createElement("button");
    uploadBtn.type = "button";
    uploadBtn.innerHTML = "<i class=\"fa-solid fa-camera\"></i> " + (org.logo_url ? "Change Logo" : "Upload Logo");
    uploadBtn.addEventListener("click", function(){ fileInput.click(); });
    actions.appendChild(uploadBtn);

    if(org.logo_url){
        const removeBtn = document.createElement("button");
        removeBtn.type = "button";
        removeBtn.className = "btn-secondary";
        removeBtn.innerHTML = "<i class=\"fa-solid fa-trash\"></i> Remove Logo";
        removeBtn.addEventListener("click", async function(){
            if(!confirm("Remove " + org.name + "'s logo? This can't be undone.")) return;

            lingkodSetButtonLoading(removeBtn, true, "Removing...");
            try {
                await lingkodRemoveOrgLogo(org.id);
                const { error } = await supabaseClient.from("organizations").update({ logo_url: null }).eq("id", org.id);
                if(error) throw error;

                applyOrgLogoUpdate(org, null);
                lingkodToast("Logo removed successfully.", "success");
                lingkodCloseModal();
            } catch(err){
                console.error("[list-of-members] logo remove failed:", err);
                lingkodToast("Failed to remove the logo: " + err.message, "error");
                lingkodSetButtonLoading(removeBtn, false);
            }
        });
        actions.appendChild(removeBtn);
    }

    wrap.appendChild(actions);

    fileInput.addEventListener("change", async function(){
        const file = fileInput.files[0];
        fileInput.value = "";
        if(!file) return;

        const validationError = lingkodValidateOrgLogoFile(file);
        if(validationError){
            lingkodToast(validationError, "error");
            return;
        }

        lingkodSetButtonLoading(uploadBtn, true, "Uploading...");
        try {
            const processed = await lingkodProcessOrgLogoFile(file);
            const newUrl = await lingkodUploadOrgLogo(org.id, processed);

            const { error } = await supabaseClient.from("organizations").update({ logo_url: newUrl }).eq("id", org.id);
            if(error) throw error;

            applyOrgLogoUpdate(org, newUrl);
            lingkodToast("Logo uploaded successfully.", "success");
            lingkodCloseModal();
        } catch(err){
            console.error("[list-of-members] logo upload failed:", err);
            lingkodToast("Failed to upload the logo: " + err.message, "error");
            lingkodSetButtonLoading(uploadBtn, false);
        }
    });

    lingkodOpenModal("Organization Logo — " + org.name, wrap);
}

// Shared by the directory card AND the member view's header (org_president
// never visits the card grid, so this has to be reachable from both
// places for the "org_president can manage their own logo" requirement to
// actually hold).
function buildOrgLogoWrap(org){
    const logoWrap = document.createElement("div");
    logoWrap.className = "org-card-logo-wrap";
    logoWrap.appendChild(lingkodBuildOrgLogoElement(org, "org-card-logo"));

    if(canManageOrgLogo(org)){
        const editBtn = document.createElement("button");
        editBtn.type = "button";
        editBtn.className = "org-card-logo-edit";
        editBtn.setAttribute("aria-label", "Manage " + org.name + "'s logo");
        editBtn.innerHTML = "<i class=\"fa-solid fa-camera\"></i>";
        editBtn.addEventListener("click", function(e){
            e.stopPropagation();
            openOrgLogoModal(org);
        });
        logoWrap.appendChild(editBtn);
    }

    return logoWrap;
}

/* ================= ORGANIZATION INFORMATION ================= */
// Shown above the stats row in the selected-organization view. Visible to
// every role that can reach this page (student included, read-only) - the
// Edit button itself is the only part gated, using the exact same
// "who can manage this org" rule as the logo editor above
// (canManageOrgLogo), since it's the same organizations_update RLS policy
// (current_user_can_manage_organization) enforcing it server-side either
// way: osoa_eb any organization, org_president their own only.
//
// The section always renders real <input>/<select>/<textarea> elements -
// not a different DOM in view vs. edit mode - so the layout never shifts
// when Edit is clicked; only their readonly/disabled state (and the
// footer button row) changes. buildOrgInfoFields() is the only thing that
// tears the fields down and rebuilds them, and it only runs when a
// DIFFERENT organization is being shown (org switch, or a fresh page
// load) - toggling edit mode on the org already on screen just flips
// existing elements in place via setOrgInfoEditable().
//
// orgInfoEditingOrgId/orgInfoInputs track which organization (if any) is
// mid-edit and its live input elements, so a realtime refresh of a
// DIFFERENT organization's data doesn't clobber input the user hasn't
// saved yet - renderOrgInfo() is a no-op for the org currently being
// edited.
//
// Organization Name isn't one of these fields at all - it's already shown
// once, above this card, in the page header (#selectedOrgName). It's also
// deliberately not editable anywhere: the org's name is duplicated as
// plain text across profiles.organization, announcements.organization,
// and documents.organization (and used for RLS/membership matching via
// that text, not a foreign key) - renaming it would silently orphan every
// one of those already-populated rows instead of cascading.
//
// Instagram/X/TikTok/Website were dropped from this iteration - Facebook
// is the only social link collected or shown now. Their columns still
// exist (20260724020000 leaves them untouched on purpose) but nothing in
// this file selects, renders, or writes them anymore.

const ORG_INFO_FIELDS = [
    { key: "acronym", label: "Organization Acronym", type: "text", required: true, errorId: "orgInfoAcronymError" },
    { key: "category", label: "Organization Category", type: "select", required: true, errorId: "orgInfoCategoryError" },
    { key: "president_name", label: "Organization President", type: "text", required: true, errorId: "orgInfoPresidentError" },
    { key: "adviser", label: "Adviser", type: "text", required: false, errorId: "orgInfoAdviserError" },
    { key: "member_count", label: "Number of Members", type: "number", required: false, errorId: "orgInfoMemberCountError" },
    { key: "description", label: "Organization Description", type: "textarea", required: true, errorId: "orgInfoDescriptionError" },
    { key: "vision", label: "Vision", type: "textarea", required: true, errorId: "orgInfoVisionError" },
    { key: "mission", label: "Mission", type: "textarea", required: true, errorId: "orgInfoMissionError" },
    { key: "goals", label: "Goals", type: "textarea", required: true, errorId: "orgInfoGoalsError" },
    { key: "facebook_url", label: "Facebook Page", type: "facebook", required: false, errorId: "orgInfoFacebookError" }
];

const ORG_INFO_CATEGORIES = ["Academic", "Civic", "Religious", "Sports", "Cultural", "Special Interest"];

const ORG_INFO_UPDATE_RETURNING = "acronym, category, description, vision, mission, goals, president_name, adviser, member_count, facebook_url, updated_at, updated_by";

let orgInfoEditingOrgId = null;
let orgInfoInputs = null;
let orgInfoFooterActions = null;

function showOrgInfoFieldError(input, errorEl, message){
    input.classList.add("invalid");
    if(errorEl){
        errorEl.textContent = message;
        errorEl.classList.add("visible");
    }
}

function clearOrgInfoFieldError(input, errorEl){
    input.classList.remove("invalid");
    if(errorEl){
        errorEl.textContent = "";
        errorEl.classList.remove("visible");
    }
}

function isValidFacebookUrl(value){
    try {
        const url = new URL(value);
        if(url.protocol !== "http:" && url.protocol !== "https:") return false;
        const host = url.hostname.toLowerCase().replace(/^www\.|^m\./, "");
        return host === "facebook.com" || host === "fb.com";
    } catch(e){
        return false;
    }
}

// Sets one field's input to whatever org currently holds - used both when
// first building the fields and to reset them (Cancel, or the fresh data
// a successful Save returns).
function applyOrgInfoFieldValue(field, input, org){
    if(field.type === "select"){
        input.value = org.category || "";
    } else if(field.key === "member_count"){
        input.value = org.member_count != null ? org.member_count : "";
    } else {
        input.value = org[field.key] || "";
    }
}

function buildOrgInfoFieldRow(field, org, inputs){
    const wrap = document.createElement("div");
    wrap.className = "org-info-field";

    const label = document.createElement("label");
    label.className = "org-info-label";
    label.textContent = field.label + (field.required ? "" : " (optional)");
    wrap.appendChild(label);

    const controlRow = document.createElement("div");
    controlRow.className = "org-info-control-row";

    let input;
    if(field.type === "select"){
        input = document.createElement("select");
        const placeholder = document.createElement("option");
        placeholder.value = "";
        placeholder.textContent = "Select a category...";
        input.appendChild(placeholder);
        ORG_INFO_CATEGORIES.forEach(function(cat){
            const opt = document.createElement("option");
            opt.value = cat;
            opt.textContent = cat;
            input.appendChild(opt);
        });
    } else if(field.type === "textarea"){
        input = document.createElement("textarea");
        input.rows = 4;
        input.className = "org-info-input-textarea";
    } else if(field.key === "member_count"){
        input = document.createElement("input");
        input.type = "number";
        input.min = "1";
        input.step = "1";
    } else if(field.type === "facebook"){
        input = document.createElement("input");
        input.type = "url";
        input.placeholder = "https://facebook.com/YourOrgPage";
    } else {
        input = document.createElement("input");
        input.type = "text";
    }

    input.classList.add("org-info-input");
    input.placeholder = input.placeholder || "—";
    if(field.required) input.required = true;
    applyOrgInfoFieldValue(field, input, org);

    controlRow.appendChild(input);

    // Facebook gets a small "open in a new tab" button next to the input -
    // still a single-line field like every other row, but the link the
    // original spec asked for (opens in a new tab) doesn't disappear just
    // because the value now lives inside a readonly input instead of an
    // <a> tag.
    if(field.type === "facebook"){
        const openLink = document.createElement("a");
        openLink.className = "org-info-facebook-open";
        openLink.target = "_blank";
        openLink.rel = "noopener noreferrer";
        openLink.setAttribute("aria-label", "Open Facebook page in a new tab");
        openLink.innerHTML = "<i class=\"fa-solid fa-arrow-up-right-from-square\"></i>";
        openLink.href = org.facebook_url || "#";
        openLink.hidden = !org.facebook_url;
        controlRow.appendChild(openLink);
        inputs.facebook_url_openLink = openLink;
    }

    wrap.appendChild(controlRow);

    const errorEl = document.createElement("small");
    errorEl.className = "field-error";
    errorEl.id = field.errorId;
    wrap.appendChild(errorEl);

    inputs[field.key] = input;
    return wrap;
}

// Flips every field between readonly (view) and editable, without
// touching the DOM layout at all - <select> has no readonly attribute, so
// it's blocked from interaction via pointer-events/tabindex instead of
// .disabled (which would also gray it out, looking "broken" rather than
// just non-editable).
function setOrgInfoEditable(inputs, editable){
    ORG_INFO_FIELDS.forEach(function(field){
        const input = inputs[field.key];
        if(field.type === "select"){
            input.style.pointerEvents = editable ? "" : "none";
            input.tabIndex = editable ? 0 : -1;
        } else {
            input.readOnly = !editable;
        }
        input.classList.toggle("org-info-input-editing", editable);
    });
}

function renderOrgInfoActions(org, inputs, editing){
    orgInfoFooterActions.innerHTML = "";
    if(!canManageOrgLogo(org)) return;

    if(editing){
        const saveBtn = document.createElement("button");
        saveBtn.type = "button";
        saveBtn.className = "org-info-edit-btn";
        saveBtn.textContent = "Save Changes";
        saveBtn.addEventListener("click", function(){ saveOrgInfo(org, inputs, saveBtn); });
        orgInfoFooterActions.appendChild(saveBtn);

        const cancelBtn = document.createElement("button");
        cancelBtn.type = "button";
        cancelBtn.className = "org-info-edit-btn btn-secondary";
        cancelBtn.textContent = "Cancel";
        cancelBtn.addEventListener("click", function(){ cancelOrgInfoEdit(org, inputs); });
        orgInfoFooterActions.appendChild(cancelBtn);
    } else {
        const editBtn = document.createElement("button");
        editBtn.type = "button";
        editBtn.className = "org-info-edit-btn";
        editBtn.innerHTML = "<i class=\"fa-solid fa-pen\"></i> Edit Organization Information";
        editBtn.addEventListener("click", function(){ enterOrgInfoEdit(org, inputs); });
        orgInfoFooterActions.appendChild(editBtn);
    }
}

function enterOrgInfoEdit(org, inputs){
    orgInfoEditingOrgId = org.id;
    setOrgInfoEditable(inputs, true);
    renderOrgInfoActions(org, inputs, true);
}

function cancelOrgInfoEdit(org, inputs){
    orgInfoEditingOrgId = null;
    ORG_INFO_FIELDS.forEach(function(field){
        applyOrgInfoFieldValue(field, inputs[field.key], org);
        clearOrgInfoFieldError(inputs[field.key], document.getElementById(field.errorId));
    });
    setOrgInfoEditable(inputs, false);
    renderOrgInfoActions(org, inputs, false);
}

async function saveOrgInfo(org, inputs, saveBtn){
    ORG_INFO_FIELDS.forEach(function(field){
        clearOrgInfoFieldError(inputs[field.key], document.getElementById(field.errorId));
    });

    let valid = true;

    const acronym = inputs.acronym.value.trim();
    if(!acronym){
        showOrgInfoFieldError(inputs.acronym, document.getElementById("orgInfoAcronymError"), "Organization Acronym is required.");
        valid = false;
    }

    const category = inputs.category.value;
    if(!category){
        showOrgInfoFieldError(inputs.category, document.getElementById("orgInfoCategoryError"), "Organization Category is required.");
        valid = false;
    }

    const description = inputs.description.value.trim();
    if(!description){
        showOrgInfoFieldError(inputs.description, document.getElementById("orgInfoDescriptionError"), "Organization Description is required.");
        valid = false;
    }

    const vision = inputs.vision.value.trim();
    if(!vision){
        showOrgInfoFieldError(inputs.vision, document.getElementById("orgInfoVisionError"), "Vision is required.");
        valid = false;
    }

    const mission = inputs.mission.value.trim();
    if(!mission){
        showOrgInfoFieldError(inputs.mission, document.getElementById("orgInfoMissionError"), "Mission is required.");
        valid = false;
    }

    const goals = inputs.goals.value.trim();
    if(!goals){
        showOrgInfoFieldError(inputs.goals, document.getElementById("orgInfoGoalsError"), "Goals is required.");
        valid = false;
    }

    const president = inputs.president_name.value.trim();
    if(!president){
        showOrgInfoFieldError(inputs.president_name, document.getElementById("orgInfoPresidentError"), "Organization President is required.");
        valid = false;
    }

    let memberCount = null;
    const memberCountRaw = inputs.member_count.value.trim();
    if(memberCountRaw){
        memberCount = Number(memberCountRaw);
        if(!Number.isInteger(memberCount) || memberCount <= 0){
            showOrgInfoFieldError(inputs.member_count, document.getElementById("orgInfoMemberCountError"), "Number of Members must be a positive whole number.");
            valid = false;
        }
    }

    const facebookRaw = inputs.facebook_url.value.trim();
    if(facebookRaw && !isValidFacebookUrl(facebookRaw)){
        showOrgInfoFieldError(inputs.facebook_url, document.getElementById("orgInfoFacebookError"), "Enter a valid Facebook link (e.g. https://facebook.com/YourOrgPage).");
        valid = false;
    }

    if(!valid) return;

    lingkodSetButtonLoading(saveBtn, true, "Saving...");

    try {
        const { data, error } = await supabaseClient
            .from("organizations")
            .update({
                acronym: acronym,
                category: category,
                description: description,
                vision: vision,
                mission: mission,
                goals: goals,
                president_name: president,
                adviser: inputs.adviser.value.trim() || null,
                member_count: memberCount,
                facebook_url: facebookRaw || null
            })
            .eq("id", org.id)
            .select(ORG_INFO_UPDATE_RETURNING)
            .single();

        if(error){
            console.error("[list-of-members] organization info update failed:", error);
            lingkodToast("Couldn't save the organization information: " + error.message, "error");
            return;
        }

        Object.assign(org, data);
        const stored = allOrganizations.find(function(o){ return o.id === org.id; });
        if(stored) Object.assign(stored, data);

        orgInfoEditingOrgId = null;
        ORG_INFO_FIELDS.forEach(function(field){
            applyOrgInfoFieldValue(field, inputs[field.key], org);
        });
        if(inputs.facebook_url_openLink){
            inputs.facebook_url_openLink.href = org.facebook_url || "#";
            inputs.facebook_url_openLink.hidden = !org.facebook_url;
        }
        setOrgInfoEditable(inputs, false);
        renderOrgInfoActions(org, inputs, false);
        lingkodToast("Organization information updated successfully.", "success");
    } finally {
        lingkodSetButtonLoading(saveBtn, false);
    }
}

function buildOrgInfoFields(org){
    orgInfoGrid.innerHTML = "";

    const inputs = {};
    ORG_INFO_FIELDS.forEach(function(field){
        orgInfoGrid.appendChild(buildOrgInfoFieldRow(field, org, inputs));
    });

    const footer = document.createElement("div");
    footer.className = "org-info-footer-actions";
    orgInfoGrid.appendChild(footer);

    orgInfoInputs = inputs;
    orgInfoFooterActions = footer;

    setOrgInfoEditable(inputs, false);
    renderOrgInfoActions(org, inputs, false);
}

// Rebuilds the field set only when a different organization is on screen
// (or on first load) - skipped entirely while the org already shown is
// mid-edit, so a realtime refresh doesn't wipe out unsaved input.
function renderOrgInfo(org){
    if(orgInfoEditingOrgId === org.id) return;
    buildOrgInfoFields(org);
}

/* ================= ORGANIZATION DIRECTORY ================= */

function buildOrgCard(org, members){
    const active = members.filter(function(m){ return m.status !== "inactive"; }).length;
    const president = members.find(function(m){ return m.role === "org_president"; });

    const card = document.createElement("div");
    card.className = "org-card";

    card.appendChild(buildOrgLogoWrap(org));

    const name = document.createElement("div");
    name.className = "org-card-name";
    name.textContent = org.name;
    card.appendChild(name);

    const president_el = document.createElement("div");
    president_el.className = "org-card-president";
    president_el.textContent = president ? "President: " + president.full_name : "No Organization President Assigned";
    card.appendChild(president_el);

    const stats = document.createElement("div");
    stats.className = "org-card-stats";
    stats.innerHTML =
        "<div><strong>" + members.length + "</strong>Members</div>"
        + "<div><strong>" + active + "</strong>Active</div>"
        + "<div><strong>" + (members.length - active) + "</strong>Inactive</div>";
    card.appendChild(stats);

    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "org-card-btn";
    btn.textContent = "View Members";
    card.appendChild(btn);

    card.addEventListener("click", function(){ selectOrganization(org.name); });

    return card;
}

const ORG_PAGE_SIZE = 12;
let orgCurrentPage = 1;

function renderOrgSkeletons(){
    orgGrid.innerHTML = "";
    for(let i = 0; i < 6; i++){
        const skeleton = document.createElement("div");
        skeleton.className = "org-card-skeleton";
        skeleton.innerHTML =
            "<div class=\"skeleton-circle\"></div>"
            + "<div class=\"skeleton-line skeleton-line-wide\"></div>"
            + "<div class=\"skeleton-line skeleton-line-narrow\"></div>"
            + "<div class=\"skeleton-line skeleton-line-medium\"></div>";
        orgGrid.appendChild(skeleton);
    }
}

function renderOrgGrid(){
    orgGrid.innerHTML = "";

    const visibleOrgs = (viewerProfile && viewerProfile.role === "org_president")
        ? allOrganizations.filter(function(o){ return o.name === viewerProfile.organization; })
        : allOrganizations;

    if(visibleOrgs.length === 0){
        const empty = document.createElement("div");
        empty.className = "org-empty";
        empty.innerHTML = "<i class=\"fa-solid fa-folder-open\"></i><p>No organizations have been registered yet.</p>";
        orgGrid.appendChild(empty);
        orgPagination.innerHTML = "";
        return;
    }

    const totalPages = Math.max(1, Math.ceil(visibleOrgs.length / ORG_PAGE_SIZE));
    if(orgCurrentPage > totalPages) orgCurrentPage = totalPages;
    const start = (orgCurrentPage - 1) * ORG_PAGE_SIZE;

    visibleOrgs.slice(start, start + ORG_PAGE_SIZE).forEach(function(org){
        const members = allProfiles.filter(function(p){ return p.organization === org.name; });
        orgGrid.appendChild(buildOrgCard(org, members));
    });

    lingkodRenderPagination(orgPagination, orgCurrentPage, totalPages, function(page){
        orgCurrentPage = page;
        renderOrgGrid();
    });
}

/* ================= VIEW SWITCHING ================= */

function renderSelectedOrgHeaderLogo(){
    selectedOrgLogoWrap.innerHTML = "";
    const org = allOrganizations.find(function(o){ return o.name === selectedOrg; });
    if(org) selectedOrgLogoWrap.appendChild(buildOrgLogoWrap(org));
}

// org_president never reaches this - the Back button is hidden for them
// at init (see the DOMContentLoaded handler) since "List of Members" is
// their whole flow, there's no organizations page for them to return to.
function showOrgDirectory(){
    selectedOrg = null;
    orgCurrentPage = 1;
    orgMembersView.classList.add("hidden");
    orgDirectoryView.classList.remove("hidden");
    restartAnimation(orgDirectoryView);
    renderOrgGrid();
}

function selectOrganization(orgName){
    selectedOrg = orgName;
    selectedOrgName.textContent = orgName;

    membersSearch.value = "";
    membersDeptFilter.value = "all";
    membersPositionFilter.value = "all";
    membersStatusFilter.value = "all";
    membersSort.value = "name_asc";
    currentPage = 1;

    orgDirectoryView.classList.add("hidden");
    orgMembersView.classList.remove("hidden");
    restartAnimation(orgMembersView);

    refreshOrgMembers();
}

backToOrgsBtn.addEventListener("click", showOrgDirectory);

/* ================= FILTER OPTIONS (derived from the selected
   organization's own members only). ================= */

function populateFilterOptions(rows){
    const depts = [...new Set(rows.map(function(r){ return r.department; }).filter(Boolean))].sort();
    const positions = [...new Set(rows.map(function(r){ return r.position; }).filter(Boolean))].sort();

    function fill(select, values){
        const current = select.value;
        select.querySelectorAll("option:not([value=\"all\"])").forEach(function(o){ o.remove(); });
        values.forEach(function(v){
            const opt = document.createElement("option");
            opt.value = v;
            opt.textContent = v;
            select.appendChild(opt);
        });
        if(values.includes(current)) select.value = current;
    }

    fill(membersDeptFilter, depts);
    fill(membersPositionFilter, positions);
}

/* ================= STATS ================= */

function renderStats(rows){
    const active = rows.filter(function(r){ return r.status !== "inactive"; }).length;
    statTotal.textContent = rows.length;
    statActive.textContent = active;
    statInactive.textContent = rows.length - active;
}

/* ================= FILTER / SORT / PAGINATE ================= */

function getFilteredSortedMembers(){
    const query = membersSearch.value.trim().toLowerCase();
    const dept = membersDeptFilter.value;
    const position = membersPositionFilter.value;
    const status = membersStatusFilter.value;
    const sort = membersSort.value;

    let rows = orgMembers.filter(function(r){
        if(dept !== "all" && r.department !== dept) return false;
        if(position !== "all" && r.position !== position) return false;
        if(status !== "all" && (r.status || "active") !== status) return false;

        if(query){
            const haystack = [r.full_name, r.student_number].filter(Boolean).join(" ").toLowerCase();
            if(!haystack.includes(query)) return false;
        }

        return true;
    });

    rows = rows.slice().sort(function(a, b){
        if(sort === "name_asc") return (a.full_name || "").localeCompare(b.full_name || "");
        if(sort === "name_desc") return (b.full_name || "").localeCompare(a.full_name || "");
        if(sort === "recent") return new Date(b.created_at) - new Date(a.created_at);
        if(sort === "oldest") return new Date(a.created_at) - new Date(b.created_at);
        return 0;
    });

    return rows;
}

/* ================= TABLE RENDER ================= */

function buildMemberRow(row){
    const tr = document.createElement("tr");

    const avatarCell = document.createElement("td");
    avatarCell.appendChild(lingkodBuildAvatarElement(row, "member-avatar"));
    tr.appendChild(avatarCell);

    tr.appendChild(lingkodCreateCell(row.student_number || "Not set"));
    tr.appendChild(lingkodCreateCell(row.full_name || "Unknown"));
    tr.appendChild(lingkodCreateCell(row.username || "Not set"));
    tr.appendChild(lingkodCreateCell(row.department || "Not set"));
    tr.appendChild(lingkodCreateCell(row.position || roleLabel(row.role)));
    tr.appendChild(lingkodCreateCell(row.contact_number || "Not set"));
    tr.appendChild(lingkodCreateCell(row.email || "Not set"));
    tr.appendChild(lingkodCreateCell(row.created_at ? lingkodFormatDate(row.created_at) : "Not set"));
    tr.appendChild(lingkodCreateStatusCell(row.status === "inactive" ? "inactive" : "active", { active: "Active", inactive: "Inactive" }));

    tr.addEventListener("click", function(){ openMemberModal(row); });

    return tr;
}

function renderMembersPage(){
    const filtered = getFilteredSortedMembers();
    const pageSize = Number(membersPageSize.value);
    const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
    if(currentPage > totalPages) currentPage = totalPages;

    membersTableBody.innerHTML = "";

    if(filtered.length === 0){
        membersTableBody.appendChild(lingkodCreateEmptyRow("No members found.", 10));
    } else {
        const start = (currentPage - 1) * pageSize;
        filtered.slice(start, start + pageSize).forEach(function(row){
            membersTableBody.appendChild(buildMemberRow(row));
        });
    }

    lingkodRenderPagination(membersPagination, currentPage, totalPages, function(page){
        currentPage = page;
        renderMembersPage();
    });
}

[membersSearch, membersDeptFilter, membersPositionFilter, membersStatusFilter, membersSort].forEach(function(el){
    el.addEventListener(el.tagName === "SELECT" ? "change" : "input", function(){
        currentPage = 1;
        renderMembersPage();
    });
});

membersPageSize.addEventListener("change", function(){
    currentPage = 1;
    renderMembersPage();
});

/* ================= LOAD ================= */

function setLoading(isLoading){
    membersLoading.classList.toggle("visible", isLoading);
}

function refreshOrgMembers(){
    orgMembers = allProfiles.filter(function(p){ return p.organization === selectedOrg; });
    populateFilterOptions(orgMembers);
    renderStats(orgMembers);
    renderMembersPage();
    renderSelectedOrgHeaderLogo();

    const org = allOrganizations.find(function(o){ return o.name === selectedOrg; });
    if(org) renderOrgInfo(org);
}

async function loadData(){
    setLoading(true);

    // RLS (profiles_admin_org_select) already restricts an org_president
    // to their own organization's rows server-side - this client-side
    // .eq() is a redundant-but-cheap belt-and-suspenders match for the
    // same reason submission/script.js's loadSubmissions() does the
    // equivalent: it lets Postgres use an index instead of relying purely
    // on the RLS subquery, and it's one less row PostgREST has to
    // serialize and ship over the wire for no benefit.
    let profilesQuery = supabaseClient.from("profiles").select(MEMBER_COLUMNS).order("full_name");
    if(viewerProfile && viewerProfile.role === "org_president"){
        profilesQuery = profilesQuery.eq("organization", viewerProfile.organization);
    }

    const [profilesResult, orgsResult] = await Promise.all([
        profilesQuery,
        supabaseClient.from("organizations").select("id, name, logo_url, acronym, category, description, vision, mission, goals, president_name, adviser, member_count, facebook_url, updated_at, updated_by").order("name")
    ]);

    setLoading(false);

    if(profilesResult.error){
        console.error("[list-of-members] profiles load failed:", profilesResult.error);
        lingkodToast("Couldn't load members: " + profilesResult.error.message, "error");
        return;
    }
    if(orgsResult.error){
        console.error("[list-of-members] organizations load failed:", orgsResult.error);
        lingkodToast("Couldn't load organizations: " + orgsResult.error.message, "error");
        return;
    }

    allProfiles = profilesResult.data;
    allOrganizations = orgsResult.data;

    // org_president's whole flow is "List of Members" - no organization
    // picker, always their own org. Pin selectedOrg to it (idempotent on
    // repeat calls, e.g. from the realtime subscriptions below) rather
    // than routing through selectOrganization(), which would reset their
    // search/filters/page on every live update.
    if(viewerProfile && viewerProfile.role === "org_president"){
        if(selectedOrg !== viewerProfile.organization){
            selectedOrg = viewerProfile.organization;
            selectedOrgName.textContent = selectedOrg;
            orgDirectoryView.classList.add("hidden");
            orgMembersView.classList.remove("hidden");
        }
        refreshOrgMembers();
    } else if(selectedOrg){
        refreshOrgMembers();
    } else {
        renderOrgGrid();
    }
}

/* ================= MEMBER DETAILS MODAL (glassmorphism) ================= */

let memberModalOverlay = null;
let memberModalCard = null;
let memberModalOpen = false;
let memberModalCloseTimer = null;

function ensureMemberModal(){
    if(memberModalOverlay) return;

    memberModalOverlay = document.createElement("div");
    memberModalOverlay.className = "member-modal-overlay";

    memberModalCard = document.createElement("div");
    memberModalCard.className = "member-modal-card";

    const closeBtn = document.createElement("button");
    closeBtn.type = "button";
    closeBtn.className = "member-modal-close";
    closeBtn.setAttribute("aria-label", "Close");
    closeBtn.innerHTML = "<i class=\"fa-solid fa-xmark\"></i>";
    closeBtn.addEventListener("click", closeMemberModal);

    memberModalCard.appendChild(closeBtn);
    memberModalOverlay.appendChild(memberModalCard);
    document.body.appendChild(memberModalOverlay);

    memberModalOverlay.addEventListener("click", function(e){
        if(e.target === memberModalOverlay) closeMemberModal();
    });

    document.addEventListener("keydown", function(e){
        if(e.key === "Escape" && memberModalOpen) closeMemberModal();
    });
}

function closeMemberModal(){
    if(!memberModalOpen || !memberModalOverlay) return;

    memberModalOpen = false;
    memberModalOverlay.classList.remove("open");
    memberModalOverlay.classList.add("closing");
    document.body.style.overflow = "";

    clearTimeout(memberModalCloseTimer);
    memberModalCloseTimer = setTimeout(function(){
        memberModalOverlay.classList.remove("closing");
        memberModalOverlay.style.display = "none";
    }, 420);
}

function buildMemberRowField(label, value){
    const row = document.createElement("div");
    row.className = "member-view-row";
    const dt = document.createElement("span");
    dt.className = "member-view-label";
    dt.textContent = label;
    const dd = document.createElement("span");
    dd.className = "member-view-value";
    dd.textContent = value || "Not set";
    row.appendChild(dt);
    row.appendChild(dd);
    return row;
}

function openMemberModal(row){
    ensureMemberModal();
    clearTimeout(memberModalCloseTimer);

    const closeIconBtn = memberModalCard.querySelector(".member-modal-close");
    memberModalCard.innerHTML = "";
    memberModalCard.appendChild(closeIconBtn);

    const wrap = document.createElement("div");
    wrap.className = "member-view";

    wrap.appendChild(lingkodBuildAvatarElement(row, "member-view-avatar"));

    const name = document.createElement("h3");
    name.className = "member-view-name";
    name.textContent = row.full_name || "Unknown";
    wrap.appendChild(name);

    const position = document.createElement("p");
    position.className = "member-view-position";
    position.textContent = row.position || roleLabel(row.role);
    wrap.appendChild(position);

    const org = document.createElement("p");
    org.className = "member-view-org";
    org.textContent = row.organization || roleLabel(row.role);
    wrap.appendChild(org);

    const divider = document.createElement("div");
    divider.className = "member-view-divider";
    wrap.appendChild(divider);

    const grid = document.createElement("div");
    grid.className = "member-view-grid";
    grid.appendChild(buildMemberRowField("Full Name", row.full_name));
    grid.appendChild(buildMemberRowField("Username", row.username));
    grid.appendChild(buildMemberRowField("Student Number", row.student_number));
    grid.appendChild(buildMemberRowField("Organization", row.organization));
    grid.appendChild(buildMemberRowField("Position", row.position || roleLabel(row.role)));
    grid.appendChild(buildMemberRowField("Department", row.department));
    grid.appendChild(buildMemberRowField("Contact Number", row.contact_number));
    grid.appendChild(buildMemberRowField("Email", row.email));
    grid.appendChild(buildMemberRowField("Date Registered", row.created_at ? lingkodFormatDate(row.created_at) : null));
    grid.appendChild(buildMemberRowField("Account Status", row.status === "inactive" ? "Inactive" : "Active"));
    wrap.appendChild(grid);

    memberModalCard.appendChild(wrap);

    memberModalOverlay.classList.remove("closing");
    memberModalOverlay.style.display = "flex";
    document.body.style.overflow = "hidden";

    requestAnimationFrame(function(){
        requestAnimationFrame(function(){
            memberModalOverlay.classList.add("open");
        });
    });

    memberModalOpen = true;
}

/* ================= EXPORT (organization-specific) ================= */

function getExportRows(){
    return getFilteredSortedMembers().map(function(row){
        return {
            "Student Number": row.student_number || "Not set",
            "Full Name": row.full_name || "Unknown",
            "Username": row.username || "Not set",
            "Department": row.department || "Not set",
            "Position": row.position || roleLabel(row.role),
            "Contact Number": row.contact_number || "Not set",
            "Email Address": row.email || "Not set",
            "Date Registered": row.created_at ? lingkodFormatDate(row.created_at) : "Not set",
            "Account Status": row.status === "inactive" ? "Inactive" : "Active"
        };
    });
}

function exportFileName(ext){
    const slug = (selectedOrg || "members").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
    return "members-" + slug + "." + ext;
}

exportExcelBtn.addEventListener("click", function(){
    const rows = getExportRows();
    if(rows.length === 0){
        lingkodToast("No members to export.", "error");
        return;
    }

    if(typeof XLSX === "undefined"){
        lingkodToast("Excel export isn't available right now. Please try again.", "error");
        return;
    }

    const worksheet = XLSX.utils.json_to_sheet(rows);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Members");
    XLSX.writeFile(workbook, exportFileName("xlsx"));
    lingkodToast("Exported to Excel successfully.", "success");
});

exportPdfBtn.addEventListener("click", async function(){
    const rows = getExportRows();
    if(rows.length === 0){
        lingkodToast("No members to export.", "error");
        return;
    }

    if(typeof window.jspdf === "undefined"){
        lingkodToast("PDF export isn't available right now. Please try again.", "error");
        return;
    }

    lingkodSetButtonLoading(exportPdfBtn, true, "Generating...");

    try {
        const doc = new window.jspdf.jsPDF({ orientation: "landscape" });
        const headers = Object.keys(rows[0]);
        const org = allOrganizations.find(function(o){ return o.name === selectedOrg; });
        const now = new Date();

        let textX = 14;
        if(org && org.logo_url){
            const dataUrl = await loadImageAsDataUrl(org.logo_url);
            if(dataUrl){
                try {
                    doc.addImage(dataUrl, 14, 10, 18, 18);
                    textX = 38;
                } catch(imgErr){
                    console.error("[list-of-members] PDF logo embed failed:", imgErr);
                }
            }
        }

        doc.setFontSize(15);
        doc.setFont(undefined, "bold");
        doc.text(selectedOrg || "List of Members", textX, 16);
        doc.setFont(undefined, "normal");
        doc.setFontSize(10);
        doc.text("Office of Student Organization and Activities (OSOA)", textX, 22);
        doc.text("Bulacan State University – Meneses Campus", textX, 27);
        doc.text(currentAcademicYearLabel(), textX, 32);

        doc.setFontSize(9);
        doc.text("Date Generated: " + now.toLocaleString("en-US", { month: "long", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit", hour12: true }), 14, 42);
        doc.text("Generated By: " + (viewerProfile ? viewerProfile.full_name : "Unknown"), 14, 47);
        doc.text("Total Members: " + rows.length, 14, 52);

        doc.autoTable({
            startY: 58,
            head: [headers],
            body: rows.map(function(row){ return headers.map(function(h){ return row[h]; }); }),
            styles: { fontSize: 8 },
            headStyles: { fillColor: [54, 42, 93] }
        });

        doc.save(exportFileName("pdf"));
        lingkodToast("Exported to PDF successfully.", "success");
    } catch(err){
        console.error("[list-of-members] PDF export failed:", err);
        lingkodToast("Failed to generate the PDF: " + err.message, "error");
    } finally {
        lingkodSetButtonLoading(exportPdfBtn, false);
    }
});

/* ================= INIT ================= */

document.addEventListener("DOMContentLoaded", async function(){
    viewerProfile = await lingkodGetAuthedProfile();

    // org_president's sidebar entry is "List of Members", not "List of
    // Organizations" - there's no organizations page for them to return
    // to, so the button that would take them there doesn't apply.
    if(viewerProfile && viewerProfile.role === "org_president"){
        backToOrgsBtn.style.display = "none";
    } else {
        // Animated placeholders instead of a blank grid while the first
        // fetch is in flight - only relevant for osoa_eb, who actually
        // sees this grid (org_president skips straight to their own
        // organization's member view).
        renderOrgSkeletons();
    }

    await loadData();
});

// New registrations, edits, and status changes appear live, without a
// page refresh - refreshes whichever view is currently open.
supabaseClient
    .channel("list_of_members_page_changes")
    .on("postgres_changes", { event: "*", schema: "public", table: "profiles" }, function(){
        loadData();
    })
    .subscribe();

supabaseClient
    .channel("list_of_members_orgs_changes")
    .on("postgres_changes", { event: "*", schema: "public", table: "organizations" }, function(){
        loadData();
    })
    .subscribe();
