# LINGKOD Meneses

OSOA (Office of Student Organizations and Activities) e-governance platform
for Bulacan State University - Meneses Campus. Static HTML/CSS/JS frontend
backed by Supabase (Postgres, Auth, Storage, Realtime) - no build step, no
bundler.

## Structure

```
LINGKOD MENESES/
├── frontend/         Everything served to the browser
│   ├── pages/         One folder per page (index.html + script.js + style.css)
│   ├── css/            Shared stylesheet (common.css)
│   ├── js/             Shared client libraries (supabase.js, auth.js, common.js, ...)
│   ├── pictures/        Shared images/logos
│   └── index.html       Entry point - redirects to pages/login/
│
├── backend/          Reserved for a future application server (see backend/README.md).
│                     Today, Supabase itself is the backend - there is no custom
│                     server, so these folders are intentionally empty.
│
├── database/          Supabase project config and schema history
│   ├── config.toml     Supabase CLI project config
│   ├── migrations/     Tracked SQL migrations, applied in filename order
│   └── scripts/        One-off diagnostic/utility SQL (not migrations)
│
├── documentation/    Project docs (currently empty)
│
├── .env               Supabase DB connection string, used by local tooling only -
│                      never read by the frontend and never committed (see .gitignore)
├── .gitignore
├── package.json       Project metadata only - there is no npm build/install step
└── README.md
```

## Running it

This is a plain static site: open `frontend/index.html` (or any page under
`frontend/pages/`) through a local static file server. There is nothing to
`npm install` or build.

## Database

The `frontend/js/supabase.js` file ships the project's Supabase URL and
**anon** (publishable) key - safe to expose in the browser. Everything
sensitive (write permissions, row visibility) is enforced server-side by
Row-Level Security policies in `database/migrations/`, not by the frontend.

### Note on the Supabase CLI

Several `supabase` CLI commands (`supabase db push`, `supabase link`,
`supabase functions deploy`, etc.) expect a folder literally named
`supabase/` containing `config.toml`, `migrations/`, and `functions/` at
the location the CLI is run from. Since that folder is now `database/`
instead (with Edge Functions living under `backend/functions/`), running
the CLI locally will need either `supabase --workdir database ...` (if
your installed CLI version supports it) or a temporary `supabase/` folder/
symlink pointing here. This does not affect the deployed app - migrations
already applied to the live project are unaffected either way.

## Backend

See `backend/README.md`. Short version: Supabase itself is the backend
(Postgres + RLS + Storage + Realtime) - there is no custom server, except
for two real Edge Functions under `backend/functions/` for the one thing
the browser's anon key genuinely can't do: permanently deleting a user's
login (`permanently-erase-account`, called directly by Registered Users'
"Remove User" action). `release-account-email` also exists but is
currently unused - see `backend/README.md` for why.
