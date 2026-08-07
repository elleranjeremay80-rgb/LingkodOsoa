const repositorySearch = document.getElementById("repositorySearch");

// Re-queried on every keystroke rather than captured once at load: rows
// are now fetched from Supabase after the page loads, so a NodeList
// snapshotted up front would always be empty.
repositorySearch.addEventListener("input", function(){

    const query = repositorySearch.value.trim().toLowerCase();
    const rows = document.querySelectorAll("#repositoryTableBody tr:not(.empty-row)");

    rows.forEach(function(row){
        const matches = row.textContent.toLowerCase().includes(query);
        row.style.display = matches ? "" : "none";
    });

});

const REPOSITORY_BUCKET = "public-files";

const repositoryTableBody = document.getElementById("repositoryTableBody");

const RECIPIENT_TYPE_LABELS = {
    public: "Public",
    osoa_eb: "OSOA EB",
    org_presidents: "Organization Presidents",
    specific_organization: "Specific Organization",
    specific_organization_members: "Specific Organization Members",
    multiple_organizations: "Multiple Organizations"
};

/* ================= RECIPIENT FIELD (upload form) ================= */
// A student can never reach this form (data-roles="admin staff" on the
// whole .manage-box), but org_president's own authority is still
// narrower than osoa_eb's - they may only address their own org, or the
// two org-agnostic kinds (Public/OSOA EB), matching what the RLS insert
// policy actually allows (20260801000000_repository_recipient_visibility.sql).
// This is cosmetic-only convenience (hiding options they'd be rejected
// for anyway) - RLS is the real enforcement either way.

const repoRecipientSelect = document.getElementById("repoRecipientSelect");
const repoRecipientOrgWrap = document.getElementById("repoRecipientOrgWrap");
const repoRecipientOrgSelect = document.getElementById("repoRecipientOrgSelect");
const repoRecipientOrgsWrap = document.getElementById("repoRecipientOrgsWrap");
const repoRecipientOrgsCheckboxes = document.getElementById("repoRecipientOrgsCheckboxes");

function updateRecipientFieldVisibility(select, orgWrap, orgsWrap){
    const value = select.value;
    orgWrap.classList.toggle("visible", value === "specific_organization" || value === "specific_organization_members");
    orgsWrap.classList.toggle("visible", value === "multiple_organizations");
}

if(repoRecipientSelect){
    repoRecipientSelect.addEventListener("change", function(){
        updateRecipientFieldVisibility(repoRecipientSelect, repoRecipientOrgWrap, repoRecipientOrgsWrap);
    });

    lingkodPopulateOrganizationSelectById(repoRecipientOrgSelect, null);
    lingkodPopulateOrganizationCheckboxes(repoRecipientOrgsCheckboxes, []);

    lingkodGetAuthedProfile().then(function(profile){
        if(!profile || profile.role !== "org_president") return;

        ["org_presidents", "multiple_organizations"].forEach(function(value){
            const opt = repoRecipientSelect.querySelector("option[value=\"" + value + "\"]");
            if(opt) opt.remove();
        });

        // Lock the org select to their own org once the list finishes
        // loading, rather than racing it.
        lingkodPopulateOrganizationSelectById(repoRecipientOrgSelect, profile.organization_id).then(function(){
            if(profile.organization_id) repoRecipientOrgSelect.value = profile.organization_id;
            repoRecipientOrgSelect.disabled = !!profile.organization_id;
        });
    });
}

const REPOSITORY_CATEGORY_LABELS = {
    renewal: "Renewal",
    financial_report: "Financial Report",
    policy: "Policy",
    memorandum: "Memorandum",
    organization_records: "Organization Records",
    proposal: "Proposal",
    other: "Other"
};

// KB/MB/GB only (no bytes) per the dashboard's own spec; 0 always reads
// as "0 MB" rather than "0 KB" to match its documented empty state.
function formatStorageSize(bytes){
    if(!bytes || bytes <= 0) return "0 MB";

    const units = ["KB", "MB", "GB"];
    let value = bytes / 1024;
    let unitIndex = 0;

    while(value >= 1024 && unitIndex < units.length - 1){
        value /= 1024;
        unitIndex++;
    }

    return value.toFixed(value < 10 ? 2 : 1) + " " + units[unitIndex];
}

