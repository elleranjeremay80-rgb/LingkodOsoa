const resetCard = document.getElementById("resetCard");
const invalidLinkCard = document.getElementById("invalidLinkCard");
const resetForm = document.getElementById("resetForm");
const newPasswordInput = document.getElementById("newPassword");
const confirmNewPasswordInput = document.getElementById("confirmNewPassword");
const newPasswordError = document.getElementById("newPasswordError");
const confirmNewPasswordError = document.getElementById("confirmNewPasswordError");
const resetStatus = document.getElementById("resetStatus");
const resetButton = document.getElementById("resetButton");

// Rule/message, field-error, status, and button-spinner helpers all now
// live in js/auth-forms.js (loaded before this file) - the exact same
// PASSWORD_RULE register/script.js enforces, from one definition instead
// of two hand-kept-in-sync copies. Aliased under their original names so
// every call site below is unchanged.
const PASSWORD_RULE = LINGKOD_PASSWORD_RULE;
const PASSWORD_MESSAGE = LINGKOD_PASSWORD_MESSAGE;
const showError = lingkodShowFieldError;
const clearError = lingkodClearFieldError;
const showStatus = lingkodShowAuthStatus;
const clearStatus = lingkodClearAuthStatus;
const setButtonLoading = lingkodSetAuthButtonLoading;

lingkodWirePasswordToggles();

function validateNewPassword(){
    if(!PASSWORD_RULE.test(newPasswordInput.value)){
        showError(newPasswordInput, newPasswordError, PASSWORD_MESSAGE);
        return false;
    }
    clearError(newPasswordInput, newPasswordError);
    return true;
}

function validateConfirmNewPassword(){
    if(!PASSWORD_RULE.test(confirmNewPasswordInput.value)){
        showError(confirmNewPasswordInput, confirmNewPasswordError, PASSWORD_MESSAGE);
        return false;
    }
    if(confirmNewPasswordInput.value !== newPasswordInput.value){
        showError(confirmNewPasswordInput, confirmNewPasswordError, "Passwords do not match.");
        return false;
    }
    clearError(confirmNewPasswordInput, confirmNewPasswordError);
    return true;
}

newPasswordInput.addEventListener("input", validateNewPassword);
confirmNewPasswordInput.addEventListener("input", validateConfirmNewPassword);

function showInvalidLinkState(){
    resetCard.style.display = "none";
    invalidLinkCard.style.display = "block";
}

/* ================= RECOVERY SESSION DETECTION ================= */
// Clicking the emailed link lands here with a recovery token in the URL
// fragment. js/supabase.js's client already has detectSessionInUrl:true
// (the SDK default), so it parses that fragment and establishes a
// temporary session automatically - Supabase's own recommended pattern
// is to listen for the PASSWORD_RECOVERY auth event rather than assume
// getSession() already has it by the time this script runs, since that
// parsing happens asynchronously.

let recoverySessionReady = false;

supabaseClient.auth.onAuthStateChange(function(event){
    if(event === "PASSWORD_RECOVERY"){
        recoverySessionReady = true;
    }
});

(async function init(){
    const { data } = await supabaseClient.auth.getSession();
    if(data.session){
        recoverySessionReady = true;
        return;
    }

    // Give onAuthStateChange a moment to fire before concluding the link
    // is genuinely invalid/expired/already used.
    setTimeout(function(){
        if(!recoverySessionReady) showInvalidLinkState();
    }, 1500);
})();

resetForm.addEventListener("submit", async function(e){
    e.preventDefault();

    const passwordValid = validateNewPassword();
    const confirmValid = validateConfirmNewPassword();
    if(!passwordValid || !confirmValid) return;

    if(!recoverySessionReady){
        showStatus(resetStatus, "This reset link is no longer valid. Please request a new one from the login page.", "error");
        return;
    }

    clearStatus(resetStatus);
    setButtonLoading(resetButton, true, "Updating...");

    try {
        const { error } = await supabaseClient.auth.updateUser({ password: newPasswordInput.value });

        if(error){
            console.error("[reset-password] updateUser failed:", error);
            showStatus(resetStatus, error.message || "Couldn't update your password. Please try again.", "error");
            setButtonLoading(resetButton, false);
            return;
        }

        showStatus(resetStatus, "Your password has been successfully updated. You can now log in with your new password.", "success");
        resetForm.reset();
        setButtonLoading(resetButton, false);
        resetButton.disabled = true;

        // The recovery token itself is already single-use (Supabase
        // rejects reusing it), but also sign out of the temporary
        // recovery session so nothing is left "logged in" here after a
        // password change - the user explicitly needs to log in fresh
        // with the new password next.
        await supabaseClient.auth.signOut();

        setTimeout(function(){
            window.location.href = "../login/index.html";
        }, 2200);
    } catch(err){
        console.error("[reset-password] unexpected error:", err);
        showStatus(resetStatus, "Something went wrong while updating your password. Please check your connection and try again.", "error");
        setButtonLoading(resetButton, false);
    }
});
