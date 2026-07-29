/* ===================================================
   LINGKOD Meneses - Upcoming Activities
   Cover images share the public "project-images" Storage bucket
   and validate/crop-to-square/upload logic with Ongoing Projects,
   Implemented Activities, and Income-Generating Projects - see
   js/common.js's "SQUARE COVER IMAGES" section.
   =================================================== */

const PROJECT_IMAGES_BUCKET = "project-images";
const CATEGORY = "upcoming_activity";

const activityForm = document.getElementById("activityForm");
const activitiesGrid = document.getElementById("activitiesGrid");
const activityImageInput = document.getElementById("activityImageInput");
const activityImagePreview = document.getElementById("activityImagePreview");
const activityImagePreviewImg = document.getElementById("activityImagePreviewImg");
const activityImageRemoveBtn = document.getElementById("activityImageRemoveBtn");
const activitySubmitBtn = document.getElementById("activitySubmitBtn");

let viewerProfile = null;
let selectedImageBlob = null;

if(activityImageInput){
    lingkodWireSquareImageInput({
        fileInput: activityImageInput,
        previewWrap: activityImagePreview,
        previewImg: activityImagePreviewImg,
        removeBtn: activityImageRemoveBtn,
        onReady: function(blob){ selectedImageBlob = blob; },
        onClear: function(){ selectedImageBlob = null; }
    });
}

function clearImageSelection(){
    selectedImageBlob = null;
    if(activityImageInput) activityImageInput.value = "";
    if(activityImagePreview) activityImagePreview.hidden = true;
    if(activityImagePreviewImg) activityImagePreviewImg.src = "";
}

function formatDate(value){
    if(!value) return "Date to be announced";
    const date = new Date(value + "T00:00:00");
    return date.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
}

/* ================= PERMISSIONS ================= */

// Shared with ongoing-projects/implemented-activities/income-projects's
// identical check - see lingkodCanManageOrgNamedRow in js/common.js.
function canManageRow(row){
    return lingkodCanManageOrgNamedRow(viewerProfile, row.organization);
}

// See ongoing-projects/script.js for why this exists: an org_president can
// only write rows for their own organization (owns_org() RLS policy). The
// dropdown still submits the organization's plain NAME, same as the free-
// text input it replaced - see lingkodPopulateOrganizationSelect.
async function setupOrgLock(){
    if(!activityForm) return;

    viewerProfile = await lingkodGetAuthedProfile();
    if(!viewerProfile) return;

    const orgSelect = activityForm.elements.organization;
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
        placeholder.innerHTML = "<i class=\"fa-solid fa-calendar-days\"></i>";
        card.appendChild(placeholder);
    }

    const bodyEl = document.createElement("div");
    bodyEl.className = "item-card-body";

    const header = document.createElement("div");
    header.className = "item-card-header";
    const h3 = document.createElement("h3");
    h3.textContent = row.title;
    const status = document.createElement("span");
    status.className = "status pending";
    status.textContent = "Scheduled";
    header.appendChild(h3);
    header.appendChild(status);

    const p = document.createElement("p");
    p.textContent = row.description || "No description provided.";

    const org = document.createElement("div");
    org.className = "item-org";
    const orgIcon = document.createElement("i");
    orgIcon.className = "fa-solid fa-users";
    org.appendChild(orgIcon);
    org.appendChild(document.createTextNode(" " + row.organization));

    const date = document.createElement("div");
    date.className = "item-date";
    const dateIcon = document.createElement("i");
    dateIcon.className = "fa-solid fa-calendar";
    date.appendChild(dateIcon);
    date.appendChild(document.createTextNode(" " + formatDate(row.start_date)));

    bodyEl.appendChild(header);
    bodyEl.appendChild(p);
    bodyEl.appendChild(org);
    bodyEl.appendChild(date);

    card.appendChild(bodyEl);

    if(canManageRow(row)){
        card.appendChild(lingkodBuildCardMenuButton([
            { label: "Edit Activity", icon: "fa-pen", onClick: function(){ openEditModal(row); } },
            { label: "Delete Activity", icon: "fa-trash", onClick: function(){ deleteActivity(row); }, destructive: true }
        ]));
    }

    return card;
}

