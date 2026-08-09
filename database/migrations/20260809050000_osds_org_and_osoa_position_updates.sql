-- LINGKOD Meneses - Add "Office of Student Development Services (OSDS) -
-- Meneses Campus" as a second osoa_eb-granting organization alongside
-- OSOA, rename two OSOA positions to match the labels the registration
-- form now shows, and add the "Faculty" department.
--
-- Same "positions grant role, role never comes from the client directly"
-- architecture 20260723010000_organization_positions.sql already
-- established (see its own header comment) - OSDS's one position
-- ("Coordinator") is seeded with system_role = 'osoa_eb' the exact same
-- way OSOA's four positions already are, so handle_new_user() picks it
-- up automatically with zero new role-mapping code anywhere in the app.
-- No new role value is introduced (still only osoa_eb/org_president/
-- student) - Coordinator and OSOA's four named positions are POSITIONS,
-- distinguished by (organization_id, position_name), not separate roles.
--
-- Backward compatibility: renaming "Chairperson" -> "Chairman" and "Vice
-- Chairperson" -> "Vice Chairman" only changes organization_positions'
-- own position_name value (what the registration dropdown offers going
-- forward) - profiles.position is a plain text column, not a foreign key
-- into this table, so any already-registered OSOA officer keeps whatever
-- exact text was written to their own profile at signup time,
-- untouched. Safe to run more than once (every statement here is a
-- no-op the second time).

-- ===================================================================
-- 1. OSDS organization row.
-- ===================================================================

insert into public.organizations (slug, name)
values ('osds-meneses', 'Office of Student Development Services – Meneses Campus')
on conflict (slug) do nothing;

-- ===================================================================
-- 2. Rename two OSOA positions to match the registration form's new
-- labels ("Chairman"/"Vice Chairman" instead of "Chairperson"/"Vice
-- Chairperson"). Associate for Ethics / Associate for Publication keep
-- their existing names unchanged - already exactly what was requested.
-- ===================================================================

update public.organization_positions
set position_name = 'Chairman'
where organization_id = (select id from public.organizations where slug = 'osoa-meneses')
  and position_name = 'Chairperson';

update public.organization_positions
set position_name = 'Vice Chairman'
where organization_id = (select id from public.organizations where slug = 'osoa-meneses')
  and position_name = 'Vice Chairperson';

-- ===================================================================
-- 3. OSDS's one position. on conflict...do update mirrors
-- 20260723010000's own seed pattern, so re-running this (or ever
-- adjusting display_order/is_active later) is safe.
-- ===================================================================

insert into public.organization_positions (organization_id, position_name, system_role, display_order)
select o.id, 'Coordinator', 'osoa_eb', 1
from public.organizations o
where o.slug = 'osds-meneses'
on conflict (organization_id, position_name) do update
  set system_role = excluded.system_role, display_order = excluded.display_order, is_active = true;

-- ===================================================================
-- 4. "Faculty" department.
-- ===================================================================

insert into public.departments (slug, name)
values ('faculty', 'Faculty')
on conflict (slug) do nothing;

notify pgrst, 'reload schema';
