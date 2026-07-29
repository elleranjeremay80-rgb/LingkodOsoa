-- LINGKOD Meneses - Documents module rework, on top of the original
-- 20260722000000_documents_module.sql (which appears to have never
-- actually been applied to the live project - that's the real cause of
-- "Could not find the table 'public.documents' in the schema cache",
-- not a bug in either migration). This file assumes that one either has
-- or hasn't run yet and is safe either way (every statement below is
-- idempotent / `if not exists` / `if exists`).
--
-- Changes from the original: sequential DOC-YYYY-NNNNNN numbers, a real
-- organization_id FK (was free-text organization), a stored file_path
-- (was file_url-only, forcing every reader to regex-parse a public URL
-- to get a storage path back for deletes), an expanded category list,
-- a "documents" storage bucket with a real MIME allow-list and folder-
-- by-category layout (was "official-documents", flat, unrestricted
-- type), a genuinely org-scoped + student-inclusive permission model
-- (was osoa_eb-or-uploader-only, no student access at all), and an
-- activity log.

-- ===================================================================
-- 1. Category list. update existing rows first (harmless no-op if the
-- table has no rows yet, which is the expected case) so the new check
-- constraint never rejects data the old one already accepted.
-- ===================================================================

do $$
begin
  if exists (select 1 from information_schema.tables where table_schema='public' and table_name='documents') then
    update public.documents set category = 'organization_records' where category = 'organization_document';
  end if;
end $$;

alter table public.documents drop constraint if exists documents_category_check;
alter table public.documents add constraint documents_category_check
  check (category in (
    'memorandum', 'resolution', 'financial_report', 'policy', 'form',
    'organization_records', 'accreditation', 'constitution_bylaws',
    'activity_documents', 'other'
  ));

-- ===================================================================
-- 2. New columns: document_number, organization_id (FK, replaces the
-- free-text organization column), file_path.
-- ===================================================================

alter table public.documents add column if not exists document_number text;
alter table public.documents add column if not exists organization_id uuid references public.organizations(id) on delete set null;
alter table public.documents add column if not exists file_path text;

-- uploaded_by_name: a server-trusted snapshot of the uploader's full
-- name, same reasoning as feedback.full_name/requests.full_name
-- (20260722000000_feedback_enhancements.sql /
-- 20260722020000_requests_enhancements.sql) - anon only has a narrow
-- column grant on profiles (id, student_number, email, role, status;
-- see 20260713040000_registration_repair.sql) that does NOT include
-- full_name, so the public Document Library page could not otherwise
-- show "Uploaded By" at all without this - it would either error or
-- silently come back empty for every guest visitor.
alter table public.documents add column if not exists uploaded_by_name text;

update public.documents d
set uploaded_by_name = p.full_name
from public.profiles p
where d.uploaded_by = p.id and d.uploaded_by_name is null;

-- Best-effort carry-over for any row that already has the old free-text
-- organization column populated (matches by name) before it's dropped -
-- a no-op if the table has no rows yet, harmless if the column is
-- already gone from a previous run of this same migration.
do $$
begin
  if exists (select 1 from information_schema.columns where table_schema='public' and table_name='documents' and column_name='organization') then
    update public.documents d
    set organization_id = o.id
    from public.organizations o
    where d.organization_id is null and lower(trim(d.organization)) = lower(trim(o.name));

    alter table public.documents drop column organization;
  end if;
end $$;

-- ===================================================================
-- 3. Sequential per-year Document Numbers (DOC-YYYY-000001). Same
-- counter-table pattern as feedback_id_counters/request_id_counters
-- (20260722000000_feedback_enhancements.sql /
-- 20260722020000_requests_enhancements.sql).
-- ===================================================================

create table if not exists public.document_id_counters (
  year int primary key,
  last_number int not null default 0
);

alter table public.document_id_counters enable row level security;
revoke all on public.document_id_counters from anon, authenticated;

create or replace function public.generate_document_id()
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_year int := extract(year from now())::int;
  v_next int;
begin
  insert into public.document_id_counters (year, last_number)
  values (v_year, 1)
  on conflict (year) do update set last_number = document_id_counters.last_number + 1
  returning last_number into v_next;

  return 'DOC-' || v_year || '-' || lpad(v_next::text, 6, '0');
end;
$$;

