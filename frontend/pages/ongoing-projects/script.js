/* ===================================================
   LINGKOD Meneses - Ongoing Projects
   Cover images live in the public "project-images" Storage
   bucket (see the project-cover-images migration) - unlike
   submission documents or message attachments, these are meant
   to be shown to every role repeatedly across every dashboard,
   so a public URL is the right fit, not a signed one. The actual
   validate/crop-to-square/upload logic is shared with Upcoming
   Activities, Implemented Activities, and Income-Generating
   Projects - see js/common.js's "SQUARE COVER IMAGES" section.
   =================================================== */

const PROJECT_IMAGES_BUCKET = "project-images";
const CATEGORY = "ongoing_project";

const PROJECT_STATUS_LABELS = {
    not_started: "Not Yet Started",
    ongoing: "On Going",
    completed: "Done"
};

const PROJECT_STATUS_CLASSES = {
    not_started: "not-started",
    ongoing: "ongoing",
    completed: "done"
};

// "+T00:00:00" forces local-time parsing of the date-only string Postgres
// returns - without it, new Date("2026-07-25") parses as UTC midnight and
// can display as the previous day in negative-UTC-offset timezones.
// Mirrors upcoming-activities/script.js's and implemented-activities/
// script.js's own formatDate/formatCompletedDate helpers.
function formatImplementationDate(value){
    if(!value) return "Date of implementation not set";
    const date = new Date(value + "T00:00:00");
    return date.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
}

const projectForm = document.getElementById("projectForm");
const projectsGrid = document.getElementById("projectsGrid");
const projectImageInput = document.getElementById("projectImageInput");
const projectImagePreview = document.getElementById("projectImagePreview");
const projectImagePreviewImg = document.getElementById("projectImagePreviewImg");
const projectImageRemoveBtn = document.getElementById("projectImageRemoveBtn");
const projectSubmitBtn = document.getElementById("projectSubmitBtn");

let viewerProfile = null;
let selectedImageBlob = null;

// projects_activities.created_by is a bare uuid (no FK to profiles), so
// PostgREST can't auto-embed the uploader's name - fetched separately and
// keyed by id, same batch-lookup pattern as submission/feedback's own
// profile lookups. See js/common.js's lingkodFetchProfilesById. Populated
// once per loadProjects() call; openDetailModal() below reads it
// synchronously since it's only ever opened after cards have rendered.
let projectProfilesById = {};

if(projectImageInput){
    lingkodWireSquareImageInput({
        fileInput: projectImageInput,
        previewWrap: projectImagePreview,
        previewImg: projectImagePreviewImg,
        removeBtn: projectImageRemoveBtn,
        onReady: function(blob){ selectedImageBlob = blob; },
        onClear: function(){ selectedImageBlob = null; }
    });
}

function clearImageSelection(){
    selectedImageBlob = null;
    if(projectImageInput) projectImageInput.value = "";
    if(projectImagePreview) projectImagePreview.hidden = true;
    if(projectImagePreviewImg) projectImagePreviewImg.src = "";
}

/* ================= PERMISSIONS ================= */

// projects_write RLS already restricts an org_president to rows whose
// organization matches their own profile - this mirrors that exact rule
// client-side so Edit/Delete only ever appear on cards a click would
// actually be allowed to act on, rather than showing buttons that would
// just fail server-side. Shared with upcoming-activities/implemented-
// activities/income-projects's identical check - see
// lingkodCanManageOrgNamedRow in js/common.js.
function canManageRow(row){
    return lingkodCanManageOrgNamedRow(viewerProfile, row.organization);
}

