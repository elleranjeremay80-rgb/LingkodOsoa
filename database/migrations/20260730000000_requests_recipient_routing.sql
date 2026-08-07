-- LINGKOD Meneses - Requests recipient routing: adds who a request is
-- addressed to (OSOA EB or the submitter's own Organization President),
-- narrows osoa_eb's "sees everything" visibility down to only
-- osoa_eb-addressed requests, and grants org_president (+ their org's
-- non-"Member"-position officers, read-only) visibility into requests
-- addressed to their organization. Same "server-trusted snapshot"
-- pattern as full_name/student_number/organization already use in
-- requests_before_insert() (20260722020000_requests_enhancements.sql /
-- 20260727000000_feedback_requests_organization.sql): assigned_organization_id
-- is always derived server-side from the submitter's own profile, never
-- trusted from the client, so nobody can address another organization's
-- president by tampering with the insert payload.
--
-- No new profiles.role value and no signup/handle_new_user() change -
-- "is this student an officer of their org" is derived purely from
-- data that already exists on every profile row (organization_positions
-- already resolves every non-President position to role='student', see
-- 20260723010000_organization_positions.sql): role='student' AND
-- organization_id is not null AND position is not null AND position <>
-- 'Member'. "Member" is the deliberately generic/lowest seeded position
-- in every organization's roster, so this cleanly separates "rank and
-- file member" from "officer" without adding anything new to the schema.

-- ===================================================================
-- 1. New columns.
-- ===================================================================

alter table public.requests add column if not exists assigned_to_role text;
alter table public.requests add column if not exists assigned_organization_id uuid references public.organizations(id) on delete set null;
alter table public.requests add column if not exists updated_by uuid references public.profiles(id) on delete set null;

-- Backfill: every request that existed before this feature only ever
-- had one possible recipient (OSOA EB), so that's the correct default
-- for pre-existing rows, not an arbitrary guess.
update public.requests set assigned_to_role = 'osoa_eb' where assigned_to_role is null;

alter table public.requests alter column assigned_to_role set default 'osoa_eb';
alter table public.requests alter column assigned_to_role set not null;

do $$
declare
  v_constraint_name text;
begin
  for v_constraint_name in
    select conname from pg_constraint
    where conrelid = 'public.requests'::regclass and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%assigned_to_role%'
  loop
    execute format('alter table public.requests drop constraint %I', v_constraint_name);
  end loop;

  alter table public.requests add constraint requests_assigned_to_role_check
    check (assigned_to_role in ('osoa_eb', 'org_president'));
end $$;

-- assigned_organization_id is required exactly when the recipient is an
-- Organization President, and must stay null otherwise (the trigger
-- below enforces this on every insert, but the constraint is a second,
-- independent guarantee against any future write path that bypasses
-- the trigger). Safe to validate immediately (not "not valid"): the
-- backfill above already leaves every existing row in the
-- assigned_to_role='osoa_eb' / assigned_organization_id=null state,
-- which satisfies this from the start.
do $$
declare
  v_constraint_name text;
begin
  for v_constraint_name in
    select conname from pg_constraint
    where conrelid = 'public.requests'::regclass and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%assigned_organization_id%'
  loop
    execute format('alter table public.requests drop constraint %I', v_constraint_name);
  end loop;

  alter table public.requests add constraint requests_assigned_org_president_check
    check (
      (assigned_to_role = 'org_president' and assigned_organization_id is not null)
      or (assigned_to_role = 'osoa_eb' and assigned_organization_id is null)
    );
end $$;

create index if not exists idx_requests_assigned_to_role on public.requests (assigned_to_role);
create index if not exists idx_requests_assigned_organization_id on public.requests (assigned_organization_id);

-- ===================================================================
-- 2. requests_before_insert(): now also derives assigned_organization_id
-- server-side (never trusts a client-sent value - the trigger always
-- overwrites whatever, if anything, arrives in NEW), and rejects
-- org_president-addressed submissions from a submitter with no
-- organization on file (e.g. an osoa_eb account, or any unaffiliated
-- account) rather than silently allowing an orphaned request.
-- ===================================================================

create or replace function public.requests_before_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.request_id is null then
    new.request_id := public.generate_request_id();
  end if;

  select p.full_name, p.student_number, p.organization, p.organization_id
    into new.full_name, new.student_number, new.organization, new.organization_id
  from public.profiles p where p.id = new.user_id;

  if new.request_type::text <> 'Others' then
    new.specified_type := null;
  end if;

  if new.assigned_to_role is null then
    new.assigned_to_role := 'osoa_eb';
  end if;

  if new.assigned_to_role = 'org_president' then
    new.assigned_organization_id := new.organization_id;
    if new.assigned_organization_id is null then
      raise exception 'Cannot address a request to an Organization President without an organization on file.';
    end if;
  else
    new.assigned_organization_id := null;
  end if;

  return new;
end;
$$;

-- ===================================================================
-- 3. updated_by: server-set on every update, mirroring how updated_at
-- is already trigger-managed (set_requests_updated_at, from
-- 20260722020000_requests_enhancements.sql) rather than client-supplied.
-- A separate trigger/function (not folded into set_updated_at()) since
-- that function is shared by other tables' updated_at triggers too and
-- shouldn't grow a requests-specific side effect.
-- ===================================================================

create or replace function public.requests_set_updated_by()
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

drop trigger if exists set_requests_updated_by on public.requests;
create trigger set_requests_updated_by
  before update on public.requests
  for each row execute function public.requests_set_updated_by();

-- ===================================================================
-- 4. RLS rewrite.
--
-- select: own rows always; OSOA EB narrowed to only osoa_eb-addressed
-- rows (was "everything" - explicit narrowing, see module docstring);
-- org_president AND their org's officers (role='student', non-null,
-- non-'Member' position) see org_president-addressed rows for their
-- own organization_id only.
--
-- update: OSOA EB manages osoa_eb-addressed rows; org_president manages
-- their own org's org_president-addressed rows. Officers get read
-- access above but no update grant here (only osoa_eb/org_president can
-- add remarks/change status, per spec).
--
-- using + with check on requests_update are intentionally symmetric:
-- this also happens to block an org_president from re-routing a row
-- they can currently update (e.g. flipping assigned_to_role to
-- 'osoa_eb', or assigned_organization_id to a different org) to
-- something they wouldn't otherwise have update rights over, since the
-- WITH CHECK re-evaluates against the NEW row's values. Not something
-- the current frontend even attempts (it only ever updates
-- status/remarks), but worth having as defense-in-depth.
-- ===================================================================

