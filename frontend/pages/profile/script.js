function setProfileText(id, value){
    const el = document.getElementById(id);
    if(el) el.textContent = value;
}

const PROFILE_STATUS_LABELS = {
    active: "Active",
    inactive: "Inactive"
};

// This is a single-campus platform - there's no "campus" column anywhere
// in the schema, so this is a fact rather than a placeholder.
const PROFILE_CAMPUS = "BulSU - Meneses Campus";
const PROFILE_NOT_SET = "Not set";
const PROFILE_DEMO_ONLY = "Not available for demo accounts";

const NAME_RULE = /^[A-Za-z' -]+$/;
// Middle Name additionally allows periods and commas (e.g. middle
// initials like "D.", or suffix-style entries) - Last Name/First Name
// stay on the stricter NAME_RULE.
const MIDDLE_NAME_RULE = /^[A-Za-z' .,-]+$/;
const USERNAME_RULE = /^[A-Za-z0-9_.]{4,30}$/;
const USERNAME_MESSAGE = "Username must be 4-30 characters and may only contain letters, numbers, underscores, and periods.";
const CONTACT_NUMBER_RULE = /^(09\d{9}|\+639\d{9})$/;
const CONTACT_NUMBER_MESSAGE = "Enter a valid PH mobile number (e.g. 09123456789 or +639123456789).";
const PASSWORD_RULE = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z0-9]).{8,}$/;
const PASSWORD_MESSAGE = "Password must be at least 8 characters and include an uppercase letter, a lowercase letter, a number, and a special character.";

// Resolved once at load (see loadProfileInfo) - reused by the Edit
// Profile / Change Password modals so they don't need their own fetch,
// and so "Save" knows which row to update.
let currentProfile = null;
let currentUserId = null;

/* ================= DISPLAY ================= */

// Demo accounts (js/auth.js's LINGKOD_ACCOUNTS) have no real Supabase
// session, so most of this page's fields have nothing to load - shown as
// "Not available for demo accounts" instead of leaving stale placeholder
// text or throwing on a failed query.
function renderDemoProfile(session){
    const avatarContainer = document.getElementById("profileAvatarContainer");
    if(avatarContainer){
        avatarContainer.innerHTML = "";
        avatarContainer.appendChild(lingkodBuildAvatarElement({ full_name: session.name }, "profile-avatar-inner"));
    }

    setProfileText("profileCardName", session.name);
    setProfileText("profileCardPosition", session.title);
    setProfileText("profileCardBadge", "Demo Account");

    setProfileText("profileStudentNumber", session.studentNumber);
    setProfileText("profileFullName", session.name);
    setProfileText("profileEmail", PROFILE_DEMO_ONLY);
    setProfileText("profileContact", PROFILE_NOT_SET);
    setProfileText("profileCampus", PROFILE_CAMPUS);
    setProfileText("profileCollege", PROFILE_DEMO_ONLY);
    setProfileText("profileOrganization", PROFILE_DEMO_ONLY);
    setProfileText("profilePosition", session.title);
    setProfileText("profileUsername", PROFILE_NOT_SET);
    setProfileText("profileAccountType", session.title);
    setProfileText("profileDateRegistered", PROFILE_DEMO_ONLY);
    setProfileText("profileAccountStatus", "Active (Demo)");
}

