-- LINGKOD Meneses - fixes "permission denied for table profiles" on
-- List of Members.
--
-- Postgres privilege checks are two separate layers: the base GRANT
-- (can this role run SELECT on this table at all?) and RLS policies
-- (which rows does it get back?). public.profiles only ever had narrow,
-- explicit column grants for the anon role (for the login lookup) - no
-- migration in this repo grants authenticated a base SELECT at all. The
-- RLS policies added for List of Members (profiles_admin_org_select) are
-- correct, but they're moot if the role can't SELECT the table in the
-- first place, hence "permission denied" rather than an empty result.
--
-- Safe to grant broadly here because RLS still does the real row-level
-- gating on top of this: own row (existing policy), or full/org-scoped
-- access for osoa_eb/org_president (profiles_admin_org_select).

grant select on public.profiles to authenticated;

notify pgrst, 'reload schema';
