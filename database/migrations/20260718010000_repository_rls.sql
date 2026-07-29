-- LINGKOD Meneses - Digital Repository: explicit RLS matching the role
-- matrix (Student: view-only; Organization President: view all, manage
-- own uploads; OSOA EB: full access to everything).
--
-- Like announcements/submissions, the base `repository_files` table's
-- original RLS isn't in this migrations folder (only its `is_public`
-- column and the file_category enum extension are, from
-- 20260713050000_repository_stats_realtime.sql), so this is written to
-- be an unambiguous, explicit source of truth regardless of what's live.
-- Safe to run more than once.

alter table public.repository_files enable row level security;

drop policy if exists "repository_files_select" on public.repository_files;
drop policy if exists "repository_files_insert" on public.repository_files;
drop policy if exists "repository_files_update" on public.repository_files;
drop policy if exists "repository_files_delete" on public.repository_files;

-- Every authenticated user (Student included) can view every file - the
-- repository is a shared institutional archive, not per-org private
-- storage. No anonymous access.
create policy "repository_files_select"
  on public.repository_files for select
  to authenticated
  using (true);

create policy "repository_files_insert"
  on public.repository_files for insert
  to authenticated
  with check (
    uploaded_by = auth.uid()
    and exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.role in ('osoa_eb', 'org_president')
    )
  );

-- Unlike Submission & Tracking's approval queue (where "own" means
-- "personally created"), the repository is a shared institutional
-- archive - the brief describes Organization President as able to edit/
-- delete documents without an "own uploads only" qualifier, matching the
-- existing frontend (admin-actions already show for any osoa_eb or
-- org_president viewer, not just the uploader). Both management roles
-- get full manage rights here; only Student is locked to view-only.
create policy "repository_files_update"
  on public.repository_files for update
  to authenticated
  using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.role in ('osoa_eb', 'org_president')
    )
  )
  with check (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.role in ('osoa_eb', 'org_president')
    )
  );

create policy "repository_files_delete"
  on public.repository_files for delete
  to authenticated
  using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.role in ('osoa_eb', 'org_president')
    )
  );

revoke all on public.repository_files from anon;
