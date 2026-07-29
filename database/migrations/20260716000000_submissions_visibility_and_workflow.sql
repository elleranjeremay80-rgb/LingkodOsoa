-- LINGKOD Meneses - Submission & Tracking: personal visibility for
-- submitters, approved-only visibility on dashboards, and a real
-- approve/reject/needs-revision workflow for OSOA EB.
--
-- Like announcements, the base `submissions` table was created directly
-- against the live project, never captured in this migrations folder -
-- every column add below is defensive (`if not exists`), and the status
-- value addition auto-detects whether `status` is a Postgres enum or a
-- plain text/check-constrained column so it works either way. Safe to run
-- more than once, in any state.

-- ===================================================================
-- 1. Columns the new workflow needs.
-- ===================================================================

alter table public.submissions add column if not exists submitted_by uuid references auth.users(id) on delete set null;
alter table public.submissions add column if not exists remarks text;
alter table public.submissions add column if not exists file_url text;
alter table public.submissions add column if not exists updated_at timestamptz not null default now();

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_submissions_updated_at on public.submissions;
create trigger set_submissions_updated_at
  before update on public.submissions
  for each row execute function public.set_updated_at();

-- ===================================================================
-- 2. "needs_revision" status value - handles both a Postgres enum
-- (guesses the conventional type name, swallows errors if that guess is
-- wrong or the value already exists) and a plain text/check-constrained
-- column (replaces any status-related CHECK constraint).
-- ===================================================================

do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'submissions' and column_name = 'status'
      and data_type = 'USER-DEFINED'
  ) then
    begin
      alter type public.submission_status add value if not exists 'needs_revision';
    exception when others then
      raise notice 'Could not extend the submissions.status enum automatically (guessed type name may be wrong): %', sqlerrm;
    end;
  end if;
end $$;

do $$
declare
  v_constraint_name text;
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'submissions' and column_name = 'status'
      and data_type <> 'USER-DEFINED'
  ) then
    for v_constraint_name in
      select conname from pg_constraint
      where conrelid = 'public.submissions'::regclass and contype = 'c'
        and pg_get_constraintdef(oid) ilike '%status%'
    loop
      execute format('alter table public.submissions drop constraint %I', v_constraint_name);
    end loop;

    alter table public.submissions add constraint submissions_status_check
      check (status in ('pending', 'approved', 'rejected', 'needs_revision'));
  end if;
end $$;

-- ===================================================================
-- 3. RLS - matches the requested visibility matrix:
--   - Every signed-in user can always see their own submissions,
--     regardless of status (their personal Submission & Tracking / the
--     Submission & Tracking section of their Profile).
--   - Every signed-in user can see any *approved* submission, regardless
--     of who submitted it (dashboards are a platform-wide approved-only
--     feed, same as they already were for admin/staff before this
--     migration - now also readable by students for their Profile/
--     Dashboard views).
--   - osoa_eb additionally sees every submission regardless of status
--     (their "Review Submitted Documents" page) and is the only role
--     that can update status/remarks.
-- ===================================================================

alter table public.submissions enable row level security;

drop policy if exists "submissions_select" on public.submissions;
drop policy if exists "submissions_insert" on public.submissions;
drop policy if exists "submissions_update" on public.submissions;

create policy "submissions_select"
  on public.submissions for select
  to authenticated
  using (
    submitted_by = auth.uid()
    or status = 'approved'
    or exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.role = 'osoa_eb'
    )
  );

create policy "submissions_insert"
  on public.submissions for insert
  to authenticated
  with check (submitted_by = auth.uid());

create policy "submissions_update"
  on public.submissions for update
  to authenticated
  using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.role = 'osoa_eb'
    )
  )
  with check (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.role = 'osoa_eb'
    )
  );

revoke all on public.submissions from anon;

-- ===================================================================
-- 4. Realtime, so approvals/rejections/new submissions sync live
-- everywhere without a page refresh.
-- ===================================================================

do $$
begin
  alter publication supabase_realtime add table public.submissions;
exception when duplicate_object then
  null;
end $$;