// select("*") rather than an explicit column list: this page wants every
// display field the live `profiles` table happens to have, and RLS
// ("Users can read their own profile") already scopes this to exactly the
// signed-in user's row regardless of which columns come back.
function renderRealProfile(profile){
    const uiRole = LINGKOD_DB_ROLE_TO_UI_ROLE[profile.role] || profile.role;
    const roleLabel = LINGKOD_ROLE_LABELS[uiRole] || profile.role;

    const avatarContainer = document.getElementById("profileAvatarContainer");
    if(avatarContainer){
        avatarContainer.innerHTML = "";
        avatarContainer.appendChild(lingkodBuildAvatarElement(profile, "profile-avatar-inner"));
    }

    setProfileText("profileCardName", profile.full_name);
    setProfileText("profileCardPosition", profile.position || roleLabel);
    setProfileText("profileCardBadge", (PROFILE_STATUS_LABELS[profile.status] || "Active") + " Account");

    setProfileText("profileStudentNumber", profile.student_number || PROFILE_NOT_SET);
    setProfileText("profileFullName", profile.full_name);
    setProfileText("profileEmail", profile.email || PROFILE_NOT_SET);
    setProfileText("profileContact", profile.contact_number || PROFILE_NOT_SET);
    setProfileText("profileCampus", PROFILE_CAMPUS);
    setProfileText("profileCollege", profile.department || PROFILE_NOT_SET);
    setProfileText("profileOrganization", profile.organization || PROFILE_NOT_SET);
    setProfileText("profilePosition", profile.position || PROFILE_NOT_SET);
    setProfileText("profileUsername", profile.username || PROFILE_NOT_SET);
    setProfileText("profileAccountType", roleLabel);
    setProfileText("profileDateRegistered", profile.created_at ? lingkodFormatDate(profile.created_at) : PROFILE_NOT_SET);
    setProfileText("profileAccountStatus", PROFILE_STATUS_LABELS[profile.status] || "Active");
}

async function loadProfileInfo(){
    const session = lingkodGetSession();
    if(!session) return;

    const { data: userData } = await supabaseClient.auth.getUser();
    if(!userData || !userData.user){
        currentProfile = null;
        currentUserId = null;
        renderDemoProfile(session);
        return;
    }

    const { data: profile, error } = await supabaseClient
        .from("profiles")
        .select("*")
        .eq("id", userData.user.id)
        .single();

    if(error || !profile){
        console.error("[profile] load failed:", error);
        lingkodToast("Couldn't load your profile details.", "error");
        currentProfile = null;
        currentUserId = null;
        renderDemoProfile(session);
        return;
    }

    currentProfile = profile;
    currentUserId = userData.user.id;
    renderRealProfile(profile);
}

/* ================= EDIT PROFILE ================= */

function showFieldError(input, errorEl, message){
    input.classList.add("invalid");
    if(errorEl){
        errorEl.textContent = message;
        errorEl.classList.add("visible");
    }
}

function clearFieldError(input, errorEl){
    input.classList.remove("invalid");
    if(errorEl){
        errorEl.textContent = "";
        errorEl.classList.remove("visible");
    }
}

function validateNameInput(input, errorId, label){
    const errorEl = document.getElementById(errorId);
    const value = input.value.trim();
    if(!value || !NAME_RULE.test(value)){
        showFieldError(input, errorEl, label + " may only contain letters, spaces, apostrophes, and hyphens.");
        return false;
    }
    clearFieldError(input, errorEl);
    return true;
}

// Middle Name is genuinely optional (the profiles_middle_name_format
// check constraint explicitly allows an empty string, same as last/first
// name's own constraints do) - unlike Last Name/First Name, which the app
// treats as always required. Validating it with validateNameInput's
// "empty is invalid" rule was stricter than the database itself allows,
// silently blocking Save for any account with no middle name on file
// (not uncommon) - the field-level error this produced sat above the
// visible scroll area often enough that it looked like the button just
// didn't work.
function validateOptionalNameInput(input, errorId, label){
    const errorEl = document.getElementById(errorId);
    const value = input.value.trim();
    if(value && !MIDDLE_NAME_RULE.test(value)){
        showFieldError(input, errorEl, label + " may only contain letters, spaces, apostrophes, hyphens, periods, and commas.");
        return false;
    }
    clearFieldError(input, errorEl);
    return true;
}

function validateUsernameFormat(input, errorId){
    const errorEl = document.getElementById(errorId);
    const value = input.value.trim();
    if(value && !USERNAME_RULE.test(value)){
        showFieldError(input, errorEl, USERNAME_MESSAGE);
        return false;
    }
    clearFieldError(input, errorEl);
    return true;
}

// Live availability check, separate from format validation - only makes a
// request once the format is already valid, and never flags the user's
// own current username as "taken."
async function checkUsernameAvailability(input, errorId){
    const errorEl = document.getElementById(errorId);
    const value = input.value.trim();

    if(!value || !USERNAME_RULE.test(value)) return;
    if(currentProfile && value.toLowerCase() === (currentProfile.username || "").toLowerCase()) return;

    const { data, error } = await supabaseClient
        .from("profiles")
        .select("id")
        .ilike("username", value)
        .neq("id", currentUserId)
        .maybeSingle();

    if(error){
        console.error("[profile] username availability check failed:", error);
        return;
    }

    if(data){
        showFieldError(input, errorEl, "Username already exists. Please choose another username.");
    }
}

