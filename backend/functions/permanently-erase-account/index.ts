// LINGKOD Meneses - Supabase Edge Function (Deno runtime)
//
// The one privileged operation this app's static frontend genuinely can't
// do itself: permanently deleting a user's actual Supabase Auth account.
// No service-role key is ever shipped to the browser (frontend/js/
// supabase.js only ever uses the public anon key) - this function is the
// only place that key is used, and it's read from the Edge Function
// runtime's own environment (Supabase injects SUPABASE_URL,
// SUPABASE_ANON_KEY, and SUPABASE_SERVICE_ROLE_KEY into every function
// automatically), never committed to source control.
//
// Distinct from "Remove User" (frontend/pages/registered-users/script.js's
// removeUser()), which anonymizes the profile row but deliberately keeps
// it alive so a user's old messages/announcements/submissions still show
// a poster as "Deleted User". profiles.id has `on delete cascade` back to
// auth.users(id) (see database/migrations/20260713000000_profiles_and_
// login.sql) - actually deleting the auth account, as this function does,
// cascades and removes the profile row too, so historical content that
// referenced this user loses that attribution entirely. That's why this
// is a separate, rarer action from Remove User, not a replacement for it
// - see registered-users/script.js's permanentlyEraseUser() for the
// (very explicit) confirmation copy shown before anyone can reach here,
// and why this function itself also refuses to run against a still-
// active account (must be deactivated via Remove User first).
//
// Deploy with the Supabase CLI from a --workdir pointed at this
// project's database/ folder (or a supabase/ symlink to it - see the
// root README's "Note on the Supabase CLI"):
//   supabase functions deploy permanently-erase-account

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CORS_HEADERS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS"
};

function jsonResponse(body: unknown, status = 200){
    return new Response(JSON.stringify(body), {
        status: status,
        headers: Object.assign({ "Content-Type": "application/json" }, CORS_HEADERS)
    });
}

Deno.serve(async function(req){
    if(req.method === "OPTIONS"){
        return new Response("ok", { headers: CORS_HEADERS });
    }

    if(req.method !== "POST"){
        return jsonResponse({ error: "Method not allowed." }, 405);
    }

    const authHeader = req.headers.get("Authorization");
    if(!authHeader){
        return jsonResponse({ error: "Missing Authorization header." }, 401);
    }

    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

    // Two clients, deliberately kept separate: callerClient only ever
    // finds out who's asking (via their own JWT) and is never used to
    // write anything. adminClient (service-role) is the only one that
    // can bypass RLS or call the Admin API - everything it's asked to do
    // below is gated by the callerClient identity check first.
    const callerClient = createClient(SUPABASE_URL, ANON_KEY, {
        global: { headers: { Authorization: authHeader } }
    });
    const adminClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

    const { data: callerData, error: callerError } = await callerClient.auth.getUser();
    if(callerError || !callerData || !callerData.user){
        return jsonResponse({ error: "Not authenticated." }, 401);
    }
    const callerId = callerData.user.id;

    const { data: callerProfile, error: callerProfileError } = await adminClient
        .from("profiles")
        .select("id, role")
        .eq("id", callerId)
        .single();

    if(callerProfileError || !callerProfile || callerProfile.role !== "osoa_eb"){
        return jsonResponse({ error: "Only OSOA Executive Board accounts can permanently erase a user." }, 403);
    }

    let body: { userId?: string };
    try {
        body = await req.json();
    } catch {
        return jsonResponse({ error: "Invalid request body." }, 400);
    }

    const targetUserId = body.userId;
    if(!targetUserId || typeof targetUserId !== "string"){
        return jsonResponse({ error: "userId is required." }, 400);
    }

    if(targetUserId === callerId){
        return jsonResponse({ error: "You cannot erase your own administrator account." }, 400);
    }

    const { data: targetProfile, error: targetProfileError } = await adminClient
        .from("profiles")
        .select("id, role, status")
        .eq("id", targetUserId)
        .single();

    if(targetProfileError || !targetProfile){
        return jsonResponse({ error: "That user no longer exists." }, 404);
    }

    // Requires the account to already be deactivated (via Remove User)
    // before it can be erased - a deliberate two-step safety rail so a
    // single click on this far more severe, irreversible action can
    // never be the first thing that happens to a still-active account.
    // Enforced here, not just hidden in the UI, since this is a
    // privileged action a determined caller could otherwise invoke
    // directly, bypassing whatever the frontend shows.
    if(targetProfile.status !== "inactive"){
        return jsonResponse({ error: "Only an already-removed (deactivated) account can be permanently erased. Use Remove User first." }, 400);
    }

    // Mirrors registered-users/script.js's explainWhyUserCantBeDeactivated()
    // - "at least one OSOA EB account must remain active" - re-checked
    // here for the same reason as the status check above.
    if(targetProfile.role === "osoa_eb"){
        const { count, error: countError } = await adminClient
            .from("profiles")
            .select("id", { count: "exact", head: true })
            .eq("role", "osoa_eb")
            .eq("status", "active")
            .neq("id", targetUserId);

        if(countError){
            return jsonResponse({ error: "Could not verify remaining OSOA EB accounts." }, 500);
        }
        if(!count || count === 0){
            return jsonResponse({ error: "At least one OSOA Executive Board account must remain active." }, 400);
        }
    }

    // Cascades: profiles.id references auth.users(id) on delete cascade,
    // so this removes the profile row too - deliberately, since this is
    // the "permanent, no trace" action.
    const { error: deleteError } = await adminClient.auth.admin.deleteUser(targetUserId);

    if(deleteError){
        console.error("[permanently-erase-account] deleteUser failed:", deleteError);
        return jsonResponse({ error: "Failed to erase this account: " + deleteError.message }, 500);
    }

    return jsonResponse({ success: true });
});
