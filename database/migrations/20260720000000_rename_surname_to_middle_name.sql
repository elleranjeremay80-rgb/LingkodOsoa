-- LINGKOD Meneses - Rename profiles.surname to profiles.middle_name
-- throughout the schema, to match the app-wide UI rename from
-- "Surname (Middle Name)" to "Middle Name".
--
-- A plain column rename is safe here even though full_name (a GENERATED
-- column) and profiles_surname_format (a CHECK constraint) both reference
-- surname: Postgres tracks those dependencies by the column's internal
-- attnum, not by re-parsing stored SQL text, so RENAME COLUMN transparently
-- updates both without needing to drop/recreate either one. Column-level
-- GRANTs (see 20260718000000_profile_self_edit_lockdown.sql) are tracked
-- the same way, so the existing UPDATE grant on this column also survives
-- the rename automatically - the re-grant below is just defensive/explicit,
-- not strictly required.
--
-- Safe to run more than once: unlike most of this project's migrations,
-- a bare RENAME COLUMN / RENAME CONSTRAINT has no "IF EXISTS" form in
-- Postgres, so re-running it unguarded would fail on a second execution
-- once surname is already gone - both are wrapped below in an existence
-- check instead, matching every other migration's actual re-run safety.

do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'profiles' and column_name = 'surname'
  ) and not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'profiles' and column_name = 'middle_name'
  ) then
    alter table public.profiles rename column surname to middle_name;
  end if;
end $$;

do $$
begin
  if exists (
    select 1 from pg_constraint where conname = 'profiles_surname_format'
  ) and not exists (
    select 1 from pg_constraint where conname = 'profiles_middle_name_format'
  ) then
    alter table public.profiles rename constraint profiles_surname_format to profiles_middle_name_format;
  end if;
end $$;

-- The signup trigger reads "surname" as a JSON key out of
-- auth.users.raw_user_meta_data - that's the metadata payload
-- register/script.js sends to signUp(), not a database column, so
-- renaming the profiles column above doesn't touch it. The client now
-- sends "middle_name" as that key instead, so the trigger has to read the
-- same new key name.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
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
    nullif(new.raw_user_meta_data->>'organization_id', '')::uuid,
    new.raw_user_meta_data->>'position',
    coalesce(new.raw_user_meta_data->>'role', 'student')::public.user_role,
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

-- Explicit re-grant using the new column name, for clarity - the rename
-- above already carried the existing grant over automatically.
grant update (
  last_name, first_name, middle_name,
  department, department_id, organization, organization_id
) on public.profiles to authenticated;

-- PostgREST (what supabase-js actually talks to) keeps its own cached copy
-- of the schema and doesn't necessarily notice a DDL change made through
-- the SQL editor right away - this is what "Could not find the
-- 'middle_name' column ... in the schema cache" means even after the
-- rename above has genuinely already happened. This tells it to reload
-- immediately rather than waiting for its own periodic refresh.
notify pgrst, 'reload schema';
