-- LINGKOD Meneses - Requests & Feedback notifications.
--
-- Fourth notification source, same pattern as submissions
-- (20260729010000_submission_notifications.sql): a new submission
-- notifies every active osoa_eb account that something needs attention;
-- any status change afterward notifies the original submitter. Requests
-- and feedback each get their own trigger function since they're
-- different tables with different columns (feedback has no remarks/
-- reply column yet - see feedback/script.js's own "future update" note
-- on replies), but the shape of the two functions is identical.

-- ===================================================================
-- 1. Requests
-- ===================================================================

create or replace function public.notify_on_request_change()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    insert into public.notifications (recipient_id, type, title, body, link_url)
    select p.id,
      'request_received',
      '📥 New request submitted',
      coalesce(new.full_name, 'Someone') || ' submitted a ' || new.request_type || ' request.',
      '../requests/index.html'
    from public.profiles p
    where p.role = 'osoa_eb' and p.status = 'active';

    return new;
  end if;

  if new.status is distinct from old.status then
    if new.user_id is null then
      return new;
    end if;

    insert into public.notifications (recipient_id, type, title, body, link_url)
    values (
      new.user_id,
      'request_' || new.status,
      case new.status
        when 'received' then '📥 Request received'
        when 'under_review' then '🔄 Request under review'
        when 'approved' then '✅ Request approved'
        when 'rejected' then '❌ Request rejected'
        when 'completed' then '🏁 Request completed'
        else 'Request updated'
      end,
      'Your ' || new.request_type || ' request is now: '
      || case new.status
           when 'under_review' then 'Under Review'
           when 'received' then 'Received'
           when 'approved' then 'Approved'
           when 'rejected' then 'Rejected'
           when 'completed' then 'Completed'
           else new.status
         end
      || (case when new.remarks is not null and length(trim(new.remarks)) > 0
            then '. Remarks: ' || new.remarks
            else '.' end),
      '../requests/index.html'
    );
  end if;

  return new;
end;
$$;

drop trigger if exists trg_notify_on_request_change on public.requests;
create trigger trg_notify_on_request_change
after insert or update on public.requests
for each row execute function public.notify_on_request_change();

-- ===================================================================
-- 2. Feedback
-- ===================================================================

create or replace function public.notify_on_feedback_change()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    insert into public.notifications (recipient_id, type, title, body, link_url)
    select p.id,
      'feedback_received',
      '💬 New feedback submitted',
      coalesce(new.full_name, 'Someone') || ' submitted ' || new.feedback_type || ' feedback.',
      '../feedback/index.html'
    from public.profiles p
    where p.role = 'osoa_eb' and p.status = 'active';

    return new;
  end if;

  if new.status is distinct from old.status then
    if new.user_id is null then
      return new;
    end if;

    insert into public.notifications (recipient_id, type, title, body, link_url)
    values (
      new.user_id,
      'feedback_' || new.status,
      case new.status
        when 'reviewed' then '🔄 Feedback under review'
        when 'in_progress' then '🔄 Feedback in progress'
        when 'resolved' then '✅ Feedback resolved'
        when 'closed' then '🔒 Feedback closed'
        else 'Feedback updated'
      end,
      'Your ' || new.feedback_type || ' feedback is now: '
      || case new.status
           when 'reviewed' then 'Under Review'
           when 'in_progress' then 'In Progress'
           when 'resolved' then 'Resolved'
           when 'closed' then 'Closed'
           else new.status
         end || '.',
      '../feedback/index.html'
    );
  end if;

  return new;
end;
$$;

drop trigger if exists trg_notify_on_feedback_change on public.feedback;
create trigger trg_notify_on_feedback_change
after insert or update on public.feedback
for each row execute function public.notify_on_feedback_change();

notify pgrst, 'reload schema';
