-- LINGKOD Meneses - Feedback module rework: auto-filled submitter identity,
-- an "Others" feedback type with a free-text specify field, a real rating
-- column (the star widget existed in the UI but was never actually saved),
-- sequential human-readable IDs (FB-YYYY-000001), and two new status
-- values for a proper admin triage workflow.
--
-- Like submissions/announcements, the base `feedback` table was created
-- directly against the live project, never captured in this migrations
-- folder - every change below is defensive and safe to run more than once,
-- in any state. Column renames only fire if the old name is present and
-- the new one isn't yet, so re-running after a partial success is safe.
--
-- `feedback_type` (renamed from `category`) turned out to be a Postgres
-- enum (`feedback_category`), not plain text, so its allowed values are
-- extended via ALTER TYPE ... ADD VALUE rather than a CHECK constraint (a
-- CHECK can't apply to an enum column, and comparing an enum column to a
-- string literal that isn't yet a valid label - as later statements in
-- this file do - fails the same way). The new labels are added and
-- COMMITted before anything else references them, since a newly added
-- enum value can't safely be used within the same transaction that added
-- it.

-- ===================================================================
-- 1. Column renames (aligning existing names to the requested schema).
-- ===================================================================

do $$
begin
  if exists (select 1 from information_schema.columns where table_schema='public' and table_name='feedback' and column_name='submitted_by')
     and not exists (select 1 from information_schema.columns where table_schema='public' and table_name='feedback' and column_name='user_id') then
    alter table public.feedback rename column submitted_by to user_id;
  end if;

  if exists (select 1 from information_schema.columns where table_schema='public' and table_name='feedback' and column_name='category')
     and not exists (select 1 from information_schema.columns where table_schema='public' and table_name='feedback' and column_name='feedback_type') then
    alter table public.feedback rename column category to feedback_type;
  end if;

  if exists (select 1 from information_schema.columns where table_schema='public' and table_name='feedback' and column_name='message')
     and not exists (select 1 from information_schema.columns where table_schema='public' and table_name='feedback' and column_name='feedback_message') then
    alter table public.feedback rename column message to feedback_message;
  end if;
end $$;

-- "Subject" is dropped from the form entirely and has no place in the
-- requested schema.
alter table public.feedback drop column if exists subject;

-- ===================================================================
-- 2. feedback_type / status enum extensions - committed on their own
-- before anything downstream tries to use the new labels.
-- ===================================================================

do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'feedback' and column_name = 'feedback_type'
      and data_type = 'USER-DEFINED'
  ) then
    begin
      alter type public.feedback_category add value if not exists 'complaint';
    exception when others then null;
    end;
    begin
      alter type public.feedback_category add value if not exists 'suggestion';
    exception when others then null;
    end;
    begin
      alter type public.feedback_category add value if not exists 'inquiry';
    exception when others then null;
    end;
    begin
      alter type public.feedback_category add value if not exists 'appreciation';
    exception when others then null;
    end;
    begin
      alter type public.feedback_category add value if not exists 'bug_report';
    exception when others then null;
    end;
    begin
      alter type public.feedback_category add value if not exists 'others';
    exception when others then null;
    end;
  end if;
end $$;

do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'feedback' and column_name = 'status'
      and data_type = 'USER-DEFINED'
  ) then
    begin
      alter type public.feedback_status add value if not exists 'in_progress';
    exception when others then
      raise notice 'Could not extend the feedback.status enum automatically (guessed type name may be wrong): %', sqlerrm;
    end;
    begin
      alter type public.feedback_status add value if not exists 'closed';
    exception when others then
      raise notice 'Could not extend the feedback.status enum automatically (guessed type name may be wrong): %', sqlerrm;
    end;
  end if;
end $$;

commit;

-- ===================================================================
-- 3. New columns.
-- ===================================================================

alter table public.feedback add column if not exists feedback_id text;
alter table public.feedback add column if not exists full_name text;
alter table public.feedback add column if not exists email text;
alter table public.feedback add column if not exists specified_type text;
alter table public.feedback add column if not exists rating smallint not null default 5;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.feedback'::regclass and conname = 'feedback_rating_range'
  ) then
    alter table public.feedback add constraint feedback_rating_range check (rating between 1 and 5);
  end if;
end $$;

-- Fallback CHECK for feedback_type, only fires if it turns out NOT to be
-- an enum on this install (defensive - the error that prompted this fix
-- confirmed it is one, but this keeps the migration safe either way).
do $$
declare
  v_constraint_name text;
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'feedback' and column_name = 'feedback_type'
      and data_type <> 'USER-DEFINED'
  ) then
    for v_constraint_name in
      select conname from pg_constraint
      where conrelid = 'public.feedback'::regclass and contype = 'c'
        and pg_get_constraintdef(oid) ilike '%feedback_type%'
    loop
      execute format('alter table public.feedback drop constraint %I', v_constraint_name);
    end loop;

    alter table public.feedback add constraint feedback_type_check
      check (feedback_type in ('complaint', 'suggestion', 'inquiry', 'appreciation', 'bug_report', 'others'))
      not valid;
  end if;
end $$;