alter table public.requests enable row level security;

drop policy if exists "requests_select" on public.requests;
drop policy if exists "requests_insert" on public.requests;
drop policy if exists "requests_update" on public.requests;

create policy "requests_select"
  on public.requests for select
  to authenticated
  using (
    user_id = auth.uid()
    or (
      assigned_to_role = 'osoa_eb'
      and exists (
        select 1 from public.profiles p
        where p.id = auth.uid() and p.role = 'osoa_eb'
      )
    )
    or (
      assigned_to_role = 'org_president'
      and assigned_organization_id is not null
      and exists (
        select 1 from public.profiles p
        where p.id = auth.uid()
          and p.organization_id = requests.assigned_organization_id
          and (
            p.role = 'org_president'
            or (p.role = 'student' and p.position is not null and p.position <> 'Member')
          )
      )
    )
  );

create policy "requests_insert"
  on public.requests for insert
  to authenticated
  with check (
    user_id = auth.uid()
    and assigned_to_role in ('osoa_eb', 'org_president')
  );

create policy "requests_update"
  on public.requests for update
  to authenticated
  using (
    (
      assigned_to_role = 'osoa_eb'
      and exists (
        select 1 from public.profiles p
        where p.id = auth.uid() and p.role = 'osoa_eb'
      )
    )
    or (
      assigned_to_role = 'org_president'
      and assigned_organization_id is not null
      and exists (
        select 1 from public.profiles p
        where p.id = auth.uid()
          and p.role = 'org_president'
          and p.organization_id = requests.assigned_organization_id
      )
    )
  )
  with check (
    (
      assigned_to_role = 'osoa_eb'
      and exists (
        select 1 from public.profiles p
        where p.id = auth.uid() and p.role = 'osoa_eb'
      )
    )
    or (
      assigned_to_role = 'org_president'
      and assigned_organization_id is not null
      and exists (
        select 1 from public.profiles p
        where p.id = auth.uid()
          and p.role = 'org_president'
          and p.organization_id = requests.assigned_organization_id
      )
    )
  );

