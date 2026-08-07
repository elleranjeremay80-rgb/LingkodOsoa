const registerForm = document.getElementById("registerForm");
const registerButton = registerForm.querySelector("button[type=\"submit\"]");
const formStatus = document.getElementById("formStatus");

const lastNameInput = registerForm.elements.lastName;
const firstNameInput = registerForm.elements.firstName;
const middleNameInput = registerForm.elements.middleName;
const studentNumberInput = registerForm.elements.studentNumber;
const departmentSelect = registerForm.elements.department;
const organizationSelect = registerForm.elements.organization;
const positionSelect = document.getElementById("positionSelect");
const emailInput = registerForm.elements.email;
const passwordInput = document.getElementById("password");
const confirmPasswordInput = document.getElementById("confirmPassword");
const passwordError = document.getElementById("passwordError");
const confirmPasswordError = document.getElementById("confirmPasswordError");

lingkodWirePasswordToggles();

// Rule/message and field-error helpers all now live in js/auth-forms.js
// (loaded before this file) - the exact same PASSWORD_RULE reset-
// password/script.js enforces, from one definition instead of two
// hand-kept-in-sync copies. Aliased under their original names so every
// call site below is unchanged.
const PASSWORD_RULE = LINGKOD_PASSWORD_RULE;
const PASSWORD_MESSAGE = LINGKOD_PASSWORD_MESSAGE;
const NAME_RULE = LINGKOD_NAME_RULE;
const NAME_MESSAGE = LINGKOD_NAME_MESSAGE;
const STUDENT_NUMBER_MESSAGE = LINGKOD_STUDENT_NUMBER_MESSAGE;
const EMAIL_RULE = LINGKOD_EMAIL_RULE;
const showError = lingkodShowFieldError;
const clearError = lingkodClearFieldError;

/* ================= FIELD VALIDITY (pure checks, no DOM side effects) ================= */
// Kept separate from the "show the error" functions below so the Register
// button's enabled state can be recomputed on every keystroke without
// flashing red error text at fields the user hasn't reached yet.

function isNameValid(value){
    const trimmed = value.trim();
    return trimmed.length > 0 && NAME_RULE.test(trimmed);
}

function isStudentNumberValid(value){
    return /^\d{10}$/.test(value.trim());
}

function isSelectValid(select){
    return !!select.value;
}

function isEmailValid(value){
    return EMAIL_RULE.test(value.trim());
}

function isPasswordValid(){
    return PASSWORD_RULE.test(passwordInput.value);
}

function isConfirmPasswordValid(){
    return PASSWORD_RULE.test(confirmPasswordInput.value) && confirmPasswordInput.value === passwordInput.value;
}

function isFormValid(){
    return isNameValid(lastNameInput.value) && isNameValid(firstNameInput.value) && isNameValid(middleNameInput.value)
        && isStudentNumberValid(studentNumberInput.value)
        && isSelectValid(departmentSelect) && isSelectValid(organizationSelect) && isSelectValid(positionSelect)
        && isEmailValid(emailInput.value) && isPasswordValid() && isConfirmPasswordValid();
}

function updateRegisterButtonState(){
    registerButton.disabled = !isFormValid();
}

/* ================= FIELD WIRING (real-time filtering + validation display) ================= */

