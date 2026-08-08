-- LINGKOD Meneses - fixes a real bug in the "Permanently Erase Account"
-- flow (backend/functions/permanently-erase-account/index.ts): deleting
-- an auth.users row cascades to delete the matching profiles row
-- (profiles.id references auth.users(id) on delete cascade), but
-- conversations.last_message_sender_id was added with a plain
-- `references public.profiles(id)` (20260719020000_messaging_persistent_
-- list_and_realtime.sql) - no explicit ON DELETE clause, which defaults
-- to NO ACTION. So permanently erasing any user who was ever the most
-- recent sender in a conversation would fail with a foreign-key
-- violation, silently aborting the whole account deletion. Confirmed via
-- a live schema query (information_schema) run against the actual
-- Supabase project.
--
-- Every other "who did this" attribution column on profiles(id) already
-- uses ON DELETE SET NULL for exactly this reason - this brings
-- last_message_sender_id in line with that same convention: the
-- conversation summary row survives, it just no longer attributes the
-- last message to anyone.
--
-- The actual constraint name is looked up dynamically rather than
-- assumed, since this column was added on a table never captured by a
-- tracked CREATE TABLE - guessing Postgres' default <table>_<column>_fkey
-- naming and getting it wrong would silently leave the old NO ACTION
-- constraint in place alongside a new, inert one. Safe to run more than
-- once (no-ops if already fixed).

do $$
declare
  v_constraint_name text;
begin
  select tc.constraint_name into v_constraint_name
  from information_schema.table_constraints tc
  join information_schema.key_column_usage kcu
    on tc.constraint_name = kcu.constraint_name and tc.table_schema = kcu.table_schema
  where tc.constraint_type = 'FOREIGN KEY'
    and tc.table_schema = 'public'
    and tc.table_name = 'conversations'
    and kcu.column_name = 'last_message_sender_id';

  if v_constraint_name is not null then
    execute format('alter table public.conversations drop constraint %I', v_constraint_name);
  end if;

  alter table public.conversations
    add constraint conversations_last_message_sender_id_fkey
    foreign key (last_message_sender_id) references public.profiles(id) on delete set null;
end $$;
