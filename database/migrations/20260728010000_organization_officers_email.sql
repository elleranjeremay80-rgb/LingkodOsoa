-- LINGKOD Meneses - organization_officers: add an optional Email field.
--
-- The Directory redesign's Edit modal needs an Email field alongside the
-- existing Contact Number (added in 20260723040000) - a manually-added
-- officer/member row has no auth.users account of its own, so this is
-- purely a free-text contact field, not tied to login/notifications.
-- No RLS changes needed: organization_officers' insert/update/delete
-- policies are row-scoped (osoa_eb any row, org_president own org only),
-- not column-scoped, so they already cover this new column.

alter table public.organization_officers add column if not exists email text;

notify pgrst, 'reload schema';