function filterNameInput(e){
    e.target.value = e.target.value.replace(/[^A-Za-z' -]/g, "");
}

function filterStudentNumberInput(e){
    e.target.value = e.target.value.replace(/\D/g, "").slice(0, 10);
}

// Errors show on blur (so the form doesn't open with every field already
// red) and stay live-updated on input once a field has been flagged, so
// the error clears the moment the user fixes it rather than lingering
// until they click away again.
function wireField(input, errorEl, checkFn, message, filterFn){
    function validateAndShow(){
        if(!checkFn()){
            showError(input, errorEl, typeof message === "function" ? message() : message);
        } else {
            clearError(input, errorEl);
        }
        updateRegisterButtonState();
    }

    if(filterFn){
        input.addEventListener("input", filterFn);
    }

    input.addEventListener("blur", function(){
        input.value = input.value.trim();
        validateAndShow();
    });

    input.addEventListener(input.tagName === "SELECT" ? "change" : "input", function(){
        if(input.classList.contains("invalid")) validateAndShow();
        updateRegisterButtonState();
    });
}

wireField(lastNameInput, document.getElementById("lastNameError"), function(){ return isNameValid(lastNameInput.value); }, "Last Name " + NAME_MESSAGE, filterNameInput);
wireField(firstNameInput, document.getElementById("firstNameError"), function(){ return isNameValid(firstNameInput.value); }, "First Name " + NAME_MESSAGE, filterNameInput);
wireField(middleNameInput, document.getElementById("middleNameError"), function(){ return isNameValid(middleNameInput.value); }, "Middle Name " + NAME_MESSAGE, filterNameInput);
wireField(studentNumberInput, document.getElementById("studentNumberError"), function(){ return isStudentNumberValid(studentNumberInput.value); }, STUDENT_NUMBER_MESSAGE, filterStudentNumberInput);
wireField(departmentSelect, document.getElementById("departmentError"), function(){ return isSelectValid(departmentSelect); }, "Please select a Department.");
wireField(organizationSelect, document.getElementById("organizationError"), function(){ return isSelectValid(organizationSelect); }, "Please select a Student Organization.");
wireField(positionSelect, document.getElementById("positionError"), function(){ return isSelectValid(positionSelect); }, "Please select a Position.");
wireField(emailInput, document.getElementById("emailError"), function(){ return isEmailValid(emailInput.value); }, "Please enter a valid email address.");

// Purely visual feedback (never gates submission - PASSWORD_RULE/
// isPasswordValid() above remain the only real validation) - counts how
// many of the five password criteria are currently met and reflects that
// as a filled bar + label, so the user sees progress while typing instead
// of only a pass/fail error after the fact.
const passwordStrengthWrap = document.getElementById("passwordStrength");
const passwordStrengthBar = document.getElementById("passwordStrengthBar");
const passwordStrengthLabel = document.getElementById("passwordStrengthLabel");
const PASSWORD_STRENGTH_LEVELS = [
    { label: "Very Weak", color: "#DB1B4C" },
    { label: "Weak", color: "#E73F1E" },
    { label: "Fair", color: "#FB6C00" },
    { label: "Good", color: "#F9B637" },
    { label: "Strong", color: "#1E8A4C" }
];

function updatePasswordStrength(){
    const value = passwordInput.value;

    if(!value){
        passwordStrengthWrap.hidden = true;
        return;
    }

    let score = 0;
    if(value.length >= 8) score++;
    if(/[A-Z]/.test(value)) score++;
    if(/[a-z]/.test(value)) score++;
    if(/\d/.test(value)) score++;
    if(/[^A-Za-z0-9]/.test(value)) score++;

    const level = PASSWORD_STRENGTH_LEVELS[Math.max(0, score - 1)];
    passwordStrengthWrap.hidden = false;
    passwordStrengthBar.style.width = (score / 5 * 100) + "%";
    passwordStrengthBar.style.backgroundColor = level.color;
    passwordStrengthLabel.textContent = level.label;
    passwordStrengthLabel.style.color = level.color;
}

passwordInput.addEventListener("input", updatePasswordStrength);

function validatePassword(){
    if(!isPasswordValid()){
        showError(passwordInput, passwordError, PASSWORD_MESSAGE);
        updateRegisterButtonState();
        return false;
    }
    clearError(passwordInput, passwordError);
    updateRegisterButtonState();
    return true;
}

function validateConfirmPassword(){
    if(!PASSWORD_RULE.test(confirmPasswordInput.value)){
        showError(confirmPasswordInput, confirmPasswordError, PASSWORD_MESSAGE);
        updateRegisterButtonState();
        return false;
    }
    if(confirmPasswordInput.value !== passwordInput.value){
        showError(confirmPasswordInput, confirmPasswordError, "Passwords do not match.");
        updateRegisterButtonState();
        return false;
    }
    clearError(confirmPasswordInput, confirmPasswordError);
    updateRegisterButtonState();
    return true;
}

passwordInput.addEventListener("input", validatePassword);
confirmPasswordInput.addEventListener("input", validateConfirmPassword);

// Start disabled - isFormValid() is false until every required field is
// filled in.
updateRegisterButtonState();

// Position now drives the account's access level indirectly: the user
// picks a real job title (Chairperson, President, Secretary, ...), and
// the role that title grants is looked up from organization_positions -
// never chosen directly. The lookup happens twice: here (client-side,
// cached from the dropdown's own fetch) purely so the client-side
// profiles upsert fallback has a role value to write if the signup
// trigger's own insert didn't happen; and again, authoritatively, inside
// handle_new_user() itself server-side. A client bypassing this form
// entirely could still send an arbitrary "role" in the upsert, same
// trust boundary this self-service signup flow already had before this
// change - closing that fully would mean revoking self-INSERT on the
// role column, a separate, bigger hardening step this task didn't ask for.
let positionsByOrgId = {};   // organization_id -> [{id, position_name, system_role}, ...]
let currentPositionsById = {}; // position_name -> system_role, for the currently-loaded organization

async function loadPositionsForOrganization(organizationId){
    positionSelect.innerHTML = "";
    currentPositionsById = {};

    if(!organizationId){
        positionSelect.disabled = true;
        const placeholder = document.createElement("option");
        placeholder.value = "";
        placeholder.disabled = true;
        placeholder.selected = true;
        placeholder.textContent = "Select an organization first";
        positionSelect.appendChild(placeholder);
        updateRegisterButtonState();
        return;
    }

    if(!positionsByOrgId[organizationId]){
        const { data, error } = await supabaseClient
            .from("organization_positions")
            .select("position_name, system_role")
            .eq("organization_id", organizationId)
            .eq("is_active", true)
            .order("display_order");

        if(error){
            console.error("[register] position list load failed:", error);
            showFormStatus("Couldn't load positions for this organization: " + error.message, "error");
            positionSelect.disabled = true;
            return;
        }

        positionsByOrgId[organizationId] = data;
    }

    const placeholder = document.createElement("option");
    placeholder.value = "";
    placeholder.disabled = true;
    placeholder.selected = true;
    placeholder.textContent = "Select Position";
    positionSelect.appendChild(placeholder);

    positionsByOrgId[organizationId].forEach(function(row){
        const opt = document.createElement("option");
        opt.value = row.position_name;
        opt.textContent = row.position_name;
        positionSelect.appendChild(opt);
        currentPositionsById[row.position_name] = row.system_role;
    });

    positionSelect.disabled = false;
    updateRegisterButtonState();
}

organizationSelect.addEventListener("change", async function(){
    const slug = organizationSelect.value;
    if(!slug){
        await loadPositionsForOrganization(null);
        return;
    }

    try {
        const organization = await lookupBySlug("organizations", slug);
        await loadPositionsForOrganization(organization.id);
    } catch(err){
        console.error("[register] organization lookup for positions failed:", err);
        showFormStatus("Couldn't load positions: " + err.message, "error");
        await loadPositionsForOrganization(null);
    }
});

function showFormStatus(message, type){
    lingkodShowAuthStatus(formStatus, message, type);
}

// The Department/Organization <select> elements send human-readable slugs
// (e.g. "information-technology"), but profiles.department_id/
// organization_id are real foreign keys into the departments/organizations
// lookup tables. This resolves a slug to its {id, name} row before we ever
// call signUp(), so both the profile upsert below and the signup metadata
// (read by the handle_new_user() safety-net trigger) always carry a real
// UUID rather than raw text.
async function lookupBySlug(table, slug){
    const { data, error } = await supabaseClient
        .from(table)
        .select("id, name")
        .eq("slug", slug)
        .maybeSingle();

    if(error){
        throw new Error(error.message);
    }
    if(!data){
        throw new Error("No matching " + table.slice(0, -1) + " found for \"" + slug + "\". Please select a valid option.");
    }
    return data;
}

// The account's role comes from the Position dropdown the user selected,
// via organization_positions.system_role (see loadPositionsForOrganization
// and currentPositionsById) — self-registration still grants OSOA EB and
// Organization President access immediately, with no approval step, same
// as before this change; the difference is *which* position leads there
// is now data-driven instead of the position list literally being
// role names.
//
// This function either fully succeeds (auth user + profile row both
// confirmed written) or throws — there is no ambiguous middle state.
// Requires "Confirm email" to be off in Supabase (see the thrown error
// below if it isn't), since writing the profile needs an active session,
// which Supabase only returns immediately when confirmation isn't required.
async function registerUser(fields){
    let department, organization;
    try {
        department = await lookupBySlug("departments", fields.departmentSlug);
    } catch(err){
        console.error("[register] department lookup failed:", err);
        throw new Error("Department mapping failed: " + err.message);
    }
    try {
        organization = await lookupBySlug("organizations", fields.organizationSlug);
    } catch(err){
        console.error("[register] organization lookup failed:", err);
        throw new Error("Organization mapping failed: " + err.message);
    }

    // Client-side check for a friendly error before ever attempting
    // signUp() - only President/OSOA positions are checked (regular
    // "Member"-type positions can have any number of holders). Goes
    // through is_position_filled() (security definer RPC) rather than
    // querying profiles directly - there's no session yet at this point
    // in registration, and anon's column grants on profiles don't cover
    // organization_id/position. The real, race-condition-proof
    // enforcement is the database's own partial unique index
    // (profiles_unique_position_per_org, added alongside
    // organization_positions) - this is purely a nicer error message for
    // the common case, not the actual security boundary.
    if(fields.role === "osoa_eb" || fields.role === "org_president"){
        const { data: isFilled, error: holderCheckError } = await supabaseClient
            .rpc("is_position_filled", { p_organization_id: organization.id, p_position: fields.positionLabel });

        if(holderCheckError){
            console.error("[register] position availability check failed:", holderCheckError);
        } else if(isFilled){
            throw new Error("The \"" + fields.positionLabel + "\" position for this organization is already filled. Contact your OSOA EB administrator if this needs to change.");
        }
    }

    // Without this, Supabase falls back to whatever "Site URL" is set to
    // in your dashboard (Authentication -> URL Configuration) after email
    // confirmation — which is almost certainly why the confirmation link
    // led to "This site can't be reached." Using window.location.origin
    // instead of hardcoding a port means this keeps working if you ever
    // run the app from a different port or a real domain later.
    const emailRedirectTo = window.location.origin + "/login/index.html";

    const { data, error } = await supabaseClient.auth.signUp({
        email: fields.email,
        password: fields.password,
        options: {
            emailRedirectTo: emailRedirectTo,
            data: {
                last_name: fields.lastName,
                first_name: fields.firstName,
                middle_name: fields.middleName,
                student_number: fields.studentNumber,
                department_id: department.id,
                department_name: department.name,
                organization_id: organization.id,
                organization_name: organization.name,
                position: fields.positionLabel,
                role: fields.role
            }
        }
    });

    if(error){
        console.error("[register] auth.signUp failed:", error);
        throw new Error("Authentication failed: " + error.message);
    }

    if(!data.session){
        // No session means Supabase Auth still has "Confirm email" turned
        // on for this project — that's a dashboard setting (Authentication
        // -> Providers -> Email), not something this code can override.
        // We CANNOT write to profiles from here either way — the insert
        // policy requires auth.uid() = id, and there is no session yet to
        // satisfy that. Rather than guess whether the background trigger
        // will eventually create the profile, treat this as a real error:
        // the "register once, log in immediately" flow the app promises
        // genuinely cannot work until that setting is off.
        console.error("[register] no active session after signUp — 'Confirm email' is still enabled in Supabase.");
        throw new Error("Registration could not be completed automatically because email confirmation is still enabled on this project. In your Supabase dashboard, go to Authentication → Providers → Email and turn off \"Confirm email\", then try registering again.");
    }

    // full_name is a generated column (last_name/first_name/middle_name
    // combined server-side) - it must NOT appear in this payload, or
    // Postgres rejects the write.
    //
    // ignoreDuplicates: true is deliberate, not incidental - it makes this
    // an INSERT ... ON CONFLICT (id) DO NOTHING rather than a DO UPDATE.
    // Without it, Postgres requires UPDATE privilege on every column in the
    // SET clause even when the row is brand new and no conflict actually
    // happens (the planner has to allow for the branch, not just the
    // outcome) - and 20260718000000_profile_self_edit_lockdown.sql
    // deliberately (and correctly, to close a self-role-escalation hole in
    // Edit Profile) only grants authenticated UPDATE on a handful of
    // columns, not email/student_number/position/role/status. That
    // mismatch is exactly what "permission denied for table profiles" on
    // registration was - loosening those grants back up would reopen that
    // hole, so the fix belongs here instead: registration only ever needs
    // to *create* a row, never update one, and by the time this runs the
    // handle_new_user() trigger (see the migration that added it) has
    // almost always already inserted an identical row from the same
    // signUp() metadata - this is a same-data fallback for the rare case
    // that trigger's own insert failed, not a competing write.
    const { error: profileError } = await supabaseClient
        .from("profiles")
        .upsert({
            id: data.user.id,
            email: fields.email,
            last_name: fields.lastName,
            first_name: fields.firstName,
            middle_name: fields.middleName,
            student_number: fields.studentNumber,
            department: department.name,
            department_id: department.id,
            organization: organization.name,
            organization_id: organization.id,
            position: fields.positionLabel,
            role: fields.role,
            status: "active"
        }, { onConflict: "id", ignoreDuplicates: true });

    if(profileError){
        console.error("[register] profile upsert failed:", profileError);
        throw new Error("Profile insertion failed: " + profileError.message);
    }

    return data;
}

// The unique-student-number violation surfaces from Postgres via the
// signup trigger as a generic "Database error saving new user" message,
// so we pattern-match the underlying reason to show something useful.
// Also covers the backend CHECK constraints added alongside the frontend
// rules (name format / student number format / required selects) in case
// they're ever hit despite the frontend already enforcing them - e.g. a
// direct API call bypassing this form.
function friendlyRegisterError(err){
    const message = (err && err.message) || "";

    if(/duplicate key|already registered|already exists/i.test(message)){
        if(/student_number/i.test(message)){
            return "This Student Number is already registered. Please log in instead.";
        }
        if(/profiles_unique_position_per_org/i.test(message)){
            return "This position is already filled for the selected organization. Contact your OSOA EB administrator if this needs to change.";
        }
        return "An account with this email already exists. Please log in instead.";
    }

    if(/profiles_student_number_format/i.test(message)){
        return STUDENT_NUMBER_MESSAGE;
    }
    if(/profiles_(last_name|first_name|middle_name)_format/i.test(message)){
        return "Names may only contain letters, spaces, apostrophes, and hyphens.";
    }
    if(/profiles_department_required/i.test(message)){
        return "Please select a Department.";
    }
    if(/profiles_organization_required/i.test(message)){
        return "Please select a Student Organization.";
    }
    if(/profiles_position_required/i.test(message)){
        return "Please select a Position.";
    }

    // Not expected to fire in normal use (the upsert above no longer
    // touches columns it isn't granted) - kept as a clear, administrator-
    // actionable message rather than a raw Postgres string, in case a
    // future grant/policy change breaks this again.
    if(/permission denied/i.test(message)){
        return "Registration couldn't save your profile due to a database permissions issue. Please contact an administrator - the Supabase project's profiles table grants or RLS policies need review.";
    }
    if(/row-level security/i.test(message)){
        return "Registration couldn't save your profile because you weren't fully signed in yet. Please try registering again.";
    }
    if(/invalid input syntax for type uuid/i.test(message)){
        return "Something went wrong identifying your account. Please try registering again.";
    }
    if(/fetch|network|failed to fetch|NetworkError/i.test(message)){
        return "Couldn't reach the server. Please check your internet connection and try again.";
    }

    return message || "Something went wrong while registering. Please try again.";
}

registerForm.addEventListener("submit", async function(e){
    e.preventDefault();

    if(!isFormValid()){
        showFormStatus("Please fix the highlighted fields before submitting.", "error");
        return;
    }

    const positionValue = positionSelect.value;

    const fields = {
        lastName: lastNameInput.value.trim(),
        firstName: firstNameInput.value.trim(),
        middleName: middleNameInput.value.trim(),
        studentNumber: studentNumberInput.value.trim(),
        departmentSlug: departmentSelect.value,
        organizationSlug: organizationSelect.value,
        positionLabel: positionValue,
        role: currentPositionsById[positionValue] || "student",
        email: emailInput.value.trim(),
        password: passwordInput.value
    };

    lingkodSetAuthButtonLoading(registerButton, true, "Registering...");
    formStatus.className = "form-status";

    try {
        await registerUser(fields);

        // By the time registerUser() resolves without throwing, the
        // profiles row is confirmed written — safe to promise immediate
        // login.
        showFormStatus("Registration successful! You can now log in using your Student Number and Password.", "success");
        setTimeout(function(){
            window.location.href = "../login/index.html";
        }, 1800);
    } catch(err){
        showFormStatus(friendlyRegisterError(err), "error");
        lingkodSetAuthButtonLoading(registerButton, false);
    }
});
