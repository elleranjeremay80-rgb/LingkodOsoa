-- LINGKOD Meneses - Organization President Directory Management.
--
-- Extends the OSOA EB-only organization_officers roster (20260723030000)
-- so an org_president can also add/edit/delete officers AND regular
-- members, but only within their own organization. "Member" rows live in
-- the same organization_officers table (position = 'Member', matching
-- every organization's seeded 'Member' position_name) rather than a
-- separate table - the Directory page classifies officer vs member by
-- that same position text at render time, so no schema split is needed.
--
-- Org Presidents also need read access across every organization (not
-- just their own) for this page's "view all, manage only your own"
-- requirement - profiles_admin_org_select previously scoped org_president
-- reads to their own organization only; widened below to match osoa_eb's
-- read scope. This is safe for List of Members (the other page relying on
-- that policy): it already applies its own explicit client-side
-- .eq("organization", ...) filter for org_president regardless of what
-- RLS allows, so widening the underlying read policy doesn't change what
-- that page shows.

alter table public.organization_officers add column if not exists contact_number text;

-- ===================================================================
-- 1. current_profile_organization_id() - a uuid-based counterpart to the
-- existing current_profile_organization() (which returns the free-text
-- name). Comparing organization_id (uuid) instead of organization name
-- (text) avoids the exact same case/whitespace-drift bug class that
-- 20260722070000 already had to fix for organization logo uploads.
-- ===================================================================

drop function if exists public.current_profile_organization_id();

create function public.current_profile_organization_id()
returns uuid
language sql
security definer
set search_path = public
stable
as $$
  select organization_id from public.profiles where id = auth.uid();
$$;

grant execute on function public.current_profile_organization_id() to authenticated;

-- ===================================================================
-- 2. organization_officers: org_president can now write (insert/update/
-- delete) rows scoped to their own organization_id. osoa_eb keeps full
-- access, unchanged.
-- ===================================================================

drop policy if exists "organization_officers_insert" on public.organization_officers;
create policy "organization_officers_insert"
  on public.organization_officers for insert
  to authenticated
  with check (
    public.current_profile_role() = 'osoa_eb'
    or (
      public.current_profile_role() = 'org_president'
      and organization_officers.organization_id = public.current_profile_organization_id()
    )
  );

drop policy if exists "organization_officers_update" on public.organization_officers;
create policy "organization_officers_update"
  on public.organization_officers for update
  to authenticated
  using (
    public.current_profile_role() = 'osoa_eb'
    or (
      public.current_profile_role() = 'org_president'
      and organization_officers.organization_id = public.current_profile_organization_id()
    )
  )
  with check (
    public.current_profile_role() = 'osoa_eb'
    or (
      public.current_profile_role() = 'org_president'
      and organization_officers.organization_id = public.current_profile_organization_id()
    )
  );

drop policy if exists "organization_officers_delete" on public.organization_officers;
create policy "organization_officers_delete"
  on public.organization_officers for delete
  to authenticated
  using (
    public.current_profile_role() = 'osoa_eb'
    or (
      public.current_profile_role() = 'org_president'
      and organization_officers.organization_id = public.current_profile_organization_id()
    )
  );

-- ===================================================================
-- 3. Storage: officer-photos - same org-scoped write access. The upload
-- path convention becomes organizationId/officerId-uuid.ext (folder is
-- now the organization, not the officer) specifically so this check
-- works for a brand new officer being added - the officer's own row
-- doesn't exist yet at upload time, but the organization the caller is
-- adding to is already known.
-- ===================================================================

drop policy if exists officer_photos_insert on storage.objects;
create policy officer_photos_insert on storage.objects
for insert to authenticated
with check (
  bucket_id = 'officer-photos'
  and (
    public.current_profile_role() = 'osoa_eb'
    or (
      public.current_profile_role() = 'org_president'
      and (storage.foldername(name))[1] = public.current_profile_organization_id()::text
    )
  )
);

drop policy if exists officer_photos_update on storage.objects;
create policy officer_photos_update on storage.objects
for update to authenticated
using (
  bucket_id = 'officer-photos'
  and (
    public.current_profile_role() = 'osoa_eb'
    or (
      public.current_profile_role() = 'org_president'
      and (storage.foldername(name))[1] = public.current_profile_organization_id()::text
    )
  )
);

drop policy if exists officer_photos_delete on storage.objects;
create policy officer_photos_delete on storage.objects
for delete to authenticated
using (
  bucket_id = 'officer-photos'
  and (
    public.current_profile_role() = 'osoa_eb'
    or (
      public.current_profile_role() = 'org_president'
      and (storage.foldername(name))[1] = public.current_profile_organization_id()::text
    )
  )
);

-- ===================================================================
-- 4. profiles: org_president can now read every profile (needed for
-- Sections 1/2/3/4 to show registered accounts across every
-- organization, not just their own) - write access to profiles itself
-- is unchanged (org_president still can't edit/delete other people's
-- real accounts anywhere in this app).
-- ===================================================================

drop policy if exists "profiles_admin_org_select" on public.profiles;

create policy "profiles_admin_org_select"
  on public.profiles for select
  to authenticated
  using (public.current_profile_role() in ('osoa_eb', 'org_president'));

notify pgrst, 'reload schema';
