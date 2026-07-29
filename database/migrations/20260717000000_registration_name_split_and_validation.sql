-- LINGKOD Meneses - Registration form: split "Full Name" into Last Name /
-- First Name / Surname (middle name), plus backend validation for names,
-- student number, and the required Department/Organization/Position
-- selects.
--
-- Design choice: `full_name` is NOT removed. Dozens of already-working
-- features across this app (announcements poster names, submission
-- submitter/reviewer names, the dashboard, calendar, Profile page, etc.)
-- read `profiles.full_name` directly via the shared lingkodFetchProfilesById
-- helper. Rather than touch every one of those call sites, full_name
-- becomes a GENERATED column computed as "Last Name, First Name Surname"
-- - every existing feature keeps working unmodified and automatically
-- shows the correctly-formatted combined name, with zero risk of missing
-- a call site. Safe to run more than once.

-- ===================================================================
-- 1. New columns (nullable for now - backfilled below, then guarded by
-- NOT VALID check constraints rather than NOT NULL, in case existing
-- rows can't be split cleanly).
-- ===================================================================

alter table public.profiles add column if not exists last_name text;
alter table public.profiles add column if not exists first_name text;
alter table public.profiles add column if not exists surname text;

-- ===================================================================
-- 2. Best-effort backfill for any existing row that only has full_name.
-- This is inherently lossy (full_name was ever only a single free-text
-- field - there's no reliable way to know which word was the middle
-- name), so it's a heuristic: first word -> first_name, last word ->
-- last_name, anything in between -> surname. Rows already having
-- last_name/first_name set are left untouched.
-- ===================================================================

do $$
declare
  r record;
  parts text[];
begin
  for r in
    select id, full_name from public.profiles
    where (last_name is null or first_name is null) and full_name is not null and trim(full_name) <> ''
  loop
    parts := regexp_split_to_array(trim(r.full_name), '\s+');
    if array_length(parts, 1) = 1 then
      update public.profiles set first_name = parts[1], last_name = parts[1], surname = ''
        where id = r.id;
    else
      update public.profiles set
        first_name = parts[1],
        last_name = parts[array_length(parts, 1)],
        surname = case when array_length(parts, 1) > 2
          then array_to_string(parts[2:array_length(parts, 1) - 1], ' ')
          else '' end
        where id = r.id;
    end if;
  end loop;
end $$;

update public.profiles set last_name = '' where last_name is null;
update public.profiles set first_name = '' where first_name is null;
update public.profiles set surname = '' where surname is null;

-- ===================================================================
-- 3. full_name becomes generated. Postgres can't convert a plain column
-- to generated in place - drop and recreate it.
-- ===================================================================

alter table public.profiles drop column if exists full_name;
alter table public.profiles add column full_name text
  generated always as (
    trim(both ', ' from
      coalesce(nullif(last_name, ''), '')
      || ', ' || coalesce(nullif(first_name, ''), '')
      || case when nullif(surname, '') is not null then ' ' || surname else '' end
    )
  ) stored;

-- ===================================================================
-- 4. Signup trigger: insert last_name/first_name/surname instead of the
-- now-generated full_name (inserting a value into a generated column is
-- a Postgres error).
-- ===================================================================

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (
    id, email, last_name, first_name, surname, student_number,
    department, department_id, organization, organization_id,
    position, role, status
  )
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'last_name', ''),
    coalesce(new.raw_user_meta_data->>'first_name', ''),
    coalesce(new.raw_user_meta_data->>'surname', ''),
    nullif(new.raw_user_meta_data->>'student_number', ''),
    new.raw_user_meta_data->>'department_name',
    nullif(new.raw_user_meta_data->>'department_id', '')::uuid,
    new.raw_user_meta_data->>'organization_name',
    nullif(new.raw_user_meta_data->>'organization_id', '')::uuid,
    new.raw_user_meta_data->>'position',
    coalesce(new.raw_user_meta_data->>'role', 'student')::public.user_role,
    'active'
  )
  on conflict (id) do nothing;
  return new;
exception
  when others then
    raise warning 'handle_new_user failed for %: %', new.id, sqlerrm;
    return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ===================================================================
-- 5. Backend validation - the frontend enforces these too, but per the
-- brief, never *only* the frontend. NOT VALID: enforced for every new
-- insert/update from now on, without failing this migration over
-- whatever legacy data already exists.
-- ===================================================================

alter table public.profiles drop constraint if exists profiles_last_name_format;
alter table public.profiles add constraint profiles_last_name_format
  check (last_name = '' or last_name ~ '^[A-Za-z'' -]+$') not valid;

alter table public.profiles drop constraint if exists profiles_first_name_format;
alter table public.profiles add constraint profiles_first_name_format
  check (first_name = '' or first_name ~ '^[A-Za-z'' -]+$') not valid;

alter table public.profiles drop constraint if exists profiles_surname_format;
alter table public.profiles add constraint profiles_surname_format
  check (surname = '' or surname ~ '^[A-Za-z'' -]+$') not valid;

alter table public.profiles drop constraint if exists profiles_student_number_format;
alter table public.profiles add constraint profiles_student_number_format
  check (student_number is null or student_number ~ '^[0-9]{10}$') not valid;

alter table public.profiles drop constraint if exists profiles_department_required;
alter table public.profiles add constraint profiles_department_required
  check (department_id is not null) not valid;

alter table public.profiles drop constraint if exists profiles_organization_required;
alter table public.profiles add constraint profiles_organization_required
  check (organization_id is not null) not valid;

alter table public.profiles drop constraint if exists profiles_position_required;
alter table public.profiles add constraint profiles_position_required
  check (position is not null and position <> '') not valid;