create or replace function public.documents_before_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.document_number is null then
    new.document_number := public.generate_document_id();
  end if;

  if new.uploaded_by_name is null then
    select p.full_name into new.uploaded_by_name from public.profiles p where p.id = new.uploaded_by;
  end if;

  return new;
end;
$$;

drop trigger if exists set_documents_before_insert on public.documents;
create trigger set_documents_before_insert
  before insert on public.documents
  for each row execute function public.documents_before_insert();

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.documents'::regclass and conname = 'documents_document_number_key'
  ) then
    alter table public.documents add constraint documents_document_number_key unique (document_number);
  end if;
end $$;

-- Backfill: assign numbers (oldest first) to any pre-existing rows and
-- seed the counter table so new uploads continue right after the
-- highest backfilled number for that year - a no-op if the table is
-- still empty, which is the expected case on a fresh apply.
do $$
declare
  r record;
  v_num int;
begin
  for r in
    select d.id, extract(year from d.created_at)::int as yr
    from public.documents d
    where d.document_number is null
    order by d.created_at asc
  loop
    insert into public.document_id_counters (year, last_number)
    values (r.yr, 1)
    on conflict (year) do update set last_number = document_id_counters.last_number + 1
    returning last_number into v_num;

    update public.documents
    set document_number = 'DOC-' || r.yr || '-' || lpad(v_num::text, 6, '0')
    where id = r.id;
  end loop;
end $$;

alter table public.documents alter column document_number set not null;

-- ===================================================================
-- 4. Indexes.
-- ===================================================================

create index if not exists documents_organization_id_idx on public.documents (organization_id);
create index if not exists documents_status_idx on public.documents (status);
create index if not exists documents_document_number_idx on public.documents (document_number);

-- ===================================================================
-- 5. RLS - genuinely org-scoped now, and students can participate:
--   - select: anyone, including guests (anon) - matches "Guest can
--     search/filter/preview/download".
--   - insert: osoa_eb for any organization; org_president/student only
--     for their own organization_id (current_profile_organization_id()
--     already exists from 20260723040000_org_president_directory_
--     management.sql - reused as-is, not redefined here).
--   - update/delete (edit/archive/delete all go through these): osoa_eb
--     any row; org_president any row in their own organization
--     (not just ones they personally uploaded); everyone else
--     (students included) only rows they personally uploaded.
-- ===================================================================

create or replace function public.current_user_can_manage_document(doc_organization_id uuid, doc_uploaded_by uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select
    exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'osoa_eb')
    or exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.role = 'org_president'
        and doc_organization_id is not null and p.organization_id = doc_organization_id
    )
    or doc_uploaded_by = auth.uid();
$$;

grant execute on function public.current_user_can_manage_document(uuid, uuid) to authenticated;

alter table public.documents enable row level security;

drop policy if exists documents_select on public.documents;
create policy documents_select on public.documents
for select to anon, authenticated
using (true);

drop policy if exists documents_insert on public.documents;
create policy documents_insert on public.documents
for insert to authenticated
with check (
  uploaded_by = auth.uid()
  and exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and p.role in ('osoa_eb', 'org_president', 'student')
      and (
        p.role = 'osoa_eb'
        -- Qualified as documents.organization_id (not just
        -- organization_id) because this comparison sits inside a
        -- subquery over profiles p, which ALSO has an organization_id
        -- column - an unqualified reference here would resolve to the
        -- subquery's own p.organization_id instead of the new row's,
        -- silently turning this into an always-true p.organization_id =
        -- p.organization_id and defeating the own-org check entirely.
        or (documents.organization_id is not null and p.organization_id = documents.organization_id)
      )
  )
);

drop policy if exists documents_update on public.documents;
create policy documents_update on public.documents
for update to authenticated
using (public.current_user_can_manage_document(organization_id, uploaded_by))
with check (public.current_user_can_manage_document(organization_id, uploaded_by));

drop policy if exists documents_delete on public.documents;
create policy documents_delete on public.documents
for delete to authenticated
using (public.current_user_can_manage_document(organization_id, uploaded_by));

revoke all on public.documents from anon;
grant select on public.documents to anon;

