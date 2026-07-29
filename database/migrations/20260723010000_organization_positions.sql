-- LINGKOD Meneses - dynamic, per-organization Position list at
-- registration, with the system role derived server-side from
-- (organization, position) instead of being chosen directly by the user.
--
-- Role is stored per position row (system_role) rather than computed at
-- signup time by string-matching position names against "President" -
-- this session already hit real bugs from exactly that kind of fragile
-- runtime string matching (feedback_type/status drift, organization name
-- matching), so the rule lives in data instead: every row already says
-- which role it grants, and the trigger just looks it up.

-- ===================================================================
-- 1. The positions table itself.
-- ===================================================================

create table if not exists public.organization_positions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  position_name text not null,
  system_role text not null check (system_role in ('osoa_eb', 'org_president', 'student')),
  display_order int not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, position_name)
);

drop trigger if exists set_organization_positions_updated_at on public.organization_positions;
create trigger set_organization_positions_updated_at
  before update on public.organization_positions
  for each row execute function public.set_updated_at();

alter table public.organization_positions enable row level security;

-- Same "anyone can read" policy as departments/organizations - the
-- registration page has to populate the Position dropdown before the
-- visitor has an account, so this needs to be readable by anon too.
drop policy if exists "Anyone can read organization positions" on public.organization_positions;
create policy "Anyone can read organization positions"
  on public.organization_positions for select
  to anon, authenticated
  using (is_active = true);

grant select on public.organization_positions to anon, authenticated;
revoke insert, update, delete on public.organization_positions from anon, authenticated;

-- ===================================================================
-- 2. Seed data. OSOA's 4 named positions all grant osoa_eb; every other
-- accredited organization gets the same standard position roster (the
-- brief gave one shared list "for all accredited student organizations,"
-- not per-organization rosters, so the same list applies to all 16) -
-- "President" grants org_president, everything else (including the
-- literal "Member" position) grants student. on conflict...do update
-- makes this safe to re-run if the position list ever needs adjusting.
-- ===================================================================

insert into public.organization_positions (organization_id, position_name, system_role, display_order)
select o.id, p.position_name, 'osoa_eb', p.display_order
from public.organizations o
cross join (values
  ('Chairperson', 1),
  ('Vice Chairperson', 2),
  ('Associate for Publication', 3),
  ('Associate for Ethics', 4)
) as p(position_name, display_order)
where o.slug = 'osoa-meneses'
on conflict (organization_id, position_name) do update
  set system_role = excluded.system_role, display_order = excluded.display_order, is_active = true;

insert into public.organization_positions (organization_id, position_name, system_role, display_order)
select o.id, p.position_name, case when p.position_name = 'President' then 'org_president' else 'student' end, p.display_order
from public.organizations o
cross join (values
  ('President', 1),
  ('Vice President', 2),
  ('Secretary', 3),
  ('Assistant Secretary', 4),
  ('Treasurer', 5),
  ('Assistant Treasurer', 6),
  ('Auditor', 7),
  ('PIO / PRO', 8),
  ('Director', 9),
  ('Committee Head', 10),
  ('Team Head', 11),
  ('Team Assistant', 12),
  ('Representative', 13),
  ('Board of Director', 14),
  ('Multimedia Head', 15),
  ('Technical Head', 16),
  ('Logistics Officer', 17),
  ('Membership Head', 18),
  ('Program Head', 19),
  ('Co-Chairperson', 20),
  ('Cheer Co-Captain', 21),
  ('Member', 22)
) as p(position_name, display_order)
where o.slug <> 'osoa-meneses'
on conflict (organization_id, position_name) do update
  set system_role = excluded.system_role, display_order = excluded.display_order, is_active = true;

