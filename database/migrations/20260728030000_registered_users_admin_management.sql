-- LINGKOD Meneses - Registered Users page: lets OSOA EB view/edit/
-- deactivate any registered account.
--
-- Real permanent deletion (removing the auth.users login row itself) is
-- deliberately NOT implemented here - that requires the Supabase Admin
-- API (auth.admin.deleteUser), which only works with the service-role
-- key, and this project only ever ships the anon key to the browser (by
-- design, everywhere in this codebase - see js/supabase.js). Shipping a
-- service-role key to the client would let anyone bypass every RLS
-- policy in the database, so "delete" here means: flip status to
-- 'inactive' (the login flow - login/script.js - already rejects
-- non-'active' accounts with "Your account is inactive") and anonymize
-- the displayed name/contact fields, preserving every other table's
-- history (messages, reports, activities, etc.) for audit purposes,
-- exactly as this feature's own spec allows as a fallback. If true
-- account deletion is ever needed, it requires a new Supabase Edge
-- Function holding the service-role key server-side - out of scope for
-- a migration file.

-- ===================================================================
-- 1. osoa_eb can UPDATE any profile row (the existing "users can update
-- their own profile" policy - created directly on the live project,
-- never captured in a tracked migration - stays untouched; this is an
-- ADDITIONAL permissive policy, combined with OR, so self-edit keeps
-- working exactly as it already does).
-- ===================================================================

drop policy if exists "profiles_admin_update" on public.profiles;
create policy "profiles_admin_update"
  on public.profiles for update
  to authenticated
  using (public.current_profile_role() = 'osoa_eb')
  with check (public.current_profile_role() = 'osoa_eb');

-- ===================================================================
-- 2. Column-level grant. Postgres GRANTs are role-wide (authenticated),
-- not row-scoped, so simply adding role/status/email/etc. here would
-- also let a REGULAR user write these on their OWN row (permitted by
-- the pre-existing self-only policy) unless something else stops them -
-- see the trigger in step 3, which is what actually enforces "only
-- osoa_eb may touch these fields, on any row including their own." This
-- is the same shape of gap 20260718000000_profile_self_edit_lockdown.sql
-- closed for `role` specifically; this migration widens the grant again
-- for admin use, so it must re-close that gap for every newly-granted
-- column, not just role.
--
-- Existing self-edit columns (last_name/first_name/middle_name/
-- avatar_url/username/contact_number - see
-- 20260723000000_profile_avatar_username_contact.sql) are preserved
-- unchanged.
-- ===================================================================

revoke update on public.profiles from authenticated;
grant update (
  last_name, first_name, middle_name, avatar_url, username, contact_number,
  organization, organization_id, position, role, status,
  email, student_number, department, department_id, bio
) on public.profiles to authenticated;

-- ===================================================================
-- 3. Guard: only osoa_eb may change the admin-only fields (on ANY row,
-- including their own - a regular user still can't grant themselves a
-- role or reactivate their own deactivated account by calling the API
-- directly). Also enforces this feature's two hard restrictions
-- server-side, not just in the client's confirm dialog:
--   - an osoa_eb account can't deactivate itself
--   - the last remaining active osoa_eb account can't be deactivated
-- auth.uid() is null whenever this fires outside a real user request
-- (e.g. a future system job) - skipped in that case rather than raising,
-- matching how every other trigger-guard in this app already treats a
-- null actor as trusted/system-level.
-- ===================================================================

create or replace function public.guard_profile_admin_fields()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  if auth.uid() is not null and public.current_profile_role() <> 'osoa_eb' then
    if new.role is distinct from old.role
       or new.status is distinct from old.status
       or new.email is distinct from old.email
       or new.student_number is distinct from old.student_number
       or new.position is distinct from old.position
       or new.organization is distinct from old.organization
       or new.organization_id is distinct from old.organization_id
       or new.department is distinct from old.department
       or new.department_id is distinct from old.department_id
       or new.bio is distinct from old.bio then
      raise exception 'Only OSOA Executive Board may change these fields.';
    end if;
  end if;

  if new.status = 'inactive' and old.status is distinct from 'inactive' then
    if auth.uid() is not null and old.id = auth.uid() then
      raise exception 'You cannot delete your own administrator account.';
    end if;

    if old.role = 'osoa_eb' and not exists (
      select 1 from public.profiles p
      where p.role = 'osoa_eb' and p.status = 'active' and p.id <> old.id
    ) then
      raise exception 'At least one OSOA Executive Board account must remain active.';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_guard_profile_admin_fields on public.profiles;
create trigger trg_guard_profile_admin_fields
before update on public.profiles
for each row execute function public.guard_profile_admin_fields();

notify pgrst, 'reload schema';
