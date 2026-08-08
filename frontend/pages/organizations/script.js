/* ===================================================
   LINGKOD Meneses - Public Organization Directory (Browse Here, from
   Login). Guest-accessible: no session required, and none of this page's
   queries touch profiles/organization_officers (the member-facing
   tables) at all - only the organizations table, which already has
   "Anyone can read organizations" (anon + authenticated, using(true)),
   and only public.organizations columns, which don't hold any per-
   member PII. Read-only by construction: nothing here ever calls
   .insert()/.update()/.delete() - and even if a guest tried to from the
   console, organizations' UPDATE grant is authenticated-only, so anon
   has no write privilege at the database layer either.

   Deliberately self-contained rather than reusing js/common.js's
   lingkodToast/lingkodOpenModal/lingkodBuildOrgLogoElement - that file's
   DOMContentLoaded handler redirects any session-less visitor straight
   to Login, which is exactly the gate this page must NOT have.
   =================================================== */

const orgBrowseGrid = document.getElementById("orgBrowseGrid");
const orgBrowseEmpty = document.getElementById("orgBrowseEmpty");
const orgBrowseEmptyMessage = document.getElementById("orgBrowseEmptyMessage");
const orgBrowseSearch = document.getElementById("orgBrowseSearch");
const orgBrowseCategoryFilter = document.getElementById("orgBrowseCategoryFilter");

const ORG_BROWSE_COLUMNS = "id, name, logo_url, acronym, category, description, vision, mission, goals, president_name, adviser, member_count, facebook_url";

let allOrgs = [];

/* ================= LOGO (initials fallback, same rule as the rest of
   the app: first letter of the org's name) ================= */

function orgInitial(name){
    return (name || "?").trim().charAt(0).toUpperCase();
}

function buildOrgLogo(org, className){
    const el = document.createElement("div");
    el.className = className;

    if(org.logo_url){
        const img = document.createElement("img");
        img.src = org.logo_url;
        img.alt = org.name;
        img.loading = "lazy";
        img.addEventListener("error", function(){
            img.remove();
            el.textContent = orgInitial(org.name);
        });
        el.appendChild(img);
    } else {
        el.textContent = orgInitial(org.name);
    }

    return el;
}

/* ================= TOAST (mirrors js/common.js's lingkodToast - same
   .toast-container/.toast classes, already styled by css/common.css,
   which this page does load) ================= */

function orgBrowseToast(message, type){
    let container = document.getElementById("orgBrowseToastContainer");
    if(!container){
        container = document.createElement("div");
        container.id = "orgBrowseToastContainer";
        container.className = "toast-container";
        document.body.appendChild(container);
    }

    const toast = document.createElement("div");
    toast.className = "toast " + (type || "success");

    const icon = document.createElement("i");
    icon.className = type === "error" ? "fa-solid fa-circle-exclamation" : "fa-solid fa-circle-check";
    toast.appendChild(icon);

    toast.appendChild(document.createTextNode(message));
    container.appendChild(toast);

    setTimeout(function(){
        toast.classList.add("leaving");
        setTimeout(function(){ toast.remove(); }, 200);
    }, 4000);
}

/* ================= MODAL (mirrors js/common.js's lingkodOpenModal/
   lingkodCloseModal - same .modal-overlay/.modal/.modal-header/.modal-body
   classes) ================= */

function orgBrowseCloseModal(){
    const overlay = document.getElementById("orgBrowseModalOverlay");
    if(overlay) overlay.classList.remove("open");
    document.body.style.overflow = "";
}

function orgBrowseOpenModal(titleText, contentNode){
    let overlay = document.getElementById("orgBrowseModalOverlay");

    if(!overlay){
        overlay = document.createElement("div");
        overlay.id = "orgBrowseModalOverlay";
        overlay.className = "modal-overlay";

        const modal = document.createElement("div");
        modal.className = "modal modal-org-detail";

        const header = document.createElement("div");
        header.className = "modal-header";

        const title = document.createElement("h3");
        title.id = "orgBrowseModalTitle";
        header.appendChild(title);

        const closeBtn = document.createElement("button");
        closeBtn.type = "button";
        closeBtn.className = "modal-close";
        closeBtn.setAttribute("aria-label", "Close");
        closeBtn.innerHTML = "<i class=\"fa-solid fa-xmark\"></i>";
        closeBtn.addEventListener("click", orgBrowseCloseModal);
        header.appendChild(closeBtn);

        modal.appendChild(header);

        const body = document.createElement("div");
        body.className = "modal-body";
        body.id = "orgBrowseModalBody";
        modal.appendChild(body);

        overlay.appendChild(modal);
        document.body.appendChild(overlay);

        overlay.addEventListener("click", function(e){
            if(e.target === overlay) orgBrowseCloseModal();
        });

        document.addEventListener("keydown", function(e){
            if(e.key === "Escape") orgBrowseCloseModal();
        });
    }

    document.getElementById("orgBrowseModalTitle").textContent = titleText;
    const body = document.getElementById("orgBrowseModalBody");
    body.innerHTML = "";
    body.appendChild(contentNode);

    overlay.classList.add("open");
    document.body.style.overflow = "hidden";
}

