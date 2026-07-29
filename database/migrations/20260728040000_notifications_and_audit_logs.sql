-- LINGKOD Meneses - Notifications and Audit Logs.
--
-- Both tables share the same shape of decision: no INSERT policy is ever
-- granted to `authenticated` at all. Every row in either table is written
-- exclusively by a security-definer trigger function, never directly by
-- a client. For notifications, that stops anyone from spamming fake
-- notifications into someone else's inbox. For audit_logs, that's the
-- entire point of an audit log - if a client could write it directly,
-- an actor could just skip logging their own action, which defeats it
-- before it starts. Real auditability has to be something the actor
-- can't opt out of.

-- ===================================================================
-- 1. Notifications
-- ===================================================================

create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid()
);

-- Added as explicit ALTERs, not left embedded in the CREATE TABLE above -
-- IF NOT EXISTS on CREATE TABLE only guards the table itself; if a
-- table by this name already existed for any reason (same class of
-- "created directly on the project" surprise this session already hit
-- for is_conversation_member and message_reports), the embedded column
-- list would have been silently skipped entirely, columns and all. Each
-- column is guaranteed to exist after this regardless of which case we're in.
alter table public.notifications add column if not exists recipient_id uuid references public.profiles(id) on delete cascade;
alter table public.notifications add column if not exists type text;
alter table public.notifications add column if not exists title text;
alter table public.notifications add column if not exists body text;
alter table public.notifications add column if not exists link_url text;
alter table public.notifications add column if not exists read_at timestamptz;
alter table public.notifications add column if not exists created_at timestamptz not null default now();

create index if not exists notifications_recipient_unread_idx
  on public.notifications (recipient_id, created_at desc)
  where read_at is null;

alter table public.notifications enable row level security;

drop policy if exists notifications_select on public.notifications;
create policy notifications_select on public.notifications
for select to authenticated
using (recipient_id = auth.uid());

-- Only the read_at column is ever meant to change from the client
-- ("mark as read") - there is no column-level grant here beyond that,
-- same reasoning as every other admin-field lockdown this project uses.
drop policy if exists notifications_update on public.notifications;
create policy notifications_update on public.notifications
for update to authenticated
using (recipient_id = auth.uid())
with check (recipient_id = auth.uid());

revoke all on public.notifications from anon;
revoke update on public.notifications from authenticated;
grant update (read_at) on public.notifications to authenticated;

do $$
begin
  alter publication supabase_realtime add table public.notifications;
exception when duplicate_object then
  null;
end $$;

-- Fans a report out to every active OSOA EB account the moment one is
-- submitted - the concrete "notify OSOA EB administrators" gap flagged
-- across both the conversation-options and per-message Report features.
-- Covers both shapes message_reports already supports: a plain user
-- report (message_id is null) and a per-message report (message_id set).
create or replace function public.notify_osoa_eb_on_report()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  reporter_name text;
  reported_name text;
begin
  select full_name into reporter_name from public.profiles where id = new.reporter_id;
  select full_name into reported_name from public.profiles where id = new.reported_user_id;

  insert into public.notifications (recipient_id, type, title, body, link_url)
  select
    p.id,
    case when new.message_id is not null then 'message_report' else 'user_report' end,
    case when new.message_id is not null then 'New message report' else 'New user report' end,
    coalesce(reporter_name, 'Someone') || ' reported ' || coalesce(reported_name, 'a user')
      || ' for ' || new.reason || '.',
    '../reports/index.html'
  from public.profiles p
  where p.role = 'osoa_eb' and p.status = 'active';

  return new;
end;
$$;

drop trigger if exists trg_notify_osoa_eb_on_report on public.message_reports;
create trigger trg_notify_osoa_eb_on_report
after insert on public.message_reports
for each row execute function public.notify_osoa_eb_on_report();

-- ===================================================================
-- 2. Audit logs
-- ===================================================================

create table if not exists public.audit_logs (
  id uuid primary key default gen_random_uuid()
);

