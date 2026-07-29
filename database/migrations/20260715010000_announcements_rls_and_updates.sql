-- LINGKOD Meneses - Announcements & Profile alignment.
--
-- The base `announcements` table (and its original RLS) were created
-- directly against the live project, never captured in this migrations
-- folder - and earlier profiles migrations disagree with each other on
-- column names (department vs department_id, is_active vs status), which
-- only makes sense if some of this was also hand-patched live. This
-- migration is written defensively so it's a safe, single source of truth
-- regardless of what's actually live right now:
--   - every column add is `if not exists`
--   - every trigger/policy is dropped-then-recreated by name
--   - the realtime publish is wrapped so re-running it doesn't error
-- Safe to run more than once, in any state.

-- ===================================================================
-- 1. PROFILES - backfill any column the app's JS reads (profile/script.js
-- does `select("*")`, so missing columns don't error, but the page can't
-- show real data for a column that isn't there).
-- ===================================================================

alter table public.profiles add column if not exists email text;
alter table public.profiles add column if not exists full_name text;
alter table public.profiles add column if not exists student_number text;
alter table public.profiles add column if not exists department text;
alter table public.profiles add column if not exists organization text;
alter table public.profiles add column if not exists position text;
alter table public.profiles add column if not exists role text not null default 'student';
alter table public.profiles add column if not exists status text not null default 'active';
alter table public.profiles add column if not exists created_at timestamptz not null default now();
alter table public.profiles add column if not exists updated_at timestamptz not null default now();

-- Shared updated_at trigger function (also used below for announcements).
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_profiles_updated_at on public.profiles;
create trigger set_profiles_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

-- ===================================================================
-- 2. ANNOUNCEMENTS - create if missing entirely, otherwise backfill any
-- column the app's JS relies on (announcements/script.js, dashboard/
-- script.js, profile/script.js).
-- ===================================================================

create table if not exists public.announcements (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  content text not null,
  event_date date,
  event_location text,
  event_who text,
  visibility text not null default 'public' check (visibility in ('public', 'organization', 'department')),
  organization text,
  created_by uuid references auth.users(id) on delete set null,
  is_published boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.announcements add column if not exists event_date date;
alter table public.announcements add column if not exists event_location text;
alter table public.announcements add column if not exists event_who text;
alter table public.announcements add column if not exists organization text;
alter table public.announcements add column if not exists is_published boolean not null default true;
alter table public.announcements add column if not exists created_at timestamptz not null default now();
alter table public.announcements add column if not exists updated_at timestamptz not null default now();

drop trigger if exists set_announcements_updated_at on public.announcements;
create trigger set_announcements_updated_at
  before update on public.announcements
  for each row execute function public.set_updated_at();

alter table public.announcements enable row level security;

-- Realtime: harmless no-op if it's already a publication member.
do $$
begin
  alter publication supabase_realtime add table public.announcements;
exception when duplicate_object then
  null;
end $$;

-- ===================================================================
-- 3. RLS - explicit, complete policy set matching the app's role matrix:
--   osoa_eb        -> select all published rows, insert, update any, delete any
--   org_president  -> select public + own-organization rows, insert,
--                      update/delete only rows they personally created
--   student        -> select public + own-organization rows only
-- "department" visibility reuses the same `organization` column as
-- "organization" visibility (the posting form always stores the poster's
-- profiles.organization there - see announcements/script.js), so both
-- tiers are scoped identically below.
-- ===================================================================

drop policy if exists "announcements_select" on public.announcements;
drop policy if exists "announcements_write" on public.announcements;
drop policy if exists "announcements_insert" on public.announcements;
drop policy if exists "announcements_update" on public.announcements;
drop policy if exists "announcements_delete" on public.announcements;

create policy "announcements_select"
  on public.announcements for select
  to authenticated
  using (
    is_published = true
    and (
      visibility = 'public'
      or exists (
        select 1 from public.profiles p
        where p.id = auth.uid() and p.role = 'osoa_eb'
      )
      or exists (
        select 1 from public.profiles p
        where p.id = auth.uid() and p.organization = announcements.organization
      )
    )
  );

create policy "announcements_insert"
  on public.announcements for insert
  to authenticated
  with check (
    created_by = auth.uid()
    and exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.role in ('osoa_eb', 'org_president')
    )
  );

create policy "announcements_update"
  on public.announcements for update
  to authenticated
  using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
        and (p.role = 'osoa_eb' or (p.role = 'org_president' and announcements.created_by = auth.uid()))
    )
  )
  with check (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
        and (p.role = 'osoa_eb' or (p.role = 'org_president' and announcements.created_by = auth.uid()))
    )
  );

create policy "announcements_delete"
  on public.announcements for delete
  to authenticated
  using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
        and (p.role = 'osoa_eb' or (p.role = 'org_president' and announcements.created_by = auth.uid()))
    )
  );

-- No anonymous access at all.
revoke all on public.announcements from anon;
