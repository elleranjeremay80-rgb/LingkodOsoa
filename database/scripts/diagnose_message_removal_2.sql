-- LINGKOD Meneses - follow-up diagnostic for "Couldn't remove this
-- message." - closes two gaps the first diagnostic left open:
-- 1. Does message_removals actually have a PRIMARY KEY/UNIQUE constraint
--    on (message_id, user_id)? The upsert's onConflict:"message_id,user_id"
--    requires one to exist, or Postgres rejects it outright.
-- 2. The FULL guard_message_update body (the dashboard result column cuts
--    long text off - this returns it as one selectable block instead).

select 'message_removals constraints' as check_name,
       coalesce(string_agg(conname || ' (' || contype::text || '): ' || pg_get_constraintdef(oid), ' | '), 'NO CONSTRAINTS AT ALL') as result
from pg_constraint
where conrelid = 'public.message_removals'::regclass

union all
select 'messages table constraints (relevant only)',
       coalesce(string_agg(conname || ' (' || contype::text || ')', ', '), 'NONE')
from pg_constraint
where conrelid = 'public.messages'::regclass
  and contype = 'c'

union all
select 'guard_message_update full body',
       prosrc
from pg_proc
where proname = 'guard_message_update'

union all
select 'conversation_members columns',
       coalesce(string_agg(column_name || ':' || data_type, ', ' order by column_name), 'TABLE MISSING')
from information_schema.columns
where table_schema = 'public' and table_name = 'conversation_members';