-- Same reasoning as notifications above - explicit ALTERs so every
-- column is guaranteed to exist even if a table by this name somehow
-- already existed.
alter table public.audit_logs add column if not exists actor_id uuid references public.profiles(id) on delete set null;
alter table public.audit_logs add column if not exists action text;
alter table public.audit_logs add column if not exists target_table text;
alter table public.audit_logs add column if not exists target_id uuid;
alter table public.audit_logs add column if not exists details jsonb not null default '{}';
alter table public.audit_logs add column if not exists created_at timestamptz not null default now();

create index if not exists audit_logs_created_at_idx on public.audit_logs (created_at desc);

alter table public.audit_logs enable row level security;

drop policy if exists audit_logs_select_admin on public.audit_logs;
create policy audit_logs_select_admin on public.audit_logs
for select to authenticated
using (public.current_profile_role() = 'osoa_eb');

revoke all on public.audit_logs from anon;

do $$
begin
  alter publication supabase_realtime add table public.audit_logs;
exception when duplicate_object then
  null;
end $$;

-- 2a. profiles: logs the two admin actions Registered Users can actually
-- perform (role changes, status/deactivate-reactivate) - not every
-- profiles update, since self-service edits (name, avatar, contact
-- number) aren't administrative actions worth an audit trail entry.
create or replace function public.log_profile_admin_change()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  if auth.uid() is not null and (
    new.role is distinct from old.role or new.status is distinct from old.status
  ) then
    insert into public.audit_logs (actor_id, action, target_table, target_id, details)
    values (
      auth.uid(),
      case
        when new.status = 'inactive' and old.status is distinct from 'inactive' then 'user.deactivate'
        when new.status = 'active' and old.status is distinct from 'active' then 'user.reactivate'
        when new.role is distinct from old.role then 'user.role_change'
        else 'user.update'
      end,
      'profiles',
      new.id,
      jsonb_build_object(
        'old_role', old.role, 'new_role', new.role,
        'old_status', old.status, 'new_status', new.status
      )
    );
  end if;
  return new;
end;
$$;

drop trigger if exists trg_log_profile_admin_change on public.profiles;
create trigger trg_log_profile_admin_change
after update on public.profiles
for each row execute function public.log_profile_admin_change();

-- 2b. organizations: OSOA EB's own org-level edit/delete from Directory.
create or replace function public.log_organization_change()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    insert into public.audit_logs (actor_id, action, target_table, target_id, details)
    values (auth.uid(), 'organization.delete', 'organizations', old.id, jsonb_build_object('name', old.name));
    return old;
  end if;

  insert into public.audit_logs (actor_id, action, target_table, target_id, details)
  values (auth.uid(), 'organization.update', 'organizations', new.id, jsonb_build_object('name', new.name));
  return new;
end;
$$;

drop trigger if exists trg_log_organization_change on public.organizations;
create trigger trg_log_organization_change
after update or delete on public.organizations
for each row execute function public.log_organization_change();

-- 2c. organization_officers: the manually-curated officer/member roster -
-- add/edit/remove, from both OSOA EB (any org) and an org_president
-- (their own org only).
create or replace function public.log_officer_change()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    insert into public.audit_logs (actor_id, action, target_table, target_id, details)
    values (
      auth.uid(), 'officer.remove', 'organization_officers', old.id,
      jsonb_build_object('full_name', old.full_name, 'position', old.position, 'organization_id', old.organization_id)
    );
    return old;
  end if;

  if tg_op = 'INSERT' then
    insert into public.audit_logs (actor_id, action, target_table, target_id, details)
    values (
      auth.uid(), 'officer.add', 'organization_officers', new.id,
      jsonb_build_object('full_name', new.full_name, 'position', new.position, 'organization_id', new.organization_id)
    );
    return new;
  end if;

  insert into public.audit_logs (actor_id, action, target_table, target_id, details)
  values (
    auth.uid(), 'officer.update', 'organization_officers', new.id,
    jsonb_build_object('full_name', new.full_name, 'position', new.position, 'organization_id', new.organization_id)
  );
  return new;
end;
$$;

drop trigger if exists trg_log_officer_change on public.organization_officers;
create trigger trg_log_officer_change
after insert or update or delete on public.organization_officers
for each row execute function public.log_officer_change();

notify pgrst, 'reload schema';
