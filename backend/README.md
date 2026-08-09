# Backend

LINGKOD Meneses has no custom application server today. Supabase *is* the
backend: Postgres, Row-Level Security policies, Postgres functions/triggers,
Storage buckets, and Realtime subscriptions do the job a hand-written
controller/service/repository layer would otherwise do. The frontend talks
to Supabase directly with the anon key (see `frontend/js/supabase.js`) and
relies on RLS as the real enforcement layer - never on client-side checks
alone.

Most of the folders here are still placeholders, reserved for if/when this
project adds a real application server. They're intentionally empty; no
code has been invented to fill them.

- `config/` - environment/config loading for a future server
- `controllers/` - request handlers
- `services/` - business logic
- `middleware/` - auth/permission/error-handling middleware
- `routes/` - route definitions
- `repositories/` - data-access layer (if ever decoupled from calling
  Supabase directly)
- `validators/` - request validation
- `utils/` - shared helpers

## `functions/` - Supabase Edge Functions (real, not a placeholder)

The one exception: the handful of things the anon key genuinely cannot do
from the browser need a privileged, server-side caller. `functions/`
holds real Supabase Edge Functions (Deno runtime) for exactly those cases.

- **`permanently-erase-account/`** - calls `auth.admin.deleteUser()` with
  the service-role key (only ever present in the Edge Function's own
  environment, never shipped to the frontend) to truly delete a user's
  login, cascading to remove their `profiles` row too. Registered Users'
  "Remove User" action calls this directly, immediately, against a
  still-active account - a deliberate product decision to make Remove
  User a true, irreversible delete rather than the soft-delete/anonymize
  design this app used before. `permanentlyEraseUser()` in
  `registered-users/script.js` (the separate "Permanently Erase Account"
  icon, only ever shown for already-inactive rows) calls the exact same
  function - it's now purely a cleanup path for any row soft-deleted by
  the old Remove User behavior before this change. Safety rails (only
  callable by osoa_eb, never on yourself, never on the last active
  osoa_eb account) are enforced unconditionally inside the function
  itself, regardless of which entry point called it. Also cleans up the
  target's `profile-images` avatar file (best-effort, via the admin
  client so it isn't subject to Storage RLS) - Storage objects are never
  FK-cascaded from `auth.users`, so this doesn't happen automatically.

- **`release-account-email/`** - calls `auth.admin.updateUserById()` with
  the service-role key to rename a deactivated user's *auth* email to a
  `deleted-user-<id>@deleted.lingkod` placeholder, freeing the real email
  for reuse without fully deleting the account. Built for the old
  soft-delete design; **not currently called by any part of the app** now
  that Remove User does a true delete instead (which frees the email as a
  side effect of deleting the whole auth account, via
  `permanently-erase-account` above). Left in place rather than deleted,
  since removing an already-deployed Edge Function is an infrastructure
  action, not a code change - safe to actually undeploy if it's confirmed
  to have no remaining use.

Deploy with `supabase functions deploy <name>`, run from a `--workdir`
pointed at this project's `database/` folder (see the root README's
"Note on the Supabase CLI").

Database schema and migrations live in `../database/`, not here.
