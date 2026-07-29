-- LINGKOD Meneses - Submission & Tracking notifications.
--
-- Second notification source (see 20260729000000_announcement_
-- notifications.sql for the first, and the reasoning for why this is a
-- Postgres trigger + the existing notifications table, not a new
-- backend). Two events, one function (mirrors log_officer_change()'s
-- own insert/update branching in 20260728040000_notifications_and_
-- audit_logs.sql):
--
--   INSERT (a new submission, always starts "pending")
--     -> notify every active osoa_eb account that something needs review
--
--   UPDATE where status actually changed to approved/rejected/
--   needs_revision
--     -> notify the original submitter (submitted_by) of the outcome,
--        including the reviewer's remarks when present
--
-- "Submission deadline approaching" from the original ask is NOT built
-- here - submissions has no due-date column at all, so there is nothing
-- for a row-level trigger to compare against. Doing that for real needs
-- a due_date column plus a scheduled job (pg_cron or a periodically-
-- invoked Edge Function), not an insert/update trigger - a bigger,
-- separate change to make once (if) that's actually wanted.

create or replace function public.notify_on_submission_change()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  submitter_name text;
begin
  if tg_op = 'INSERT' then
    insert into public.notifications (recipient_id, type, title, body, link_url)
    select p.id,
      'submission_received',
      '🗂️ New submission to review',
      coalesce((select full_name from public.profiles where id = new.submitted_by), 'Someone')
        || ' submitted "' || new.document_title || '" for review.',
      '../submission/index.html'
    from public.profiles p
    where p.role = 'osoa_eb' and p.status = 'active';

    return new;
  end if;

  -- UPDATE: only act when status actually changed, and only for the
  -- three outcomes a submitter would want to hear about - a plain edit
  -- (e.g. remarks tweaked with no status change) stays silent.
  if new.status is distinct from old.status and new.status in ('approved', 'rejected', 'needs_revision') then
    if new.submitted_by is null then
      return new;
    end if;

    insert into public.notifications (recipient_id, type, title, body, link_url)
    values (
      new.submitted_by,
      'submission_' || new.status,
      case new.status
        when 'approved' then '✅ Submission approved'
        when 'rejected' then '❌ Submission rejected'
        else '✏️ Revision requested'
      end,
      case new.status
        when 'approved' then 'Your "' || new.document_title || '" has been approved.'
        when 'rejected' then 'Your "' || new.document_title || '" was rejected.'
        else 'Please revise your "' || new.document_title || '".'
      end
      || (case when new.remarks is not null and length(trim(new.remarks)) > 0
            then ' Remarks: ' || new.remarks
            else '' end),
      '../submission/index.html'
    );
  end if;

  return new;
end;
$$;

drop trigger if exists trg_notify_on_submission_change on public.submissions;
create trigger trg_notify_on_submission_change
after insert or update on public.submissions
for each row execute function public.notify_on_submission_change();

notify pgrst, 'reload schema';
