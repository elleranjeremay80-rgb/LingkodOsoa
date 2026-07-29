/* ===================================================
   LINGKOD Meneses - Income-Generating Projects
   Cover images share the public "project-images" Storage bucket
   and validate/crop-to-square/upload logic with Ongoing Projects,
   Upcoming Activities, and Implemented Activities - see
   js/common.js's "SQUARE COVER IMAGES" section.
   =================================================== */

const PROJECT_IMAGES_BUCKET = "project-images";
const CATEGORY = "income_generating";

const STATUS_LABELS = {
    ongoing: { text: "Active", className: "status received" },
    completed: { text: "Closed", className: "status approved" }
};

const incomeForm = document.getElementById("incomeForm");
const incomeGrid = document.getElementById("incomeGrid");
const incomeImageInput = document.getElementById("incomeImageInput");
const incomeImagePreview = document.getElementById("incomeImagePreview");
const incomeImagePreviewImg = document.getElementById("incomeImagePreviewImg");
const incomeImageRemoveBtn = document.getElementById("incomeImageRemoveBtn");
const incomeSubmitBtn = document.getElementById("incomeSubmitBtn");

let viewerProfile = null;
let selectedImageBlob = null;

if(incomeImageInput){
    lingkodWireSquareImageInput({
        fileInput: incomeImageInput,
        previewWrap: incomeImagePreview,
        previewImg: incomeImagePreviewImg,
        removeBtn: incomeImageRemoveBtn,
        onReady: function(blob){ selectedImageBlob = blob; },
        onClear: function(){ selectedImageBlob = null; }
    });
}

function clearImageSelection(){
    selectedImageBlob = null;
    if(incomeImageInput) incomeImageInput.value = "";
    if(incomeImagePreview) incomeImagePreview.hidden = true;
    if(incomeImagePreviewImg) incomeImagePreviewImg.src = "";
}

const WHO_CAN_AVAIL_OPTIONS = ["Students", "Faculty", "Alumni", "Public", "Everyone"];

