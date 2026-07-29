-- LINGKOD Meneses - Directory page: profile picture + optional bio, and
-- live updates when a new account registers.
--
-- No upload UI exists yet anywhere in the app for either column - this
-- only adds the schema and the Directory page's *display* logic (real
-- image if present, initials fallback otherwise, exactly as requested).
-- Every existing account will show initials until an upload flow is
-- built somewhere (Edit Profile / Settings), which is a separate, later
-- piece of work, not silently assumed here.
-- Safe to run more than once.

alter table public.profiles add column if not exists avatar_url text;
alter table public.profiles add column if not exists bio text;

do $$
begin
  alter publication supabase_realtime add table public.profiles;
exception when duplicate_object then
  null;
end $$;

notify pgrst, 'reload schema';