-- specified_type must be present only for "others", and must be null
-- otherwise. Safe now that 'others' is a committed enum label.
do $$
declare
  v_constraint_name text;
begin
  for v_constraint_name in
    select conname from pg_constraint
    where conrelid = 'public.feedback'::regclass and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%specified_type%'
  loop
    execute format('alter table public.feedback drop constraint %I', v_constraint_name);
  end loop;

  alter table public.feedback add constraint feedback_specified_type_check
    check (
      (feedback_type::text = 'others' and specified_type is not null and length(trim(specified_type)) > 0)
      or (feedback_type::text <> 'others' and specified_type is null)
    )
    not valid;
end $$;

do $$
declare
  v_constraint_name text;
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'feedback' and column_name = 'status'
      and data_type <> 'USER-DEFINED'
  ) then
    for v_constraint_name in
      select conname from pg_constraint
      where conrelid = 'public.feedback'::regclass and contype = 'c'
        and pg_get_constraintdef(oid) ilike '%status%'
    loop
      execute format('alter table public.feedback drop constraint %I', v_constraint_name);
    end loop;

    alter table public.feedback add constraint feedback_status_check
      check (status in ('new', 'reviewed', 'in_progress', 'resolved', 'closed'));
  end if;
end $$;

-- ===================================================================
-- 4. Sequential per-year Feedback IDs (FB-YYYY-000001). A counter table
-- (rather than a plain sequence) so the numbering resets cleanly every
-- calendar year and survives row deletion without reusing a number.
-- ===================================================================

create table if not exists public.feedback_id_counters (
  year int primary key,
  last_number int not null default 0
);

alter table public.feedback_id_counters enable row level security;
revoke all on public.feedback_id_counters from anon, authenticated;

create or replace function public.generate_feedback_id()
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_year int := extract(year from now())::int;
  v_next int;
begin
  insert into public.feedback_id_counters (year, last_number)
  values (v_year, 1)
  on conflict (year) do update set last_number = feedback_id_counters.last_number + 1
  returning last_number into v_next;

  return 'FB-' || v_year || '-' || lpad(v_next::text, 6, '0');
end;
$$;

-- One trigger handles both the sequential ID and the server-trusted
-- full_name/email snapshot, so a client can never spoof another user's
-- name on their own feedback row and the two always fire in a fixed order.
create or replace function public.feedback_before_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.feedback_id is null then
    new.feedback_id := public.generate_feedback_id();
  end if;

  select p.full_name into new.full_name from public.profiles p where p.id = new.user_id;

  if new.email is null then
    select u.email into new.email from auth.users u where u.id = new.user_id;
  end if;

  if new.feedback_type::text <> 'others' then
    new.specified_type := null;
  end if;

  return new;
end;
$$;

drop trigger if exists set_feedback_before_insert on public.feedback;
create trigger set_feedback_before_insert
  before insert on public.feedback
  for each row execute function public.feedback_before_insert();

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.feedback'::regclass and conname = 'feedback_feedback_id_key'
  ) then
    alter table public.feedback add constraint feedback_feedback_id_key unique (feedback_id);
  end if;
end $$;

-- Backfill: assign IDs (oldest first, so the sequence reflects real
-- submission order) and full_name to any pre-existing rows, and seed the
-- counter table so new submissions continue right after the highest
-- backfilled number for that year.
do $$
declare
  r record;
  v_num int;
begin
  for r in
    select f.id, extract(year from f.created_at)::int as yr
    from public.feedback f
    where f.feedback_id is null
    order by f.created_at asc
  loop
    insert into public.feedback_id_counters (year, last_number)
    values (r.yr, 1)
    on conflict (year) do update set last_number = feedback_id_counters.last_number + 1
    returning last_number into v_num;

    update public.feedback
    set feedback_id = 'FB-' || r.yr || '-' || lpad(v_num::text, 6, '0')
    where id = r.id;
  end loop;

  update public.feedback f
  set full_name = p.full_name
  from public.profiles p
  where f.user_id = p.id and f.full_name is null;
end $$;

alter table public.feedback alter column feedback_id set not null;

-- ===================================================================
-- 5. RLS - osoa_eb sees/manages every row; everyone else sees and can
-- only insert their own. Only osoa_eb can update (status changes) - no
-- one else is granted an update policy, so a submitter cannot edit their
-- own feedback after the fact.
-- ===================================================================

alter table public.feedback enable row level security;

drop policy if exists "feedback_select" on public.feedback;
drop policy if exists "feedback_insert" on public.feedback;
drop policy if exists "feedback_update" on public.feedback;

create policy "feedback_select"
  on public.feedback for select
  to authenticated
  using (
    user_id = auth.uid()
    or exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.role = 'osoa_eb'
    )
  );

create policy "feedback_insert"
  on public.feedback for insert
  to authenticated
  with check (user_id = auth.uid());

create policy "feedback_update"
  on public.feedback for update
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

revoke all on public.feedback from anon;

-- ===================================================================
-- 6. Realtime, so both the submitter's own status and the admin queue
-- update live without a page refresh.
-- ===================================================================

do $$
begin
  alter publication supabase_realtime add table public.feedback;
exception when duplicate_object then null;
end $$;

notify pgrst, 'reload schema';
