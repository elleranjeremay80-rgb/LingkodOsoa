-- LINGKOD Meneses - Digital Repository: recipient-based visibility, plus
-- a real file_path column (avoids the fragile "parse the storage path
-- back out of the public URL" pattern the existing delete flow already
-- has to use), and updated_by/updated_at tracking.
--
-- repository_files was created directly against the live project (see
-- 20260718010000_repository_rls.sql's own docstring) - no CREATE TABLE
-- exists in this repo, so every change below is defensive
-- (add-column-if-not-exists) and this migration is the sole, explicit
-- source of truth for this table's RLS going forward, same approach
-- 20260718010000 already took.
--
-- Recipient model (6 kinds, matching the requested dropdown):
--   public                       - every authenticated user (today's
--                                   default/only behavior, preserved as
--                                   the fallback for existing rows)
--   osoa_eb                      - OSOA EB only
--   org_presidents                - every organization's president (any
--                                   org), OSOA EB always included
--   specific_organization         - that org's president + officers +
--                                   members (its whole roster), OSOA EB
--                                   always included
--   specific_organization_members - that org's rank-and-file members
--                                   only (role='student', position is
--                                   null or 'Member' - i.e. NOT an
--                                   officer/president), OSOA EB always
--                                   included. Narrower than
--                                   specific_organization on purpose -
--                                   e.g. a general-membership notice vs.
--                                   a leadership-only financial report.
--   multiple_organizations        - the full roster (as
--                                   specific_organization) of every org
--                                   in recipient_organization_ids, OSOA
--                                   EB always included
--
-- OSOA EB can always see every file regardless of recipient_type -
-- matches this table's current "osoa_eb manages everything" behavior
-- and the spec's own example ("...OSOA EB can see it" is listed for
-- every recipient scenario given).
--
-- Officer/member derivation reuses the exact idiom already established
-- for requests (20260730000000_requests_recipient_routing.sql):
-- role='student' and position is not null and position <> 'Member' means
-- an officer; role='org_president' is the president; role='student' and
-- (position is null or position = 'Member') is a rank-and-file member.
--
-- Upload/edit permission: org_president may only target their own
-- organization (specific_organization/specific_organization_members
-- pointed at their own org_id, or public/osoa_eb) - org_presidents and
-- multiple_organizations require osoa_eb, since only OSOA EB has
-- platform-wide authority to address every president or several orgs at
-- once. Enforced server-side in the INSERT/UPDATE RLS below, not just
-- hidden in the UI.

-- ===================================================================
-- 1. New columns.
-- ===================================================================

alter table public.repository_files add column if not exists file_path text;
alter table public.repository_files add column if not exists recipient_type text;
alter table public.repository_files add column if not exists recipient_organization_id uuid references public.organizations(id) on delete set null;
alter table public.repository_files add column if not exists recipient_organization_ids uuid[];
alter table public.repository_files add column if not exists updated_at timestamptz not null default now();
alter table public.repository_files add column if not exists updated_by uuid references public.profiles(id) on delete set null;

-- Existing rows were always visible to everyone (the only behavior this
-- table ever had) - backfill them to 'public' rather than guessing.
update public.repository_files set recipient_type = 'public' where recipient_type is null;

alter table public.repository_files alter column recipient_type set default 'public';
alter table public.repository_files alter column recipient_type set not null;

do $$
declare
  v_constraint_name text;
begin
  for v_constraint_name in
    select conname from pg_constraint
    where conrelid = 'public.repository_files'::regclass and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%recipient_type%'
  loop
    execute format('alter table public.repository_files drop constraint %I', v_constraint_name);
  end loop;

  alter table public.repository_files add constraint repository_files_recipient_type_check
    check (recipient_type in ('public', 'osoa_eb', 'org_presidents', 'specific_organization', 'specific_organization_members', 'multiple_organizations'));
end $$;

do $$
declare
  v_constraint_name text;