/* ================= ORGANIZATION DETAILS =================
   Same field/section design as the List of Organizations page's own
   organization-details modal (list-of-members/script.js's
   buildOrgDetailTextBlock/buildOrgDetailSection/openOrgDetailsModal) -
   ported here rather than shared, since this page deliberately stays
   self-contained (no js/common.js, no auth - see the file header comment).
   Both pages query the same public.organizations table/columns
   (ORG_BROWSE_COLUMNS above matches list-of-members/script.js's own
   organizations select), so this is the same data rendered the same way,
   just via this page's own modal implementation. Inline styles are a
   guaranteed fallback alongside the CSS classes - the List of
   Organizations page's identical modal needed this same hardening for its
   label/value rows to reliably render with proper spacing instead of
   running together. */

// One consistent field style for every row - label above a bordered,
// read-only content box (never a form input - this page has no edit
// capability, no auth). Used for both the short Organization Details
// fields and the long-form Description/Vision/Mission/Goals.
function buildOrgDetailTextBlock(label, value){
    const row = document.createElement("div");
    row.className = "org-detail-row org-detail-text-block";
    row.style.display = "flex";
    row.style.flexDirection = "column";
    row.style.gap = "6px";
    row.style.width = "100%";
    row.style.minWidth = "0";
    row.style.boxSizing = "border-box";

    const dt = document.createElement("span");
    dt.className = "org-detail-label";
    dt.textContent = label;
    dt.style.fontSize = "12px";
    dt.style.fontWeight = "700";
    dt.style.color = "#8B7A6C";
    dt.style.textTransform = "uppercase";
    dt.style.letterSpacing = ".03em";
    row.appendChild(dt);

    const box = document.createElement("p");
    box.className = "org-detail-text-box";
    box.textContent = value;
    box.style.margin = "0";
    box.style.width = "100%";
    box.style.boxSizing = "border-box";
    box.style.background = "#FFF8EE";
    box.style.border = "1px solid #F0E0C8";
    box.style.borderRadius = "10px";
    box.style.padding = "12px 14px";
    box.style.fontSize = "14px";
    box.style.color = "#2B1B12";
    box.style.lineHeight = "1.6";
    box.style.whiteSpace = "pre-wrap";
    box.style.wordBreak = "break-word";
    box.style.overflowWrap = "break-word";
    row.appendChild(box);

    return row;
}

// Groups related rows into one titled section - returns null (nothing to
// append) when every row in the group was skipped for missing data, so
// callers can filter empty sections out rather than showing a heading
// over blank space.
function buildOrgDetailSection(titleText, rows){
    const populated = rows.filter(Boolean);
    if(populated.length === 0) return null;

    const section = document.createElement("div");
    section.className = "org-detail-section";
    section.style.display = "flex";
    section.style.flexDirection = "column";
    section.style.gap = "16px";
    section.style.width = "100%";
    section.style.boxSizing = "border-box";

    const title = document.createElement("h4");
    title.className = "org-detail-section-title";
    title.textContent = titleText;
    title.style.margin = "0";
    title.style.color = "#E73F1E";
    title.style.fontSize = "13px";
    title.style.fontWeight = "700";
    title.style.textTransform = "uppercase";
    title.style.letterSpacing = ".04em";
    section.appendChild(title);

    populated.forEach(function(row){ section.appendChild(row); });
    return section;
}

