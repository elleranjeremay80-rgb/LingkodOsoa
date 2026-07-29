-- LINGKOD Meneses - Account status & role change notifications.
--
-- Fifth notification source. Companion to log_profile_admin_change()
-- (20260728040000_notifications_and_audit_logs.sql), which already
-- audit-logs the exact same two conditions (role changed, status
-- changed) - this notifies the affected account itself, not just the
-- audit trail. Deliberately narrow, matching what was actually asked
-- for: no "profile updated" (you always know when you edit your own
-- profile), no "login from a new device" or "password/email changed"
-- (no device-session tracking exists, and those happen against
-- auth.users via Supabase Auth directly, not this table).

create or replace function public.notify_on_account_change()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  if new.role is distinct from old.role then
    insert into public.notifications (recipient_id, type, title, body, link_url)
    values (
      new.id,
      'role_changed',
      '🔑 Your role has been updated',
      'Your account role is now '
      || case new.role
           when 'osoa_eb' then 'OSOA EB'
           when 'org_president' then 'Organization President'
           when 'student' then 'Member'
           else new.role
         end || '.',
      '../profile/index.html'
    );
  end if;

  if new.status is distinct from old.status then
    insert into public.notifications (recipient_id, type, title, body, link_url)
    values (
      new.id,
      'status_' || new.status,
      case new.status
        when 'active' then '🔓 Account reactivated'
        else '🔒 Account deactivated'
      end,
      case new.status
        when 'active' then 'Your account has been reactivated. You can log in again.'
        else 'Your account has been deactivated.'
      end,
      '../login/index.html'
    );
  end if;

  return new;
end;
$$;

drop trigger if exists trg_notify_on_account_change on public.profiles;
create trigger trg_notify_on_account_change
after update on public.profiles
for each row execute function public.notify_on_account_change();

notify pgrst, 'reload schema';
