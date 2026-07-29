/* ===================================================
   LINGKOD Meneses - Shared Auth Form UI Helpers
   Used by login/register/reset-password - the three pre-authentication
   pages, which deliberately don't load js/common.js (that file's own
   DOMContentLoaded handler assumes a logged-in sidebar/dashboard shell
   that doesn't exist here - see login/script.js's own comment on this).
   DOM helpers only, specific to these three pages' own form chrome
   (status banner, button spinner, password-visibility toggle) - the
   validation rules these pages also need now live in js/validators.js,
   which is genuinely reusable app-wide and isn't pre-auth-specific.
   Load validators.js before this file.
   =================================================== */

function lingkodShowFieldError(input, errorEl, message){
    input.classList.add("invalid");
    if(errorEl){
        errorEl.textContent = message;
        errorEl.classList.add("visible");
    }
}

function lingkodClearFieldError(input, errorEl){
    input.classList.remove("invalid");
    if(errorEl){
        errorEl.textContent = "";
        errorEl.classList.remove("visible");
    }
}

function lingkodShowAuthStatus(el, message, type){
    el.textContent = message;
    el.className = "form-status visible " + type;
}

function lingkodClearAuthStatus(el){
    el.textContent = "";
    el.className = "form-status";
}

function lingkodSetAuthButtonLoading(button, isLoading, loadingText){
    if(isLoading){
        if(button.dataset.originalLabel === undefined){
            button.dataset.originalLabel = button.textContent;
        }
        button.disabled = true;
        button.innerHTML = "<span class=\"btn-spinner\"></span>" + loadingText;
    } else {
        button.disabled = false;
        if(button.dataset.originalLabel !== undefined){
            button.textContent = button.dataset.originalLabel;
            delete button.dataset.originalLabel;
        }
    }
}

// Wires every .toggle-password button on the page in one call - each
// button finds its own input via data-target, so this works regardless
// of how many password fields a given page has (login has one,
// register and reset-password each have two).
function lingkodWirePasswordToggles(){
    document.querySelectorAll(".toggle-password").forEach(function(btn){
        btn.addEventListener("click", function(){
            const input = document.getElementById(btn.getAttribute("data-target"));
            const icon = btn.querySelector("i");
            const isHidden = input.type === "password";

            input.type = isHidden ? "text" : "password";
            icon.classList.toggle("fa-eye", !isHidden);
            icon.classList.toggle("fa-eye-slash", isHidden);
            btn.setAttribute("aria-label", isHidden ? "Hide password" : "Show password");
        });
    });
}
