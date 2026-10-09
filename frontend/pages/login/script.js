const splash = document.getElementById("splash");
const loginCard = document.getElementById("loginCard");
const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

const loginForm = document.getElementById("loginForm");
const studentNumberInput = document.getElementById("studentNumber");
const rememberMeCheckbox = document.getElementById("rememberMe");
const loginButton = loginForm.querySelector("button[type=\"submit\"]");
const loginStatus = document.getElementById("loginStatus");

// Defined once in js/auth-forms.js (loaded before this file) - aliased
// here under their original names so every call site below is unchanged.
const showStatus = lingkodShowAuthStatus;
const clearStatus = lingkodClearAuthStatus;
const setButtonLoading = lingkodSetAuthButtonLoading;

/* ================= AUTO-REDIRECT IF ALREADY LOGGED IN ================= */
// Mirrors common.js's lingkodRehydrateFromSupabase() (which every *other*
// page uses) - the login page doesn't load common.js (its DOMContentLoaded
// handler assumes a sidebar/dashboard shell that doesn't exist here), so
// this is its own copy of "is there already a valid session (demo or real)
// worth skipping the login form for?"

async function redirectIfAlreadyLoggedIn(){
    if(lingkodGetSession()){
        window.location.href = "../dashboard/index.html";
        return true;
    }

    const { data } = await supabaseClient.auth.getSession();
    if(!data.session) return false;

    const { data: profile, error } = await supabaseClient
        .from("profiles")
        .select("role, full_name, student_number, position")
        .eq("id", data.session.user.id)
        .single();

    if(error || !profile) return false;

    lingkodSetSession(lingkodBuildAccountFromProfile(profile));
    window.location.href = "../dashboard/index.html";
    return true;
}

(async function init(){
    const redirected = await redirectIfAlreadyLoggedIn();
    if(redirected) return;

    // "Request a New Link" on the reset-password page links back here as
    // #forgot, so open straight onto the recovery form.
    const openForgotOnLoad = window.location.hash === "#forgot";
    if(openForgotOnLoad) window.history.replaceState(null, "", window.location.pathname);

    const splashDelay = reduceMotion ? 0 : 1400;

    setTimeout(function(){
        splash.classList.add("hide");
        if(openForgotOnLoad) showForgotCard();
        else loginCard.classList.add("visible");
    }, splashDelay);

    splash.addEventListener("transitionend", function(){
        splash.remove();
    });

    if(reduceMotion){
        splash.remove();
        if(!openForgotOnLoad) loginCard.classList.add("visible");
    }
})();

lingkodWirePasswordToggles();

// The Student Number field and the Remember Me checkbox always start
// empty/unchecked on page load, regardless of any previous login - this
// page no longer restores either from a past session. Purges any value
// saved by an older build of this page that did, so a browser that
// already has one left over doesn't keep resurfacing it forever.
localStorage.removeItem("lingkod_studentNumber");

// Looks up whether a student number belongs to a registered account by
// querying the profiles table directly (no RPC). Only the columns
// actually needed to log in are requested — never full_name, department,
// organization, or position — since this query has to run before the
// visitor is authenticated (a matching RLS policy + column grant on
// profiles is required for this to return anything at all; see the SQL
// notes in the explanation).
//
// Uses .maybeSingle() rather than .single(): a genuine "no such student
// number" (data is null, no error) is NOT the same thing as the lookup
// itself failing (error is set — e.g. an RLS/permissions problem).
// Conflating those two used to make every setup problem look identical
// to "Student Number not found." We throw on a genuine error so it
// surfaces instead of being silently treated as "not found."
//
// This pre-login lookup always goes through the page-load shared
// `supabaseClient` (no session concerns either way) - only the actual
// sign-in call below needs a Remember-Me-aware client.
async function findRegisteredLoginInfo(studentNumber){
    const { data, error } = await supabaseClient
        .from("profiles")
        .select("id, email, role, status")
        .ilike("student_number", studentNumber.trim())
        .maybeSingle();

    if(error){
        console.error("[login] profiles lookup failed:", error);
        throw new Error("We couldn't check your account right now (" + error.message + "). Please try again.");
    }

    return data;
}