function validateContactNumberInput(input, errorId){
    const errorEl = document.getElementById(errorId);
    const value = input.value.trim();
    if(value && !CONTACT_NUMBER_RULE.test(value)){
        showFieldError(input, errorEl, CONTACT_NUMBER_MESSAGE);
        return false;
    }
    clearFieldError(input, errorEl);
    return true;
}

// Real-time validation: shows the error on blur, then keeps it live-
// updated on every keystroke once a field has actually been flagged, so
// it doesn't open with everything already red.
function wireLiveValidation(input, validateFn){
    input.addEventListener("blur", function(){
        input.value = input.value.trim();
        validateFn();
    });
    input.addEventListener("input", function(){
        if(input.classList.contains("invalid")) validateFn();
    });
}

function buildReadOnlyField(labelText, value){
    const input = document.createElement("input");
    input.type = "text";
    input.value = value;
    input.disabled = true;
    return lingkodBuildFormField(labelText, input);
}

async function saveProfileEdits(fields, saveBtn){
    const lastNameValid = validateNameInput(fields.lastName, "editLastNameError", "Last Name");
    const firstNameValid = validateNameInput(fields.firstName, "editFirstNameError", "First Name");
    const middleNameValid = validateOptionalNameInput(fields.middleName, "editMiddleNameError", "Middle Name");
    const usernameValid = validateUsernameFormat(fields.username, "editUsernameError");
    const contactValid = validateContactNumberInput(fields.contactNumber, "editContactNumberError");

    if(!lastNameValid || !firstNameValid || !middleNameValid || !usernameValid || !contactValid){
        // A field-level error above the current scroll position is easy
        // to miss entirely (this is exactly what made Save look like it
        // did nothing) - scroll straight to the first invalid field and
        // say so explicitly, regardless of which field it turns out to be.
        const firstInvalid = [fields.lastName, fields.firstName, fields.middleName, fields.username, fields.contactNumber]
            .find(function(input){ return input.classList.contains("invalid"); });
        if(firstInvalid){
            firstInvalid.scrollIntoView({ behavior: "smooth", block: "center" });
            firstInvalid.focus();
        }
        lingkodToast("Please fix the highlighted field before saving.", "error");
        return;
    }

    const newUsername = fields.username.value.trim();

    // Final, authoritative availability check right before saving - the
    // live one on blur is a convenience, not the source of truth (someone
    // else could have taken it in between), and the database's own unique
    // index is the last line of defense either way (caught below).
    if(newUsername && newUsername.toLowerCase() !== (currentProfile.username || "").toLowerCase()){
        const { data: existing, error: checkError } = await supabaseClient
            .from("profiles")
            .select("id")
            .ilike("username", newUsername)
            .neq("id", currentUserId)
            .maybeSingle();

        if(checkError){
            lingkodToast("Couldn't verify username availability: " + checkError.message, "error");
            return;
        }
        if(existing){
            showFieldError(fields.username, document.getElementById("editUsernameError"), "Username already exists. Please choose another username.");
            return;
        }
    }

    lingkodSetButtonLoading(saveBtn, true, "Saving...");

    // last_name/first_name are required (validated above) and always
    // sent. middle_name/username/contact_number are optional - only
    // included when the field actually has a value, so leaving one
    // blank (whether never filled in, or just not touched this edit)
    // preserves whatever is already saved instead of overwriting it
    // with null/empty string.
    const patch = {
        last_name: fields.lastName.value.trim(),
        first_name: fields.firstName.value.trim()
    };

    const middleNameValue = fields.middleName.value.trim();
    if(middleNameValue) patch.middle_name = middleNameValue;

    if(newUsername) patch.username = newUsername;

    const contactNumberValue = fields.contactNumber.value.trim();
    if(contactNumberValue) patch.contact_number = contactNumberValue;

    try {
        // Photo uploads only at Save, not at crop-confirm time - if
        // anything below fails, nothing partial is left in place: the
        // avatar is uploaded first (fixed path, upsert:true) but
        // profiles.avatar_url is only set together with every other field
        // in the same update.
        if(fields.pendingAvatarBlob){
            patch.avatar_url = await lingkodUploadAvatarImage(currentUserId, fields.pendingAvatarBlob);
        }

        const { error: profileError } = await supabaseClient
            .from("profiles")
            .update(patch)
            .eq("id", currentUserId);

        if(profileError){
            console.error("[profile] update failed:", profileError);
            if(/profiles_username_unique/i.test(profileError.message)){
                showFieldError(fields.username, document.getElementById("editUsernameError"), "Username already exists. Please choose another username.");
            } else if(/profiles_username_format/i.test(profileError.message)){
                showFieldError(fields.username, document.getElementById("editUsernameError"), USERNAME_MESSAGE);
            } else if(/profiles_contact_number_format/i.test(profileError.message)){
                showFieldError(fields.contactNumber, document.getElementById("editContactNumberError"), CONTACT_NUMBER_MESSAGE);
            } else {
                lingkodToast("Failed to update your profile: " + profileError.message, "error");
            }
            return;
        }

        lingkodCloseModal();
        lingkodToast("Profile updated successfully.", "success");
        await loadProfileInfo();
    } catch(err){
        console.error("[profile] avatar upload failed:", err);
        lingkodToast("Couldn't upload your photo: " + err.message, "error");
    } finally {
        lingkodSetButtonLoading(saveBtn, false);
    }
}

