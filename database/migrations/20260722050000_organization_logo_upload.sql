-- LINGKOD Meneses - Organization logo upload (List of Members' org
-- directory cards). public.organizations already has `logo_url` (added in
-- 20260722040000) and public read access - this migration adds what was
-- missing: permission to actually WRITE that column, and a Storage bucket
-- to hold the image files.
--
-- Reuses the current_profile_role()/current_profile_organization()
-- security definer helpers created in 20260722030000 (originally to fix
-- the profiles RLS recursion bug) - they're the established, already-
-- working way to check "who is the caller" without re-triggering RLS.

-- ===================================================================
-- 1. organizations UPDATE policy: osoa_eb can update any row;
-- org_president only the row matching their own organization; students
-- get no write policy at all (default deny).
-- ===================================================================

drop policy if exists "organizations_update" on public.organizations;

create policy "organizations_update"
  on public.organizations for update
  to authenticated
  using (
    public.current_profile_role() = 'osoa_eb'
    or (public.current_profile_role() = 'org_president' and organizations.name = public.current_profile_organization())
  )
  with check (
    public.current_profile_role() = 'osoa_eb'
    or (public.current_profile_role() = 'org_president' and organizations.name = public.current_profile_organization())
  );

grant update (logo_url) on public.organizations to authenticated;

-- ===================================================================
-- 2. Storage bucket. Public (a logo needs to render for every signed-in
-- viewer across the app, same reasoning as profile-images/project-images)
-- - id::text handles this table's id column being either uuid or text
-- depending on which earlier migration actually created it live.
-- ===================================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'organization-logos',
  'organization-logos',
  true,
  10485760, -- 10 MB
  array['image/jpeg', 'image/png', 'image/webp', 'image/svg+xml']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists organization_logos_select on storage.objects;
create policy organization_logos_select on storage.objects
for select
using (bucket_id = 'organization-logos');

-- Objects live at "<organization id>/logo.<ext>" - insert/update/delete
-- all check the same thing: osoa_eb (any folder), or org_president whose
-- own organization's row has that id.
drop policy if exists organization_logos_insert on storage.objects;
create policy organization_logos_insert on storage.objects
for insert to authenticated
with check (
  bucket_id = 'organization-logos'
  and (
    public.current_profile_role() = 'osoa_eb'
    or exists (
      select 1 from public.organizations o
      where o.id::text = (storage.foldername(name))[1]
        and o.name = public.current_profile_organization()
    )
  )
);

drop policy if exists organization_logos_update on storage.objects;
create policy organization_logos_update on storage.objects
for update to authenticated
using (
  bucket_id = 'organization-logos'
  and (
    public.current_profile_role() = 'osoa_eb'
    or exists (
      select 1 from public.organizations o
      where o.id::text = (storage.foldername(name))[1]
        and o.name = public.current_profile_organization()
    )
  )
);

drop policy if exists organization_logos_delete on storage.objects;
create policy organization_logos_delete on storage.objects
for delete to authenticated
using (
  bucket_id = 'organization-logos'
  and (
    public.current_profile_role() = 'osoa_eb'
    or exists (
      select 1 from public.organizations o
      where o.id::text = (storage.foldername(name))[1]
        and o.name = public.current_profile_organization()
    )
  )
);

notify pgrst, 'reload schema';