-- ===================================================================
-- 3. "Only one Chairperson, one Vice Chairperson, ... only one President
-- per organization" - a single partial unique index covers both rules at
-- once: OSOA's 4 rows all share the same organization_id, so
-- (organization_id, position) can only exist once per named OSOA
-- position; every other org's "President" is scoped to its own
-- organization_id, so this doesn't stop two different organizations from
-- each having their own President. Scoped to active accounts only, so a
-- deactivated former president/OSOA officer doesn't permanently block
-- the position from ever being filled again.
--
-- No "Super Administrator override" exists to build against - this app
-- has no role beyond osoa_eb/org_president/student today, so there's no
-- self-service bypass for this constraint. Reassigning a filled position
-- means an OSOA EB member changing the current holder's profile
-- (deactivating them, or editing their role/position directly) before
-- someone else can register into it - not something this migration adds
-- a UI for.
--
-- Excludes the two old generic position labels ("OSOA Executive Board
-- (OSOA EB)" / "Organization President") that every account registered
-- before this migration has - the old Position dropdown WAS the role
-- picker (3 fixed options, no granular titles), so every pre-existing
-- osoa_eb/org_president account shares one of these two identical
-- strings and was never asked to choose "Chairperson" vs "Vice
-- Chairperson" etc. in the first place. Enforcing per-position
-- uniqueness against data that predates that distinction isn't
-- meaningful - this index only governs real position names going
-- forward, which is all the new dropdown can ever produce.
-- ===================================================================

drop index if exists profiles_unique_position_per_org;
create unique index profiles_unique_position_per_org
  on public.profiles (organization_id, position)
  where status = 'active'
    and role in ('osoa_eb', 'org_president')
    and position not in ('OSOA Executive Board (OSOA EB)', 'Organization President');

-- ===================================================================
-- 4. handle_new_user() now derives role server-side from
-- (organization_id, position) via organization_positions, instead of
-- trusting whatever role string arrives in the signup metadata directly.
-- Falls back to the lowest-privilege role (student) if no matching
-- position is found, same resilience-first shape as the rest of this
-- function (warn and continue rather than ever blocking a real auth
-- signup) - a client bypassing the UI to send a bogus position simply
-- doesn't get elevated access, it just lands as a student.
-- ===================================================================

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  v_org_id uuid;
  v_position text;
  v_role public.user_role;
begin
  v_org_id := nullif(new.raw_user_meta_data->>'organization_id', '')::uuid;
  v_position := new.raw_user_meta_data->>'position';

  select op.system_role::public.user_role into v_role
  from public.organization_positions op
  where op.organization_id = v_org_id
    and op.position_name = v_position
    and op.is_active = true
  limit 1;

  if v_role is null then
    v_role := 'student'::public.user_role;
  end if;

  insert into public.profiles (
    id, email, last_name, first_name, middle_name, student_number,
    department, department_id, organization, organization_id,
    position, role, status
  )
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'last_name', ''),
    coalesce(new.raw_user_meta_data->>'first_name', ''),
    coalesce(new.raw_user_meta_data->>'middle_name', ''),
    nullif(new.raw_user_meta_data->>'student_number', ''),
    new.raw_user_meta_data->>'department_name',
    nullif(new.raw_user_meta_data->>'department_id', '')::uuid,
    new.raw_user_meta_data->>'organization_name',
    v_org_id,
    v_position,
    v_role,
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

-- ===================================================================
-- 5. Registration runs pre-signup, with no session yet - anon only has
-- column-level grants for id/student_number/email/role/status on
-- profiles (see "Public can look up login info"), not organization_id/
-- position, so the registration form can't just SELECT those columns
-- directly to show a friendly "this position is already filled" error.
-- Rather than widen anon's raw column access to profiles, this is a
-- narrow security definer function that answers exactly one yes/no
-- question without exposing any profile data at all.
-- ===================================================================

create or replace function public.is_position_filled(p_organization_id uuid, p_position text)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from public.profiles
    where organization_id = p_organization_id
      and position = p_position
      and status = 'active'
  );
$$;

grant execute on function public.is_position_filled(uuid, text) to anon, authenticated;

notify pgrst, 'reload schema';
