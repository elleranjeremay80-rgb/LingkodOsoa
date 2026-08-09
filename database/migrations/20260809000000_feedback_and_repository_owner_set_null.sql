-- LINGKOD Meneses - Two more "who did this" columns on profiles(id) that
-- 20260808030000_owner_columns_set_null_on_erase.sql missed, found while
-- debugging the Supabase Dashboard's Authentication -> Users -> Delete
-- user failing with an opaque "Failed to delete selected users: {}" for a
-- specific already-deactivated account.
--
-- feedback and repository_files were both created directly against the
-- live project - no CREATE TABLE for either exists anywhere in this
-- migrations folder (see 20260722000000_feedback_enhancements.sql's own
-- header comment, and 20260801000000_repository_recipient_visibility.sql's).
-- 20260808030000 converted every *other* base-table owner column it could
-- find (submissions.submitted_by, requests.user_id, documents.uploaded_by,
-- messages.sender_id, message_reports.reporter_id/reported_user_id) from
-- an implicit ON DELETE NO ACTION (or, per repository/script.js:457's own
-- comment on uploaded_by, possibly no FK at all) to ON DELETE SET NULL,
-- matching every column added *by* a tracked migration on these two exact
-- tables (feedback.updated_by, repository_files.updated_by) - but missed
-- feedback.user_id and repository_files.uploaded_by themselves, since
-- neither's original definition is visible from this repo either.
--
-- Whichever of the two was actually the blocker for that specific delete,
-- both get the same fix here - safe to run more than once, and safe
-- either way since dropping a constraint/nullability that doesn't exist
-- yet is a no-op, not an error.
--
-- NOT VALID (unlike 20260808030000's equivalent adds): those five columns
-- were always populated by tracked application code that only ever wrote
-- a real signed-in user's own id, so there was no realistic risk of
-- orphaned values. These two columns' history before this migrations
-- folder existed is unknown, so NOT VALID skips re-validating whatever
-- is already sitting in the column - the ON DELETE SET NULL action itself
-- still fires normally regardless of the NOT VALID flag; only the
-- (skipped) one-time check of *existing* rows is affected.

alter table public.feedback alter column user_id drop not null;
alter table public.repository_files alter column uploaded_by drop not null;

do $$
declare
  v_constraint_name text;
begin
  -- feedback.user_id
  select tc.constraint_name into v_constraint_name
  from information_schema.table_constraints tc
  join information_schema.key_column_usage kcu
    on tc.constraint_name = kcu.constraint_name and tc.table_schema = kcu.table_schema
  where tc.constraint_type = 'FOREIGN KEY' and tc.table_schema = 'public'
    and tc.table_name = 'feedback' and kcu.column_name = 'user_id';
  if v_constraint_name is not null then
    execute format('alter table public.feedback drop constraint %I', v_constraint_name);
  end if;
  alter table public.feedback
    add constraint feedback_user_id_fkey
    foreign key (user_id) references public.profiles(id) on delete set null not valid;

  -- repository_files.uploaded_by
  select tc.constraint_name into v_constraint_name
  from information_schema.table_constraints tc
  join information_schema.key_column_usage kcu
    on tc.constraint_name = kcu.constraint_name and tc.table_schema = kcu.table_schema
  where tc.constraint_type = 'FOREIGN KEY' and tc.table_schema = 'public'
    and tc.table_name = 'repository_files' and kcu.column_name = 'uploaded_by';
  if v_constraint_name is not null then
    execute format('alter table public.repository_files drop constraint %I', v_constraint_name);
  end if;
  alter table public.repository_files
    add constraint repository_files_uploaded_by_fkey
    foreign key (uploaded_by) references public.profiles(id) on delete set null not valid;
end $$;

notify pgrst, 'reload schema';
