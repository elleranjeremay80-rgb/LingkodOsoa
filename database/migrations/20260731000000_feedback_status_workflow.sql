-- LINGKOD Meneses - Feedback: complete the status-update workflow.
--
-- Replaces the old 5-value status vocabulary (new/reviewed/in_progress/
-- resolved/closed) with the requested one (pending/under_review/approved/
-- rejected/completed), adds updated_by/updated_at tracking (same
-- server-trusted trigger pattern already used by requests - see
-- 20260730000000_requests_recipient_routing.sql section 3), and - having
-- learned from this session's earlier live drift (feedback_status was
-- only ever a guessed type name, never confirmed) - extends the enum via
-- its *actual* udt_name rather than assuming the guess was right, same
-- technique 20260722020000_requests_enhancements.sql section 2 uses.
--
-- Existing rows are remapped rather than left on retired labels:
--   new -> pending, reviewed -> under_review, in_progress -> under_review
--   (merged - no distinct equivalent in the new 5-value set),
--   resolved -> approved, closed -> completed. 'rejected' has no old
--   equivalent - it's simply a new option available going forward.

-- ===================================================================
-- 1. Add the new status labels to whatever type actually backs
-- feedback.status, committed before anything below tries to use them.
-- ===================================================================

do $$
declare
  v_type_name text;
  v_value text;
begin
  select udt_name into v_type_name
  from information_schema.columns
  where table_schema='public' and table_name='feedback' and column_name='status' and data_type='USER-DEFINED';

  if v_type_name is not null then
    foreach v_value in array array['pending', 'under_review', 'approved', 'rejected', 'completed']
    loop
      begin
        execute format('alter type public.%I add value if not exists %L', v_type_name, v_value);
      exception when others then
        raise notice 'Could not add % to feedback.status enum (%): %', v_value, v_type_name, sqlerrm;
      end;
    end loop;
  end if;
end $$;

commit;

-- ===================================================================
-- 1.5. notify_on_feedback_change() (20260729030000_requests_feedback_
-- notifications.sql) fires AFTER INSERT OR UPDATE on feedback and has
-- the exact same enum-coercion bug already found and fixed on requests'
-- equivalent trigger (20260730020000_requests_notification_enum_cast_
-- fix.sql): its UPDATE branch's `case new.status when 'reviewed' then
-- 'Under Review' ... else new.status end` mixes text literals with an
-- enum-typed ELSE, so Postgres tries to cast 'Under Review' etc. to
-- feedback_status and fails - which is exactly what just crashed the
-- data remap below (section 2 fires an UPDATE, which fires this
-- trigger). Rather than patch the cast, the UPDATE branch is removed
-- outright here: section 4 below adds a dedicated
-- notify_on_feedback_status_change() trigger that already owns "notify
-- the submitter when status changes" with the correct new vocabulary,
-- so keeping both would send a duplicate notification on every status
-- change. This function keeps its INSERT branch (notify osoa_eb of a
-- new submission) - only the UPDATE half is dropped.
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
  end if;

  return new;
end;
$$;

-- ===================================================================
-- 2. Remap existing rows from the old vocabulary to the new one.
-- ===================================================================

do $$
declare
  v_type_name text;
begin
  select udt_name into v_type_name
  from information_schema.columns
  where table_schema='public' and table_name='feedback' and column_name='status' and data_type='USER-DEFINED';

  if v_type_name is not null then
    execute format(
      'update public.feedback set status = (case status::text
         when ''new'' then ''pending''
         when ''reviewed'' then ''under_review''
         when ''in_progress'' then ''under_review''
         when ''resolved'' then ''approved''
         when ''closed'' then ''completed''
         else status::text
       end)::public.%I
       where status::text in (''new'', ''reviewed'', ''in_progress'', ''resolved'', ''closed'')',
      v_type_name
    );
  else
    update public.feedback set status = case status
      when 'new' then 'pending'
      when 'reviewed' then 'under_review'
      when 'in_progress' then 'under_review'
      when 'resolved' then 'approved'
      when 'closed' then 'completed'
      else status
    end
    where status in ('new', 'reviewed', 'in_progress', 'resolved', 'closed');
  end if;
end $$;

-- Fallback CHECK, only fires if status turns out not to be an enum at all.
do $$
declare
  v_constraint_name text;
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='feedback' and column_name='status' and data_type <> 'USER-DEFINED'
  ) then
    for v_constraint_name in
      select conname from pg_constraint
      where conrelid = 'public.feedback'::regclass and contype = 'c'
        and pg_get_constraintdef(oid) ilike '%status%'
    loop
      execute format('alter table public.feedback drop constraint %I', v_constraint_name);
    end loop;

    alter table public.feedback add constraint feedback_status_check
      check (status in ('pending', 'under_review', 'approved', 'rejected', 'completed'));
  end if;
end $$;

-- ===================================================================
-- 3. updated_at / updated_by - same trigger-managed, server-trusted
-- pattern already used by requests.
-- ===================================================================

alter table public.feedback add column if not exists updated_at timestamptz not null default now();
alter table public.feedback add column if not exists updated_by uuid references public.profiles(id) on delete set null;

drop trigger if exists set_feedback_updated_at on public.feedback;
create trigger set_feedback_updated_at
  before update on public.feedback
  for each row execute function public.set_updated_at();

create or replace function public.feedback_set_updated_by()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.updated_by := auth.uid();
  return new;
end;
$$;

drop trigger if exists set_feedback_updated_by on public.feedback;
create trigger set_feedback_updated_by
  before update on public.feedback
  for each row execute function public.feedback_set_updated_by();

-- ===================================================================
-- 4. Notification on status change, so the submitter sees the outcome -
-- same shape as notify_on_request_change()'s status-change branch
-- (20260730020000_requests_notification_enum_cast_fix.sql), including
-- that migration's fix: cast the CASE's subject/fallback to text so no
-- implicit enum coercion is attempted on the plain-text THEN branches.
-- ===================================================================

create or replace function public.notify_on_feedback_status_change()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  v_updated_by_role text;
  v_updated_by_label text;
begin
  if new.status is distinct from old.status then
    if new.user_id is null then
      return new;
    end if;

    select p.role into v_updated_by_role
    from public.profiles p where p.id = new.updated_by;

    v_updated_by_label := case v_updated_by_role
      when 'osoa_eb' then 'OSOA Executive Board'
      else null
    end;

    insert into public.notifications (recipient_id, type, title, body, link_url)
    values (
      new.user_id,
      'feedback_' || new.status::text,
      case new.status::text
        when 'under_review' then '🔄 Feedback under review'
        when 'approved' then '✅ Feedback approved'
        when 'rejected' then '❌ Feedback rejected'
        when 'completed' then '🏁 Feedback completed'
        else 'Feedback updated'
      end,
      'Your feedback is now: '
      || case new.status::text
           when 'under_review' then 'Under Review'
           when 'approved' then 'Approved'
           when 'rejected' then 'Rejected'
           when 'completed' then 'Completed'
           else new.status::text
         end
      || (case when v_updated_by_label is not null
            then '. Updated by: ' || v_updated_by_label
            else '' end)
      || '.',
      '../feedback/index.html'
    );
  end if;

  return new;
end;
$$;

drop trigger if exists trg_notify_on_feedback_status_change on public.feedback;
create trigger trg_notify_on_feedback_status_change
after update on public.feedback
for each row execute function public.notify_on_feedback_status_change();

notify pgrst, 'reload schema';
