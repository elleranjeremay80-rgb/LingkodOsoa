const resetCard = document.getElementById("resetCard");
const invalidLinkCard = document.getElementById("invalidLinkCard");
const invalidLinkMessage = document.getElementById("invalidLinkMessage");
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

const EXPIRED_LINK_MESSAGE = "This password reset link has expired or has already been used. Please request a new one.";

function showInvalidLinkState(message){
    if(message) invalidLinkMessage.textContent = message;
    resetCard.style.display = "none";
    invalidLinkCard.style.display = "block";
}

/* ================= RECOVERY SESSION DETECTION ================= */
// Clicking the emailed link lands here with the recovery callback in the
// URL - normally #access_token=...&type=recovery (Supabase's default
// email template), or ?token_hash=...&type=recovery if the template was
// customised to the token-hash format. The inline script in index.html
// snapshots the URL *before* the SDK loads, because js/supabase.js's
// client (detectSessionInUrl:true) parses the fragment into a temporary
// recovery session and then wipes it from the address bar on its own.
// Nothing token-related is ever logged.
//
// Only a genuine recovery session may change the password here - an
// ordinary logged-in session that merely navigates to this page is
// treated as "no valid link". The sessionStorage flag lets a refresh of
// this tab (after the fragment is already consumed) keep working.

const RECOVERY_FLAG_KEY = "lingkod_password_recovery";
const authCallback = window.LINGKOD_AUTH_CALLBACK || { hash: "", search: "" };
const callbackHashParams = new URLSearchParams((authCallback.hash || "").replace(/^#/, ""));
const callbackQueryParams = new URLSearchParams(authCallback.search || "");

function callbackParam(name){
    return callbackHashParams.get(name) || callbackQueryParams.get(name);
}

let recoverySessionReady = false;

supabaseClient.auth.onAuthStateChange(function(event){
    if(event === "PASSWORD_RECOVERY"){
        sessionStorage.setItem(RECOVERY_FLAG_KEY, "1");
        recoverySessionReady = true;
    }
});

// Supabase redirects back with #error=...&error_code=otp_expired when the
// link is expired, already used, or otherwise rejected.
function describeCallbackError(){
    const errorCode = callbackParam("error_code");
    if(!errorCode && !callbackParam("error")) return null;
    if(errorCode === "otp_expired") return EXPIRED_LINK_MESSAGE;
    return "This password reset link is invalid. Please request a new one.";
}

(async function init(){
    setButtonLoading(resetButton, true, "Verifying link...");

    try {
        const callbackError = describeCallbackError();
        if(callbackError){
            sessionStorage.removeItem(RECOVERY_FLAG_KEY);
            showInvalidLinkState(callbackError);
            return;
        }

        const isRecoveryCallback = callbackParam("type") === "recovery";

        // Token-hash style link: verify it explicitly. (The default
        // #access_token link is exchanged by the SDK automatically.)
        const tokenHash = callbackParam("token_hash");
        if(tokenHash && isRecoveryCallback){
            window.history.replaceState(null, "", window.location.pathname);
            const { error } = await supabaseClient.auth.verifyOtp({ token_hash: tokenHash, type: "recovery" });
            if(error){
                console.error("[reset-password] recovery link verification failed:", error.message);
                sessionStorage.removeItem(RECOVERY_FLAG_KEY);
                showInvalidLinkState(EXPIRED_LINK_MESSAGE);
                return;
            }
        }

        if(isRecoveryCallback) sessionStorage.setItem(RECOVERY_FLAG_KEY, "1");

        // getSession() waits for the SDK to finish parsing the URL
        // fragment, so by now the recovery session exists if the link
        // was valid.
        const { data } = await supabaseClient.auth.getSession();
        const cameFromRecoveryLink = recoverySessionReady || sessionStorage.getItem(RECOVERY_FLAG_KEY) === "1";

        if(data.session && cameFromRecoveryLink){
            recoverySessionReady = true;
            return;
        }

        sessionStorage.removeItem(RECOVERY_FLAG_KEY);
        recoverySessionReady = false;
        showInvalidLinkState(cameFromRecoveryLink
            ? EXPIRED_LINK_MESSAGE
            : "Please open this page using the password reset link sent to your email, or request a new link.");
    } catch(err){
        console.error("[reset-password] could not verify the reset link:", err && err.message);
        showInvalidLinkState("We couldn't verify your reset link. Please check your connection and try again, or request a new link.");
    } finally {
        setButtonLoading(resetButton, false);
    }
})();

/* ================= PASSWORD UPDATE ================= */

function isSessionError(error){
    const code = error.code || "";
    return error.status === 401 || error.status === 403
        || code === "session_not_found" || code === "session_expired" || code === "bad_jwt"
        || /session|jwt/i.test(error.message || "");
}

function describeUpdateError(error){
    if(error.code === "same_password" || /different from the old password/i.test(error.message || "")){
        return "Your new password must be different from your current password.";
    }
    return error.message || "Couldn't update your password. Please try again.";
}

function expireRecovery(message){
    sessionStorage.removeItem(RECOVERY_FLAG_KEY);
    recoverySessionReady = false;
    showInvalidLinkState(message);
}

let isUpdating = false;

resetForm.addEventListener("submit", async function(e){
    e.preventDefault();
    if(isUpdating) return;

    const passwordValid = validateNewPassword();
    const confirmValid = validateConfirmNewPassword();
    if(!passwordValid || !confirmValid) return;

    if(!recoverySessionReady){
        showInvalidLinkState("This password reset link is no longer valid. Please request a new one.");
        return;
    }

    isUpdating = true;
    let succeeded = false;
    clearStatus(resetStatus);
    setButtonLoading(resetButton, true, "Updating...");

    try {
        // Re-check right before updating: the recovery session is
        // short-lived and may have lapsed while the form sat open.
        const { data: sessionData } = await supabaseClient.auth.getSession();
        if(!sessionData.session){
            expireRecovery("Your reset session has expired. Please request a new password reset link.");
            return;
        }

        // updateUser() only ever changes the password of the account the
        // recovery session belongs to - Supabase enforces that server-side.
        const { error } = await supabaseClient.auth.updateUser({ password: newPasswordInput.value });

        if(error){
            console.error("[reset-password] updateUser failed:", error.message);
            if(isSessionError(error)){
                expireRecovery("Your reset session has expired. Please request a new password reset link.");
                return;
            }
            showStatus(resetStatus, describeUpdateError(error), "error");
            return;
        }

        succeeded = true;
        sessionStorage.removeItem(RECOVERY_FLAG_KEY);
        recoverySessionReady = false;
        resetForm.reset();
        setButtonLoading(resetButton, false);
        resetButton.disabled = true;
        showStatus(resetStatus, "Your password has been successfully updated. Redirecting you to the login page...", "success");

        // The recovery token itself is single-use. Signing out (global
        // scope by default) also revokes any other sessions of this
        // account, and the cached LINGKOD profile is cleared so the login
        // page doesn't auto-skip to the dashboard - the user must log in
        // fresh with the new password.
        try {
            await supabaseClient.auth.signOut();
        } catch(signOutErr){
            console.error("[reset-password] sign-out after reset failed:", signOutErr && signOutErr.message);
        }
        lingkodClearSession();

        setTimeout(function(){
            window.location.href = "../login/index.html";
        }, 2200);
    } catch(err){
        console.error("[reset-password] unexpected error:", err && err.message);
        showStatus(resetStatus, "Something went wrong while updating your password. Please check your connection and try again.", "error");
    } finally {
        isUpdating = false;
        if(!succeeded) setButtonLoading(resetButton, false);
    }
});