// projects_activities.organization is still free text under the hood
// (the write RLS policy only lets an org_president write rows whose
// organization matches their own profile - a live dropdown just replaces
// how that text gets typed in, submitting the same organization NAME as
// before) - see js/common.js's lingkodPopulateOrganizationSelect. An
// org_president's dropdown is populated then locked to their own org
// (picking anything else would just fail server-side); OSOA EB gets the
// full list, free to pick any organization.
async function setupOrgLock(){
    if(!projectForm) return;

    viewerProfile = await lingkodGetAuthedProfile();
    if(!viewerProfile) return;

    const orgSelect = projectForm.elements.organization;
    await lingkodPopulateOrganizationSelect(orgSelect, viewerProfile.organization);

    if(viewerProfile.role === "org_president" && viewerProfile.organization){
        orgSelect.disabled = true;
    }
}

/* ================= CARD RENDERING ================= */

function buildCard(row){
    const card = document.createElement("div");
    card.className = "item-card";
    card.dataset.id = row.id;

    if(row.image_url){
        const img = document.createElement("img");
        img.className = "item-card-cover";
        img.src = row.image_url;
        img.alt = row.title + " cover image";
        card.appendChild(img);
    } else {
        const placeholder = document.createElement("div");
        placeholder.className = "item-card-cover-placeholder";
        placeholder.innerHTML = "<i class=\"fa-solid fa-diagram-project\"></i>";
        card.appendChild(placeholder);
    }

    const bodyEl = document.createElement("div");
    bodyEl.className = "item-card-body";

    const header = document.createElement("div");
    header.className = "item-card-header";
    const h3 = document.createElement("h3");
    h3.textContent = row.title;
    header.appendChild(h3);

    const p = document.createElement("p");
    p.textContent = row.description || "No description provided.";

    const org = document.createElement("div");
    org.className = "item-org";
    const orgIcon = document.createElement("i");
    orgIcon.className = "fa-solid fa-users";
    org.appendChild(orgIcon);
    org.appendChild(document.createTextNode(" " + row.organization));

    const implementationDate = document.createElement("div");
    implementationDate.className = "item-org";
    const dateIcon = document.createElement("i");
    dateIcon.className = "fa-solid fa-calendar-day";
    implementationDate.appendChild(dateIcon);
    implementationDate.appendChild(document.createTextNode(" " + formatImplementationDate(row.implementation_date)));

    const statusRow = document.createElement("div");
    statusRow.className = "item-status-row";
    const statusLabel = document.createElement("span");
    statusLabel.className = "item-status-label";
    statusLabel.textContent = "Status:";
    const statusBadge = document.createElement("span");
    statusBadge.className = "status " + (PROJECT_STATUS_CLASSES[row.status] || "ongoing");
    statusBadge.textContent = PROJECT_STATUS_LABELS[row.status] || "On Going";
    statusRow.appendChild(statusLabel);
    statusRow.appendChild(statusBadge);

    bodyEl.appendChild(header);
    bodyEl.appendChild(p);
    bodyEl.appendChild(org);
    bodyEl.appendChild(implementationDate);
    bodyEl.appendChild(statusRow);

    card.appendChild(bodyEl);

    // Clicking anywhere on the card opens the read-only detail modal - the
    // three-dot menu button below stops its own click from bubbling here
    // (see lingkodBuildCardMenuButton in js/common.js), so this never fires
    // when a manager opens the Edit/Delete menu instead.
    card.style.cursor = "pointer";
    card.addEventListener("click", function(){ openDetailModal(row); });

    if(canManageRow(row)){
        card.appendChild(lingkodBuildCardMenuButton([
            { label: "Edit Activity", icon: "fa-pen", onClick: function(){ openEditModal(row); } },
            { label: "Delete Activity", icon: "fa-trash", onClick: function(){ deleteProject(row); }, destructive: true }
        ]));
    }

    return card;
}

/* ================= DETAIL MODAL (read-only, all roles) ================= */
// Every role - including students, who have no Edit/Delete access at all -
// can open this by clicking a card. Edit/Delete only appear in the actions
// row for viewers canManageRow(row) already allows to manage this specific
// row; they call the page's existing openEditModal/deleteProject verbatim.

