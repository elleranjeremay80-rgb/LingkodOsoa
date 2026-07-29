-- LINGKOD Meneses - live-updating Ongoing Projects / Upcoming Activities /
-- Implemented Activities / Income-Generating Projects preview panels on the
-- Organization President and Student dashboards.
-- Without this, an insert/update/delete on projects_activities by the OSOA
-- Executive Board (or an org president, for their own org) never reaches
-- postgres_changes subscribers, so the dashboards would only pick it up on
-- a manual refresh.
do $$
begin
  alter publication supabase_realtime add table public.projects_activities;
exception when duplicate_object then
  null;
end $$;