// Supabase's public Storage URL embeds the bucket + path
// (".../object/public/<bucket>/<path>") - parsed back out so a delete can
// remove the underlying object, not just the metadata row.
function extractStoragePath(fileUrl, bucket){
    if(!fileUrl) return null;
    const marker = "/object/public/" + bucket + "/";
    const idx = fileUrl.indexOf(marker);
    if(idx === -1) return null;
    return decodeURIComponent(fileUrl.slice(idx + marker.length));
}

async function computeAndRenderStats(){
    const totalEl = document.getElementById("statTotalFiles");
    const policiesEl = document.getElementById("statPolicies");
    const orgRecordsEl = document.getElementById("statOrgRecords");
    const storageEl = document.getElementById("statStorageUsed");

    const { data, error } = await supabaseClient
        .from("repository_files")
        .select("category, file_size");

    if(error){
        console.error("[repository] stats load failed:", error);
        totalEl.textContent = "0";
        policiesEl.textContent = "0";
        orgRecordsEl.textContent = "0";
        storageEl.textContent = "0 MB";
        return;
    }

    const policiesCount = data.filter(function(row){
        return row.category === "policy" || row.category === "memorandum";
    }).length;
    const orgRecordsCount = data.filter(function(row){
        return row.category === "organization_records";
    }).length;
    const totalBytes = data.reduce(function(sum, row){
        return sum + (row.file_size || 0);
    }, 0);

    totalEl.textContent = String(data.length);
    policiesEl.textContent = String(policiesCount);
    orgRecordsEl.textContent = String(orgRecordsCount);
    storageEl.textContent = formatStorageSize(totalBytes);
}

const repoUploadForm = document.getElementById("repoUploadForm");
if(repoUploadForm){
    const uploadButton = repoUploadForm.querySelector("button[type=\"submit\"]");

    repoUploadForm.addEventListener("submit", async function(e){
        e.preventDefault();

        const title = repoUploadForm.elements.title.value.trim();
        const category = repoUploadForm.elements.category.value;
        const file = repoUploadForm.elements.file.files[0];
        const recipientType = repoRecipientSelect ? repoRecipientSelect.value : "";

        if(!category){
            lingkodToast("Please select a category.", "error");
            return;
        }
        if(!recipientType){
            lingkodToast("Please select who this document is for.", "error");
            return;
        }
        if((recipientType === "specific_organization" || recipientType === "specific_organization_members") && !repoRecipientOrgSelect.value){
            lingkodToast("Please select an organization.", "error");
            return;
        }
        const selectedOrgIds = recipientType === "multiple_organizations"
            ? Array.from(repoRecipientOrgsCheckboxes.querySelectorAll("input:checked")).map(function(cb){ return cb.value; })
            : [];
        if(recipientType === "multiple_organizations" && selectedOrgIds.length === 0){
            lingkodToast("Please select at least one organization.", "error");
            return;
        }
        if(!file){
            lingkodToast("Please choose a file to upload.", "error");
            return;
        }

        const profile = await lingkodGetAuthedProfile();
        if(!profile){
            lingkodToast("Please log in with a registered account to upload documents.", "error");
            return;
        }

        lingkodSetButtonLoading(uploadButton, true, "Uploading...");

        try {
            const storagePath = "repository/" + crypto.randomUUID() + "-" + sanitizeRepoFileName(file.name);

            const { error: uploadError } = await supabaseClient
                .storage
                .from(REPOSITORY_BUCKET)
                .upload(storagePath, file);

            if(uploadError){
                console.error("[repository] file upload failed:", uploadError);
                lingkodToast("File upload failed: " + uploadError.message, "error");
                return;
            }

            const { data: urlData } = supabaseClient.storage.from(REPOSITORY_BUCKET).getPublicUrl(storagePath);

            const { error: insertError } = await supabaseClient
                .from("repository_files")
                .insert({
                    title: title || file.name,
                    category: category,
                    organization: profile.organization,
                    is_public: true,
                    recipient_type: recipientType,
                    recipient_organization_id: (recipientType === "specific_organization" || recipientType === "specific_organization_members") ? repoRecipientOrgSelect.value : null,
                    recipient_organization_ids: recipientType === "multiple_organizations" ? selectedOrgIds : null,
                    file_name: file.name,
                    file_path: storagePath,
                    file_url: urlData.publicUrl,
                    file_size: file.size,
                    file_type: file.type,
                    uploaded_by: profile.id
                });

            if(insertError){
                console.error("[repository] metadata insert failed:", insertError);
                lingkodToast("The file was uploaded, but saving its details failed: " + insertError.message, "error");
                return;
            }

            lingkodToast("Document uploaded successfully.", "success");
            repoUploadForm.reset();
            updateRecipientFieldVisibility(repoRecipientSelect, repoRecipientOrgWrap, repoRecipientOrgsWrap);
            // The realtime subscription below will also pick this up, but
            // refreshing directly means the uploader's own view updates
            // immediately rather than waiting on the round trip.
            await loadRepository();
            await computeAndRenderStats();
        } finally {
            lingkodSetButtonLoading(uploadButton, false);
        }
    });
}

