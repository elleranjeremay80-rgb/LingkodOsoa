const emailNotificationsToggle = document.getElementById("emailNotificationsToggle");
const darkModeToggle = document.getElementById("darkModeToggle");
const twoFactorToggle = document.getElementById("twoFactorToggle");
const showProfileToggle = document.getElementById("showProfileToggle");

const ALL_TOGGLES = [emailNotificationsToggle, darkModeToggle, twoFactorToggle, showProfileToggle];

const DEFAULT_SETTINGS = {
    email_notifications: true,
    dark_mode: false,
    two_factor_enabled: false,
    show_profile_information: true
};

let currentUserId = null;
// Set once we know a real, verified TOTP factor exists (see
// refreshMfaFactor) - the source of truth for "is 2FA actually on",
// independent of whatever user_settings.two_factor_enabled currently says
// (the two are reconciled on every load, in case they ever drifted).
let mfaFactorId = null;

function applySettingsToForm(settings){
    emailNotificationsToggle.checked = !!settings.email_notifications;
    darkModeToggle.checked = !!settings.dark_mode;
    twoFactorToggle.checked = !!settings.two_factor_enabled;
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

// Same as saveField but does a true partial UPDATE instead of an upsert -
// used after the 2FA enrollment/unenroll flow already resolved, where an
// upsert seeded with DEFAULT_SETTINGS would clobber the user's other real
// saved values.
async function updateField(toggleInput, field, value, previousValue){
    if(!currentUserId) return false;

    setToggleSaving(toggleInput, true);

    try {
        const patch = {};
        patch[field] = value;

        const { error } = await supabaseClient
            .from("user_settings")
            .update(patch)
            .eq("user_id", currentUserId);

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

// Supabase Auth's own MFA state is the source of truth for whether 2FA is
// really on - the database flag is just a display/preference mirror of
// it, so this is checked on every load and the toggle corrected if it
// ever drifted (e.g. an enrollment that succeeded but whose settings save
// failed right after).
async function refreshMfaFactor(){
    try {
        const { data, error } = await supabaseClient.auth.mfa.listFactors();
        if(error) throw error;
        const verified = (data.totp || []).find(function(f){ return f.status === "verified"; });
        mfaFactorId = verified ? verified.id : null;
        twoFactorToggle.checked = !!mfaFactorId;
    } catch(err){
        console.error("[settings] MFA factor check failed:", err);
    }
}

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

    await refreshMfaFactor();
}

/* ================= TWO-FACTOR AUTHENTICATION (real TOTP) ================= */

// Resolves true if the user completed enrollment (2FA is now genuinely
// on), false if they backed out (dismissed the modal, or Supabase MFA
// isn't configured on this project at all) - the caller uses this to
// decide what to actually save.
function runTwoFactorEnrollment(){
    return new Promise(async function(resolve){
        const { data, error } = await supabaseClient.auth.mfa.enroll({ factorType: "totp" });

        if(error){
            console.error("[settings] MFA enroll failed:", error);
            lingkodToast("Two-Factor Authentication support will be available in a future update.", "error");
            resolve(false);
            return;
        }

        const factorId = data.id;
        let settled = false;

        const wrapper = document.createElement("div");
        wrapper.className = "edit-profile-form";

        const instructions = document.createElement("p");
        instructions.textContent = "Scan this QR code with your authenticator app (Google Authenticator, Authy, etc.), then enter the 6-digit code it shows to finish enabling Two-Factor Authentication.";
        wrapper.appendChild(instructions);

        const qrWrap = document.createElement("div");
        qrWrap.className = "mfa-qr";
        qrWrap.innerHTML = data.totp.qr_code;
        wrapper.appendChild(qrWrap);

        const secretInput = document.createElement("input");
        secretInput.type = "text";
        secretInput.value = data.totp.secret;
        secretInput.readOnly = true;
        wrapper.appendChild(lingkodBuildFormField("Can't scan? Enter this code manually", secretInput));

        const codeInput = document.createElement("input");
        codeInput.type = "text";
        codeInput.inputMode = "numeric";
        codeInput.maxLength = 6;
        codeInput.placeholder = "Enter the 6-digit code";
        wrapper.appendChild(lingkodBuildFormField("Verification Code", codeInput, "mfaCodeError"));

        const confirmBtn = document.createElement("button");
        confirmBtn.type = "button";
        confirmBtn.textContent = "Verify & Enable";
        wrapper.appendChild(confirmBtn);

        async function cleanupUnverifiedFactor(){
            try {
                await supabaseClient.auth.mfa.unenroll({ factorId: factorId });
            } catch(cleanupErr){
                console.error("[settings] MFA cleanup failed:", cleanupErr);
            }
        }

        confirmBtn.addEventListener("click", async function(){
            const code = codeInput.value.trim();
            if(!/^\d{6}$/.test(code)){
                lingkodToast("Enter the 6-digit code from your authenticator app.", "error");
                return;
            }

            lingkodSetButtonLoading(confirmBtn, true, "Verifying...");

            try {
                const { data: challengeData, error: challengeError } = await supabaseClient.auth.mfa.challenge({ factorId: factorId });
                if(challengeError) throw challengeError;

                const { error: verifyError } = await supabaseClient.auth.mfa.verify({
                    factorId: factorId,
                    challengeId: challengeData.id,
                    code: code
                });
                if(verifyError) throw verifyError;

                mfaFactorId = factorId;
                settled = true;
                lingkodCloseModal();
                lingkodToast("Two-Factor Authentication has been enabled.", "success");
                resolve(true);
            } catch(verifyErr){
                console.error("[settings] MFA verify failed:", verifyErr);
                lingkodToast("That code didn't match. Please check your authenticator app and try again.", "error");
                lingkodSetButtonLoading(confirmBtn, false);
            }
        });

        lingkodOpenModal("Set Up Two-Factor Authentication", wrapper);

        // If the modal is dismissed (X button, backdrop click, Escape)
        // without completing verification, the enrolled-but-unverified
        // factor shouldn't linger - watched via the shared overlay's own
        // "open" class rather than hooking every dismiss path individually.
        const overlay = document.getElementById("lingkodModalOverlay");
        const observer = new MutationObserver(function(){
            if(settled) return;
            if(!overlay.classList.contains("open")){
                observer.disconnect();
                cleanupUnverifiedFactor();
                resolve(false);
            }
        });
        observer.observe(overlay, { attributes: true, attributeFilter: ["class"] });
    });
}

// Resolves true once the factor is actually removed (2FA genuinely off),
// false if the removal failed (still on - the caller should keep the
// toggle checked and the saved flag true).
async function disableTwoFactor(){
    if(!mfaFactorId){
        await refreshMfaFactor();
        if(!mfaFactorId) return true;
    }

    const { error } = await supabaseClient.auth.mfa.unenroll({ factorId: mfaFactorId });

    if(error){
        console.error("[settings] MFA unenroll failed:", error);
        lingkodToast("Failed to save settings. Please try again.", "error");
        return false;
    }

    mfaFactorId = null;
    return true;
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

twoFactorToggle.addEventListener("change", async function(){
    const wantsOn = twoFactorToggle.checked;
    const currentlyEnrolled = !!mfaFactorId;

    if(wantsOn && !currentlyEnrolled){
        // Optimistic flip would show the QR modal as already "on" - keep
        // it visually off until enrollment is actually verified.
        twoFactorToggle.checked = false;
        setToggleSaving(twoFactorToggle, true);
        const enrolled = await runTwoFactorEnrollment();
        setToggleSaving(twoFactorToggle, false);
        twoFactorToggle.checked = enrolled;
        if(enrolled) await updateField(twoFactorToggle, "two_factor_enabled", true, false);
    } else if(!wantsOn && currentlyEnrolled){
        twoFactorToggle.checked = true;
        lingkodConfirmAction({
            title: "Disable Two-Factor Authentication?",
            message: "Your account will only require your password to sign in.",
            icon: "fa-shield-halved",
            confirmLabel: "Disable",
            loadingLabel: "Disabling...",
            destructive: true,
            onConfirm: async function(){
                setToggleSaving(twoFactorToggle, true);
                const reallyDisabled = await disableTwoFactor();
                setToggleSaving(twoFactorToggle, false);
                twoFactorToggle.checked = !reallyDisabled;
                if(reallyDisabled){
                    await updateField(twoFactorToggle, "two_factor_enabled", false, true);
                    lingkodToast("Two-Factor Authentication has been disabled.", "success");
                } else {
                    throw new Error("disable failed");
                }
            }
        });
    }
});

document.addEventListener("DOMContentLoaded", loadSettings);
