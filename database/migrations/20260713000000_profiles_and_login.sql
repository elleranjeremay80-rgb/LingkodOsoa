-- LINGKOD Meneses - profiles table + login access
-- Consolidates everything the app's registration/login code needs.
-- Safe to run more than once (every statement is idempotent).

-- 1. Table
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  full_name text not null,
  student_number text not null,
  department text not null,
  organization text,
  position text,
  role text not null default 'student' check (role in ('admin', 'staff', 'student')),
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

-- Backfill columns in case the table was created before any of these existed.
alter table public.profiles add column if not exists email text;
alter table public.profiles add column if not exists is_active boolean not null default true;
alter table public.profiles add column if not exists created_at timestamptz not null default now();

-- 2. Student Number must be unique
create unique index if not exists profiles_student_number_unique
  on public.profiles (student_number);

-- 3. Row Level Security
alter table public.profiles enable row level security;

drop policy if exists "Users can read their own profile" on public.profiles;
create policy "Users can read their own profile"
  on public.profiles for select
  using (auth.uid() = id);

drop policy if exists "Users can update their own profile" on public.profiles;
create policy "Users can update their own profile"
  on public.profiles for update
  using (auth.uid() = id);

drop policy if exists "Users can insert their own profile" on public.profiles;
create policy "Users can insert their own profile"
  on public.profiles for insert
  with check (auth.uid() = id);

-- Anonymous (pre-login) visitors need to look up an account by student
-- number before they're authenticated. Row-level this is wide open;
-- column-level (below) is scoped tightly so it never exposes name,
-- department, organization, or position.
drop policy if exists "Public can look up login info" on public.profiles;
create policy "Public can look up login info"
  on public.profiles for select
  to anon
  using (true);

revoke select on public.profiles from anon;
grant select (id, student_number, email, role, is_active) on public.profiles to anon;

-- 4. Auto-create a profile row on signup. Never blocks account creation
-- if something about the profile insert fails (logs a warning instead) —
-- register/script.js's own upsert is the authoritative, error-surfaced path.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, email, full_name, student_number, department, organization, position, role)
  values (
    new.id,
    new.email,
    new.raw_user_meta_data ->> 'full_name',
    new.raw_user_meta_data ->> 'student_number',
    new.raw_user_meta_data ->> 'department',
    new.raw_user_meta_data ->> 'organization',
    new.raw_user_meta_data ->> 'position',
    'student'
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

-- 5. Old RPC-based login lookup is no longer used by the client — cleaned up.
drop function if exists public.get_email_by_student_number(text);
drop function if exists public.get_login_info_by_student_number(text);
