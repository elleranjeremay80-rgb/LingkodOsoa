-- LINGKOD Meneses - performance indexes for List of Organizations/Members.
--
-- profiles.organization and profiles.role are now the primary filter
-- columns for this page's queries (org_president's client-side .eq(),
-- the org-scoped card stats grouping, and the security definer RLS
-- helper functions' own internal lookups) - none of the earlier
-- migrations that added these columns indexed them. Safe to run more
-- than once; a plain (non-partial, non-unique) index has no data
-- dependency to worry about.

create index if not exists profiles_organization_idx on public.profiles (organization);
create index if not exists profiles_role_idx on public.profiles (role);

notify pgrst, 'reload schema';
