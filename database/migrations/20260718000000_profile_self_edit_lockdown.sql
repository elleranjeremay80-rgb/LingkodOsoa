-- LINGKOD Meneses - Edit Profile: lock down self-service profile updates
-- to a safe column allowlist, and keep profiles.email in sync with
-- auth.users.email automatically.
--
-- Security note: the existing "Users can update their own profile" RLS
-- policy only checks auth.uid() = id (row-level) - with no column-level
-- restriction, any authenticated user could already update THEIR OWN
-- `role` via a raw API call bypassing the UI entirely, since `role`
-- drives every permission decision across this app (OSOA EB access,
-- submission review rights, etc.). Now that a real Edit Profile form
-- exists, this closes that gap by only granting UPDATE on the columns
-- the form actually needs - role/status/student_number/position can
-- never be self-edited, by anyone, regardless of what the client sends.
--
-- email is deliberately NOT in that grant list either: the Edit Profile
-- form changes it via supabaseClient.auth.updateUser({email}), which goes
-- through Supabase's own confirmation flow, never a direct profiles.email
-- write - this trigger is what actually applies it to profiles once
-- Supabase confirms the change (works no matter when/where that
-- confirmation happens, not just this session).
-- Safe to run more than once.

revoke update on public.profiles from authenticated;
grant update (
  last_name, first_name, surname,
  department, department_id, organization, organization_id
) on public.profiles to authenticated;

create or replace function public.handle_user_email_updated()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  update public.profiles set email = new.email where id = new.id;
  return new;
end;
$$;

drop trigger if exists on_auth_user_email_updated on auth.users;
create trigger on_auth_user_email_updated
  after update of email on auth.users
  for each row
  when (new.email is distinct from old.email)
  execute function public.handle_user_email_updated();
