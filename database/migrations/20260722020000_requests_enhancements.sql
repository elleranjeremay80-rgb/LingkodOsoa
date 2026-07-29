-- LINGKOD Meneses - Service & Document Requests rework: mirrors the
-- Feedback module's auto-filled identity, "Others" + specify field,
-- sequential human-readable IDs (REQ-YYYY-000001), and admin triage
-- workflow (see 20260722000000_feedback_enhancements.sql for the sibling
-- migration this one is modeled on).
--
-- Like feedback, the base `requests` table was created directly against
-- the live project - every change below is defensive and safe to run
-- more than once, in any state.
--
-- Lesson learned from the feedback migration: rather than guessing an
-- enum type's name, this one looks it up dynamically via
-- information_schema.columns.udt_name and extends whatever it actually
-- finds, so a wrong guess can't silently no-op or blow up the batch. The
-- new labels are added and COMMITted before anything downstream
-- references them (a newly added enum value can't safely be used within
-- the same transaction that added it).

-- ===================================================================
-- 1. Column renames (aligning existing names to the requested schema).
-- ===================================================================

do $$
begin
  if exists (select 1 from information_schema.columns where table_schema='public' and table_name='requests' and column_name='requester_id')
     and not exists (select 1 from information_schema.columns where table_schema='public' and table_name='requests' and column_name='user_id') then
    alter table public.requests rename column requester_id to user_id;
  end if;

  if exists (select 1 from information_schema.columns where table_schema='public' and table_name='requests' and column_name='description')
     and not exists (select 1 from information_schema.columns where table_schema='public' and table_name='requests' and column_name='request_description') then
    alter table public.requests rename column description to request_description;
  end if;
end $$;

-- ===================================================================
-- 2. request_type / status enum extensions, using the column's *actual*
-- underlying type name (via udt_name) rather than a guess.
-- ===================================================================

do $$
declare
  v_type_name text;
  v_value text;
begin
  select udt_name into v_type_name
  from information_schema.columns
  where table_schema='public' and table_name='requests' and column_name='request_type' and data_type='USER-DEFINED';

  if v_type_name is not null then
    foreach v_value in array array[
      'Organization Accreditation', 'Organization Verification', 'Event Approval',
      'Venue Reservation', 'Equipment Borrowing', 'Certificate Request',
      'Letter Request', 'Financial Assistance', 'Document Request',
      'Other Services', 'Others'
    ]
    loop
      begin
        execute format('alter type public.%I add value if not exists %L', v_type_name, v_value);
      exception when others then
        raise notice 'Could not add % to requests.request_type enum (%): %', v_value, v_type_name, sqlerrm;
      end;
    end loop;
  end if;
end $$;

do $$
declare
  v_type_name text;
  v_value text;
begin
  select udt_name into v_type_name
  from information_schema.columns
  where table_schema='public' and table_name='requests' and column_name='status' and data_type='USER-DEFINED';

  if v_type_name is not null then
    foreach v_value in array array['received', 'under_review', 'completed']
    loop
      begin
        execute format('alter type public.%I add value if not exists %L', v_type_name, v_value);
      exception when others then
        raise notice 'Could not add % to requests.status enum (%): %', v_value, v_type_name, sqlerrm;
      end;
    end loop;
  end if;
end $$;

commit;

-- ===================================================================
-- 3. New columns.
-- ===================================================================

alter table public.requests add column if not exists request_id text;
alter table public.requests add column if not exists full_name text;
alter table public.requests add column if not exists student_number text;
alter table public.requests add column if not exists specified_type text;
alter table public.requests add column if not exists remarks text;
alter table public.requests add column if not exists updated_at timestamptz not null default now();

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_requests_updated_at on public.requests;
create trigger set_requests_updated_at
  before update on public.requests
  for each row execute function public.set_updated_at();

-- request_type is confirmed plain text on this install (the enum probe in
-- section 2 above found nothing). Deliberately NOT adding an allow-list
-- CHECK constraint here: a live row already holds "Certificate of
-- Membership", a value outside even the old dropdown's options, so this
-- column has drifted further than the app's <select> alone would suggest.
-- A NOT VALID CHECK only skips the *initial* validation of existing rows -
-- it still re-validates on every future UPDATE to that row (which is
-- exactly what broke the backfill below on the first attempt). Since the
-- full set of stray historical values isn't known, request_type stays
-- validated client-side only, same as before this migration.
alter table public.requests drop constraint if exists requests_request_type_check;

