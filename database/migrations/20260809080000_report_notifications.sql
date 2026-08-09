-- LINGKOD Meneses - Reports notifications, structural copy of
-- notify_on_request_change() (20260730020000_requests_notification_
-- enum_cast_fix.sql) - INSERT notifies the resolved recipient (the
-- matching org_president for recipient_organization_id, or the single
-- osoa_eb profile whose position = recipient_position - both guaranteed
-- unique-or-none by profiles_unique_position_per_org); status changes
-- notify the reporter, including who updated it and any remarks.
--
-- new.status::text is cast explicitly in every CASE subject/branch up
-- front - requests' own notify function originally got this wrong (a
-- CASE mixing enum and text branches forced an implicit cast that threw
-- "invalid input value for enum" on plain-text branches, fixed later in
-- 20260730020000) - written correctly here from the start instead of
-- reproducing that bug.

create or replace function public.notify_on_report_change()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  v_updated_by_role text;
  v_updated_by_label text;
begin
  if tg_op = 'INSERT' then
    if new.recipient_type = 'org_president' then
      insert into public.notifications (recipient_id, type, title, body, link_url)
      select p.id, 'report_received', '📥 New report submitted',
        coalesce(new.reporter_name, 'Someone') || ' submitted a ' || new.report_type || ' report.',
        '../reports/index.html'
      from public.profiles p
      where p.role = 'org_president' and p.status = 'active' and p.organization_id = new.recipient_organization_id;
    else
      insert into public.notifications (recipient_id, type, title, body, link_url)
      select p.id, 'report_received', '📥 New report submitted',
        coalesce(new.reporter_name, 'Someone') || ' submitted a ' || new.report_type || ' report.',
        '../reports/index.html'
      from public.profiles p
      where p.role = 'osoa_eb' and p.status = 'active' and p.position = new.recipient_position;
    end if;
    return new;
  end if;

  if new.status is distinct from old.status then
    if new.reporter_id is null then
      return new;
    end if;

    select p.role into v_updated_by_role from public.profiles p where p.id = new.updated_by;
    v_updated_by_label := case v_updated_by_role
      when 'osoa_eb' then 'OSOA Executive Board'
      when 'org_president' then 'Organization President'
      else null
    end;

    insert into public.notifications (recipient_id, type, title, body, link_url)
    values (
      new.reporter_id,
      'report_' || new.status::text,
      case new.status::text
        when 'received' then '📥 Report received'
        when 'under_review' then '🔄 Report under review'
        when 'in_progress' then '🔧 Report in progress'
        when 'resolved' then '✅ Report resolved'
        when 'rejected' then '❌ Report rejected'
        when 'closed' then '🏁 Report closed'
        else 'Report updated'
      end,
      'Your ' || new.report_type || ' report is now: '
      || case new.status::text
           when 'received' then 'Received'
           when 'under_review' then 'Under Review'
           when 'in_progress' then 'In Progress'
           when 'resolved' then 'Resolved'
           when 'rejected' then 'Rejected'
           when 'closed' then 'Closed'
           else new.status::text
         end
      || (case when v_updated_by_label is not null then '. Updated by: ' || v_updated_by_label else '' end)
      || (case when new.remarks is not null and length(trim(new.remarks)) > 0 then '. Remarks: ' || new.remarks else '.' end),
      '../reports/index.html'
    );
  end if;

  return new;
end;
$$;

drop trigger if exists trg_notify_on_report_change on public.reports;
create trigger trg_notify_on_report_change
after insert or update on public.reports
for each row execute function public.notify_on_report_change();

notify pgrst, 'reload schema';