async function loadActivities(){
    if(!activitiesGrid) return;

    const { data, error } = await supabaseClient
        .from("projects_activities")
        .select("id, title, description, organization, start_date, image_url, created_at")
        .eq("category", CATEGORY)
        .order("created_at", { ascending: false });

    activitiesGrid.innerHTML = "";

    if(error){
        console.error("[upcoming-activities] load failed:", error);
        const p = document.createElement("p");
        p.textContent = "Couldn't load activities (" + error.message + ").";
        activitiesGrid.appendChild(p);
        return;
    }

    if(data.length === 0){
        const p = document.createElement("p");
        p.textContent = "No upcoming activities available.";
        activitiesGrid.appendChild(p);
        return;
    }

    data.forEach(function(row){
        activitiesGrid.appendChild(buildCard(row));
    });
}

/* ================= CREATE ================= */

if(activityForm){
    setupOrgLock();

    activityForm.addEventListener("submit", async function(e){
        e.preventDefault();

        const title = activityForm.elements.title.value.trim();
        const organization = activityForm.elements.organization.value.trim();
        const date = activityForm.elements.date.value || null;
        const description = activityForm.elements.description.value.trim();

        if(!organization){
            lingkodToast("Please select an organization.", "error");
            return;
        }

        if(!viewerProfile){
            lingkodToast("Please log in with a registered account to add an activity.", "error");
            return;
        }

        lingkodSetButtonLoading(activitySubmitBtn, true, "Adding...");

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
                    status: "planned",
                    start_date: date,
                    image_url: imageUrl,
                    created_by: viewerProfile.id
                });

            if(error){
                if(imageUrl) lingkodDeletePublicImage(PROJECT_IMAGES_BUCKET, imageUrl);
                console.error("[upcoming-activities] create failed:", error);
                lingkodToast("Couldn't add this activity: " + error.message, "error");
                return;
            }

            lingkodToast("Activity added successfully.", "success");
            activityForm.reset();
            clearImageSelection();
            await setupOrgLock();
            await loadActivities();
        } catch(err){
            console.error("[upcoming-activities] image upload failed:", err);
            lingkodToast("Couldn't upload the cover image: " + err.message, "error");
        } finally {
            lingkodSetButtonLoading(activitySubmitBtn, false);
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
    form.appendChild(lingkodBuildFormField("Activity Title", titleInput));

    const descriptionInput = document.createElement("textarea");
    descriptionInput.rows = 3;
    descriptionInput.value = row.description || "";
    form.appendChild(lingkodBuildFormField("Description", descriptionInput));

    const dateInput = document.createElement("input");
    dateInput.type = "date";
    dateInput.value = row.start_date || "";
    form.appendChild(lingkodBuildFormField("Date", dateInput));

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
            lingkodToast("Activity title is required.", "error");
            return;
        }

        lingkodSetButtonLoading(saveBtn, true, "Saving...");

        try {
            const patch = {
                title: newTitle,
                description: descriptionInput.value.trim() || null,
                start_date: dateInput.value || null
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
                console.error("[upcoming-activities] update failed:", error);
                lingkodToast("Couldn't update this activity: " + error.message, "error");
                return;
            }

            if((coverImage.state.newBlob || coverImage.state.removeExisting) && row.image_url){
                lingkodDeletePublicImage(PROJECT_IMAGES_BUCKET, row.image_url);
            }

            lingkodCloseModal();
            lingkodToast("Activity updated successfully.", "success");
            await loadActivities();
        } catch(err){
            console.error("[upcoming-activities] image upload failed:", err);
            lingkodToast("Couldn't upload the cover image: " + err.message, "error");
        } finally {
            lingkodSetButtonLoading(saveBtn, false);
        }
    });

    lingkodOpenModal("Edit Activity", form);
}

/* ================= DELETE ================= */

function deleteActivity(row){
    lingkodConfirmDelete({
        title: "Delete Activity?",
        message: "Are you sure you want to delete this activity? This action cannot be undone.",
        onConfirm: async function(){
            const { error } = await supabaseClient.from("projects_activities").delete().eq("id", row.id);

            if(error){
                console.error("[upcoming-activities] delete failed:", error);
                lingkodToast("Couldn't delete this activity: " + error.message, "error");
                throw error;
            }

            if(row.image_url) lingkodDeletePublicImage(PROJECT_IMAGES_BUCKET, row.image_url);

            lingkodToast("Activity deleted successfully.", "success");
            await loadActivities();
        }
    });
}

document.addEventListener("DOMContentLoaded", loadActivities);

supabaseClient
    .channel("upcoming_activities_page_changes")
    .on("postgres_changes", { event: "*", schema: "public", table: "projects_activities" }, function(payload){
        const row = payload.new && Object.keys(payload.new).length ? payload.new : payload.old;
        if(row && row.category && row.category !== CATEGORY) return;
        loadActivities();
    })
    .subscribe();
