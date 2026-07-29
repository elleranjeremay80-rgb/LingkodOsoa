-- LINGKOD Meneses - Organization Information redesign: Facebook is now
-- the only social link the UI collects/shows (Instagram/X/TikTok/Website
-- dropped from the editor and every render path per this iteration's
-- request). Their columns are deliberately left in place, untouched -
-- dropping them would be a destructive, irreversible schema change for a
-- UI-only decision, and any data already saved in them stays intact in
-- case a future iteration brings them back. They're simply never
-- selected/rendered/written by the app anymore from this point on.
--
-- facebook_url's existing check only required http(s):// - tightened here
-- to actually require a facebook.com (or fb.com/m.facebook.com/etc.)
-- link, matching this iteration's stricter "must be a valid Facebook
-- link" validation rule. Client-side validation enforces the same rule
-- (see list-of-members/script.js's isValidFacebookUrl) - this is the
-- server-side backstop.

alter table public.organizations drop constraint if exists organizations_facebook_url_check;

alter table public.organizations add constraint organizations_facebook_url_check
  check (facebook_url is null or facebook_url ~* '^https?://(www\.|m\.)?(facebook|fb)\.com/');

notify pgrst, 'reload schema';
