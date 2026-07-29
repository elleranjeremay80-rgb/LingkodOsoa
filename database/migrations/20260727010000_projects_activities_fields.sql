-- LINGKOD Meneses - projects_activities: two module-specific additions.
--
-- 1. Ongoing Projects gets a "Date of Implementation" field
--    (implementation_date) - the only one of the 4 modules sharing this
--    table that had no date column at all (Upcoming/Implemented Activities
--    already have start_date/end_date).
--
-- 2. Income-Generating Projects: amount_raised -> price (the form now
--    collects a selling price / registration fee, not a running total
--    raised - same column, new name and meaning, so existing values carry
--    over as-is rather than being reinterpreted or wiped), plus a new
--    who_can_avail field (text[] - Students/Faculty/Alumni/Public/
--    Everyone, multi-select via checkboxes client-side).
--
-- Like every other column on this table, no CREATE TABLE for
-- projects_activities exists in this migrations folder (created directly
-- against the live project) - every statement below is defensive.

alter table public.projects_activities add column if not exists implementation_date date;

do $$
begin
  if exists (select 1 from information_schema.columns where table_schema='public' and table_name='projects_activities' and column_name='amount_raised')
     and not exists (select 1 from information_schema.columns where table_schema='public' and table_name='projects_activities' and column_name='price') then
    alter table public.projects_activities rename column amount_raised to price;
  end if;
end $$;

alter table public.projects_activities add column if not exists price numeric(12,2);

alter table public.projects_activities drop constraint if exists projects_activities_price_check;
alter table public.projects_activities add constraint projects_activities_price_check
  check (price is null or price >= 0);

alter table public.projects_activities add column if not exists who_can_avail text[];

alter table public.projects_activities drop constraint if exists projects_activities_who_can_avail_check;
alter table public.projects_activities add constraint projects_activities_who_can_avail_check
  check (
    who_can_avail is null
    or who_can_avail <@ array['Students', 'Faculty', 'Alumni', 'Public', 'Everyone']::text[]
  );

notify pgrst, 'reload schema';