function openOrgDetailModal(org){
    const wrap = document.createElement("div");
    wrap.style.width = "100%";
    wrap.style.maxWidth = "100%";
    wrap.style.overflowX = "hidden";
    wrap.style.boxSizing = "border-box";

    const header = document.createElement("div");
    header.className = "org-detail-header";
    header.style.display = "flex";
    header.style.alignItems = "center";
    header.style.gap = "14px";
    header.style.padding = "20px 56px 18px 24px";
    header.style.borderBottom = "1px solid #F0E0C8";
    header.style.width = "100%";
    header.style.boxSizing = "border-box";
    header.style.background = "#fff";
    header.style.position = "sticky";
    header.style.top = "0";
    header.style.zIndex = "5";

    // Small logo beside the name only - never a large banner image,
    // regardless of the source photo's own dimensions.
    const logoEl = buildOrgLogo(org, "org-detail-logo");
    logoEl.style.width = "56px";
    logoEl.style.height = "56px";
    logoEl.style.minWidth = "56px";
    logoEl.style.borderRadius = "50%";
    logoEl.style.overflow = "hidden";
    logoEl.style.display = "flex";
    logoEl.style.alignItems = "center";
    logoEl.style.justifyContent = "center";
    logoEl.style.flexShrink = "0";
    logoEl.style.background = "linear-gradient(135deg,#E73F1E,#B82E12)";
    logoEl.style.color = "#fff";
    logoEl.style.fontSize = "20px";
    logoEl.style.border = "2px solid #fff";
    logoEl.style.boxShadow = "0 4px 10px rgba(184,46,18,.2)";
    const logoImg = logoEl.querySelector("img");
    if(logoImg){
        logoImg.style.width = "100%";
        logoImg.style.height = "100%";
        logoImg.style.objectFit = "cover";
        logoImg.style.display = "block";
    }
    header.appendChild(logoEl);

    const titleWrap = document.createElement("div");
    titleWrap.className = "org-detail-title";
    titleWrap.style.display = "flex";
    titleWrap.style.flexWrap = "wrap";
    titleWrap.style.alignItems = "center";
    titleWrap.style.gap = "8px";
    titleWrap.style.minWidth = "0";

    const name = document.createElement("h3");
    name.textContent = org.name;
    name.style.width = "100%";
    name.style.margin = "0";
    name.style.color = "#E73F1E";
    name.style.fontSize = "17px";
    name.style.fontWeight = "700";
    name.style.wordBreak = "break-word";
    titleWrap.appendChild(name);

    if(org.acronym){
        const acronym = document.createElement("span");
        acronym.className = "org-detail-acronym";
        acronym.textContent = org.acronym;
        acronym.style.fontSize = "13px";
        acronym.style.fontWeight = "600";
        acronym.style.color = "#8B7A6C";
        titleWrap.appendChild(acronym);
    }
    if(org.category){
        const badge = document.createElement("span");
        badge.className = "org-browse-category-badge";
        badge.textContent = org.category;
        badge.style.display = "inline-block";
        badge.style.padding = "3px 12px";
        badge.style.borderRadius = "20px";
        badge.style.background = "#FFF8EE";
        badge.style.color = "#E73F1E";
        badge.style.fontSize = "11px";
        badge.style.fontWeight = "700";
        badge.style.textTransform = "uppercase";
        badge.style.letterSpacing = ".03em";
        titleWrap.appendChild(badge);
    }
    header.appendChild(titleWrap);
    wrap.appendChild(header);

    const sections = document.createElement("div");
    sections.className = "org-detail-sections";
    sections.style.display = "flex";
    sections.style.flexDirection = "column";
    sections.style.gap = "24px";
    sections.style.width = "100%";
    sections.style.boxSizing = "border-box";
    sections.style.padding = "22px 24px 26px";

    const fbRow = org.facebook_url ? (function(){
        const row = document.createElement("div");
        row.className = "org-detail-row";
        row.style.display = "flex";
        row.style.flexDirection = "column";
        row.style.gap = "6px";
        row.style.width = "100%";
        row.style.minWidth = "0";

        const label = document.createElement("span");
        label.className = "org-detail-label";
        label.textContent = "Facebook Page";
        label.style.fontSize = "12px";
        label.style.fontWeight = "700";
        label.style.color = "#8B7A6C";
        label.style.textTransform = "uppercase";
        label.style.letterSpacing = ".03em";
        row.appendChild(label);

        const link = document.createElement("a");
        link.href = org.facebook_url;
        link.target = "_blank";
        link.rel = "noopener noreferrer";
        link.className = "org-detail-social-link";
        link.innerHTML = "<i class=\"fa-brands fa-facebook\"></i> " + org.facebook_url;
        link.style.display = "inline-flex";
        link.style.alignItems = "center";
        link.style.gap = "7px";
        link.style.maxWidth = "100%";
        link.style.overflowWrap = "break-word";
        link.style.wordBreak = "break-word";
        link.style.padding = "8px 14px";
        link.style.borderRadius = "30px";
        link.style.background = "#fff";
        link.style.border = "1px solid #F0E0C8";
        link.style.color = "#E73F1E";
        link.style.fontSize = "13px";
        link.style.fontWeight = "600";
        link.style.textDecoration = "none";
        row.appendChild(link);
        return row;
    })() : null;

    [
        buildOrgDetailSection("Organization Details", [
            org.acronym && buildOrgDetailTextBlock("Organization Acronym", org.acronym),
            org.category && buildOrgDetailTextBlock("Organization Category", org.category),
            org.president_name && buildOrgDetailTextBlock("Organization President", org.president_name),
            org.adviser && buildOrgDetailTextBlock("Adviser", org.adviser),
            org.member_count != null && buildOrgDetailTextBlock("Number of Members", String(org.member_count))
        ]),
        buildOrgDetailSection("Organization Description", [
            org.description && buildOrgDetailTextBlock("Organization Description", org.description)
        ]),
        buildOrgDetailSection("Organization Direction", [
            org.vision && buildOrgDetailTextBlock("Vision", org.vision),
            org.mission && buildOrgDetailTextBlock("Mission", org.mission),
            org.goals && buildOrgDetailTextBlock("Goals", org.goals)
        ]),
        buildOrgDetailSection("Social Media", [ fbRow ])
    ].filter(Boolean).forEach(function(section){ sections.appendChild(section); });

    if(sections.children.length === 0){
        const empty = document.createElement("p");
        empty.className = "org-detail-empty";
        empty.textContent = "This organization hasn't added any details yet.";
        sections.appendChild(empty);
    }

    wrap.appendChild(sections);

    orgBrowseOpenModal(org.name, wrap);
}

