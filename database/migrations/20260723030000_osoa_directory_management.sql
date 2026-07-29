-- LINGKOD Meneses - OSOA EB-exclusive Directory Management.
--
-- The OSOA EB's own Directory view groups officers by organization and
-- lets OSOA EB add/edit/delete both organizations and officer entries.
-- This is a deliberately separate, manually-curated roster
-- (organization_officers) rather than reusing public.profiles - a real
-- profile row can't be created without a matching auth.users account
-- (profiles.id references auth.users(id) on delete cascade), so there's
-- no way to "Add Officer" against profiles directly, and no way to
-- permanently delete a real account from the client at all (that needs
-- Supabase's Admin API with a service-role key, which this project
-- doesn't have). organization_officers has neither constraint, so OSOA
-- EB can freely curate this roster - it's an admin-maintained directory
-- of who holds what position, not a live mirror of registered accounts,
-- and can drift out of sync with actual registrations if not kept
-- up to date by hand.
--
-- Org President and Student keep their existing profiles-driven
-- Directory page completely untouched - this table/UI is additive,
-- gated to osoa_eb only both client-side (data-role-view="admin" in
-- directory/index.html) and server-side (RLS below).

alter table public.organizations add column if not exists description text;
alter table public.organizations add column if not exists theme_color text;

-- ===================================================================
-- 1. Officer roster table.
-- ===================================================================

create table if not exists public.organization_officers (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  full_name text not null,
  position text not null,
  department text,
  course text,
  year_level text,
  photo_url text,
  description text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists set_organization_officers_updated_at on public.organization_officers;
create trigger set_organization_officers_updated_at
  before update on public.organization_officers
  for each row execute function public.set_updated_at();

alter table public.organization_officers enable row level security;

drop policy if exists "organization_officers_select" on public.organization_officers;
create policy "organization_officers_select"
  on public.organization_officers for select
  to authenticated
  using (true);

drop policy if exists "organization_officers_insert" on public.organization_officers;
create policy "organization_officers_insert"
  on public.organization_officers for insert
  to authenticated
  with check (public.current_profile_role() = 'osoa_eb');

drop policy if exists "organization_officers_update" on public.organization_officers;
create policy "organization_officers_update"
  on public.organization_officers for update
  to authenticated
  using (public.current_profile_role() = 'osoa_eb')
  with check (public.current_profile_role() = 'osoa_eb');

drop policy if exists "organization_officers_delete" on public.organization_officers;
create policy "organization_officers_delete"
  on public.organization_officers for delete
  to authenticated
  using (public.current_profile_role() = 'osoa_eb');

grant select, insert, update, delete on public.organization_officers to authenticated;

-- ===================================================================
-- 2. Organizations: Add/Delete are new capabilities this screen
-- introduces (Update already exists from 20260722070000 and also covers
-- org_president managing their own org's logo on List of Members - left
-- untouched). Add/Delete are osoa_eb only, per this feature's own spec.
-- The organization_officers FK above is "on delete restrict", so
-- deleting an organization that still has officer rows fails with a
-- clear foreign-key error rather than silently orphaning or cascading -
-- the client checks the officer count first and blocks with a friendly
-- message before ever attempting the delete.
-- ===================================================================

drop policy if exists "organizations_insert" on public.organizations;
create policy "organizations_insert"
  on public.organizations for insert
  to authenticated
  with check (public.current_profile_role() = 'osoa_eb');

drop policy if exists "organizations_delete" on public.organizations;
create policy "organizations_delete"
  on public.organizations for delete
  to authenticated
  using (public.current_profile_role() = 'osoa_eb');

-- ===================================================================
-- 3. Storage: officer photos - public bucket + public URL, same
-- reasoning as project-images (shown repeatedly across every session,
-- not gated to a specific reader).
-- ===================================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'officer-photos',
  'officer-photos',
  true,
  10485760,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists officer_photos_select on storage.objects;
create policy officer_photos_select on storage.objects
for select
using (bucket_id = 'officer-photos');

drop policy if exists officer_photos_insert on storage.objects;
create policy officer_photos_insert on storage.objects
for insert to authenticated
with check (
  bucket_id = 'officer-photos'
  and public.current_profile_role() = 'osoa_eb'
);

drop policy if exists officer_photos_update on storage.objects;
create policy officer_photos_update on storage.objects
for update to authenticated
using (
  bucket_id = 'officer-photos'
  and public.current_profile_role() = 'osoa_eb'
);

drop policy if exists officer_photos_delete on storage.objects;
create policy officer_photos_delete on storage.objects
for delete to authenticated
using (
  bucket_id = 'officer-photos'
  and public.current_profile_role() = 'osoa_eb'
);

-- ===================================================================
-- 4. Realtime, so Add/Edit/Delete Officer appear live without a refresh.
-- ===================================================================

do $$
begin
  alter publication supabase_realtime add table public.organization_officers;
exception when duplicate_object then null;
end $$;

notify pgrst, 'reload schema';
