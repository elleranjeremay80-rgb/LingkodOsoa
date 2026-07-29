/* ===================================================
   LINGKOD Meneses - Supabase Connection
   Single shared client every page reuses. Requires the
   Supabase JS SDK (v2) loaded via CDN *before* this file:

   <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>
   <script src="../../js/supabase.js"></script>

   The SDK exposes a global `supabase` namespace with
   .createClient(). We name our client "supabaseClient" so
   it doesn't collide with that global.
   =================================================== */

const SUPABASE_URL = "https://ydfmxqiqozapsyxfisog.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_CiSfNviDtLcpo2ZkJgr0lw_Bd9PIz6T";

// "Remember Me" (see login/script.js) decides *where* Supabase persists
// the session token: localStorage survives closing the browser entirely;
// sessionStorage is wiped the moment the tab/browser closes. This one
// flag has to live in localStorage unconditionally - it isn't the
// session itself, just a preference - so every page load (not only the
// login page) knows which storage today's active session actually lives
// in. Defaults to "not remembered" (sessionStorage) when nobody has ever
// made a choice yet, matching the login checkbox's own unchecked default.
const LINGKOD_REMEMBER_ME_KEY = "lingkod_remember_me";

function lingkodIsRememberMeEnabled(){
    return localStorage.getItem(LINGKOD_REMEMBER_ME_KEY) === "1";
}

function lingkodAuthStorage(){
    return lingkodIsRememberMeEnabled() ? window.localStorage : window.sessionStorage;
}

const supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: {
        persistSession: true,
        storage: lingkodAuthStorage(),
        autoRefreshToken: true,
        detectSessionInUrl: true
    }
});