function buildDetailImagePanel(row){
    const panel = document.createElement("div");
    panel.className = "view-modal-preview";

    if(row.image_url){
        const img = document.createElement("img");
        img.src = row.image_url;
        img.alt = row.title + " cover image";
        panel.appendChild(img);
    } else {
        lingkodShowPreviewMessage(panel, "fa-solid fa-image", "No image available.");
    }

    return panel;
}

function buildDetailInfoPanel(row){
    const uploader = projectProfilesById[row.created_by];

    const panel = document.createElement("div");
    panel.className = "view-modal-info";

    const badge = document.createElement("span");
    badge.className = "status " + (PROJECT_STATUS_CLASSES[row.status] || "ongoing");
    badge.textContent = PROJECT_STATUS_LABELS[row.status] || row.status;
    panel.appendChild(badge);

    const h4 = document.createElement("h4");
    h4.textContent = row.title;
    panel.appendChild(h4);

    [
        ["Organization", row.organization],
        ["Date of Implementation", formatImplementationDate(row.implementation_date)]
    ].forEach(function(pair){
        const field = document.createElement("div");
        field.className = "view-modal-field";
        const dt = document.createElement("label");
        dt.textContent = pair[0];
        const dd = document.createElement("span");
        dd.textContent = pair[1];
        field.appendChild(dt);
        field.appendChild(dd);
        panel.appendChild(field);
    });

    // Description gets its own <p> field (long free text, not truncated) -
    // matches feedback/script.js's buildFeedbackViewBody's feedback_message
    // field.
    const descField = document.createElement("div");
    descField.className = "view-modal-field";
    const descLabel = document.createElement("label");
    descLabel.textContent = "Description";
    descField.appendChild(descLabel);
    const descValue = document.createElement("p");
    descValue.textContent = row.description || "No description provided.";
    descField.appendChild(descValue);
    panel.appendChild(descField);

    [
        ["Status", PROJECT_STATUS_LABELS[row.status] || row.status],
        ["Uploaded By", uploader ? uploader.full_name : "Unknown"],
        ["Uploaded Date", lingkodFormatDate(row.created_at)]
    ].forEach(function(pair){
        const field = document.createElement("div");
        field.className = "view-modal-field";
        const dt = document.createElement("label");
        dt.textContent = pair[0];
        const dd = document.createElement("span");
        dd.textContent = pair[1];
        field.appendChild(dt);
        field.appendChild(dd);
        panel.appendChild(field);
    });

    return panel;
}

function buildDetailActions(row){
    const actions = document.createElement("div");
    actions.className = "view-modal-actions";

    if(canManageRow(row)){
        const editBtn = document.createElement("button");
        editBtn.type = "button";
        editBtn.className = "btn-secondary";
        editBtn.innerHTML = "<i class=\"fa-solid fa-pen\"></i> Edit";
        editBtn.addEventListener("click", function(){ openEditModal(row); });
        actions.appendChild(editBtn);

        const deleteBtn = document.createElement("button");
        deleteBtn.type = "button";
        deleteBtn.className = "btn-danger";
        deleteBtn.innerHTML = "<i class=\"fa-solid fa-trash\"></i> Delete";
        deleteBtn.addEventListener("click", function(){ deleteProject(row); });
        actions.appendChild(deleteBtn);
    }

    return actions;
}

function openDetailModal(row){
    const wrapper = document.createElement("div");
    wrapper.className = "view-modal";

    const layout = document.createElement("div");
    layout.className = "view-modal-layout";
    layout.appendChild(buildDetailInfoPanel(row));
    layout.appendChild(buildDetailImagePanel(row));
    wrapper.appendChild(layout);

    wrapper.appendChild(buildDetailActions(row));

    lingkodOpenModal(row.title, wrapper, "modal-wide");
}

