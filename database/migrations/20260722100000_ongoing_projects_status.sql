-- LINGKOD Meneses - Ongoing Projects: replaces the progress-percentage
-- bar with a real Project Status field (Not Yet Started / On Going /
-- Done). Only Ongoing Projects ever used progress_percent or an editable
-- status - Upcoming/Implemented Activities show hardcoded badges
-- unrelated to any column, and Income-Generating Projects has its own
-- separate, already-working ongoing/completed status for fundraising
-- state, which this migration does not touch.
--
-- Like every other table in this app that was created directly against
-- the live project, projects_activities has no CREATE TABLE in this
-- migrations folder - status's exact type (enum vs text) is looked up
-- dynamically via udt_name (the technique this session settled on after
-- an earlier guessed-enum-name mistake), not assumed.
--
-- Reuses the existing 'ongoing' and 'completed' values already written
-- by this and other modules for "On Going" and "Done" - only
-- 'not_started' is new.

do $$
declare
  v_type_name text;
begin
  select udt_name into v_type_name
  from information_schema.columns
  where table_schema = 'public' and table_name = 'projects_activities' and column_name = 'status'
    and data_type = 'USER-DEFINED';

  if v_type_name is not null then
    begin
      execute format('alter type public.%I add value if not exists %L', v_type_name, 'not_started');
    exception when others then
      raise notice 'Could not add not_started to projects_activities.status enum (%): %', v_type_name, sqlerrm;
    end;
  end if;
end $$;

commit;

-- Fallback CHECK, only fires if status turns out to be plain text on this
-- install rather than an enum. Deliberately permissive of every value any
-- of the 4 modules has ever written (on_hold/cancelled were never
-- actually written but existed in a label map defensively) so this
-- doesn't reject rows from the other 3 modules that share this column.
do $$
declare
  v_constraint_name text;
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'projects_activities' and column_name = 'status'
      and data_type <> 'USER-DEFINED'
  ) then
    for v_constraint_name in
      select conname from pg_constraint
      where conrelid = 'public.projects_activities'::regclass and contype = 'c'
        and pg_get_constraintdef(oid) ilike '%status%'
    loop
      execute format('alter table public.projects_activities drop constraint %I', v_constraint_name);
    end loop;

    alter table public.projects_activities add constraint projects_activities_status_check
      check (status in ('not_started', 'ongoing', 'completed', 'planned', 'on_hold', 'cancelled'))
      not valid;
  end if;
end $$;

-- Backfill: existing Ongoing Projects rows inserted before this migration
-- were always given status = 'ongoing' (the old insert hardcoded it) -
-- nothing to backfill there. progress_percent is being dropped outright
-- per "remove all logic related to progress percentages."
alter table public.projects_activities drop column if exists progress_percent;

notify pgrst, 'reload schema';