function openEditProfileModal(){
    const form = document.createElement("form");
    form.className = "edit-profile-form";

    let pendingAvatarBlob = null;

    /* ---- Photo ---- */

    const photoWrap = document.createElement("div");
    photoWrap.className = "edit-avatar-wrap";
    const avatarPreview = lingkodBuildAvatarElement(currentProfile, "edit-avatar-preview");
    photoWrap.appendChild(avatarPreview);

    const fileInput = document.createElement("input");
    fileInput.type = "file";
    fileInput.accept = ".jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp";
    fileInput.style.display = "none";

    const changePhotoBtn = document.createElement("button");
    changePhotoBtn.type = "button";
    changePhotoBtn.className = "change-photo-btn";
    changePhotoBtn.innerHTML = "<i class=\"fa-solid fa-camera\"></i> Change Photo";
    changePhotoBtn.addEventListener("click", function(){ fileInput.click(); });

    fileInput.addEventListener("change", function(){
        const file = fileInput.files[0];
        fileInput.value = "";
        if(!file) return;

        lingkodOpenAvatarCropper(file, function(blob){
            pendingAvatarBlob = blob;

            const newPreview = document.createElement("div");
            newPreview.className = "edit-avatar-preview";
            const img = document.createElement("img");
            img.src = URL.createObjectURL(blob);
            newPreview.appendChild(img);
            photoWrap.replaceChild(newPreview, photoWrap.firstChild);

            // The cropper's own Apply handler already closed the modal to
            // do its work - this brings the (still-intact, still holding
            // whatever the user had already typed) Edit Profile form back.
            lingkodOpenModal("Edit Profile", form);
        });
    });

    photoWrap.appendChild(changePhotoBtn);
    photoWrap.appendChild(fileInput);
    form.appendChild(photoWrap);

    /* ---- Editable fields ---- */

    const lastNameInput = document.createElement("input");
    lastNameInput.type = "text";
    lastNameInput.value = currentProfile.last_name || "";

    const firstNameInput = document.createElement("input");
    firstNameInput.type = "text";
    firstNameInput.value = currentProfile.first_name || "";

    const middleNameInput = document.createElement("input");
    middleNameInput.type = "text";
    middleNameInput.value = currentProfile.middle_name || "";

    const usernameInput = document.createElement("input");
    usernameInput.type = "text";
    usernameInput.value = currentProfile.username || "";
    usernameInput.placeholder = "4-30 characters: letters, numbers, _ .";
    usernameInput.maxLength = 30;

    const contactNumberInput = document.createElement("input");
    contactNumberInput.type = "text";
    contactNumberInput.value = currentProfile.contact_number || "";
    contactNumberInput.placeholder = "e.g. 09123456789";

    form.appendChild(lingkodBuildFormField("Last Name", lastNameInput, "editLastNameError"));
    form.appendChild(lingkodBuildFormField("First Name", firstNameInput, "editFirstNameError"));
    form.appendChild(lingkodBuildFormField("Middle Name", middleNameInput, "editMiddleNameError"));
    form.appendChild(lingkodBuildFormField("Username", usernameInput, "editUsernameError"));
    form.appendChild(lingkodBuildFormField("Contact Number", contactNumberInput, "editContactNumberError"));

    const uiRole = LINGKOD_DB_ROLE_TO_UI_ROLE[currentProfile.role] || currentProfile.role;

    /* ---- Read-only reference fields ----
       Email/Department/Organization/Position/Student Number/Account Type/
       Date Registered/Account Status are all governance facts, not
       self-service - role in particular drives every permission check in
       this app, so letting a student edit their own way into "OSOA
       Executive Board" would be a privilege escalation bug, not a
       profile feature. */

    form.appendChild(buildReadOnlyField("Student Number", currentProfile.student_number || PROFILE_NOT_SET));
    form.appendChild(buildReadOnlyField("Email Address", currentProfile.email || PROFILE_NOT_SET));
    form.appendChild(buildReadOnlyField("Campus", PROFILE_CAMPUS));
    form.appendChild(buildReadOnlyField("College/Department", currentProfile.department || PROFILE_NOT_SET));
    form.appendChild(buildReadOnlyField("Organization", currentProfile.organization || PROFILE_NOT_SET));
    form.appendChild(buildReadOnlyField("Position", currentProfile.position || PROFILE_NOT_SET));
    form.appendChild(buildReadOnlyField("Account Type", LINGKOD_ROLE_LABELS[uiRole] || currentProfile.role));
    form.appendChild(buildReadOnlyField("Date Registered", currentProfile.created_at ? lingkodFormatDate(currentProfile.created_at) : PROFILE_NOT_SET));
    form.appendChild(buildReadOnlyField("Account Status", PROFILE_STATUS_LABELS[currentProfile.status] || "Active"));

    const actions = document.createElement("div");
    actions.className = "profile-view-actions";

    const cancelBtn = document.createElement("button");
    cancelBtn.type = "button";
    cancelBtn.className = "btn-secondary";
    cancelBtn.textContent = "Cancel";
    cancelBtn.addEventListener("click", function(){ lingkodCloseModal(); });
    actions.appendChild(cancelBtn);

    const saveBtn = document.createElement("button");
    saveBtn.type = "submit";
    saveBtn.textContent = "Save Changes";
    actions.appendChild(saveBtn);

    form.appendChild(actions);

    wireLiveValidation(lastNameInput, function(){ validateNameInput(lastNameInput, "editLastNameError", "Last Name"); });
    wireLiveValidation(firstNameInput, function(){ validateNameInput(firstNameInput, "editFirstNameError", "First Name"); });
    wireLiveValidation(middleNameInput, function(){ validateOptionalNameInput(middleNameInput, "editMiddleNameError", "Middle Name"); });
    wireLiveValidation(contactNumberInput, function(){ validateContactNumberInput(contactNumberInput, "editContactNumberError"); });

    usernameInput.addEventListener("blur", async function(){
        usernameInput.value = usernameInput.value.trim();
        if(validateUsernameFormat(usernameInput, "editUsernameError")){
            await checkUsernameAvailability(usernameInput, "editUsernameError");
        }
    });
    usernameInput.addEventListener("input", function(){
        if(usernameInput.classList.contains("invalid")) validateUsernameFormat(usernameInput, "editUsernameError");
    });

    form.addEventListener("submit", function(e){
        e.preventDefault();
        saveProfileEdits({
            lastName: lastNameInput,
            firstName: firstNameInput,
            middleName: middleNameInput,
            username: usernameInput,
            contactNumber: contactNumberInput,
            get pendingAvatarBlob(){ return pendingAvatarBlob; }
        }, saveBtn);
    });

    lingkodOpenModal("Edit Profile", form);
}

