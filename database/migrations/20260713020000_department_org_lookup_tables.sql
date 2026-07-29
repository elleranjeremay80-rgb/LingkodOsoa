-- LINGKOD Meneses - normalize department/organization into real lookup
-- tables with foreign keys, and rename is_active -> status.
-- Safe to run more than once.

-- 1. Lookup tables. IDs are human-readable slugs matching the values
-- now hardcoded into register/index.html's <option value="..."> so no
-- runtime lookup is needed at registration time.
create table if not exists public.departments (
  id text primary key,
  name text not null unique
);

create table if not exists public.organizations (
  id text primary key,
  name text not null unique
);

insert into public.departments (id, name) values
  ('information-technology', 'Information Technology'),
  ('business-administration', 'Business Administration'),
  ('hospitality-management', 'Hospitality Management'),
  ('bit-culinary-food-processing', 'BIT Culinary and Food Processing Technology'),
  ('bit-computer-technology', 'BIT Computer Technology'),
  ('computer-engineering', 'Computer Engineering'),
  ('teacher-education', 'Teacher Education')
on conflict (id) do update set name = excluded.name;

insert into public.organizations (id, name) values
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
  ('sda', 'Sovereign Dance Athletics (SDA)')
on conflict (id) do update set name = excluded.name;

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

-- 2. New columns on profiles
alter table public.profiles add column if not exists department_id text references public.departments(id);
alter table public.profiles add column if not exists organization_id text references public.organizations(id);
alter table public.profiles add column if not exists status text not null default 'active' check (status in ('active', 'inactive'));

-- 3. Best-effort backfill from the old text columns (only if they still exist)
do $$
begin
  if exists (select 1 from information_schema.columns where table_schema='public' and table_name='profiles' and column_name='department') then
    update public.profiles p
    set department_id = d.id
    from public.departments d
    where p.department_id is null and lower(trim(p.department)) = lower(d.name);
  end if;

  if exists (select 1 from information_schema.columns where table_schema='public' and table_name='profiles' and column_name='organization') then
    update public.profiles p
    set organization_id = o.id
    from public.organizations o
    where p.organization_id is null and lower(trim(p.organization)) = lower(o.name);
  end if;

  if exists (select 1 from information_schema.columns where table_schema='public' and table_name='profiles' and column_name='is_active') then
    update public.profiles
    set status = case when is_active then 'active' else 'inactive' end;
  end if;
end $$;

-- 4. Drop the old columns now that data has been migrated
alter table public.profiles drop column if exists department;
alter table public.profiles drop column if exists organization;
alter table public.profiles drop column if exists is_active;

-- 5. Update the signup trigger for the new column names
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, email, full_name, student_number, department_id, organization_id, position, role, status)
  values (
    new.id,
    new.email,
    new.raw_user_meta_data ->> 'full_name',
    new.raw_user_meta_data ->> 'student_number',
    new.raw_user_meta_data ->> 'department_id',
    new.raw_user_meta_data ->> 'organization_id',
    new.raw_user_meta_data ->> 'position',
    'student',
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

-- 6. Update the anon login-lookup grant: is_active -> status
revoke select on public.profiles from anon;
grant select (id, student_number, email, role, status) on public.profiles to anon;
