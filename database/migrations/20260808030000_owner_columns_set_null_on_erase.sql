-- LINGKOD Meneses - "Permanently Erase Account" currently deletes more
-- than the erased user's own data on five columns that were left on
-- ON DELETE CASCADE instead of the ON DELETE SET NULL convention every
-- other "who did this" column on profiles(id) already follows (including
-- the *other* columns on these exact same tables - submissions.
-- reviewed_by, requests.approved_by/updated_by are already SET NULL,
-- just not the primary owner column):
--
--   submissions.submitted_by   -> deleted the org's actual compliance/
--                                 renewal submission records
--   requests.user_id           -> deleted requests filed with OSOA
--   documents.uploaded_by      -> deleted shared repository documents
--   messages.sender_id         -> deleted every message they ever sent,
--                                 including the other participant's copy
--   message_reports.reporter_id / .reported_user_id
--                               -> deleted moderation report records
--
-- User decision (2026-08-08): keep this content and null the attribution
-- instead of deleting it, matching how "Remove User" (the soft-delete
-- step that must already happen before Permanently Erase is even
-- reachable) already treats messages/announcements - shown as posted/
-- sent by no one in particular rather than disappearing.
--
-- Constraint names are looked up dynamically rather than assumed - see
-- 20260808010000's header comment for why.
--
-- documents.uploaded_by and both message_reports columns are declared
-- NOT NULL (20260722000000_documents_module.sql:26,
-- 20260719030000_messaging_conversation_options.sql:91-92) - adding
-- ON DELETE SET NULL to a NOT NULL column doesn't make it nullable, it
-- just fails a different way (a NOT NULL violation instead of a foreign-
-- key violation) the moment the action actually fires. requests.user_id
-- and messages.sender_id predate any tracked migration so their current
-- nullability can't be confirmed from this repo, but a message/request
-- realistically always has a sender/submitter today, so they're dropped
-- defensively too - `drop not null` is a no-op (not an error) on a
-- column that's already nullable, so this is safe either way. Existing
-- application code already has to handle a missing submitter/sender
-- gracefully (e.g. submission/script.js already falls back to "Unknown"
-- when a profile lookup misses), so this doesn't introduce a new class
-- of frontend bug - only Permanently Erase can ever actually produce a
-- null value here; every normal insert still supplies a real user id.
--
-- Safe to run more than once.

alter table public.documents alter column uploaded_by drop not null;
alter table public.message_reports alter column reporter_id drop not null;
alter table public.message_reports alter column reported_user_id drop not null;
alter table public.requests alter column user_id drop not null;
alter table public.messages alter column sender_id drop not null;

do $$
declare
  v_constraint_name text;
begin
  -- submissions.submitted_by
  select tc.constraint_name into v_constraint_name
  from information_schema.table_constraints tc
  join information_schema.key_column_usage kcu
    on tc.constraint_name = kcu.constraint_name and tc.table_schema = kcu.table_schema
  where tc.constraint_type = 'FOREIGN KEY' and tc.table_schema = 'public'
    and tc.table_name = 'submissions' and kcu.column_name = 'submitted_by';
  if v_constraint_name is not null then
    execute format('alter table public.submissions drop constraint %I', v_constraint_name);
  end if;
  alter table public.submissions
    add constraint submissions_submitted_by_fkey
    foreign key (submitted_by) references public.profiles(id) on delete set null;

  -- requests.user_id
  select tc.constraint_name into v_constraint_name
  from information_schema.table_constraints tc
  join information_schema.key_column_usage kcu
    on tc.constraint_name = kcu.constraint_name and tc.table_schema = kcu.table_schema
  where tc.constraint_type = 'FOREIGN KEY' and tc.table_schema = 'public'
    and tc.table_name = 'requests' and kcu.column_name = 'user_id';
  if v_constraint_name is not null then
    execute format('alter table public.requests drop constraint %I', v_constraint_name);
  end if;
  alter table public.requests
    add constraint requests_user_id_fkey
    foreign key (user_id) references public.profiles(id) on delete set null;

  -- documents.uploaded_by
  select tc.constraint_name into v_constraint_name
  from information_schema.table_constraints tc
  join information_schema.key_column_usage kcu
    on tc.constraint_name = kcu.constraint_name and tc.table_schema = kcu.table_schema
  where tc.constraint_type = 'FOREIGN KEY' and tc.table_schema = 'public'
    and tc.table_name = 'documents' and kcu.column_name = 'uploaded_by';
  if v_constraint_name is not null then
    execute format('alter table public.documents drop constraint %I', v_constraint_name);
  end if;
  alter table public.documents
    add constraint documents_uploaded_by_fkey
    foreign key (uploaded_by) references public.profiles(id) on delete set null;

  -- messages.sender_id
  select tc.constraint_name into v_constraint_name
  from information_schema.table_constraints tc
  join information_schema.key_column_usage kcu
    on tc.constraint_name = kcu.constraint_name and tc.table_schema = kcu.table_schema
  where tc.constraint_type = 'FOREIGN KEY' and tc.table_schema = 'public'
    and tc.table_name = 'messages' and kcu.column_name = 'sender_id';
  if v_constraint_name is not null then
    execute format('alter table public.messages drop constraint %I', v_constraint_name);
  end if;
  alter table public.messages
    add constraint messages_sender_id_fkey
    foreign key (sender_id) references public.profiles(id) on delete set null;

  -- message_reports.reporter_id
  select tc.constraint_name into v_constraint_name
  from information_schema.table_constraints tc
  join information_schema.key_column_usage kcu
    on tc.constraint_name = kcu.constraint_name and tc.table_schema = kcu.table_schema
  where tc.constraint_type = 'FOREIGN KEY' and tc.table_schema = 'public'
    and tc.table_name = 'message_reports' and kcu.column_name = 'reporter_id';
  if v_constraint_name is not null then
    execute format('alter table public.message_reports drop constraint %I', v_constraint_name);
  end if;
  alter table public.message_reports
    add constraint message_reports_reporter_id_fkey
    foreign key (reporter_id) references public.profiles(id) on delete set null;

  -- message_reports.reported_user_id
  select tc.constraint_name into v_constraint_name
  from information_schema.table_constraints tc
  join information_schema.key_column_usage kcu
    on tc.constraint_name = kcu.constraint_name and tc.table_schema = kcu.table_schema
  where tc.constraint_type = 'FOREIGN KEY' and tc.table_schema = 'public'
    and tc.table_name = 'message_reports' and kcu.column_name = 'reported_user_id';
  if v_constraint_name is not null then
    execute format('alter table public.message_reports drop constraint %I', v_constraint_name);
  end if;
  alter table public.message_reports
    add constraint message_reports_reported_user_id_fkey
    foreign key (reported_user_id) references public.profiles(id) on delete set null;
end $$;
