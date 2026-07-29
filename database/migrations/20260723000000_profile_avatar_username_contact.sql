-- LINGKOD Meneses - Profile page: real photo upload, a real (stored,
-- unique) username instead of the email-local-part display fallback used
-- until now, and a validated contact number.
-- Safe to run more than once.

alter table public.profiles add column if not exists avatar_url text;
alter table public.profiles add column if not exists username text;
alter table public.profiles add column if not exists contact_number text;

-- Case-insensitive uniqueness ("John" and "john" would otherwise be
-- confusable near-duplicates) - a partial index so it only ever applies
-- to rows that actually have a username set, letting every existing
-- account keep working unset until its owner picks one.
drop index if exists profiles_username_unique;
create unique index profiles_username_unique
  on public.profiles (lower(username))
  where username is not null;

alter table public.profiles drop constraint if exists profiles_username_format;
alter table public.profiles add constraint profiles_username_format
  check (username is null or username ~ '^[A-Za-z0-9_.]{4,30}$') not valid;

alter table public.profiles drop constraint if exists profiles_contact_number_format;
alter table public.profiles add constraint profiles_contact_number_format
  check (contact_number is null or contact_number ~ '^(09\d{9}|\+639\d{9})$') not valid;

-- Public bucket (same reasoning as project cover images: an avatar needs
-- to render on every page that shows this person - Directory, Messages'
-- contact list/chat header/search, Dashboard - not gated to one reader).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'profile-images',
  'profile-images',
  true,
  10485760, -- 10 MB
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists profile_images_select on storage.objects;
create policy profile_images_select on storage.objects
for select
using (bucket_id = 'profile-images');

-- Objects live at "<user id>/avatar.jpg" - a fixed path per user (not a
-- random name per upload) so a new upload with upsert:true genuinely
-- replaces the old one instead of accumulating orphaned files, and so
-- the insert/update policies can check identity by folder name alone.
drop policy if exists profile_images_insert on storage.objects;
create policy profile_images_insert on storage.objects
for insert to authenticated
with check (
  bucket_id = 'profile-images'
  and (storage.foldername(name))[1] = auth.uid()::text
);

drop policy if exists profile_images_update on storage.objects;
create policy profile_images_update on storage.objects
for update to authenticated
using (
  bucket_id = 'profile-images'
  and (storage.foldername(name))[1] = auth.uid()::text
);

drop policy if exists profile_images_delete on storage.objects;
create policy profile_images_delete on storage.objects
for delete to authenticated
using (
  bucket_id = 'profile-images'
  and (storage.foldername(name))[1] = auth.uid()::text
);

-- The self-edit-lockdown migration's UPDATE grant needs the new
-- self-editable columns added, or the profile save at the end of this
-- feature would fail with "permission denied for table profiles" -
-- exactly the same class of bug already fixed once for registration.
--
-- department/department_id/organization/organization_id are deliberately
-- DROPPED from the grant here (the previous migration included them) -
-- the updated Edit Profile spec now treats College/Department and
-- Organization as read-only governance facts, same as Position and
-- Student Number, not something a user changes themselves. Revoking
-- first keeps this idempotent regardless of which grant list last ran.
revoke update on public.profiles from authenticated;
grant update (
  last_name, first_name, middle_name,
  avatar_url, username, contact_number
) on public.profiles to authenticated;

do $$
begin
  alter publication supabase_realtime add table public.profiles;
exception when duplicate_object then
  null;
end $$;

notify pgrst, 'reload schema';
