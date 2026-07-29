/* ===================================================
   LINGKOD Meneses - Implemented Activities and Projects
   Cover images share the public "project-images" Storage bucket
   and validate/crop-to-square/upload logic with Ongoing Projects,
   Upcoming Activities, and Income-Generating Projects - see
   js/common.js's "SQUARE COVER IMAGES" section.
   =================================================== */

const PROJECT_IMAGES_BUCKET = "project-images";
const CATEGORY = "implemented";

const implementedForm = document.getElementById("implementedForm");
const implementedGrid = document.getElementById("implementedGrid");
const implementedImageInput = document.getElementById("implementedImageInput");
const implementedImagePreview = document.getElementById("implementedImagePreview");
const implementedImagePreviewImg = document.getElementById("implementedImagePreviewImg");
const implementedImageRemoveBtn = document.getElementById("implementedImageRemoveBtn");
const implementedSubmitBtn = document.getElementById("implementedSubmitBtn");

let viewerProfile = null;
let selectedImageBlob = null;

if(implementedImageInput){
    lingkodWireSquareImageInput({
        fileInput: implementedImageInput,
        previewWrap: implementedImagePreview,
        previewImg: implementedImagePreviewImg,
        removeBtn: implementedImageRemoveBtn,
        onReady: function(blob){ selectedImageBlob = blob; },
        onClear: function(){ selectedImageBlob = null; }
    });
}

function clearImageSelection(){
    selectedImageBlob = null;
    if(implementedImageInput) implementedImageInput.value = "";
    if(implementedImagePreview) implementedImagePreview.hidden = true;
    if(implementedImagePreviewImg) implementedImagePreviewImg.src = "";
}

function formatCompletedDate(value){
    if(!value) return "Completion date not set";
    const date = new Date(value + "T00:00:00");
    return "Completed " + date.toLocaleDateString("en-US", { year: "numeric", month: "long" });
}

/* ================= PERMISSIONS ================= */

// Shared with ongoing-projects/upcoming-activities/income-projects's
// identical check - see lingkodCanManageOrgNamedRow in js/common.js.
function canManageRow(row){
    return lingkodCanManageOrgNamedRow(viewerProfile, row.organization);
}

// See ongoing-projects/script.js for why this exists: an org_president can
// only write rows for their own organization (owns_org() RLS policy). The
// dropdown still submits the organization's plain NAME, same as the free-
// text input it replaced - see lingkodPopulateOrganizationSelect.
async function setupOrgLock(){
    if(!implementedForm) return;

    viewerProfile = await lingkodGetAuthedProfile();
    if(!viewerProfile) return;

    const orgSelect = implementedForm.elements.organization;
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
        placeholder.innerHTML = "<i class=\"fa-solid fa-flag-checkered\"></i>";
        card.appendChild(placeholder);
    }

    const bodyEl = document.createElement("div");
    bodyEl.className = "item-card-body";

    const header = document.createElement("div");
    header.className = "item-card-header";
    const h3 = document.createElement("h3");
    h3.textContent = row.title;
    const status = document.createElement("span");
    status.className = "status approved";
    status.textContent = "Completed";
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
    dateIcon.className = "fa-solid fa-calendar-check";
    date.appendChild(dateIcon);
    date.appendChild(document.createTextNode(" " + formatCompletedDate(row.end_date)));

    bodyEl.appendChild(header);
    bodyEl.appendChild(p);
    bodyEl.appendChild(org);
    bodyEl.appendChild(date);

    card.appendChild(bodyEl);

    if(canManageRow(row)){
        card.appendChild(lingkodBuildCardMenuButton([
            { label: "Edit Activity", icon: "fa-pen", onClick: function(){ openEditModal(row); } },
            { label: "Delete Activity", icon: "fa-trash", onClick: function(){ deleteRecord(row); }, destructive: true }
        ]));
    }

    return card;
}

async function loadImplemented(){
    if(!implementedGrid) return;

    const { data, error } = await supabaseClient
        .from("projects_activities")
        .select("id, title, description, organization, end_date, image_url, created_at")
        .eq("category", CATEGORY)
        .order("created_at", { ascending: false });

    implementedGrid.innerHTML = "";

    if(error){
        console.error("[implemented-activities] load failed:", error);
        const p = document.createElement("p");
        p.textContent = "Couldn't load records (" + error.message + ").";
        implementedGrid.appendChild(p);
        return;
    }

    if(data.length === 0){
        const p = document.createElement("p");
        p.textContent = "No implemented activities available.";
        implementedGrid.appendChild(p);
        return;
    }

    data.forEach(function(row){
        implementedGrid.appendChild(buildCard(row));
    });
}

