-- LINGKOD Meneses - Organization officer roster change notifications.
--
-- Third notification source. organization_officers is a manually-curated
-- roster with no link to a real account at all (see its own header
-- comment in 20260723030000_osoa_directory_management.sql) - there's no
-- verified person to tell "you were appointed," so this notifies the
-- people who actually have real accounts and a real stake in knowing the
-- roster changed: every active osoa_eb account, plus that organization's
-- own org_president. Mirrors log_officer_change()'s own insert/update/
-- delete branching (20260728040000_notifications_and_audit_logs.sql),
-- which already audit-logs these same three events. The person who made
-- the change doesn't get notified about their own action.

create or replace function public.notify_on_officer_change()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  org_id uuid;
  org_name text;
  officer_name text;
  notif_type text;
  notif_title text;
  notif_body text;
begin
  if tg_op = 'DELETE' then
    org_id := old.organization_id;
    officer_name := old.full_name;
    notif_type := 'officer_removed';
    notif_title := '👤 Officer removed';
  elsif tg_op = 'INSERT' then
    org_id := new.organization_id;
    officer_name := new.full_name;
    notif_type := 'officer_added';
    notif_title := '👤 New officer added';
  else
    org_id := new.organization_id;
    officer_name := new.full_name;
    notif_type := 'officer_updated';
    notif_title := '👤 Officer entry updated';
  end if;

  select name into org_name from public.organizations where id = org_id;

  notif_body := officer_name
    || (case tg_op
          when 'DELETE' then ' was removed from the roster for '
          when 'INSERT' then ' was added as ' || new.position || ' for '
          else ' was updated (now ' || new.position || ') for '
        end)
    || coalesce(org_name, 'an organization') || '.';

  insert into public.notifications (recipient_id, type, title, body, link_url)
  select distinct p.id, notif_type, notif_title, notif_body, '../directory/index.html'
  from public.profiles p
  where p.status = 'active'
    and p.id is distinct from auth.uid()
    and (
      p.role = 'osoa_eb'
      or (p.role = 'org_president' and p.organization_id = org_id)
    );

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_notify_on_officer_change on public.organization_officers;
create trigger trg_notify_on_officer_change
after insert or update or delete on public.organization_officers
for each row execute function public.notify_on_officer_change();

notify pgrst, 'reload schema';
