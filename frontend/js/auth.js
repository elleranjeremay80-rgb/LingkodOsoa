/* ===================================================
   LINGKOD Meneses - Shared Auth / Role Access
   Session caching + role display helpers for real,
   Supabase-registered accounts only (no demo accounts).
   =================================================== */

const LINGKOD_SESSION_KEY = "lingkod_session";

// Shared role -> display label mapping, used anywhere a role needs to
// be shown to a user (session badge, login title, etc.) so it's only
// ever defined once. Only the LABEL changed here (Student -> Member) -
// the underlying role key ("student") stays exactly as-is everywhere
// else in the app (RLS policies, data-roles/data-role-view attributes,
// role === "student" checks) since that's an internal identifier, not
// display text - same pattern
// "admin"/"staff" already use for their own display labels.
const LINGKOD_ROLE_LABELS = {
    admin: "OSOA EB",
    staff: "Organization President",
    student: "Member"
};

// profiles.role is a Postgres enum using the DB's own vocabulary
// (osoa_eb/org_president/student) — not the admin/staff/student names
// every dashboard page's data-roles="..." gate (see common.js) already
// keys off. Translated once here, at session-build time, so nothing else
// in the app needs to know the DB's naming.
const LINGKOD_DB_ROLE_TO_UI_ROLE = {
    osoa_eb: "admin",
    org_president: "staff",
    student: "student"
};

// Converts a row from the Supabase "profiles" table into the
// {studentNumber, role, name, title} shape the session cache below
// stores, so the rest of the app only ever deals with one shape.
function lingkodBuildAccountFromProfile(profile){
    const uiRole = LINGKOD_DB_ROLE_TO_UI_ROLE[profile.role] || profile.role;
    return {
        studentNumber: profile.student_number,
        role: uiRole,
        name: profile.full_name,
        // The real, specific title (e.g. "Chairman", "Coordinator") - falls
        // back to the generic role label only when the account has no
        // specific position on file. Prefer this over `title` wherever the
        // account's title is displayed (e.g. the topbar) - `title` below is
        // kept only for any old cached session that predates this field.
        position: profile.position || null,
        title: LINGKOD_ROLE_LABELS[uiRole] || uiRole
    };
}

// Requests/feedback/submissions/repository all need the real Supabase
// user id (for requester_id/submitted_by, which RLS checks against
// auth.uid()) plus the profile's organization — neither of which lives
// in the sessionStorage session object above. Resolves to null if
// there's no active Supabase session or profile row; callers should
// treat that as "can't read/write these tables" rather than as a
// login failure.
async function lingkodGetAuthedProfile(){
    if(typeof supabaseClient === "undefined") return null;

    const { data: userData } = await supabaseClient.auth.getUser();
    if(!userData || !userData.user) return null;

    const { data: profile, error } = await supabaseClient
        .from("profiles")
        .select("id, full_name, first_name, student_number, organization, organization_id, position, role, avatar_url")
        .eq("id", userData.user.id)
        .single();

    if(error || !profile) return null;

    return profile;
}

// A local fast-path cache of the current session's display info
// (role/name/title), checked by pages before falling back to a real
// Supabase lookup. Respects the same Remember Me flag as the actual
// Supabase session (see js/supabase.js): persisted in localStorage
// when remembered, cleared with the browser session otherwise.
function lingkodSetSession(account){
    lingkodAuthStorage().setItem(LINGKOD_SESSION_KEY, JSON.stringify({
        studentNumber: account.studentNumber,
        role: account.role,
        name: account.name,
        position: account.position || null,
        title: account.title
    }));
}

function lingkodGetSession(){
    const raw = lingkodAuthStorage().getItem(LINGKOD_SESSION_KEY);
    return raw ? JSON.parse(raw) : null;
}

function lingkodClearSession(){
    sessionStorage.removeItem(LINGKOD_SESSION_KEY);
    localStorage.removeItem(LINGKOD_SESSION_KEY);
}

// Ends both the real Supabase session and the local session cache.
// Safe to call even if there's no Supabase session — signOut() on an
// already-signed-out client is a no-op.
async function lingkodSignOut(){
    lingkodClearSession();
    if(typeof supabaseClient !== "undefined"){
        await supabaseClient.auth.signOut();
    }
}
