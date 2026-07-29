-- LINGKOD Meneses - read-only diagnostic for "no approved submissions
-- showing on the dashboard", as ONE query / ONE result set (6 rows, one
-- per check) instead of 5 separate blocks. Changes nothing - safe to run.

with columns_check as (
  select 'submissions columns present' as check_name,
         coalesce(string_agg(column_name, ', ' order by column_name), 'TABLE MISSING') as result
  from information_schema.columns
  where table_schema = 'public' and table_name = 'submissions'
),
status_counts as (
  select 'status value counts (exact case)' as check_name,
         coalesce(string_agg(status || ': ' || cnt, ', '), 'NO ROWS AT ALL') as result
  from (
    select status, count(*) as cnt
    from public.submissions
    group by status
  ) t
),
approved_rows as (
  select 'approved submissions (lower(status)=''approved'')' as check_name,
         coalesce(string_agg(document_title || ' [' || coalesce(file_name, 'no file') || ']', ' | '), 'NONE FOUND') as result
  from public.submissions
  where lower(status) = 'approved'
),
rls_enabled as (
  select 'RLS enabled on submissions' as check_name,
         coalesce(rowsecurity::text, 'TABLE MISSING') as result
  from pg_tables
  where schemaname = 'public' and tablename = 'submissions'
),
rls_policies as (
  select 'submissions RLS policies' as check_name,
         coalesce(string_agg(policyname || ' (' || cmd || ')', ', '), 'NO POLICIES - migration not applied') as result
  from pg_policies
  where schemaname = 'public' and tablename = 'submissions'
),
realtime_check as (
  select 'submissions in supabase_realtime publication' as check_name,
         case when count(*) > 0 then 'YES' else 'NO - realtime step of the migration not applied' end as result
  from pg_publication_tables
  where pubname = 'supabase_realtime' and tablename = 'submissions'
)
select * from columns_check
union all select * from status_counts
union all select * from approved_rows
union all select * from rls_enabled
union all select * from rls_policies
union all select * from realtime_check;