// Supabase JS has no public API to change a client's storage backend
// after construction, and the page-load-time `supabaseClient` (js/
// supabase.js) was built using whatever Remember Me choice was active on
// a *previous* visit. So the actual sign-in call always goes through a
// freshly-built client reflecting the checkbox's value *right now* -
// otherwise checking/unchecking Remember Me on this visit would have no
// effect on where this login's session actually gets written.
function buildAuthClient(rememberMe){
    return supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
        auth: {
            persistSession: true,
            storage: rememberMe ? window.localStorage : window.sessionStorage,
            autoRefreshToken: true,
            detectSessionInUrl: false
        }
    });
}

// Attempts to authenticate a real, registered Supabase user.
// Returns a result object describing exactly what happened so the
// submit handler can show the right message for each case.
async function loginWithSupabase(studentNumber, password, authClient){
    const info = await findRegisteredLoginInfo(studentNumber);

    if(!info){
        return { status: "not_found" };
    }

    if(info.status !== "active"){
        return { status: "inactive" };
    }

    const { data, error } = await authClient.auth.signInWithPassword({
        email: info.email,
        password: password
    });

    if(error){
        console.error("[login] signInWithPassword failed:", error.message);
        return { status: "wrong_password" };
    }

    const { data: profile, error: profileError } = await authClient
        .from("profiles")
        .select("role, full_name, student_number, position")
        .eq("id", data.user.id)
        .single();

    if(profileError || !profile){
        console.error("[login] authenticated but profile fetch failed:", profileError);
        // We have a valid Supabase session but no usable profile — don't
        // leave the user half-logged-in with no role to route them by.
        await authClient.auth.signOut();
        return { status: "profile_error", message: profileError ? profileError.message : "Profile not found." };
    }

    return { status: "ok", account: lingkodBuildAccountFromProfile(profile) };
}

/* ================= TWO-FACTOR VERIFICATION (real TOTP challenge) ================= */

const mfaCard = document.getElementById("mfaCard");
const mfaForm = document.getElementById("mfaForm");
const mfaCodeInput = document.getElementById("mfaCode");
const mfaStatus = document.getElementById("mfaStatus");
const mfaButton = mfaForm.querySelector("button[type=\"submit\"]");
const mfaCancelLink = document.getElementById("mfaCancelLink");

function showMfaCard(){
    clearStatus(loginStatus);
    loginCard.style.display = "none";
    mfaCard.style.display = "block";
    mfaCodeInput.value = "";
    requestAnimationFrame(function(){ mfaCard.classList.add("visible"); });
    mfaCodeInput.focus();
}

function hideMfaCard(){
    mfaCard.classList.remove("visible");
    mfaCard.style.display = "none";
    loginCard.style.display = "block";
}