// Mirrors submission/script.js's sanitizeFileName - strips anything that
// isn't safe in a Storage object key.
function sanitizeRepoFileName(name){
    return name.replace(/[^a-zA-Z0-9.\-_]/g, "_");
}

/* ================= EDIT ================= */

async function openEditRepositoryModal(row){
    const form = document.createElement("form");
    form.className = "edit-profile-form";

    const titleInput = document.createElement("input");
    titleInput.type = "text";
    titleInput.value = row.title;
    form.appendChild(lingkodBuildFormField("Document Title", titleInput));

    const categorySelect = document.createElement("select");
    Object.keys(REPOSITORY_CATEGORY_LABELS).forEach(function(value){
        const opt = document.createElement("option");
        opt.value = value;
        opt.textContent = REPOSITORY_CATEGORY_LABELS[value];
        if(row.category === value) opt.selected = true;
        categorySelect.appendChild(opt);
    });
    form.appendChild(lingkodBuildFormField("Category", categorySelect));

    const recipientSelect = document.createElement("select");
    Object.keys(RECIPIENT_TYPE_LABELS).forEach(function(value){
        const opt = document.createElement("option");
        opt.value = value;
        opt.textContent = RECIPIENT_TYPE_LABELS[value];
        if(row.recipient_type === value) opt.selected = true;
        recipientSelect.appendChild(opt);
    });
    form.appendChild(lingkodBuildFormField("Recipient", recipientSelect));

    const orgWrap = document.createElement("div");
    orgWrap.className = "specify-field";
    const orgSelect = document.createElement("select");
    orgWrap.appendChild(lingkodBuildFormField("Select Organization", orgSelect));
    form.appendChild(orgWrap);

    const orgsWrap = document.createElement("div");
    orgsWrap.className = "specify-field";
    const orgsCheckboxes = document.createElement("div");
    orgsCheckboxes.className = "checkbox-group";
    orgsWrap.appendChild(lingkodBuildFormField("Select Organizations", orgsCheckboxes));
    form.appendChild(orgsWrap);

    await Promise.all([
        lingkodPopulateOrganizationSelectById(orgSelect, row.recipient_organization_id),
        lingkodPopulateOrganizationCheckboxes(orgsCheckboxes, row.recipient_organization_ids || [])
    ]);
    updateRecipientFieldVisibility(recipientSelect, orgWrap, orgsWrap);
    recipientSelect.addEventListener("change", function(){
        updateRecipientFieldVisibility(recipientSelect, orgWrap, orgsWrap);
    });

    const fileField = lingkodBuildFormField("Replace File (optional)", (function(){
        const input = document.createElement("input");
        input.type = "file";
        return input;
    })());
    const fileInput = fileField.querySelector("input[type=\"file\"]");
    const currentFileNote = document.createElement("small");
    currentFileNote.className = "feedback-reply-note";
    currentFileNote.textContent = "Current file: " + (row.file_name || "—") + ". Leave blank to keep it.";
    fileField.appendChild(currentFileNote);
    form.appendChild(fileField);

    const saveBtn = document.createElement("button");
    saveBtn.type = "submit";
    saveBtn.textContent = "Save Changes";
    form.appendChild(saveBtn);

    form.addEventListener("submit", async function(e){
        e.preventDefault();

        const newTitle = titleInput.value.trim();
        if(!newTitle){
            lingkodToast("Document title is required.", "error");
            return;
        }

        const recipientType = recipientSelect.value;
        if((recipientType === "specific_organization" || recipientType === "specific_organization_members") && !orgSelect.value){
            lingkodToast("Please select an organization.", "error");
            return;
        }
        const selectedOrgIds = recipientType === "multiple_organizations"
            ? Array.from(orgsCheckboxes.querySelectorAll("input:checked")).map(function(cb){ return cb.value; })
            : [];
        if(recipientType === "multiple_organizations" && selectedOrgIds.length === 0){
            lingkodToast("Please select at least one organization.", "error");
            return;
        }

        lingkodSetButtonLoading(saveBtn, true, "Saving...");

        const patch = {
            title: newTitle,
            category: categorySelect.value,
            recipient_type: recipientType,
            recipient_organization_id: (recipientType === "specific_organization" || recipientType === "specific_organization_members") ? orgSelect.value : null,
            recipient_organization_ids: recipientType === "multiple_organizations" ? selectedOrgIds : null
        };

        const newFile = fileInput.files[0];
        let uploadedPath = null;

        try {
            if(newFile){
                uploadedPath = "repository/" + crypto.randomUUID() + "-" + sanitizeRepoFileName(newFile.name);

                const { error: uploadError } = await supabaseClient
                    .storage
                    .from(REPOSITORY_BUCKET)
                    .upload(uploadedPath, newFile);

                if(uploadError){
                    console.error("[repository] replacement file upload failed:", uploadError);
                    lingkodToast("File upload failed: " + uploadError.message, "error");
                    return;
                }

                const { data: urlData } = supabaseClient.storage.from(REPOSITORY_BUCKET).getPublicUrl(uploadedPath);
                patch.file_name = newFile.name;
                patch.file_path = uploadedPath;
                patch.file_url = urlData.publicUrl;
                patch.file_size = newFile.size;
                patch.file_type = newFile.type;
            }

            const { error } = await supabaseClient
                .from("repository_files")
                .update(patch)
                .eq("id", row.id);

            if(error){
                console.error("[repository] update failed:", error);
                lingkodToast("Couldn't update this document: " + error.message, "error");
                // The DB row wasn't updated - clean up the newly-uploaded
                // replacement so it doesn't linger as an orphaned object.
                if(uploadedPath){
                    supabaseClient.storage.from(REPOSITORY_BUCKET).remove([uploadedPath]).catch(function(){});
                }
                return;
            }

            // Old file only deleted after the row update succeeds and now
            // points at the new one - same ordering as delete's own
            // "DB first, Storage cleanup second" rule.
            if(newFile){
                const oldPath = row.file_path || extractStoragePath(row.file_url, REPOSITORY_BUCKET);
                if(oldPath){
                    supabaseClient.storage.from(REPOSITORY_BUCKET).remove([oldPath]).catch(function(err){
                        console.error("[repository] old file cleanup failed:", err);
                    });
                }
            }

            lingkodCloseModal();
            lingkodToast("Document updated successfully.", "success");
            await loadRepository();
            // Category may have just changed, and the summary cards' Policies/
            // Organization Records counts are category-based - keep them in
            // sync rather than only refreshing on upload/delete.
            await computeAndRenderStats();
        } finally {
            lingkodSetButtonLoading(saveBtn, false);
        }
    });

    lingkodOpenModal("Edit Document", form);
}

