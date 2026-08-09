const emailNotificationsToggle = document.getElementById("emailNotificationsToggle");
const darkModeToggle = document.getElementById("darkModeToggle");
const showProfileToggle = document.getElementById("showProfileToggle");

const ALL_TOGGLES = [emailNotificationsToggle, darkModeToggle, showProfileToggle];

// two_factor_enabled is intentionally still written on every save below
// (DEFAULT_SETTINGS/saveField's upsert) even though there's no longer a
// UI control for it - the user_settings table/column stay untouched per
// scope, and this keeps every existing row's shape consistent rather
// than leaving the column unset on new rows.
const DEFAULT_SETTINGS = {
    email_notifications: true,
    dark_mode: false,
    two_factor_enabled: false,
    show_profile_information: true
};

let currentUserId = null;

function applySettingsToForm(settings){
    emailNotificationsToggle.checked = !!settings.email_notifications;
    darkModeToggle.checked = !!settings.dark_mode;
    showProfileToggle.checked = !!settings.show_profile_information;
}

/* ================= PER-TOGGLE SAVE STATE ================= */

function setToggleSaving(toggleInput, isSaving){
    toggleInput.disabled = isSaving;
    const switchLabel = toggleInput.closest(".switch");
    switchLabel.classList.toggle("is-saving", isSaving);

    let spinner = switchLabel.querySelector(".toggle-spinner");
    if(isSaving){
        if(!spinner){
            spinner = document.createElement("span");
            spinner.className = "toggle-spinner";
            switchLabel.appendChild(spinner);
        }
    } else if(spinner){
        spinner.remove();
    }
}

// Persists a single field, creating the row with defaults on first-ever
// save (upsert) so a partial save never needs a prior load-time insert.
// Reverts the toggle's visual state on failure - the UI is optimistic
// (already flipped by the native checkbox before this runs) but must not
// stay flipped if the write didn't actually happen.
async function saveField(toggleInput, field, value, previousValue){
    if(!currentUserId) return false;

    setToggleSaving(toggleInput, true);

    try {
        const payload = Object.assign({ user_id: currentUserId }, DEFAULT_SETTINGS);
        payload[field] = value;

        const { error } = await supabaseClient
            .from("user_settings")
            .upsert(payload, { onConflict: "user_id", ignoreDuplicates: false });

        if(error) throw error;

        lingkodToast("Settings saved successfully.", "success");
        return true;
    } catch(err){
        console.error("[settings] save failed:", field, err);
        toggleInput.checked = previousValue;
        lingkodToast("Failed to save settings. Please try again.", "error");
        return false;
    } finally {
        setToggleSaving(toggleInput, false);
    }
}

/* ================= LOAD ================= */

async function loadSettings(){
    const profile = await lingkodGetAuthedProfile();
    if(!profile){
        ALL_TOGGLES.forEach(function(el){ el.disabled = true; });
        lingkodToast("Settings aren't available for demo accounts.", "error");
        return;
    }

    currentUserId = profile.id;

    const { data, error } = await supabaseClient
        .from("user_settings")
        .select("*")
        .eq("user_id", currentUserId)
        .maybeSingle();

    if(error){
        console.error("[settings] load failed:", error);
        lingkodToast("Couldn't load your settings.", "error");
        applySettingsToForm(DEFAULT_SETTINGS);
        return;
    }

    if(data){
        applySettingsToForm(data);
    } else {
        // No record yet - create one with defaults now, so the row exists
        // from the moment the page is opened rather than only after the
        // user first touches a toggle.
        applySettingsToForm(DEFAULT_SETTINGS);
        const { error: createError } = await supabaseClient
            .from("user_settings")
            .upsert(Object.assign({ user_id: currentUserId }, DEFAULT_SETTINGS), { onConflict: "user_id" });
        if(createError) console.error("[settings] default row creation failed:", createError);
    }
}

/* ================= PER-TOGGLE AUTO-SAVE WIRING ================= */

emailNotificationsToggle.addEventListener("change", function(){
    const value = emailNotificationsToggle.checked;
    saveField(emailNotificationsToggle, "email_notifications", value, !value);
});

darkModeToggle.addEventListener("change", async function(){
    const value = darkModeToggle.checked;
    lingkodApplyTheme(value);
    const saved = await saveField(darkModeToggle, "dark_mode", value, !value);
    if(!saved) lingkodApplyTheme(!value);
});

showProfileToggle.addEventListener("change", function(){
    const value = showProfileToggle.checked;
    saveField(showProfileToggle, "show_profile_information", value, !value);
});

document.addEventListener("DOMContentLoaded", loadSettings);
