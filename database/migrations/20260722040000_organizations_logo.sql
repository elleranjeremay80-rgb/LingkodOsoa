-- LINGKOD Meneses - "List of Members" organization directory cards want an
-- optional logo image per organization (falls back to a default icon in
-- the UI when unset). public.organizations already grants unrestricted
-- select to anon/authenticated ("Anyone can read organizations"), so no
-- RLS/grant change is needed for a new nullable column - it's covered by
-- the existing whole-table select grant automatically.

alter table public.organizations add column if not exists logo_url text;

notify pgrst, 'reload schema';
