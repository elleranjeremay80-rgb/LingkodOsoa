-- LINGKOD Meneses - registration/login repair.
--
-- The live `profiles` table never matched what register/script.js was
-- writing: it sent department_id/organization_id, but the real table only
-- ever had plain-text `department`/`organization` columns (and no such
-- table as `departments`/`organizations` existed at all). Every signup's
-- profile insert has therefore been failing with "column ... does not
-- exist" right after auth.signUp() succeeded — the account exists in
-- auth.users, but with no matching profiles row, so login's student-number
-- lookup always came back empty. This migration is idempotent (safe to
-- run more than once).

-- 1. Lookup tables, UUID-keyed, matching the <option value="..."> slugs
-- already hardcoded in register/index.html.
create table if not exists public.departments (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null unique
);

create table if not exists public.organizations (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null unique
);

insert into public.departments (slug, name) values
  ('information-technology', 'Information Technology'),
  ('business-administration', 'Business Administration'),
  ('hospitality-management', 'Hospitality Management'),
  ('bit-culinary-food-processing', 'BIT Culinary and Food Processing Technology'),
  ('bit-computer-technology', 'BIT Computer Technology'),
  ('computer-engineering', 'Computer Engineering'),
  ('teacher-education', 'Teacher Education')
on conflict (slug) do update set name = excluded.name;

insert into public.organizations (slug, name) values
  ('rac-bmc', 'Rotaract Club of BulSU Meneses Campus (RAC BMC)'),
  ('chem', 'Community Events of Hospitality Management (CHEM)'),
  ('ba-org', 'Business Administration Organization (BA ORG)'),
  ('sipnayan-society', 'Sipnayan Society Organization'),
  ('rcyc-mc', 'Red Cross Youth Council – Meneses Campus (RCYC-MC)'),
  ('sphere', 'Society of Physical Education and Recreation Enthusiast (SPHERE)'),
  ('seed', 'Society of English Educators for Development (SEED)'),
  ('cs-byte', 'Community of Students Bridging Youth and Technology for Evolution (CS BYTE)'),
  ('kapinas-fil', 'Kapisanan ng mga Nagpapakadalubhasa sa Filipino (KaPinas-Fil)'),
  ('bulakan-woodpushers', 'Bulakan Woodpushers'),
  ('icpep-se-mc', 'Institute of Computer Engineers of the Philippines Student Edition – Bulacan State University Meneses Campus (ICpEP.SE-MC)'),
  ('bulsu-maharlika', 'BulSU Maharlika'),
  ('enc-bulsu-mc', 'Every Nation Campus: Bulacan State University – Meneses Campus (ENC: BulSU-MC)'),
  ('soar', 'BulSU Uprising Soar Esports – Meneses Campus (SOAR)'),
  ('samaka', 'Samahan ng mga Mag-aaral na Katoliko (SAMAKA)'),
  ('sda', 'Sovereign Dance Athletics (SDA)'),
  ('osoa-meneses', 'Office of Student Organization and Activities (OSOA) – Meneses Campus')
on conflict (slug) do update set name = excluded.name;

alter table public.departments enable row level security;
alter table public.organizations enable row level security;

drop policy if exists "Anyone can read departments" on public.departments;
create policy "Anyone can read departments"
  on public.departments for select
  to anon, authenticated
  using (true);

drop policy if exists "Anyone can read organizations" on public.organizations;
create policy "Anyone can read organizations"
  on public.organizations for select
  to anon, authenticated
  using (true);

grant select on public.departments to anon, authenticated;
grant select on public.organizations to anon, authenticated;

-- 2. New FK columns on profiles. Additive only: the existing `department`/
-- `organization` text columns stay, since is_org_president()'s RLS check
-- (organization = current_profile_org()) and the 4 existing rows already
-- depend on them holding the display name.
alter table public.profiles add column if not exists department_id uuid references public.departments(id);
alter table public.profiles add column if not exists organization_id uuid references public.organizations(id);

grant select (department_id, organization_id) on public.profiles to anon, authenticated;
grant insert (department_id, organization_id) on public.profiles to authenticated;
grant update (department_id, organization_id) on public.profiles to authenticated;

-- 3. student_number must uniquely identify one account, or login-by-
-- student-number is ambiguous. Partial + case-insensitive: the column
-- defaults to '' and some seed rows are null, neither of which should
-- collide with a real student number.
create unique index if not exists profiles_student_number_unique
  on public.profiles (lower(student_number))
  where student_number is not null and student_number <> '';

-- 4. One-time backfill: accounts already stuck in auth.users with no
-- profiles row (every signup since the department_id bug was introduced)
-- get their profile created now, from the metadata their original signup
-- already captured. Duplicate student numbers are skipped (logged via
-- NOTICE) rather than aborting the whole migration - oldest signup wins.
do $$
declare
  r record;
  v_department_id uuid;
  v_department_name text;
  v_organization_id uuid;
  v_organization_name text;
  v_role public.user_role;
begin
  for r in
    select u.id, u.email, u.raw_user_meta_data as meta, u.created_at
    from auth.users u
    left join public.profiles p on p.id = u.id
    where p.id is null
    order by u.created_at asc
  loop
    select id, name into v_department_id, v_department_name
      from public.departments
      where slug = r.meta->>'department_id' or name = r.meta->>'department_name' or name = r.meta->>'department'
      limit 1;

    select id, name into v_organization_id, v_organization_name
      from public.organizations
      where slug = r.meta->>'organization_id' or name = r.meta->>'organization_name' or name = r.meta->>'organization'
      limit 1;

    v_role := case r.meta->>'role'
      when 'admin' then 'osoa_eb'
      when 'staff' then 'org_president'
      when 'osoa_eb' then 'osoa_eb'
      when 'org_president' then 'org_president'
      else 'student'
    end;

    begin
      insert into public.profiles (
        id, email, full_name, student_number,
        department, department_id, organization, organization_id,
        position, role, status
      )
      values (
        r.id, r.email,
        coalesce(r.meta->>'full_name', ''),
        nullif(r.meta->>'student_number', ''),
        v_department_name, v_department_id,
        v_organization_name, v_organization_id,
        r.meta->>'position', v_role, 'active'
      )
      on conflict (id) do nothing;
    exception when unique_violation then
      raise notice 'Skipped backfill for % (%): student number already claimed by an earlier signup', r.email, r.id;
    end;
  end loop;
end $$;

-- 5. Safety-net trigger so a profile is created even if the client's own
-- insert (register/script.js) never runs for any reason. Wrapped in an
-- exception handler so it never blocks account creation - the register
-- page's own upsert remains the authoritative, error-surfaced path.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (
    id, email, full_name, student_number,
    department, department_id, organization, organization_id,
    position, role, status
  )
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'full_name', ''),
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

-- 6. Anon currently holds INSERT/UPDATE column grants across nearly every
-- profiles column (harmless today only because RLS's auth.uid() = id
-- check blocks an unauthenticated anon role from ever satisfying it) -
-- tighten to exactly what the pre-login student-number lookup needs.
revoke all on public.profiles from anon;
grant select (id, student_number, email, role, status) on public.profiles to anon;