// Resolves true once the password step is fully done (no MFA enrolled,
// or the code was verified) - false if the user backed out, or something
// about the challenge itself failed. authClient is the same Remember-Me-
// aware client the password sign-in just ran on, since the pending
// session (and the eventual verify() call) both need to be the same
// client instance.
function completeMfaChallengeIfNeeded(authClient){
    return new Promise(async function(resolve){
        const { data: levelData, error: levelError } = await authClient.auth.mfa.getAuthenticatorAssuranceLevel();

        if(levelError){
            console.error("[login] MFA level check failed:", levelError);
            resolve(true); // fail open - don't lock the user out over a status-check error
            return;
        }

        if(levelData.currentLevel === levelData.nextLevel){
            resolve(true); // no factor enrolled, or already at the required level
            return;
        }

        const { data: factorsData, error: factorsError } = await authClient.auth.mfa.listFactors();
        const totpFactor = factorsData && factorsData.totp && factorsData.totp[0];

        if(factorsError || !totpFactor){
            console.error("[login] MFA required but no factor found:", factorsError);
            resolve(true); // shouldn't happen, but don't lock the user out over it
            return;
        }

        const { data: challengeData, error: challengeError } = await authClient.auth.mfa.challenge({ factorId: totpFactor.id });

        if(challengeError){
            console.error("[login] MFA challenge failed:", challengeError);
            showStatus(loginStatus, "Couldn't start the verification step. Please try logging in again.", "error");
            resolve(false);
            return;
        }

        showMfaCard();

        mfaForm.onsubmit = async function(e){
            e.preventDefault();

            const code = mfaCodeInput.value.trim();
            if(!/^\d{6}$/.test(code)){
                showStatus(mfaStatus, "Enter the 6-digit code from your authenticator app.", "error");
                return;
            }

            clearStatus(mfaStatus);
            setButtonLoading(mfaButton, true, "Verifying...");

            const { error: verifyError } = await authClient.auth.mfa.verify({
                factorId: totpFactor.id,
                challengeId: challengeData.id,
                code: code
            });

            setButtonLoading(mfaButton, false);

            if(verifyError){
                console.error("[login] MFA verify failed:", verifyError);
                showStatus(mfaStatus, "Incorrect code. Please try again.", "error");
                return;
            }

            hideMfaCard();
            resolve(true);
        };

        mfaCancelLink.onclick = async function(e){
            e.preventDefault();
            await authClient.auth.signOut();
            hideMfaCard();
            resolve(false);
        };
    });
}

function finishLogin(account, studentNumber){
    lingkodSetSession(account);
    window.location.href = "../dashboard/index.html";
}

loginForm.addEventListener("submit", async function(e){
    e.preventDefault();

    const studentNumber = studentNumberInput.value;
    const password = document.getElementById("password").value;
    const rememberMe = rememberMeCheckbox.checked;

    // Persisted immediately (not just on success) so that the session
    // cache below (js/auth.js's lingkodSetSession, which reads this
    // flag) picks the right storage for *this* attempt.
    localStorage.setItem(LINGKOD_REMEMBER_ME_KEY, rememberMe ? "1" : "0");

    clearStatus(loginStatus);
    setButtonLoading(loginButton, true, "Logging in...");

    try {
        const authClient = buildAuthClient(rememberMe);
        const result = await loginWithSupabase(studentNumber, password, authClient);

        if(result.status === "ok"){
            const mfaOk = await completeMfaChallengeIfNeeded(authClient);
            if(!mfaOk) return;
            finishLogin(result.account, studentNumber);
            return;
        }

        if(result.status === "inactive"){
            showStatus(loginStatus, "Your account is inactive. Please contact the administrator.", "error");
            return;
        }

        if(result.status === "wrong_password"){
            showStatus(loginStatus, "Incorrect password.", "error");
            return;
        }

        if(result.status === "profile_error"){
            showStatus(loginStatus, "We found your account, but couldn't load your profile (" + result.message + "). Please contact the administrator.", "error");
            return;
        }

        showStatus(loginStatus, "Student Number not found.", "error");
    } catch(err){
        // A genuine setup/connection problem (e.g. the SQL function
        // doesn't exist yet), or a network failure — surfaced instead of
        // hidden.
        console.error("[login] unexpected error:", err);
        showStatus(loginStatus, err.message || "Something went wrong while logging in. Please check your connection and try again.", "error");
    } finally {
        setButtonLoading(loginButton, false);
    }
});

/* ================= FORGOT PASSWORD ================= */

const forgotCard = document.getElementById("forgotCard");
const forgotForm = document.getElementById("forgotForm");
const forgotEmailInput = document.getElementById("forgotEmail");
const forgotStatus = document.getElementById("forgotStatus");
const forgotButton = forgotForm.querySelector("button[type=\"submit\"]");
const forgotPasswordLink = document.getElementById("forgotPasswordLink");
const backToLoginLink = document.getElementById("backToLoginLink");

