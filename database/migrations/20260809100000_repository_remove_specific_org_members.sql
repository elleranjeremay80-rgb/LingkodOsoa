-- LINGKOD Meneses - Removes "Specific Organization Members" as a Digital
-- Repository recipient type. Was one of 6 values on repository_files.
-- recipient_type (20260801000000_repository_recipient_visibility.sql) -
-- this migration undoes every piece of that file's support for it: the
-- CHECK constraints, both RLS policies that reference it, and the
-- notification trigger's fan-out branch. "Specific Organization" (the
-- whole-org-roster option, a DIFFERENT value) is untouched.
--
-- Existing rows: any file already addressed to 'specific_organization_
-- members' is widened to 'specific_organization' (whole org roster)
-- rather than left on a value the new CHECK constraint would reject -
-- the closest available fallback, mirroring how the original migration
-- itself backfilled null recipient_type to 'public' (line 68 of
-- 20260801000000). Must run before the CHECK constraints are tightened
-- below, or the ALTER TABLE would fail outright against any such row.
--
-- Safe to run more than once.

update public.repository_files
set recipient_type = 'specific_organization'
where recipient_type = 'specific_organization_members';

-- ===================================================================
-- 1. CHECK constraints.
-- ===================================================================

do $$
declare
  v_constraint_name text;
begin
  for v_constraint_name in
    select conname from pg_constraint
    where conrelid = 'public.repository_files'::regclass and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%recipient_type%specific_organization_members%'
  loop
    execute format('alter table public.repository_files drop constraint %I', v_constraint_name);
  end loop;

  alter table public.repository_files add constraint repository_files_recipient_type_check
    check (recipient_type in ('public', 'osoa_eb', 'org_presidents', 'specific_organization', 'multiple_organizations'));
end $$;

do $$
declare
  v_constraint_name text;
begin
  for v_constraint_name in
    select conname from pg_constraint
    where conrelid = 'public.repository_files'::regclass and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%recipient_organization_id%'
  loop
    execute format('alter table public.repository_files drop constraint %I', v_constraint_name);
  end loop;

  alter table public.repository_files add constraint repository_files_recipient_org_check
    check (
      (recipient_type = 'specific_organization' and recipient_organization_id is not null)
      or (recipient_type <> 'specific_organization' and recipient_organization_id is null)
    );
end $$;

-- ===================================================================
-- 2. RLS - drop and recreate the same three policies from
-- 20260801000000, minus the specific_organization_members branches.
-- ===================================================================

drop policy if exists "repository_files_select" on public.repository_files;
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
      recipient_type = 'multiple_organizations'
      and exists (
        select 1 from public.profiles p
        where p.id = auth.uid() and p.organization_id = any(repository_files.recipient_organization_ids)
      )
    )
  );

drop policy if exists "repository_files_insert" on public.repository_files;
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
        and recipient_type in ('public', 'osoa_eb', 'specific_organization')
        and (
          recipient_type <> 'specific_organization'
          or recipient_organization_id = (select organization_id from public.profiles where id = auth.uid())
        )
      )
    )
  );

drop policy if exists "repository_files_update" on public.repository_files;
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
      and recipient_type in ('public', 'osoa_eb', 'specific_organization')
      and (
        recipient_type <> 'specific_organization'
        or recipient_organization_id = (select organization_id from public.profiles where id = auth.uid())
      )
    )
  );

-- ===================================================================
-- 3. Notification trigger - same function, minus the
-- specific_organization_members fan-out branch.
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
        or (new.recipient_type = 'multiple_organizations' and p.organization_id = any(new.recipient_organization_ids))
      )
      -- Don't notify the uploader about their own upload.
      and p.id <> new.uploaded_by;

    return new;
  end if;

  return new;
end;
$$;

notify pgrst, 'reload schema';
