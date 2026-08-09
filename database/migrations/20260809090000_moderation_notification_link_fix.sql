-- LINGKOD Meneses - notify_osoa_eb_on_report() (message-moderation
-- reports, 20260728040000_notifications_and_audit_logs.sql) still points
-- its notification link_url at '../reports/index.html' - now the new
-- document-report feature's route, not the moderation inbox's route it
-- moved from (frontend/pages/reports/ -> frontend/pages/moderation/).
-- Updates the function to point at the moderation inbox's new location;
-- nothing else about this function changes.

create or replace function public.notify_osoa_eb_on_report()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  reporter_name text;
  reported_name text;
begin
  select full_name into reporter_name from public.profiles where id = new.reporter_id;
  select full_name into reported_name from public.profiles where id = new.reported_user_id;

  insert into public.notifications (recipient_id, type, title, body, link_url)
  select
    p.id,
    case when new.message_id is not null then 'message_report' else 'user_report' end,
    case when new.message_id is not null then 'New message report' else 'New user report' end,
    coalesce(reporter_name, 'Someone') || ' reported ' || coalesce(reported_name, 'a user')
      || ' for ' || new.reason || '.',
    '../moderation/index.html'
  from public.profiles p
  where p.role = 'osoa_eb' and p.status = 'active';

  return new;
end;
$$;

notify pgrst, 'reload schema';