async function loadProjects(){
    if(!projectsGrid) return;

    const { data, error } = await supabaseClient
        .from("projects_activities")
        .select("id, title, description, organization, implementation_date, status, image_url, created_at, created_by")
        .eq("category", CATEGORY)
        .order("created_at", { ascending: false });

    projectsGrid.innerHTML = "";

    if(error){
        console.error("[ongoing-projects] load failed:", error);
        const p = document.createElement("p");
        p.textContent = "Couldn't load projects (" + error.message + ").";
        projectsGrid.appendChild(p);
        return;
    }

    if(data.length === 0){
        const p = document.createElement("p");
        p.textContent = "No ongoing projects available.";
        projectsGrid.appendChild(p);
        return;
    }

    projectProfilesById = await lingkodFetchProfilesById(data.map(function(row){ return row.created_by; }));

    data.forEach(function(row){
        projectsGrid.appendChild(buildCard(row));
    });
}

/* ================= CREATE ================= */

if(projectForm){
    setupOrgLock();

    projectForm.addEventListener("submit", async function(e){
        e.preventDefault();

        const title = projectForm.elements.title.value.trim();
        const organization = projectForm.elements.organization.value.trim();
        const implementationDate = projectForm.elements.implementation_date.value;
        const description = projectForm.elements.description.value.trim();
        const status = projectForm.elements.status.value;

        if(!organization){
            lingkodToast("Please select an organization.", "error");
            return;
        }

        if(!implementationDate){
            lingkodToast("Please select a date of implementation.", "error");
            return;
        }

        if(!viewerProfile){
            lingkodToast("Please log in with a registered account to add a project.", "error");
            return;
        }

        lingkodSetButtonLoading(projectSubmitBtn, true, "Adding...");

        try {
            const newId = crypto.randomUUID();
            let imageUrl = null;

            if(selectedImageBlob){
                imageUrl = await lingkodUploadPublicImage(PROJECT_IMAGES_BUCKET, newId, selectedImageBlob);
            }

            const { error } = await supabaseClient
                .from("projects_activities")
                .insert({
                    id: newId,
                    category: CATEGORY,
                    title: title,
                    description: description || null,
                    organization: organization,
                    implementation_date: implementationDate,
                    status: status,
                    image_url: imageUrl,
                    created_by: viewerProfile.id
                });

            if(error){
                if(imageUrl) lingkodDeletePublicImage(PROJECT_IMAGES_BUCKET, imageUrl);
                console.error("[ongoing-projects] create failed:", error);
                lingkodToast("Couldn't add this project: " + error.message, "error");
                return;
            }

            lingkodToast("Project added successfully.", "success");
            projectForm.reset();
            clearImageSelection();
            await setupOrgLock();
            await loadProjects();
        } catch(err){
            console.error("[ongoing-projects] image upload failed:", err);
            lingkodToast("Couldn't upload the cover image: " + err.message, "error");
        } finally {
            lingkodSetButtonLoading(projectSubmitBtn, false);
        }
    });
}

/* ================= EDIT ================= */