-- Fallback CHECK for status, only fires if it turns out NOT to be an enum.
do $$
declare
  v_constraint_name text;
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='requests' and column_name='status' and data_type <> 'USER-DEFINED'
  ) then
    for v_constraint_name in
      select conname from pg_constraint
      where conrelid = 'public.requests'::regclass and contype = 'c'
        and pg_get_constraintdef(oid) ilike '%status%'
    loop
      execute format('alter table public.requests drop constraint %I', v_constraint_name);
    end loop;

    alter table public.requests add constraint requests_status_check
      check (status in ('pending', 'received', 'under_review', 'approved', 'rejected', 'completed'));
  end if;
end $$;

-- specified_type must be present only for "Others", and null otherwise.
-- Safe now that 'Others' is a committed enum label (if request_type is an
-- enum at all).
do $$
declare
  v_constraint_name text;
begin
  for v_constraint_name in
    select conname from pg_constraint
    where conrelid = 'public.requests'::regclass and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%specified_type%'
  loop
    execute format('alter table public.requests drop constraint %I', v_constraint_name);
  end loop;

  alter table public.requests add constraint requests_specified_type_check
    check (
      (request_type::text = 'Others' and specified_type is not null and length(trim(specified_type)) > 0)
      or (request_type::text <> 'Others' and specified_type is null)
    )
    not valid;
end $$;

-- ===================================================================
-- 4. Sequential per-year Request IDs (REQ-YYYY-000001). Same
-- counter-table pattern as feedback_id_counters, scoped to this table.
-- ===================================================================

create table if not exists public.request_id_counters (
  year int primary key,
  last_number int not null default 0
);

alter table public.request_id_counters enable row level security;
revoke all on public.request_id_counters from anon, authenticated;

create or replace function public.generate_request_id()
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_year int := extract(year from now())::int;
  v_next int;
begin
  insert into public.request_id_counters (year, last_number)
  values (v_year, 1)
  on conflict (year) do update set last_number = request_id_counters.last_number + 1
  returning last_number into v_next;

  return 'REQ-' || v_year || '-' || lpad(v_next::text, 6, '0');
end;
$$;

-- One trigger handles the sequential ID and the server-trusted
-- full_name/student_number snapshot, so a client can never spoof another
-- user's identity on their own request row.
create or replace function public.requests_before_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.request_id is null then
    new.request_id := public.generate_request_id();
  end if;

  select p.full_name, p.student_number into new.full_name, new.student_number
  from public.profiles p where p.id = new.user_id;

  if new.request_type::text <> 'Others' then
    new.specified_type := null;
  end if;

  return new;
end;
$$;

drop trigger if exists set_requests_before_insert on public.requests;
create trigger set_requests_before_insert
  before insert on public.requests
  for each row execute function public.requests_before_insert();

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.requests'::regclass and conname = 'requests_request_id_key'
  ) then
    alter table public.requests add constraint requests_request_id_key unique (request_id);
  end if;
end $$;

-- Backfill: assign IDs (oldest first) and full_name/student_number to any
-- pre-existing rows, and seed the counter table so new submissions
-- continue right after the highest backfilled number for that year.
do $$
declare
  r record;
  v_num int;
begin
  for r in
    select rq.id, extract(year from rq.created_at)::int as yr
    from public.requests rq
    where rq.request_id is null
    order by rq.created_at asc
  loop
    insert into public.request_id_counters (year, last_number)
    values (r.yr, 1)
    on conflict (year) do update set last_number = request_id_counters.last_number + 1
    returning last_number into v_num;

    update public.requests
    set request_id = 'REQ-' || r.yr || '-' || lpad(v_num::text, 6, '0')
    where id = r.id;
  end loop;

  update public.requests rq
  set full_name = p.full_name, student_number = p.student_number
  from public.profiles p
  where rq.user_id = p.id and rq.full_name is null;
end $$;

alter table public.requests alter column request_id set not null;

-- ===================================================================
-- 5. RLS - osoa_eb sees/manages every row; everyone else sees and can
-- only insert their own, matching the requested access matrix (this
-- narrows the previous "every org member's requests" visibility down to
-- strictly own-row-only for students/org presidents). Only osoa_eb can
-- update (status + remarks).
-- ===================================================================

alter table public.requests enable row level security;

drop policy if exists "requests_select" on public.requests;
drop policy if exists "requests_insert" on public.requests;
drop policy if exists "requests_update" on public.requests;

create policy "requests_select"
  on public.requests for select
  to authenticated
  using (
    user_id = auth.uid()
    or exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.role = 'osoa_eb'
    )
  );

create policy "requests_insert"
  on public.requests for insert
  to authenticated
  with check (user_id = auth.uid());

create policy "requests_update"
  on public.requests for update
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

revoke all on public.requests from anon;

-- ===================================================================
-- 6. Realtime, so both the submitter's own status and the admin queue
-- update live without a page refresh.
-- ===================================================================

do $$
begin
  alter publication supabase_realtime add table public.requests;
exception when duplicate_object then null;
end $$;

notify pgrst, 'reload schema';
