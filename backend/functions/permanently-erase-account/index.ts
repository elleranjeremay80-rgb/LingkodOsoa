// LINGKOD Meneses - Supabase Edge Function (Deno runtime)
//
// The one privileged operation this app's static frontend genuinely can't
// do itself: permanently deleting a user's actual Supabase Auth account.
// No service-role key is ever shipped to the browser (frontend/js/
// supabase.js only ever uses the public publishable key) - this function
// is the only place that key is used, and it's read from the Edge Function
// runtime's own environment (Supabase injects SUPABASE_URL and
// SUPABASE_SERVICE_ROLE_KEY into every function automatically), never
// committed to source control.
//
// Called by both Registered Users delete entry points: "Delete" (an active
// account) and "Permanently Erase Account" (a row left inactive by the old
// soft-delete behavior) - see frontend/pages/registered-users/script.js's
// deleteUserAccount().
//
// What a delete does, and why it's safe to re-register afterwards:
//   - auth.admin.deleteUser() hard-deletes the auth.users row, which frees
//     the email address in Supabase Auth.
//   - profiles.id references auth.users(id) ON DELETE CASCADE, so the
//     profile row - and with it the unique student number and any
//     position it held (is_position_filled() only counts live profiles) -
//     goes too.
//   - Every other table that points at the user is either ON DELETE
//     CASCADE for purely personal state (conversation membership,
//     reactions, blocks, notifications, settings) or ON DELETE SET NULL
//     for shared/historical records (messages, announcements, submissions,
//     requests, feedback, documents, reports, audit logs), so those
//     records survive with no owner instead of being destroyed. Because
//     they're linked by the old account's UUID - never by email or student
//     number - a later re-registration gets a brand-new UUID and can never
//     inherit them.
//   - Storage is never FK-cascaded, so this function removes the user's
//     own profile-images/<id>/ folder (their avatar) itself. Files they
//     uploaded into shared records (documents, submissions, chat
//     attachments, reports) are deliberately kept - those belong to the
//     record, which other people still rely on.
//
// Deploy (see backend/README.md for the --workdir note):
//   supabase functions deploy permanently-erase-account --no-verify-jwt
// --no-verify-jwt is intentional, not a security relaxation: the gateway's
// legacy JWT check isn't compatible with Supabase's newer signing keys /
// publishable keys (which this project uses), and this function verifies
// the caller's token itself below via auth.getUser() before doing anything.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const UUID_RULE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const AVATAR_BUCKET = "profile-images";

// Echo whatever headers the browser's preflight asks for - newer
// supabase-js releases add their own x-supabase-* client headers, and a
// fixed allow-list that misses one makes the browser block the request
// before it's ever sent ("Failed to send a request to the Edge Function").
function corsHeaders(req: Request){
    return {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": req.headers.get("Access-Control-Request-Headers")
            || "authorization, x-client-info, apikey, content-type",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Max-Age": "86400"
    };
}

