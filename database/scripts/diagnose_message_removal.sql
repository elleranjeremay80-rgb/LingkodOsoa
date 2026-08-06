-- LINGKOD Meneses - diagnostic for "Couldn't remove this message."
-- (both Remove for Me and Remove for Everyone). Read-only - changes
-- nothing, safe to run any time. Combined into ONE result set (Supabase's
-- SQL editor only shows the last statement's output when several SELECTs
-- are pasted together) - run this whole block as one query.

select 'message_removals columns' as check_name,
       coalesce(string_agg(column_name || ':' || data_type, ', ' order by column_name), 'TABLE MISSING') as result
from information_schema.columns
where table_schema = 'public' and table_name = 'message_removals'

union all
select 'messages removal columns',
       coalesce(string_agg(column_name || ':' || data_type, ', ' order by column_name), 'COLUMNS MISSING')
from information_schema.columns
where table_schema = 'public' and table_name = 'messages'
  and column_name in ('removed_for_everyone', 'removed_by', 'removed_at')

union all
select 'message_removals policies',
       coalesce(string_agg(policyname || ' (' || cmd || ')', ', '), 'NO POLICIES - migration not applied')
from pg_policies
where schemaname = 'public' and tablename = 'message_removals'

union all
select 'messages update policies',
       coalesce(string_agg(policyname || ' (' || cmd || ')', ', '), 'NO POLICIES')
from pg_policies
where schemaname = 'public' and tablename = 'messages' and cmd = 'UPDATE'

union all
select 'is_conversation_member signature',
       coalesce(pg_get_function_arguments(oid), 'FUNCTION MISSING')
from pg_proc
where proname = 'is_conversation_member'

union all
select 'guard_message_update body',
       coalesce(prosrc, 'FUNCTION MISSING')
from pg_proc
where proname = 'guard_message_update'

union all
select 'trg_guard_message_update trigger',
       coalesce(string_agg(tgname || ' (enabled=' || (tgenabled <> 'D') || ')', ', '), 'TRIGGER MISSING')
from pg_trigger
where tgname = 'trg_guard_message_update'

union all
select 'message-attachments bucket',
       coalesce(string_agg(id, ', '), 'BUCKET MISSING')
from storage.buckets
where id = 'message-attachments';
