// LINGKOD Meneses - Supabase Edge Function (Deno runtime)
//
// Fixes a gap "Remove User" (frontend/pages/registered-users/script.js's
// removeUser()) always had: that action anonymizes the profiles row
// (status -> 'inactive', email -> a deleted-user@deleted.lingkod
// placeholder, student_number -> null, ...) but only ever touched the
// public.profiles table. It never had the privilege to touch the actual
// Supabase Auth account (auth.users), so the REAL email the person
// registered with stayed attached to that (now-inactive) auth user
// forever - auth.signUp() checks auth.users.email uniqueness, not
// profiles.email, so anyone trying to register again with that same
// email kept getting "already registered" even though the account they
// remembered was gone from every visible part of the app.
//
// Same trust boundary as permanently-erase-account/index.ts next to this
// file: no service-role key is ever shipped to the browser (frontend/js/
// supabase.js only ever uses the public anon key) - this function is the
// only place that key is used here, read from the Edge Function
// runtime's own environment, never committed to source control.
//
// Deliberately separate from permanently-erase-account: this only frees
// the email for reuse and leaves the auth account (and the profiles row,
// via `on delete cascade`) otherwise intact, so historical content still
// attributes to "Deleted User" - permanently-erase-account is the one
// that actually removes the auth account and everything cascading from
// it.
//
// Deploy with the Supabase CLI from a --workdir pointed at this
// project's database/ folder (or a supabase/ symlink to it - see the
// root README's "Note on the Supabase CLI"):
//   supabase functions deploy release-account-email

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
        return jsonResponse({ error: "Only OSOA Executive Board accounts can free up a removed user's email." }, 403);
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
        return jsonResponse({ error: "You cannot do this to your own administrator account." }, 400);
    }

    const { data: targetProfile, error: targetProfileError } = await adminClient
        .from("profiles")
        .select("id, status")
        .eq("id", targetUserId)
        .single();

    if(targetProfileError || !targetProfile){
        return jsonResponse({ error: "That user no longer exists." }, 404);
    }

    // Only ever called right after (or well after) Remove User has
    // already flipped this row to 'inactive' - re-checked here, not just
    // trusted from the frontend, since this is a privileged action a
    // determined caller could otherwise invoke directly against a still-
    // active account and lock a real, in-use email out from under its
    // owner.
    if(targetProfile.status !== "inactive"){
        return jsonResponse({ error: "Only an already-removed (deactivated) account's email can be freed. Use Remove User first." }, 400);
    }

    // Mirrors the placeholder removeUser() already writes to
    // profiles.email - same shape, so the auth account and the profile
    // row read as consistently anonymized. email_confirm: true skips
    // sending a confirmation email to this made-up address.
    const placeholderEmail = "deleted-user-" + targetUserId + "@deleted.lingkod";

    const { error: updateError } = await adminClient.auth.admin.updateUserById(targetUserId, {
        email: placeholderEmail,
        email_confirm: true
    });

    if(updateError){
        console.error("[release-account-email] updateUserById failed:", updateError);
        return jsonResponse({ error: "Failed to free up this account's email: " + updateError.message }, 500);
    }

    return jsonResponse({ success: true });
});