/* ================= CREATE ================= */

if(implementedForm){
    setupOrgLock();

    implementedForm.addEventListener("submit", async function(e){
        e.preventDefault();

        const title = implementedForm.elements.title.value.trim();
        const organization = implementedForm.elements.organization.value.trim();
        const date = implementedForm.elements.date.value || null;
        const description = implementedForm.elements.description.value.trim();

        if(!organization){
            lingkodToast("Please select an organization.", "error");
            return;
        }

        if(!viewerProfile){
            lingkodToast("Please log in with a registered account to add a record.", "error");
            return;
        }

        lingkodSetButtonLoading(implementedSubmitBtn, true, "Adding...");

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
                    status: "completed",
                    end_date: date,
                    image_url: imageUrl,
                    created_by: viewerProfile.id
                });

            if(error){
                if(imageUrl) lingkodDeletePublicImage(PROJECT_IMAGES_BUCKET, imageUrl);
                console.error("[implemented-activities] create failed:", error);
                lingkodToast("Couldn't add this record: " + error.message, "error");
                return;
            }

            lingkodToast("Record added successfully.", "success");
            implementedForm.reset();
            clearImageSelection();
            await setupOrgLock();
            await loadImplemented();
        } catch(err){
            console.error("[implemented-activities] image upload failed:", err);
            lingkodToast("Couldn't upload the cover image: " + err.message, "error");
        } finally {
            lingkodSetButtonLoading(implementedSubmitBtn, false);
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
    form.appendChild(lingkodBuildFormField("Title", titleInput));

    const descriptionInput = document.createElement("textarea");
    descriptionInput.rows = 3;
    descriptionInput.value = row.description || "";
    form.appendChild(lingkodBuildFormField("Description", descriptionInput));

    const dateInput = document.createElement("input");
    dateInput.type = "date";
    dateInput.value = row.end_date || "";
    form.appendChild(lingkodBuildFormField("Completion Date", dateInput));

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
            lingkodToast("Title is required.", "error");
            return;
        }

        lingkodSetButtonLoading(saveBtn, true, "Saving...");

        try {
            const patch = {
                title: newTitle,
                description: descriptionInput.value.trim() || null,
                end_date: dateInput.value || null
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
                console.error("[implemented-activities] update failed:", error);
                lingkodToast("Couldn't update this record: " + error.message, "error");
                return;
            }

            if((coverImage.state.newBlob || coverImage.state.removeExisting) && row.image_url){
                lingkodDeletePublicImage(PROJECT_IMAGES_BUCKET, row.image_url);
            }

            lingkodCloseModal();
            lingkodToast("Record updated successfully.", "success");
            await loadImplemented();
        } catch(err){
            console.error("[implemented-activities] image upload failed:", err);
            lingkodToast("Couldn't upload the cover image: " + err.message, "error");
        } finally {
            lingkodSetButtonLoading(saveBtn, false);
        }
    });

    lingkodOpenModal("Edit Record", form);
}

/* ================= DELETE ================= */

function deleteRecord(row){
    lingkodConfirmDelete({
        title: "Delete Activity?",
        message: "Are you sure you want to delete this activity? This action cannot be undone.",
        onConfirm: async function(){
            const { error } = await supabaseClient.from("projects_activities").delete().eq("id", row.id);

            if(error){
                console.error("[implemented-activities] delete failed:", error);
                lingkodToast("Couldn't delete this record: " + error.message, "error");
                throw error;
            }

            if(row.image_url) lingkodDeletePublicImage(PROJECT_IMAGES_BUCKET, row.image_url);

            lingkodToast("Record deleted successfully.", "success");
            await loadImplemented();
        }
    });
}

document.addEventListener("DOMContentLoaded", loadImplemented);

supabaseClient
    .channel("implemented_activities_page_changes")
    .on("postgres_changes", { event: "*", schema: "public", table: "projects_activities" }, function(payload){
        const row = payload.new && Object.keys(payload.new).length ? payload.new : payload.old;
        if(row && row.category && row.category !== CATEGORY) return;
        loadImplemented();
    })
    .subscribe();
