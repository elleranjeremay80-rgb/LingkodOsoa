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

## `functions/` - Supabase Edge Functions

Edge Functions (Deno) are for privileged operations a browser can't
safely do. **None are currently deployed** to the Supabase project.

- **Deleting a registered user is not an Edge Function.** It used to be
  (`permanently-erase-account`), but that function was never deployed, so
  Registered Users' Delete always failed with "Couldn't reach the account
  deletion service". It was replaced on 2026-10-09 by the
  `public.admin_delete_user(uuid)` database function
  (`database/migrations/20261009010000_admin_delete_user.sql`), called with
  `supabase.rpc()`. It checks the caller is an active `osoa_eb` (not self,
  not the last one), then deletes the login and profile in a single
  transaction - nothing to deploy, and no half-finished deletes.

- **`release-account-email/`** - calls `auth.admin.updateUserById()` with
  the service-role key to rename a deactivated user's *auth* email to a
  `deleted-user-<id>@deleted.lingkod` placeholder. Built for the old
  soft-delete design; **not called by any part of the app** and not
  deployed. Kept only for reference.

If an Edge Function is ever added: Dashboard -> Edge Functions -> Deploy a
new function -> Via Editor, or the Supabase CLI (`supabase functions
deploy <name>` from a folder with a `supabase/functions/<name>/` layout).
`SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are injected automatically.

Database schema and migrations live in `../database/`, not here.