/* ================= CHANGE PASSWORD ================= */

async function handleChangePassword(currentInput, newInput, confirmInput, saveBtn){
    const currentPassword = currentInput.value;
    const newPassword = newInput.value;
    const confirmPassword = confirmInput.value;

    if(!currentPassword){
        lingkodToast("Please enter your current password.", "error");
        return;
    }
    if(!PASSWORD_RULE.test(newPassword)){
        lingkodToast(PASSWORD_MESSAGE, "error");
        return;
    }
    if(newPassword !== confirmPassword){
        lingkodToast("New passwords do not match.", "error");
        return;
    }
    if(newPassword === currentPassword){
        lingkodToast("Your new password must be different from your current password.", "error");
        return;
    }

    lingkodSetButtonLoading(saveBtn, true, "Verifying...");

    // Supabase has no direct "verify this password without signing in"
    // call - re-authenticating with it *is* the verification. This
    // doesn't disturb the active session; on success it just confirms
    // the same account with the same credentials again.
    const { error: verifyError } = await supabaseClient.auth.signInWithPassword({
        email: currentProfile.email,
        password: currentPassword
    });

    if(verifyError){
        lingkodSetButtonLoading(saveBtn, false);
        lingkodToast("Your current password is incorrect.", "error");
        return;
    }

    lingkodSetButtonLoading(saveBtn, true, "Updating...");
    const { error } = await supabaseClient.auth.updateUser({ password: newPassword });
    lingkodSetButtonLoading(saveBtn, false);

    if(error){
        console.error("[profile] password update failed:", error);
        lingkodToast("Failed to update your password: " + error.message, "error");
        return;
    }

    lingkodToast("Your password has been changed successfully.", "success");
    lingkodCloseModal();
}

