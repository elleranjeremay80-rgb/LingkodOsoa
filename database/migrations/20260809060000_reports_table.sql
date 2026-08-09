-- LINGKOD Meneses - Reports: Members, Organization Presidents, and OSOA EB
-- can each submit a report addressed either to their own Organization
-- President (Members only) or to a SPECIFIC named OSOA EB position
-- (Chairman / Vice Chairman / Associate for Ethics / Associate for
-- Publication - see 20260809050000_osds_org_and_osoa_position_updates.sql
-- for where those exact names come from) - never a generic "OSOA EB"
-- recipient. Modeled directly on public.requests' proven architecture
-- (20260730000000_requests_recipient_routing.sql): a security-definer
-- BEFORE INSERT trigger resolves and validates the recipient server-side
-- (never trusting client-sent values), RLS enforces per-row visibility,
-- and status changes fan out a notification - extended here with
-- position-level (not just role-level) routing, since an OSOA EB Vice
-- Chairman must never see a report addressed to the Chairman, unlike
-- requests' "any osoa_eb sees any osoa_eb-addressed request" model.
--
-- report_status is a fresh enum (not grafted onto the already-shared
-- public.approval_status, which backs requests/feedback/submissions with
-- approve/reject-flavored semantics that don't fit a report's tracking
-- workflow) - created directly with every value it needs, so unlike
-- approval_status's own history in this project, no follow-up migration
-- is needed just to add missing labels.
--
-- Safe to run more than once.

-- ===================================================================
-- 1. Status enum.
-- ===================================================================

do $$
begin
  if not exists (select 1 from pg_type where typname = 'report_status' and typnamespace = 'public'::regnamespace) then
    create type public.report_status as enum (
      'submitted', 'received', 'under_review', 'in_progress', 'resolved', 'rejected', 'closed'
    );
  end if;
end $$;

-- ===================================================================
-- 2. Sequential per-year Report IDs (RPT-YYYY-000001), mirrors
-- request_id_counters/generate_request_id() exactly.
-- ===================================================================

create table if not exists public.report_id_counters (
  year int primary key,
  last_number int not null default 0
);

alter table public.report_id_counters enable row level security;
revoke all on public.report_id_counters from anon, authenticated;

create or replace function public.generate_report_id()
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_year int := extract(year from now())::int;
  v_next int;
begin
  insert into public.report_id_counters (year, last_number)
  values (v_year, 1)
  on conflict (year) do update set last_number = report_id_counters.last_number + 1
  returning last_number into v_next;

  return 'RPT-' || v_year || '-' || lpad(v_next::text, 6, '0');
end;
$$;

-- ===================================================================
-- 3. The table itself.
-- ===================================================================

create table if not exists public.reports (
  id uuid primary key default gen_random_uuid(),
  report_id text unique not null,

  reporter_id uuid references public.profiles(id) on delete set null,
  reporter_name text,
  reporter_role text,

  organization_id uuid references public.organizations(id) on delete set null,
  organization_name text,

  recipient_type text not null check (recipient_type in ('org_president', 'osoa_eb_position')),
  recipient_organization_id uuid references public.organizations(id) on delete set null,
  recipient_position text,

  report_title text not null,
  report_type text not null,
  specified_type text,
  report_details text,

  attachment_file_name text,
  attachment_file_path text,
  attachment_file_type text,
  attachment_file_size bigint,
  storage_bucket text,

  status public.report_status not null default 'submitted',
  remarks text,

  updated_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists set_reports_updated_at on public.reports;
create trigger set_reports_updated_at
  before update on public.reports
  for each row execute function public.set_updated_at();

-- "Others" -> specified_type, same pattern requests/feedback/submissions
-- already use. Unlike those tables, this one is brand new with zero
-- legacy rows, so the CHECK is added fully validated from the start
-- (never NOT VALID) - no later "data fix" migration will ever be needed
-- for this specific gap the way it was for submissions/feedback/requests.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conrelid = 'public.reports'::regclass and conname = 'reports_specified_type_check'
  ) then
    alter table public.reports add constraint reports_specified_type_check
      check (
        (report_type = 'Others' and specified_type is not null and length(trim(specified_type)) > 0)
        or (report_type <> 'Others' and specified_type is null)
      );
  end if;
end $$;

-- ===================================================================
-- 4. Recipient resolution + validation - the real security boundary for
-- "which recipient can this be addressed to," mirroring requests_before_
-- insert()'s shape. Snapshots reporter identity/org from profiles - never
-- trusts client-sent values for anything that determines routing.
-- ===================================================================

create or replace function public.reports_before_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_reporter record;
begin
  select p.full_name, p.role, p.position, p.organization_id, p.organization
  into v_reporter
  from public.profiles p
  where p.id = new.reporter_id;

  if new.report_id is null then
    new.report_id := public.generate_report_id();
  end if;

  new.reporter_name := v_reporter.full_name;
  new.reporter_role := v_reporter.role;
  new.organization_id := v_reporter.organization_id;
  new.organization_name := v_reporter.organization;

  if new.report_type <> 'Others' then
    new.specified_type := null;
  end if;

  if new.recipient_type = 'org_president' then
    if v_reporter.role <> 'student' then
      raise exception 'Only members may address a report to their Organization President.';
    end if;

    new.recipient_organization_id := v_reporter.organization_id;
    new.recipient_position := null;

    if new.recipient_organization_id is null then
      raise exception 'Cannot address a report to an Organization President without an organization on file.';
    end if;

  elsif new.recipient_type = 'osoa_eb_position' then
    if new.recipient_position is null or length(trim(new.recipient_position)) = 0 then
      raise exception 'Please select which OSOA Executive Board position this report is addressed to.';
    end if;

    if not exists (
      select 1 from public.organization_positions op
      join public.organizations o on o.id = op.organization_id
      where o.slug = 'osoa-meneses'
        and op.position_name = new.recipient_position
        and op.system_role = 'osoa_eb'
        and op.is_active = true
    ) then
      raise exception 'That is not a valid OSOA Executive Board position.';
    end if;

    if v_reporter.role = 'osoa_eb' and v_reporter.position = new.recipient_position then
      raise exception 'You cannot address a report to your own position.';
    end if;

    new.recipient_organization_id := null;

  else
    raise exception 'Invalid recipient type.';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_reports_before_insert on public.reports;