/* ================= DELETE ================= */

function deleteRepositoryFile(row){
    lingkodConfirmDelete({
        title: "Delete Document?",
        message: "Are you sure you want to remove \"" + row.title + "\" from the repository? This action cannot be undone.",
        onConfirm: async function(){
            const { error: dbError } = await supabaseClient.from("repository_files").delete().eq("id", row.id);
            if(dbError){
                console.error("[repository] delete failed:", dbError);
                lingkodToast("Couldn't delete this document: " + dbError.message, "error");
                throw dbError;
            }

            // Storage cleanup only after the row delete succeeds - matches
            // documents/script.js's deleteDocument, so a failed row delete
            // never leaves an orphaned "row still references a deleted
            // file" state; a leftover Storage object is the safer failure
            // mode of the two.
            const path = row.file_path || extractStoragePath(row.file_url, REPOSITORY_BUCKET);
            if(path){
                const { error: storageError } = await supabaseClient.storage.from(REPOSITORY_BUCKET).remove([path]);
                if(storageError) console.error("[repository] storage object delete failed:", storageError);
            }

            lingkodToast("Document deleted successfully.", "success");
            await loadRepository();
            await computeAndRenderStats();
        }
    });
}

// repository_files.uploaded_by is a bare uuid (no FK to profiles), so
// PostgREST can't auto-embed the uploader's name in one query - fetched
// separately here and joined client-side.
async function fetchUploaderNames(userIds){
    const uniqueIds = [...new Set(userIds.filter(Boolean))];
    if(uniqueIds.length === 0) return {};

    const { data, error } = await supabaseClient
        .from("profiles")
        .select("id, full_name")
        .in("id", uniqueIds);

    if(error){
        console.error("[repository] uploader lookup failed:", error);
        return {};
    }

    const byId = {};
    data.forEach(function(profile){
        byId[profile.id] = profile.full_name;
    });
    return byId;
}

