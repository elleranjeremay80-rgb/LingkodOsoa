-- LINGKOD Meneses - Organization Information: adds Vision, Mission, and
-- Goals to the fields OSOA EB / the org's own president can maintain
-- alongside Organization Description. Same pattern as
-- 20260724000000_organization_information.sql - optional (existing rows
-- have none of this filled in yet), no RLS change needed (organizations_
-- update already covers every column on the row), just a wider column
-- grant so these three are actually writable.

alter table public.organizations add column if not exists vision text;
alter table public.organizations add column if not exists mission text;
alter table public.organizations add column if not exists goals text;

grant update (vision, mission, goals) on public.organizations to authenticated;

notify pgrst, 'reload schema';