Deno.serve(async function(req){
    function jsonResponse(body: Record<string, unknown>, status = 200){
        return new Response(JSON.stringify(body), {
            status: status,
            headers: Object.assign({ "Content-Type": "application/json" }, corsHeaders(req))
        });
    }

    if(req.method === "OPTIONS"){
        return new Response(null, { status: 204, headers: corsHeaders(req) });
    }
    if(req.method !== "POST"){
        return jsonResponse({ error: "Method not allowed." }, 405);
    }

    const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
    const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if(!SUPABASE_URL || !SERVICE_ROLE_KEY){
        console.error("[permanently-erase-account] missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in the function environment");
        return jsonResponse({ error: "The account deletion service is not configured correctly. Please contact the system administrator." }, 500);
    }

    const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "").trim();
    if(!token){
        return jsonResponse({ error: "You are not logged in. Please log in again and retry." }, 401);
    }

    // Service-role client: used to verify the caller's token, read trusted
    // role data, and call the Admin API. Every privileged step below is
    // gated on the caller checks that come first.
    const adminClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
        auth: { autoRefreshToken: false, persistSession: false }
    });

    try {
        /* ---------- 1. Who is calling? (never trust the request body for this) ---------- */
        const { data: callerData, error: callerError } = await adminClient.auth.getUser(token);
        if(callerError || !callerData || !callerData.user){
            return jsonResponse({ error: "Your session has expired. Please log in again and retry." }, 401);
        }
        const callerId = callerData.user.id;

        const { data: callerProfile, error: callerProfileError } = await adminClient
            .from("profiles")
            .select("id, role, status")
            .eq("id", callerId)
            .maybeSingle();

        if(callerProfileError){
            console.error("[permanently-erase-account] caller profile lookup failed:", callerProfileError.message);
            return jsonResponse({ error: "Could not verify your permissions. Please try again." }, 500);
        }
        if(!callerProfile || callerProfile.role !== "osoa_eb" || callerProfile.status !== "active"){
            return jsonResponse({ error: "Only active OSOA Executive Board accounts can delete registered users." }, 403);
        }

        /* ---------- 2. Validate the target ---------- */
        let body: { userId?: unknown };
        try {
            body = await req.json();
        } catch {
            return jsonResponse({ error: "Invalid request body." }, 400);
        }

        const targetUserId = typeof body.userId === "string" ? body.userId.trim() : "";
        if(!UUID_RULE.test(targetUserId)){
            return jsonResponse({ error: "A valid user ID is required." }, 400);
        }
        if(targetUserId === callerId){
            return jsonResponse({ error: "You cannot delete your own administrator account." }, 400);
        }

        const [{ data: targetProfile, error: targetProfileError }, { data: targetAuth, error: targetAuthError }] = await Promise.all([
            adminClient.from("profiles").select("id, role, status, full_name, organization").eq("id", targetUserId).maybeSingle(),
            adminClient.auth.admin.getUserById(targetUserId)
        ]);

        if(targetProfileError){
            console.error("[permanently-erase-account] target profile lookup failed:", targetProfileError.message);
            return jsonResponse({ error: "Could not look up this user. Please try again." }, 500);
        }
        const authUserExists = !targetAuthError && !!(targetAuth && targetAuth.user);
        if(!targetProfile && !authUserExists){
            return jsonResponse({ error: "This user no longer exists. The list will refresh." }, 404);
        }

        // At least one active OSOA EB must remain to administer the system.
        if(targetProfile && targetProfile.role === "osoa_eb"){
            const { count, error: countError } = await adminClient
                .from("profiles")
                .select("id", { count: "exact", head: true })
                .eq("role", "osoa_eb")
                .eq("status", "active")
                .neq("id", targetUserId);

            if(countError){
                console.error("[permanently-erase-account] OSOA EB count failed:", countError.message);
                return jsonResponse({ error: "Could not verify remaining OSOA EB accounts. Please try again." }, 500);
            }
            if(!count){
                return jsonResponse({ error: "At least one OSOA Executive Board account must remain active." }, 400);
            }
        }

        /* ---------- 3. Delete the login (cascades to the profile) ---------- */
        if(authUserExists){
            const { error: deleteError } = await adminClient.auth.admin.deleteUser(targetUserId);
            if(deleteError){
                console.error("[permanently-erase-account] deleteUser failed:", deleteError.status, deleteError.message);
                const blockedByDatabase = /database error/i.test(deleteError.message || "");
                return jsonResponse({
                    error: blockedByDatabase
                        ? "The database blocked deleting this account because another record still depends on it. No changes were made."
                        : "Supabase could not delete this account's login. No changes were made. Please try again."
                }, 500);
            }
        }

        // Normally already gone via ON DELETE CASCADE; removes a profile
        // left without a login (or survives a cascade that didn't fire) so
        // its student number is genuinely released.
        const { error: profileDeleteError } = await adminClient.from("profiles").delete().eq("id", targetUserId);
        if(profileDeleteError){
            console.error("[permanently-erase-account] profile cleanup failed:", profileDeleteError.message);
        }

        /* ---------- 4. Confirm it's really gone before reporting success ---------- */
        const [{ data: leftoverProfile }, { data: leftoverAuth }] = await Promise.all([
            adminClient.from("profiles").select("id").eq("id", targetUserId).maybeSingle(),
            adminClient.auth.admin.getUserById(targetUserId)
        ]);
        if(leftoverProfile || (leftoverAuth && leftoverAuth.user)){
            return jsonResponse({ error: "The account could not be fully removed. Please try again or contact the system administrator." }, 500);
        }

        /* ---------- 5. Best-effort cleanup (the account itself is already gone) ---------- */
        const warnings: string[] = [];

        // Only this user's own avatar folder - never shared record files.
        const { data: avatarFiles, error: listError } = await adminClient.storage.from(AVATAR_BUCKET).list(targetUserId, { limit: 100 });
        if(listError){
            console.error("[permanently-erase-account] avatar list failed:", listError.message);
            warnings.push("profile picture cleanup");
        } else if(avatarFiles && avatarFiles.length){
            const paths = avatarFiles.map(function(f){ return targetUserId + "/" + f.name; });
            const { error: removeError } = await adminClient.storage.from(AVATAR_BUCKET).remove(paths);
            if(removeError){
                console.error("[permanently-erase-account] avatar removal failed:", removeError.message);
                warnings.push("profile picture cleanup");
            }
        }

        // Audit trail (Audit Logs page) - name/role/organization only, no
        // email or student number.
        const { error: auditError } = await adminClient.from("audit_logs").insert({
            actor_id: callerId,
            action: "user.delete",
            target_table: "profiles",
            target_id: targetUserId,
            details: {
                full_name: (targetProfile && targetProfile.full_name) || "Unlinked account",
                role: targetProfile ? targetProfile.role : null,
                organization: targetProfile ? targetProfile.organization : null
            }
        });
        if(auditError){
            console.error("[permanently-erase-account] audit log insert failed:", auditError.message);
            warnings.push("audit log entry");
        }

        return jsonResponse({ success: true, deletedUserId: targetUserId, warnings: warnings });
    } catch(err){
        console.error("[permanently-erase-account] unexpected error:", err instanceof Error ? err.message : String(err));
        return jsonResponse({ error: "Something went wrong while deleting this account. Please try again." }, 500);
    }
});