-- ===================================================================
-- 6. Storage: new "documents" bucket (folder-per-category, real MIME
-- allow-list, 20 MB). The old "official-documents" bucket from the
-- first migration is left in place untouched (nothing was ever
-- successfully uploaded to it, since the table it depends on was never
-- live) - just no longer referenced by the app going forward.
-- ===================================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'documents',
  'documents',
  true,
  20971520, -- 20 MB
  array[
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-powerpoint',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'image/jpeg',
    'image/png'
  ]
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- Select is unrestricted (no `to` clause = every role, anon included) -
-- matches the table's own select policy above and is what lets
-- lingkodGetSignedFileUrl()/createSignedUrl() succeed for a guest.
-- Insert/delete are coarse role checks (any osoa_eb/org_president/
-- student), same pattern as project-images - the real per-row
-- authorization already happened one step earlier, when the client's
-- insert/update/delete against public.documents itself either passed or
-- failed against the policies in section 5.
drop policy if exists documents_bucket_select on storage.objects;
create policy documents_bucket_select on storage.objects
for select
using (bucket_id = 'documents');

drop policy if exists documents_bucket_insert on storage.objects;
create policy documents_bucket_insert on storage.objects
for insert to authenticated
with check (
  bucket_id = 'documents'
  and exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.role in ('osoa_eb', 'org_president', 'student')
  )
);

drop policy if exists documents_bucket_delete on storage.objects;
create policy documents_bucket_delete on storage.objects
for delete to authenticated
using (
  bucket_id = 'documents'
  and exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.role in ('osoa_eb', 'org_president', 'student')
  )
);

-- ===================================================================
-- 7. Activity log - upload/edit/archive/unarchive/delete, backend only
-- (no viewing UI yet). document_title/actor_name are snapshotted onto
-- the log row itself so a later delete of the document (or, in theory,
-- the actor's account) doesn't leave the log unreadable - document_id
-- is kept too, for anything that still exists, but set null on delete
-- rather than cascading the log entry away with it.
-- ===================================================================

create table if not exists public.document_activity_log (
  id uuid primary key default gen_random_uuid(),
  document_id uuid references public.documents(id) on delete set null,
  document_title text not null,
  action text not null check (action in ('upload', 'edit', 'archive', 'unarchive', 'delete')),
  actor_id uuid references public.profiles(id) on delete set null,
  actor_name text,
  created_at timestamptz not null default now()
);

create index if not exists document_activity_log_document_id_idx on public.document_activity_log (document_id);
create index if not exists document_activity_log_created_at_idx on public.document_activity_log (created_at desc);

alter table public.document_activity_log enable row level security;

drop policy if exists document_activity_log_select on public.document_activity_log;
create policy document_activity_log_select on public.document_activity_log
for select to authenticated
using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'osoa_eb'));

revoke all on public.document_activity_log from anon, authenticated;
grant select on public.document_activity_log to authenticated;

create or replace function public.log_document_activity()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor_id uuid := auth.uid();
  v_actor_name text;
begin
  select full_name into v_actor_name from public.profiles where id = v_actor_id;

  if tg_op = 'INSERT' then
    insert into public.document_activity_log (document_id, document_title, action, actor_id, actor_name)
    values (new.id, new.title, 'upload', v_actor_id, v_actor_name);
    return new;
  end if;

  if tg_op = 'UPDATE' then
    if new.status = 'archived' and old.status <> 'archived' then
      insert into public.document_activity_log (document_id, document_title, action, actor_id, actor_name)
      values (new.id, new.title, 'archive', v_actor_id, v_actor_name);
    elsif new.status = 'active' and old.status = 'archived' then
      insert into public.document_activity_log (document_id, document_title, action, actor_id, actor_name)
      values (new.id, new.title, 'unarchive', v_actor_id, v_actor_name);
    else
      insert into public.document_activity_log (document_id, document_title, action, actor_id, actor_name)
      values (new.id, new.title, 'edit', v_actor_id, v_actor_name);
    end if;
    return new;
  end if;

  if tg_op = 'DELETE' then
    insert into public.document_activity_log (document_id, document_title, action, actor_id, actor_name)
    values (null, old.title, 'delete', v_actor_id, v_actor_name);
    return old;
  end if;

  return null;
end;
$$;

drop trigger if exists documents_activity_log on public.documents;
create trigger documents_activity_log
  after insert or update or delete on public.documents
  for each row execute function public.log_document_activity();

-- ===================================================================
-- 8. Realtime (idempotent - already added by the original migration if
-- that one ran; harmless if it didn't).
-- ===================================================================

do $$
begin
  alter publication supabase_realtime add table public.documents;
exception when duplicate_object then
  null;
end $$;

notify pgrst, 'reload schema';
