-- LINGKOD Meneses - same bug class as 20260808010000: messages.removed_by
-- (added in 20260728020000_message_reactions_pins_forward_removal.sql,
-- with no explicit ON DELETE clause, defaulting to NO ACTION) blocks
-- "Permanently Erase Account" for any user who ever used "Remove for me"
-- on a message - deleting their profiles row would raise a foreign-key
-- violation and abort the whole erase. Brought in line with the same
-- ON DELETE SET NULL convention already used for every other "who did
-- this" attribution column on profiles(id). Confirmed via a live schema
-- query (information_schema) run against the actual Supabase project.
--
-- The actual constraint name is looked up dynamically rather than
-- assumed - see 20260808010000's header comment for why. Safe to run
-- more than once.

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
    and tc.table_name = 'messages'
    and kcu.column_name = 'removed_by';

  if v_constraint_name is not null then
    execute format('alter table public.messages drop constraint %I', v_constraint_name);
  end if;

  alter table public.messages
    add constraint messages_removed_by_fkey
    foreign key (removed_by) references public.profiles(id) on delete set null;
end $$;