begin
  for v_constraint_name in
    select conname from pg_constraint
    where conrelid = 'public.repository_files'::regclass and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%recipient_organization_id%and%recipient_type%'
  loop
    execute format('alter table public.repository_files drop constraint %I', v_constraint_name);
  end loop;

  alter table public.repository_files add constraint repository_files_recipient_org_check
    check (
      (recipient_type in ('specific_organization', 'specific_organization_members') and recipient_organization_id is not null)
      or (recipient_type not in ('specific_organization', 'specific_organization_members') and recipient_organization_id is null)
    );
end $$;

do $$
declare
  v_constraint_name text;
begin
  for v_constraint_name in
    select conname from pg_constraint
    where conrelid = 'public.repository_files'::regclass and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%recipient_organization_ids%'
  loop
    execute format('alter table public.repository_files drop constraint %I', v_constraint_name);
  end loop;

  alter table public.repository_files add constraint repository_files_recipient_orgs_check
    check (
      (recipient_type = 'multiple_organizations' and recipient_organization_ids is not null and array_length(recipient_organization_ids, 1) > 0)
      or (recipient_type <> 'multiple_organizations' and recipient_organization_ids is null)
    );
end $$;

create index if not exists idx_repository_files_recipient_type on public.repository_files (recipient_type);
create index if not exists idx_repository_files_recipient_organization_id on public.repository_files (recipient_organization_id);

drop trigger if exists set_repository_files_updated_at on public.repository_files;
create trigger set_repository_files_updated_at
  before update on public.repository_files
  for each row execute function public.set_updated_at();

create or replace function public.repository_files_set_updated_by()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.updated_by := auth.uid();
  return new;
end;
$$;

drop trigger if exists set_repository_files_updated_by on public.repository_files;
create trigger set_repository_files_updated_by
  before update on public.repository_files
  for each row execute function public.repository_files_set_updated_by();

-- ===================================================================
-- 2. RLS rewrite - replaces 20260718010000_repository_rls.sql's
-- "everyone sees everything" select policy with real recipient-based
-- visibility. Insert/update also now validate the recipient assignment
-- itself (an org_president cannot address a different org or use the
-- osoa_eb-only recipient kinds), not just who is allowed to write at all.
-- ===================================================================

alter table public.repository_files enable row level security;

drop policy if exists "repository_files_select" on public.repository_files;
drop policy if exists "repository_files_insert" on public.repository_files;
drop policy if exists "repository_files_update" on public.repository_files;
drop policy if exists "repository_files_delete" on public.repository_files;

create policy "repository_files_select"
  on public.repository_files for select
  to authenticated
  using (
    recipient_type = 'public'
    or exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.role = 'osoa_eb'
    )
    or (
      recipient_type = 'org_presidents'
      and exists (
        select 1 from public.profiles p
        where p.id = auth.uid() and p.role = 'org_president'
      )
    )
    or (
      recipient_type = 'specific_organization'
      and exists (
        select 1 from public.profiles p
        where p.id = auth.uid() and p.organization_id = repository_files.recipient_organization_id
      )
    )
    or (
      recipient_type = 'specific_organization_members'
      and exists (
        select 1 from public.profiles p
        where p.id = auth.uid()
          and p.organization_id = repository_files.recipient_organization_id
          and p.role = 'student'
          and (p.position is null or p.position = 'Member')
      )
    )
    or (
      recipient_type = 'multiple_organizations'
      and exists (
        select 1 from public.profiles p
        where p.id = auth.uid() and p.organization_id = any(repository_files.recipient_organization_ids)
      )
    )
  );