/* ================= GRID ================= */

function renderOrgBrowseSkeletons(){
    orgBrowseGrid.innerHTML = "";
    for(let i = 0; i < 8; i++){
        const skeleton = document.createElement("div");
        skeleton.className = "org-browse-skeleton";
        skeleton.innerHTML =
            "<div class=\"org-browse-skeleton-circle\"></div>"
            + "<div class=\"org-browse-skeleton-line\" style=\"width:80%\"></div>"
            + "<div class=\"org-browse-skeleton-line\" style=\"width:45%\"></div>"
            + "<div class=\"org-browse-skeleton-line\" style=\"width:60%\"></div>";
        orgBrowseGrid.appendChild(skeleton);
    }
}

function buildOrgBrowseCard(org){
    const card = document.createElement("div");
    card.className = "org-browse-card";

    card.appendChild(buildOrgLogo(org, "org-browse-logo"));

    const name = document.createElement("div");
    name.className = "org-browse-card-name";
    name.textContent = org.name;
    card.appendChild(name);

    if(org.acronym){
        const acronym = document.createElement("div");
        acronym.className = "org-browse-card-acronym";
        acronym.textContent = org.acronym;
        card.appendChild(acronym);
    }

    if(org.category){
        const badge = document.createElement("span");
        badge.className = "org-browse-category-badge";
        badge.textContent = org.category;
        card.appendChild(badge);
    }

    const desc = document.createElement("p");
    desc.className = "org-browse-card-desc";
    desc.textContent = org.description || "No description added yet.";
    card.appendChild(desc);

    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "org-browse-card-btn";
    btn.textContent = "View Details";
    btn.addEventListener("click", function(){ openOrgDetailModal(org); });
    card.appendChild(btn);

    return card;
}

function getFilteredOrgs(){
    const query = orgBrowseSearch.value.trim().toLowerCase();
    const category = orgBrowseCategoryFilter.value;

    return allOrgs.filter(function(org){
        if(category && org.category !== category) return false;

        if(query){
            const haystack = [org.name, org.acronym].filter(Boolean).join(" ").toLowerCase();
            if(!haystack.includes(query)) return false;
        }

        return true;
    });
}

function renderOrgBrowseGrid(){
    const filtered = getFilteredOrgs();

    orgBrowseGrid.innerHTML = "";

    if(filtered.length === 0){
        orgBrowseGrid.classList.add("hidden");
        orgBrowseEmpty.classList.remove("hidden");
        orgBrowseEmptyMessage.textContent = allOrgs.length === 0
            ? "No organizations available at the moment."
            : "No organizations match your search or filter.";
        return;
    }

    orgBrowseGrid.classList.remove("hidden");
    orgBrowseEmpty.classList.add("hidden");

    filtered.forEach(function(org){
        orgBrowseGrid.appendChild(buildOrgBrowseCard(org));
    });
}

[orgBrowseSearch, orgBrowseCategoryFilter].forEach(function(el){
    el.addEventListener(el.tagName === "SELECT" ? "change" : "input", renderOrgBrowseGrid);
});

/* ================= LOAD ================= */

async function loadOrgBrowseData(){
    const { data, error } = await supabaseClient
        .from("organizations")
        .select(ORG_BROWSE_COLUMNS)
        .order("name");

    if(error){
        console.error("[organizations] load failed:", error);
        orgBrowseToast("Couldn't load organizations: " + error.message, "error");
        return;
    }

    allOrgs = data || [];
    renderOrgBrowseGrid();
}

document.addEventListener("DOMContentLoaded", function(){
    renderOrgBrowseSkeletons();
    loadOrgBrowseData();
});

// Live updates so a newly-accredited organization (or an edited one)
// appears without a refresh - same publication list-of-members/script.js
// already relies on (public.organizations, added in
// 20260724000000_organization_information.sql).
supabaseClient
    .channel("organizations_browse_page_changes")
    .on("postgres_changes", { event: "*", schema: "public", table: "organizations" }, function(){
        loadOrgBrowseData();
    })
    .subscribe();