// Preview and Download now use the same shared implementation as
// Submission & Tracking (see js/common.js) - repository_files rows carry
// a plain public file_url rather than a signed file_path, which those
// helpers already know how to use as-is (no signing needed for an
// already-public Storage object).

function buildPreviewCell(row){
    const td = document.createElement("td");
    if(!row.file_url){
        td.textContent = "—";
        return td;
    }

    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "file-action-btn";
    btn.innerHTML = "<i class=\"fa-solid fa-eye\"></i> Preview";
    btn.addEventListener("click", function(){
        lingkodOpenSimpleFilePreview(Object.assign({ document_title: row.title }, row));
    });
    td.appendChild(btn);
    return td;
}

function buildDownloadCell(row){
    const td = document.createElement("td");
    if(!row.file_url){
        td.textContent = "—";
        return td;
    }

    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "file-action-btn";
    btn.innerHTML = "<i class=\"fa-solid fa-download\"></i> Download";
    btn.addEventListener("click", function(){ lingkodDownloadFile(row, btn); });
    td.appendChild(btn);
    return td;
}

function buildAdminActionsCell(row){
    const td = document.createElement("td");
    td.className = "action";

    // Rows are inserted after common.js's one-time data-role-view pass
    // already ran, so that pass never sees this markup - the session's
    // role is checked directly here instead of relying on it.
    const session = lingkodGetSession();
    if(!session || (session.role !== "admin" && session.role !== "staff")){
        td.textContent = "—";
        return td;
    }

    const adminActions = document.createElement("span");
    adminActions.className = "admin-actions";

    const edit = document.createElement("a");
    edit.className = "edit";
    edit.href = "#";
    edit.textContent = "Edit";
    edit.addEventListener("click", function(e){
        e.preventDefault();
        openEditRepositoryModal(row);
    });

    const del = document.createElement("a");
    del.className = "delete";
    del.href = "#";
    del.textContent = "Delete";
    del.addEventListener("click", function(e){
        e.preventDefault();
        deleteRepositoryFile(row);
    });

    adminActions.appendChild(edit);
    adminActions.appendChild(del);
    td.appendChild(adminActions);
    return td;
}

function renderRepository(rows, uploaderNames){
    repositoryTableBody.innerHTML = "";

    if(rows.length === 0){
        repositoryTableBody.appendChild(lingkodCreateEmptyRow("No repository documents available.", 8));
        return;
    }

    rows.forEach(function(row){
        const tr = document.createElement("tr");
        tr.appendChild(lingkodCreateCell(row.title || "—"));
        tr.appendChild(lingkodCreateCell(row.file_name));
        tr.appendChild(lingkodCreateCell(REPOSITORY_CATEGORY_LABELS[row.category] || row.category));
        tr.appendChild(lingkodCreateCell(uploaderNames[row.uploaded_by] || "—"));
        tr.appendChild(lingkodCreateCell(lingkodFormatDate(row.created_at)));
        tr.appendChild(buildPreviewCell(row));
        tr.appendChild(buildDownloadCell(row));
        tr.appendChild(buildAdminActionsCell(row));
        repositoryTableBody.appendChild(tr);
    });
}

async function loadRepository(){
    const { data, error } = await supabaseClient
        .from("repository_files")
        .select("id, title, file_name, file_url, file_path, file_type, file_size, category, uploaded_by, created_at, recipient_type, recipient_organization_id, recipient_organization_ids")
        .order("created_at", { ascending: false });

    repositoryTableBody.innerHTML = "";

    if(error){
        console.error("[repository] load failed:", error);
        repositoryTableBody.appendChild(lingkodCreateEmptyRow("Couldn't load the repository (" + error.message + ").", 8));
        return;
    }

    const uploaderNames = await fetchUploaderNames(data.map(function(row){ return row.uploaded_by; }));
    renderRepository(data, uploaderNames);
}

document.addEventListener("DOMContentLoaded", function(){
    loadRepository();
    computeAndRenderStats();
});

// Live updates: any insert/update/delete on repository_files - from this
// tab, another tab, or another user entirely - refreshes the table and
// stats without a page reload. RLS still applies to what postgres_changes
// delivers, same as any other query.
supabaseClient
    .channel("repository_files_changes")
    .on("postgres_changes", { event: "*", schema: "public", table: "repository_files" }, function(){
        loadRepository();
        computeAndRenderStats();
    })
    .subscribe();
