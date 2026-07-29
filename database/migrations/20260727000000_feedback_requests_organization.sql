-- LINGKOD Meneses - Feedback and Requests: adds an Organization column to
-- the admin-facing tables, auto-filled from the submitter's profile - same
-- server-trusted-snapshot pattern already used for full_name/student_number
-- (see feedback_before_insert()/requests_before_insert() in
-- 20260722000000_feedback_enhancements.sql / 20260722020000_requests_
-- enhancements.sql). The client never sends organization; the trigger
-- copies it from profiles at insert time, so it can't be spoofed or left
-- blank by mistake.
--
-- Both organization (text, display name) and organization_id (uuid, FK)
-- are snapshotted - organization is what the UI actually renders (no join
-- needed), organization_id is kept alongside for any future filtering/
-- reporting by a stable identifier rather than a name that could in theory
-- change.

alter table public.feedback add column if not exists organization text;
alter table public.feedback add column if not exists organization_id uuid references public.organizations(id) on delete set null;

alter table public.requests add column if not exists organization text;
alter table public.requests add column if not exists organization_id uuid references public.organizations(id) on delete set null;

create or replace function public.feedback_before_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.feedback_id is null then
    new.feedback_id := public.generate_feedback_id();
  end if;

  select p.full_name, p.organization, p.organization_id
    into new.full_name, new.organization, new.organization_id
  from public.profiles p where p.id = new.user_id;

  if new.email is null then
    select u.email into new.email from auth.users u where u.id = new.user_id;
  end if;

  if new.feedback_type::text <> 'others' then
    new.specified_type := null;
  end if;

  return new;
end;
$$;

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

  return new;
end;
$$;

-- Backfill: existing rows never had this column, so it's null on
-- anything submitted before this migration.
update public.feedback f
set organization = p.organization, organization_id = p.organization_id
from public.profiles p
where f.user_id = p.id and f.organization is null;

update public.requests rq
set organization = p.organization, organization_id = p.organization_id
from public.profiles p
where rq.user_id = p.id and rq.organization is null;

notify pgrst, 'reload schema';
