-- handle_new_user(): reject a signup whose profile would violate a unique
-- index, instead of silently creating a login with no profile.
--
-- Why: the previous version caught *every* error (`when others`) and
-- returned NEW anyway, so when a student number was already taken
-- (profiles_student_number_unique) or a single-holder position was
-- already filled (profiles_unique_position_per_org), Supabase Auth still
-- created the auth.users row. The register page then reported "already
-- registered", but that email was left attached to a profile-less login:
-- the person could neither log in (login resolves through profiles) nor
-- register again ("User already registered"). Two such orphaned logins
-- existed in production when this was written (both from 2026-09-19,
-- both with student numbers already held by another profile).
--
-- What changes: unique_violation is re-raised, which aborts the whole
-- auth.users insert in the same transaction - signUp() fails cleanly with
-- "Database error saving new user" (mapped to a friendly message in
-- frontend/pages/register/script.js), and no login is created. All other
-- errors keep the previous warn-and-continue behavior, so nothing else
-- about registration changes. The function body is otherwise identical.

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
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
  when unique_violation then
    -- Taken student number / filled position: refuse the signup outright
    -- so no orphaned login is left behind.
    raise;
  when others then
    raise warning 'handle_new_user failed for %: %', new.id, sqlerrm;
    return new;
end;
$function$;