revoke all on public.requests from anon;

-- ===================================================================
-- 5. notify_on_request_change(): INSERT now notifies the correct
-- recipient set (active osoa_eb, or the active org_president(s) of
-- assigned_organization_id - a plain WHERE match, not a LIMIT 1, so it
-- naturally handles 0 or 1 matching rows per
-- profiles_unique_position_per_org, 20260723010000_organization_positions.sql
-- section 3). Status-change notifications to the submitter now also
-- name who made the update, via the new updated_by column joined back
-- to profiles.role - label strings copied from the spec's own example
-- text ("OSOA Executive Board" / "Organization President").
-- ===================================================================

create or replace function public.notify_on_request_change()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  v_updated_by_role text;
  v_updated_by_label text;
begin
  if tg_op = 'INSERT' then
    if new.assigned_to_role = 'org_president' then
      insert into public.notifications (recipient_id, type, title, body, link_url)
      select p.id,
        'request_received',
        '📥 New request submitted',
        coalesce(new.full_name, 'Someone') || ' submitted a ' || new.request_type || ' request.',
        '../requests/index.html'
      from public.profiles p
      where p.role = 'org_president'
        and p.status = 'active'
        and p.organization_id = new.assigned_organization_id;
    else
      insert into public.notifications (recipient_id, type, title, body, link_url)
      select p.id,
        'request_received',
        '📥 New request submitted',
        coalesce(new.full_name, 'Someone') || ' submitted a ' || new.request_type || ' request.',
        '../requests/index.html'
      from public.profiles p
      where p.role = 'osoa_eb' and p.status = 'active';
    end if;

    return new;
  end if;

  if new.status is distinct from old.status then
    if new.user_id is null then
      return new;
    end if;

    select p.role into v_updated_by_role
    from public.profiles p where p.id = new.updated_by;

    v_updated_by_label := case v_updated_by_role
      when 'osoa_eb' then 'OSOA Executive Board'
      when 'org_president' then 'Organization President'
      else null
    end;

    insert into public.notifications (recipient_id, type, title, body, link_url)
    values (
      new.user_id,
      'request_' || new.status,
      case new.status
        when 'received' then '📥 Request received'
        when 'under_review' then '🔄 Request under review'
        when 'approved' then '✅ Request approved'
        when 'rejected' then '❌ Request rejected'
        when 'completed' then '🏁 Request completed'
        else 'Request updated'
      end,
      'Your ' || new.request_type || ' request is now: '
      || case new.status
           when 'under_review' then 'Under Review'
           when 'received' then 'Received'
           when 'approved' then 'Approved'
           when 'rejected' then 'Rejected'
           when 'completed' then 'Completed'
           else new.status
         end
      || (case when v_updated_by_label is not null
            then '. Updated by: ' || v_updated_by_label
            else '' end)
      || (case when new.remarks is not null and length(trim(new.remarks)) > 0
            then '. Remarks: ' || new.remarks
            else '.' end),
      '../requests/index.html'
    );
  end if;

  return new;
end;
$$;

-- trigger definition itself (trg_notify_on_request_change) is unchanged
-- - only the function body above changes, CREATE OR REPLACE is enough.

notify pgrst, 'reload schema';
