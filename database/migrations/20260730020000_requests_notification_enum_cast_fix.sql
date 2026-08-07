-- LINGKOD Meneses - Fix the actual root cause of "invalid input value for
-- enum approval_status: Under Review": notify_on_request_change()'s
-- status-change notification builds its message with
--
--   case new.status
--     when 'under_review' then 'Under Review'
--     ...
--     else new.status
--   end
--
-- Postgres resolves a CASE expression's result type from ALL of its
-- branches together. Since the ELSE branch (new.status) is typed
-- approval_status, every THEN branch - including the plain text literal
-- 'Under Review' - gets implicitly cast to approval_status too, so the
-- whole CASE expression can share one type. 'Under Review' (title case,
-- with a space) is not a valid label of that enum (only the lowercase
-- snake_case labels are), so THAT implicit cast is what actually throws
-- - inside this trigger, on every status update, regardless of what the
-- client sent. This pre-dates today's other requests changes (same
-- shape already existed in 20260729030000_requests_feedback_notifications.sql)
-- - it's the real cause of the original bug report, not a client bug.
--
-- Fix: cast the CASE's subject (and its ELSE fallback) to text up front,
-- so every branch is uniformly text and no enum coercion is attempted.

create or replace function public.notify_on_request_change()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  v_updated_by_role text;
  v_updated_by_label text;
begin
  if tg_op = 'INSERT' then
    if new.assigned_to_role = 'org_president' then
      insert into public.notifications (recipient_id, type, title, body, link_url)
      select p.id,
        'request_received',
        '📥 New request submitted',
        coalesce(new.full_name, 'Someone') || ' submitted a ' || new.request_type || ' request.',
        '../requests/index.html'
      from public.profiles p
      where p.role = 'org_president'
        and p.status = 'active'
        and p.organization_id = new.assigned_organization_id;
    else
      insert into public.notifications (recipient_id, type, title, body, link_url)
      select p.id,
        'request_received',
        '📥 New request submitted',
        coalesce(new.full_name, 'Someone') || ' submitted a ' || new.request_type || ' request.',
        '../requests/index.html'
      from public.profiles p
      where p.role = 'osoa_eb' and p.status = 'active';
    end if;

    return new;
  end if;

  if new.status is distinct from old.status then
    if new.user_id is null then
      return new;
    end if;

    select p.role into v_updated_by_role
    from public.profiles p where p.id = new.updated_by;

    v_updated_by_label := case v_updated_by_role
      when 'osoa_eb' then 'OSOA Executive Board'
      when 'org_president' then 'Organization President'
      else null
    end;

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
      || case new.status::text
           when 'under_review' then 'Under Review'
           when 'received' then 'Received'
           when 'approved' then 'Approved'
           when 'rejected' then 'Rejected'
           when 'completed' then 'Completed'
           else new.status::text
         end
      || (case when v_updated_by_label is not null
            then '. Updated by: ' || v_updated_by_label
            else '' end)
      || (case when new.remarks is not null and length(trim(new.remarks)) > 0
            then '. Remarks: ' || new.remarks
            else '.' end),
      '../requests/index.html'
    );
  end if;

  return new;
end;
$$;

notify pgrst, 'reload schema';