create trigger trg_reports_before_insert
before insert on public.reports
for each row execute function public.reports_before_insert();

-- ===================================================================
-- 5. Access-control functions - the single source of truth reused by
-- this table's own RLS below AND by the report-attachments Storage
-- bucket's RLS (next migration), so "who can see/act on this report" is
-- defined exactly once. security definer + stable, same idiom as
-- is_position_filled().
-- ===================================================================

create or replace function public.is_report_recipient(p_report_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from public.reports r
    where r.id = p_report_id
      and (
        (
          r.recipient_type = 'org_president'
          and r.recipient_organization_id is not null
          and exists (
            select 1 from public.profiles p
            where p.id = auth.uid()
              and p.role = 'org_president'
              and p.organization_id = r.recipient_organization_id
          )
        )
        or (
          r.recipient_type = 'osoa_eb_position'
          and exists (
            select 1 from public.profiles p
            where p.id = auth.uid()
              and p.role = 'osoa_eb'
              and p.status = 'active'
              and p.position = r.recipient_position
          )
        )
      )
  );
$$;

create or replace function public.can_view_report(p_report_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from public.reports r where r.id = p_report_id and r.reporter_id = auth.uid()
  ) or public.is_report_recipient(p_report_id);
$$;

grant execute on function public.is_report_recipient(uuid) to authenticated;
grant execute on function public.can_view_report(uuid) to authenticated;

-- ===================================================================
-- 6. Column-level authority guard - mirrors guard_profile_admin_fields():
-- the reporter may edit their own report's content only while it's still
-- 'submitted' (before a recipient has acted on it); only the resolved
-- recipient may ever change status/remarks. The GRANT below is
-- deliberately shared/broad (not split reporter-columns vs recipient-
-- columns) - this trigger is what actually enforces who may touch what,
-- same shape as guard_profile_admin_fields()'s own reasoning. auth.uid()
-- is null whenever this fires outside a real user request (system/
-- migration context), skipped in that case, same as every other
-- trigger-guard in this app.
-- ===================================================================

create or replace function public.guard_report_fields()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  if auth.uid() is not null then
    if (
      new.report_title is distinct from old.report_title
      or new.report_type is distinct from old.report_type
      or new.specified_type is distinct from old.specified_type
      or new.report_details is distinct from old.report_details
      or new.recipient_type is distinct from old.recipient_type
      or new.recipient_position is distinct from old.recipient_position
      or new.attachment_file_name is distinct from old.attachment_file_name
      or new.attachment_file_path is distinct from old.attachment_file_path
      or new.attachment_file_type is distinct from old.attachment_file_type
      or new.attachment_file_size is distinct from old.attachment_file_size
    ) then
      if old.reporter_id is distinct from auth.uid() then
        raise exception 'Only the reporter may edit this report.';
      end if;
      if old.status <> 'submitted' then
        raise exception 'This report can no longer be edited once the recipient has started processing it.';
      end if;
    end if;

    if (
      new.status is distinct from old.status
      or new.remarks is distinct from old.remarks
    ) then
      if not public.is_report_recipient(old.id) then
        raise exception 'Only the assigned recipient may update this report''s status.';
      end if;
    end if;
  end if;

  new.updated_by := auth.uid();
  return new;
end;
$$;

drop trigger if exists trg_guard_report_fields on public.reports;
create trigger trg_guard_report_fields
before update on public.reports
for each row execute function public.guard_report_fields();

-- ===================================================================
-- 7. RLS + column grants.
-- ===================================================================

alter table public.reports enable row level security;

drop policy if exists reports_select on public.reports;
create policy reports_select
  on public.reports for select
  to authenticated
  using (public.can_view_report(id));

drop policy if exists reports_insert on public.reports;
create policy reports_insert
  on public.reports for insert
  to authenticated
  with check (reporter_id = auth.uid());

drop policy if exists reports_update on public.reports;
create policy reports_update
  on public.reports for update
  to authenticated
  using (reporter_id = auth.uid() or public.is_report_recipient(id))
  with check (reporter_id = auth.uid() or public.is_report_recipient(id));

revoke all on public.reports from anon;
revoke update on public.reports from authenticated;
grant select, insert on public.reports to authenticated;
grant update (
  report_title, report_type, specified_type, report_details, recipient_type, recipient_position,
  attachment_file_name, attachment_file_path, attachment_file_type, attachment_file_size,
  status, remarks
) on public.reports to authenticated;

-- ===================================================================
-- 8. Realtime.
-- ===================================================================

do $$
begin
  alter publication supabase_realtime add table public.reports;
exception when duplicate_object then null;
end $$;

notify pgrst, 'reload schema';