function openChangePasswordModal(){
    const form = document.createElement("form");
    form.className = "edit-profile-form";

    const currentPasswordInput = document.createElement("input");
    currentPasswordInput.type = "password";
    currentPasswordInput.placeholder = "Enter current password";

    const newPasswordInput = document.createElement("input");
    newPasswordInput.type = "password";
    newPasswordInput.placeholder = "Enter new password";

    const confirmPasswordInput = document.createElement("input");
    confirmPasswordInput.type = "password";
    confirmPasswordInput.placeholder = "Re-enter new password";

    form.appendChild(lingkodBuildFormField("Current Password", currentPasswordInput));

    const newPasswordField = lingkodBuildFormField("New Password", newPasswordInput);
    const hint = document.createElement("small");
    hint.className = "field-hint";
    hint.textContent = PASSWORD_MESSAGE;
    newPasswordField.appendChild(hint);
    form.appendChild(newPasswordField);

    form.appendChild(lingkodBuildFormField("Confirm New Password", confirmPasswordInput));

    const saveBtn = document.createElement("button");
    saveBtn.type = "submit";
    saveBtn.textContent = "Update Password";
    form.appendChild(saveBtn);

    form.addEventListener("submit", function(e){
        e.preventDefault();
        handleChangePassword(currentPasswordInput, newPasswordInput, confirmPasswordInput, saveBtn);
    });

    lingkodOpenModal("Change Password", form);
}

/* ================= WIRING ================= */

document.getElementById("editProfileBtn").addEventListener("click", function(){
    if(!currentProfile){
        lingkodToast("Editing isn't available for demo accounts.", "error");
        return;
    }
    openEditProfileModal();
});

document.getElementById("changePasswordBtn").addEventListener("click", function(){
    if(!currentUserId){
        lingkodToast("Changing password isn't available for demo accounts.", "error");
        return;
    }
    openChangePasswordModal();
});

document.addEventListener("DOMContentLoaded", function(){
    loadProfileInfo();
});

// Live updates: if this profile is edited from another tab/device (or, in
// principle, another realtime-driven path), this page reflects it without
// needing a manual refresh - matches every other module's realtime
// wiring, and specifically covers "refresh without logout/login."
supabaseClient
    .channel("profile_page_changes")
    .on("postgres_changes", { event: "UPDATE", schema: "public", table: "profiles" }, function(payload){
        if(currentUserId && payload.new && payload.new.id === currentUserId){
            loadProfileInfo();
        }
    })
    .subscribe();