function formatPrice(value){
    const num = Number(value) || 0;
    return num.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/* ================= PERMISSIONS ================= */

// Shared with ongoing-projects/upcoming-activities/implemented-
// activities's identical check - see lingkodCanManageOrgNamedRow in
// js/common.js.
function canManageRow(row){
    return lingkodCanManageOrgNamedRow(viewerProfile, row.organization);
}

// See ongoing-projects/script.js for why this exists: an org_president can
// only write rows for their own organization (owns_org() RLS policy). The
// dropdown still submits the organization's plain NAME, same as the free-
// text input it replaced - see lingkodPopulateOrganizationSelect.
async function setupOrgLock(){
    if(!incomeForm) return;

    viewerProfile = await lingkodGetAuthedProfile();
    if(!viewerProfile) return;

    const orgSelect = incomeForm.elements.organization;
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

    const statusInfo = STATUS_LABELS[row.status] || STATUS_LABELS.ongoing;

    if(row.image_url){
        const img = document.createElement("img");
        img.className = "item-card-cover";
        img.src = row.image_url;
        img.alt = row.title + " cover image";
        card.appendChild(img);
    } else {
        const placeholder = document.createElement("div");
        placeholder.className = "item-card-cover-placeholder";
        placeholder.innerHTML = "<i class=\"fa-solid fa-sack-dollar\"></i>";
        card.appendChild(placeholder);
    }

    const bodyEl = document.createElement("div");
    bodyEl.className = "item-card-body";

    const header = document.createElement("div");
    header.className = "item-card-header";
    const h3 = document.createElement("h3");
    h3.textContent = row.title;
    const status = document.createElement("span");
    status.className = statusInfo.className;
    status.textContent = statusInfo.text;
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

    const price = document.createElement("div");
    price.className = "item-amount";
    const priceIcon = document.createElement("i");
    priceIcon.className = "fa-solid fa-sack-dollar";
    price.appendChild(priceIcon);
    price.appendChild(document.createTextNode(" ₱" + formatPrice(row.price)));

    const avail = document.createElement("div");
    avail.className = "item-avail";
    const availIcon = document.createElement("i");
    availIcon.className = "fa-solid fa-user-group";
    avail.appendChild(availIcon);
    avail.appendChild(document.createTextNode(" " + (row.who_can_avail && row.who_can_avail.length ? "Who Can Avail: " + row.who_can_avail.join(", ") : "Who Can Avail: Not set")));

    bodyEl.appendChild(header);
    bodyEl.appendChild(p);
    bodyEl.appendChild(org);
    bodyEl.appendChild(price);
    bodyEl.appendChild(avail);

    card.appendChild(bodyEl);

    if(canManageRow(row)){
        card.appendChild(lingkodBuildCardMenuButton([
            { label: "Edit Activity", icon: "fa-pen", onClick: function(){ openEditModal(row); } },
            { label: "Delete Activity", icon: "fa-trash", onClick: function(){ deleteProject(row); }, destructive: true }
        ]));
    }

    return card;
}

async function loadIncomeProjects(){
    if(!incomeGrid) return;

    const { data, error } = await supabaseClient
        .from("projects_activities")
        .select("id, title, description, organization, price, who_can_avail, status, image_url, created_at")
        .eq("category", CATEGORY)
        .order("created_at", { ascending: false });

    incomeGrid.innerHTML = "";

    if(error){
        console.error("[income-projects] load failed:", error);
        const p = document.createElement("p");
        p.textContent = "Couldn't load projects (" + error.message + ").";
        incomeGrid.appendChild(p);
        return;
    }

    if(data.length === 0){
        const p = document.createElement("p");
        p.textContent = "No income-generating projects available.";
        incomeGrid.appendChild(p);
        return;
    }

    data.forEach(function(row){
        incomeGrid.appendChild(buildCard(row));
    });
}

/* ================= CREATE ================= */

if(incomeForm){
    setupOrgLock();

    incomeForm.addEventListener("submit", async function(e){
        e.preventDefault();

        const title = incomeForm.elements.title.value.trim();
        const organization = incomeForm.elements.organization.value.trim();
        const price = Number(incomeForm.elements.price.value);
        const whoCanAvail = Array.from(incomeForm.querySelectorAll("input[name=\"who_can_avail\"]:checked")).map(function(cb){ return cb.value; });
        const description = incomeForm.elements.description.value.trim();

        if(!organization){
            lingkodToast("Please select an organization.", "error");
            return;
        }

        if(!incomeForm.elements.price.value || !Number.isFinite(price) || price <= 0){
            lingkodToast("Please enter a valid price greater than zero.", "error");
            return;
        }

        if(whoCanAvail.length === 0){
            lingkodToast("Please select at least one group under Who Can Avail.", "error");
            return;
        }

        if(!viewerProfile){
            lingkodToast("Please log in with a registered account to add a project.", "error");
            return;
        }

        lingkodSetButtonLoading(incomeSubmitBtn, true, "Adding...");

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
                    status: "ongoing",
                    price: price,
                    who_can_avail: whoCanAvail,
                    image_url: imageUrl,
                    created_by: viewerProfile.id
                });

            if(error){
                if(imageUrl) lingkodDeletePublicImage(PROJECT_IMAGES_BUCKET, imageUrl);
                console.error("[income-projects] create failed:", error);
                lingkodToast("Couldn't add this project: " + error.message, "error");
                return;
            }

            lingkodToast("Project added successfully.", "success");
            incomeForm.reset();
            clearImageSelection();
            await setupOrgLock();
            await loadIncomeProjects();
        } catch(err){
            console.error("[income-projects] image upload failed:", err);
            lingkodToast("Couldn't upload the cover image: " + err.message, "error");
        } finally {
            lingkodSetButtonLoading(incomeSubmitBtn, false);
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

    const priceInput = document.createElement("input");
    priceInput.type = "number";
    priceInput.min = "0.01";
    priceInput.step = "0.01";
    priceInput.value = row.price != null ? String(row.price) : "";
    form.appendChild(lingkodBuildFormField("Price", priceInput));

    const availField = document.createElement("div");
    availField.className = "checkbox-group";
    const availLabel = document.createElement("label");
    availLabel.className = "field-label";
    availLabel.textContent = "Who Can Avail";
    availField.appendChild(availLabel);
    const availOptions = document.createElement("div");
    availOptions.className = "checkbox-options";
    const rowAvail = row.who_can_avail || [];
    const availCheckboxes = WHO_CAN_AVAIL_OPTIONS.map(function(option){
        const optionLabel = document.createElement("label");
        const checkbox = document.createElement("input");
        checkbox.type = "checkbox";
        checkbox.value = option;
        checkbox.checked = rowAvail.includes(option);
        optionLabel.appendChild(checkbox);
        optionLabel.appendChild(document.createTextNode(" " + option));
        availOptions.appendChild(optionLabel);
        return checkbox;
    });
    availField.appendChild(availOptions);
    form.appendChild(availField);

    const statusSelect = document.createElement("select");
    ["ongoing", "completed"].forEach(function(value){
        const opt = document.createElement("option");
        opt.value = value;
        opt.textContent = STATUS_LABELS[value].text;
        if(row.status === value) opt.selected = true;
        statusSelect.appendChild(opt);
    });
    form.appendChild(lingkodBuildFormField("Status", statusSelect));

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

        const newPrice = Number(priceInput.value);
        if(!priceInput.value || !Number.isFinite(newPrice) || newPrice <= 0){
            lingkodToast("Please enter a valid price greater than zero.", "error");
            return;
        }

        const newWhoCanAvail = availCheckboxes.filter(function(cb){ return cb.checked; }).map(function(cb){ return cb.value; });
        if(newWhoCanAvail.length === 0){
            lingkodToast("Please select at least one group under Who Can Avail.", "error");
            return;
        }

        lingkodSetButtonLoading(saveBtn, true, "Saving...");

        try {
            const patch = {
                title: newTitle,
                description: descriptionInput.value.trim() || null,
                price: newPrice,
                who_can_avail: newWhoCanAvail,
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
                console.error("[income-projects] update failed:", error);
                lingkodToast("Couldn't update this project: " + error.message, "error");
                return;
            }

            if((coverImage.state.newBlob || coverImage.state.removeExisting) && row.image_url){
                lingkodDeletePublicImage(PROJECT_IMAGES_BUCKET, row.image_url);
            }

            lingkodCloseModal();
            lingkodToast("Project updated successfully.", "success");
            await loadIncomeProjects();
        } catch(err){
            console.error("[income-projects] image upload failed:", err);
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
                console.error("[income-projects] delete failed:", error);
                lingkodToast("Couldn't delete this project: " + error.message, "error");
                throw error;
            }

            if(row.image_url) lingkodDeletePublicImage(PROJECT_IMAGES_BUCKET, row.image_url);

            lingkodToast("Project deleted successfully.", "success");
            await loadIncomeProjects();
        }
    });
}

document.addEventListener("DOMContentLoaded", loadIncomeProjects);

supabaseClient
    .channel("income_projects_page_changes")
    .on("postgres_changes", { event: "*", schema: "public", table: "projects_activities" }, function(payload){
        const row = payload.new && Object.keys(payload.new).length ? payload.new : payload.old;
        if(row && row.category && row.category !== CATEGORY) return;
        loadIncomeProjects();
    })
    .subscribe();
