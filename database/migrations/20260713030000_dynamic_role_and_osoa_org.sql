-- LINGKOD Meneses - self-registration now sets role from the Position
-- dropdown (osoa_eb -> admin, organization_president -> staff,
-- student -> student), instead of always defaulting to student.
-- Also adds the OSOA office itself as a selectable organization.

-- New organization option
insert into public.organizations (id, name) values
  ('osoa-meneses', 'Office of Student Organization and Activities (OSOA) – Meneses Campus')
on conflict (id) do update set name = excluded.name;

-- Trigger now reads role from signup metadata (register/script.js sends
-- it directly as 'admin' / 'staff' / 'student', already translated from
-- the Position dropdown's friendlier option values). Falls back to
-- 'student' if that metadata is ever missing, so no signup can end up
-- with a null/invalid role.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, email, full_name, student_number, department_id, organization_id, position, role, status)
  values (
    new.id,
    new.email,
    new.raw_user_meta_data ->> 'full_name',
    new.raw_user_meta_data ->> 'student_number',
    new.raw_user_meta_data ->> 'department_id',
    new.raw_user_meta_data ->> 'organization_id',
    new.raw_user_meta_data ->> 'position',
    coalesce(new.raw_user_meta_data ->> 'role', 'student'),
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