function openEditModal(row){
    const form = document.createElement("form");
    form.className = "edit-profile-form";

    const titleInput = document.createElement("input");
    titleInput.type = "text";
    titleInput.value = row.title;
    form.appendChild(lingkodBuildFormField("Project Title", titleInput));

    const descriptionInput = document.createElement("textarea");
    descriptionInput.rows = 3;
    descriptionInput.value = row.description || "";
    form.appendChild(lingkodBuildFormField("Description", descriptionInput));

    const implementationDateInput = document.createElement("input");
    implementationDateInput.type = "date";
    implementationDateInput.value = row.implementation_date || "";
    form.appendChild(lingkodBuildFormField("Date of Implementation", implementationDateInput));

    const statusSelect = document.createElement("select");
    Object.keys(PROJECT_STATUS_LABELS).forEach(function(key){
        const option = document.createElement("option");
        option.value = key;
        option.textContent = PROJECT_STATUS_LABELS[key];
        if(key === row.status) option.selected = true;
        statusSelect.appendChild(option);
    });
    form.appendChild(lingkodBuildFormField("Project Status", statusSelect));

    const coverImage = lingkodBuildCoverImageField(row.image_url);
    form.appendChild(coverImage.field);

    const saveBtn = document.createElement("button");
    saveBtn.type = "submit";
    saveBtn.textContent = "Save Changes";
    form.appendChild(saveBtn);

    form.addEventListener("submit", async function(e){
        e.preventDefault();

        const newTitle = titleInput.value.trim();
        if(!newTitle){
            lingkodToast("Project title is required.", "error");
            return;
        }

        if(!implementationDateInput.value){
            lingkodToast("Date of implementation is required.", "error");
            return;
        }

        lingkodSetButtonLoading(saveBtn, true, "Saving...");

        try {
            const patch = {
                title: newTitle,
                description: descriptionInput.value.trim() || null,
                implementation_date: implementationDateInput.value,
                status: statusSelect.value
            };

            let uploadedUrl = null;
            if(coverImage.state.newBlob){
                uploadedUrl = await lingkodUploadPublicImage(PROJECT_IMAGES_BUCKET, row.id, coverImage.state.newBlob);
                patch.image_url = uploadedUrl;
            } else if(coverImage.state.removeExisting){
                patch.image_url = null;
            }

            const { error } = await supabaseClient
                .from("projects_activities")
                .update(patch)
                .eq("id", row.id);

            if(error){
                if(uploadedUrl) lingkodDeletePublicImage(PROJECT_IMAGES_BUCKET, uploadedUrl);
                console.error("[ongoing-projects] update failed:", error);
                lingkodToast("Couldn't update this project: " + error.message, "error");
                return;
            }

            // Old image is only removed from Storage after the row update
            // succeeds - if the update had failed, the previous image
            // would still be the one actually referenced by the row.
            if((coverImage.state.newBlob || coverImage.state.removeExisting) && row.image_url){
                lingkodDeletePublicImage(PROJECT_IMAGES_BUCKET, row.image_url);
            }

            lingkodCloseModal();
            lingkodToast("Project updated successfully.", "success");
            await loadProjects();
        } catch(err){
            console.error("[ongoing-projects] image upload failed:", err);
            lingkodToast("Couldn't upload the cover image: " + err.message, "error");
        } finally {
            lingkodSetButtonLoading(saveBtn, false);
        }
    });

    lingkodOpenModal("Edit Project", form);
}

/* ================= DELETE ================= */

function deleteProject(row){
    lingkodConfirmDelete({
        title: "Delete Activity?",
        message: "Are you sure you want to delete this activity? This action cannot be undone.",
        onConfirm: async function(){
            const { error } = await supabaseClient.from("projects_activities").delete().eq("id", row.id);

            if(error){
                console.error("[ongoing-projects] delete failed:", error);
                lingkodToast("Couldn't delete this project: " + error.message, "error");
                throw error;
            }

            if(row.image_url) lingkodDeletePublicImage(PROJECT_IMAGES_BUCKET, row.image_url);

            lingkodToast("Project deleted successfully.", "success");
            await loadProjects();
        }
    });
}

document.addEventListener("DOMContentLoaded", loadProjects);

// Live updates: a project added/edited/deleted by anyone (OSOA EB, or an
// org president for their own org) refreshes this page immediately for
// everyone viewing it - matches the dashboard preview widgets, which
// already have their own realtime subscription on this same table.
supabaseClient
    .channel("ongoing_projects_page_changes")
    .on("postgres_changes", { event: "*", schema: "public", table: "projects_activities" }, function(payload){
        const row = payload.new && Object.keys(payload.new).length ? payload.new : payload.old;
        if(row && row.category && row.category !== CATEGORY) return;
        loadProjects();
    })
    .subscribe();
