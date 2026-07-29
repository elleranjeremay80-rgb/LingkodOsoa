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
  login. Distinct from Registered Users' "Remove User" action, which only
  anonymizes the profile and deliberately keeps the row alive so a
  removed user's old posts still show "Deleted User" - see the function's
  own header comment and `registered-users/script.js`'s
  `permanentlyEraseUser()` for the full reasoning and the safety rails
  (only callable by osoa_eb, never on yourself, never on the last active
  osoa_eb account, and only after the target account is already
  deactivated).

Deploy with `supabase functions deploy <name>`, run from a `--workdir`
pointed at this project's `database/` folder (see the root README's
"Note on the Supabase CLI").

Database schema and migrations live in `../database/`, not here.