function showForgotCard(){
    clearStatus(loginStatus);
    loginCard.style.display = "none";
    forgotCard.style.display = "block";
    requestAnimationFrame(function(){ forgotCard.classList.add("visible"); });
}

function showLoginCard(){
    clearStatus(forgotStatus);
    forgotForm.reset();
    forgotCard.classList.remove("visible");
    forgotCard.style.display = "none";
    loginCard.style.display = "block";
    loginCard.classList.add("visible");
}

forgotPasswordLink.addEventListener("click", function(e){
    e.preventDefault();
    showForgotCard();
});

backToLoginLink.addEventListener("click", function(e){
    e.preventDefault();
    showLoginCard();
});

// Resolved relative to *this* page rather than window.location.origin, so
// it points at the real file wherever the site is served from - e.g.
// /frontend/pages/reset-password/index.html under a local static server
// rooted at the repo, or /pages/reset-password/index.html on Vercel with
// frontend/ as the root. (The old origin + "/reset-password/index.html"
// pointed at a path that doesn't exist - the "Cannot GET" error.) This
// exact URL must also be in Supabase's Redirect URLs allow-list, or
// Supabase silently falls back to the Site URL instead.
const RESET_PASSWORD_URL = new URL("../reset-password/index.html", window.location.href).href;

function describeForgotError(error){
    const message = (error.message || "").toLowerCase();
    if(error.status === 429 || error.code === "over_email_send_rate_limit" || message.includes("rate limit")){
        return "Too many reset requests. Please wait a few minutes before trying again.";
    }
    // Supabase's built-in email service only delivers to the project's own
    // team members; any other address is refused until custom SMTP is set
    // up (Authentication -> Emails -> SMTP Settings). A configuration
    // problem, not something the user typed wrong.
    if(error.code === "email_address_not_authorized" || message.includes("not authorized")){
        return "Password reset emails can't be sent to this address yet - the system's email service isn't fully set up. Please contact the OSOA office.";
    }
    if(message.includes("sending") || message.includes("smtp") || error.status >= 500){
        return "We couldn't send the reset email right now - email delivery may not be configured. Please try again later or contact the OSOA office.";
    }
    if(error.code === "email_address_invalid" || (message.includes("invalid") && message.includes("email"))){
        return LINGKOD_EMAIL_MESSAGE;
    }
    return "Couldn't send the reset email. Please try again.";
}

let isSendingReset = false;

forgotForm.addEventListener("submit", async function(e){
    e.preventDefault();
    if(isSendingReset) return;

    const email = forgotEmailInput.value.trim();
    clearStatus(forgotStatus);

    if(!lingkodIsEmailValid(email)){
        showStatus(forgotStatus, LINGKOD_EMAIL_MESSAGE, "error");
        forgotEmailInput.focus();
        return;
    }

    isSendingReset = true;
    setButtonLoading(forgotButton, true, "Sending...");

    try {
        // resetPasswordForEmail() intentionally does not reveal whether
        // the email exists (Supabase's own anti-enumeration behavior) -
        // it "succeeds" either way, and so does the message below. The
        // reset-password page itself is where an actually-invalid/expired
        // link gets a real error, once the user tries to use it.
        const { error } = await supabaseClient.auth.resetPasswordForEmail(email, {
            redirectTo: RESET_PASSWORD_URL
        });

        if(error){
            console.error("[login] resetPasswordForEmail failed:", error.status, error.code, error.message);
            showStatus(forgotStatus, describeForgotError(error), "error");
            return;
        }

        showStatus(forgotStatus, "If an account is registered with that email, a password reset link has been sent. Please check your inbox (and spam folder).", "success");
        forgotForm.reset();
    } catch(err){
        console.error("[login] unexpected error sending reset email:", err && err.message);
        showStatus(forgotStatus, "Something went wrong while sending the reset email. Please check your connection and try again.", "error");
    } finally {
        isSendingReset = false;
        setButtonLoading(forgotButton, false);
    }
});
