-- LINGKOD Meneses - Ongoing Projects: cover image upload.
--
-- Cover images are unlike every other file this app handles (submission
-- documents, message attachments) in one important way: they're meant to
-- be shown to *everyone*, repeatedly, on every dashboard - not gated to a
-- specific reader. That's a public-bucket + public-URL fit (like the
-- Digital Repository's own "public-files" bucket), not the private
-- bucket + signed-URL pattern used for private documents, so this
-- deliberately does not reuse that pattern.
--
-- Row-level "who can attach an image to which project" is already fully
-- handled by the existing projects_write RLS policy on
-- projects_activities itself (is_osoa_eb() or the owning org's
-- president) - updating image_url goes through that same check like any
-- other column on the row. The Storage policies below only need the
-- coarser "is this account even an osoa_eb/org_president at all" check.
-- Safe to run more than once.

alter table public.projects_activities add column if not exists image_url text;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'project-images',
  'project-images',
  true,
  10485760, -- 10 MB
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists project_images_select on storage.objects;
create policy project_images_select on storage.objects
for select
using (bucket_id = 'project-images');

drop policy if exists project_images_insert on storage.objects;
create policy project_images_insert on storage.objects
for insert to authenticated
with check (
  bucket_id = 'project-images'
  and exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.role in ('osoa_eb', 'org_president')
  )
);

drop policy if exists project_images_update on storage.objects;
create policy project_images_update on storage.objects
for update to authenticated
using (
  bucket_id = 'project-images'
  and exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.role in ('osoa_eb', 'org_president')
  )
);

drop policy if exists project_images_delete on storage.objects;
create policy project_images_delete on storage.objects
for delete to authenticated
using (
  bucket_id = 'project-images'
  and exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.role in ('osoa_eb', 'org_president')
  )
);

notify pgrst, 'reload schema';