create policy "repository_files_insert"
  on public.repository_files for insert
  to authenticated
  with check (
    uploaded_by = auth.uid()
    and (
      exists (
        select 1 from public.profiles p
        where p.id = auth.uid() and p.role = 'osoa_eb'
      )
      or (
        exists (
          select 1 from public.profiles p
          where p.id = auth.uid() and p.role = 'org_president'
        )
        and recipient_type in ('public', 'osoa_eb', 'specific_organization', 'specific_organization_members')
        and (
          recipient_type not in ('specific_organization', 'specific_organization_members')
          or recipient_organization_id = (select organization_id from public.profiles where id = auth.uid())
        )
      )
    )
  );

create policy "repository_files_update"
  on public.repository_files for update
  to authenticated
  using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.role = 'osoa_eb'
    )
    or exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.role = 'org_president'
    )
  )
  with check (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.role = 'osoa_eb'
    )
    or (
      exists (
        select 1 from public.profiles p
        where p.id = auth.uid() and p.role = 'org_president'
      )
      and recipient_type in ('public', 'osoa_eb', 'specific_organization', 'specific_organization_members')
      and (
        recipient_type not in ('specific_organization', 'specific_organization_members')
        or recipient_organization_id = (select organization_id from public.profiles where id = auth.uid())
      )
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

-- ===================================================================
-- 3. Storage bucket RLS for "public-files" - the bucket/base policies
-- were also never captured in this repo (per prior research this
-- session), so this makes upload/delete permissions an explicit,
-- unambiguous source of truth here too, matching the "documents" bucket
-- pattern already used elsewhere (20260727020000_documents_module_rework.sql).
-- ===================================================================

drop policy if exists repository_files_bucket_select on storage.objects;
create policy repository_files_bucket_select on storage.objects
for select
using (bucket_id = 'public-files');

drop policy if exists repository_files_bucket_insert on storage.objects;
create policy repository_files_bucket_insert on storage.objects
for insert to authenticated
with check (
  bucket_id = 'public-files'
  and exists (select 1 from public.profiles p where p.id = auth.uid() and p.role in ('osoa_eb', 'org_president'))
);

drop policy if exists repository_files_bucket_update on storage.objects;
create policy repository_files_bucket_update on storage.objects
for update to authenticated
using (
  bucket_id = 'public-files'
  and exists (select 1 from public.profiles p where p.id = auth.uid() and p.role in ('osoa_eb', 'org_president'))
);

drop policy if exists repository_files_bucket_delete on storage.objects;
create policy repository_files_bucket_delete on storage.objects
for delete to authenticated
using (
  bucket_id = 'public-files'
  and exists (select 1 from public.profiles p where p.id = auth.uid() and p.role in ('osoa_eb', 'org_president'))
);

-- ===================================================================
-- 4. Notification on new upload, fanned out to the actual recipient set
-- - same security definer + insert-into-notifications shape used
-- everywhere else this session (see notify_on_request_change()).
-- ===================================================================

create or replace function public.notify_on_repository_file_change()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    insert into public.notifications (recipient_id, type, title, body, link_url)
    select p.id,
      'repository_file_added',
      '📁 New file in the repository',
      coalesce(new.title, new.file_name) || ' was added to the Digital Repository.',
      '../repository/index.html'
    from public.profiles p
    where p.status = 'active'
      and (
        new.recipient_type = 'public'
        or p.role = 'osoa_eb'
        or (new.recipient_type = 'org_presidents' and p.role = 'org_president')
        or (new.recipient_type = 'specific_organization' and p.organization_id = new.recipient_organization_id)
        or (new.recipient_type = 'specific_organization_members' and p.organization_id = new.recipient_organization_id and p.role = 'student' and (p.position is null or p.position = 'Member'))
        or (new.recipient_type = 'multiple_organizations' and p.organization_id = any(new.recipient_organization_ids))
      )
      -- Don't notify the uploader about their own upload.
      and p.id <> new.uploaded_by;

    return new;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_notify_on_repository_file_change on public.repository_files;
create trigger trg_notify_on_repository_file_change
after insert on public.repository_files
for each row execute function public.notify_on_repository_file_change();

notify pgrst, 'reload schema';
