-- LINGKOD Meneses - ERD schema export (READ-ONLY).
-- Lists every public table's columns, primary keys, foreign keys, unique
-- constraints and unique indexes, plus the auth.users primary key, so the
-- ERD can be drawn from the live schema instead of from the migrations
-- (several base tables were created directly on the live project and are
-- not in database/migrations/).
--
-- Only SELECTs from the system catalogs. It changes nothing.
--
-- How to use: Supabase Dashboard -> SQL Editor -> paste -> Run ->
-- "Export" -> "Download CSV", and save the file as
-- documentation/erd-schema.csv.

with cols as (
  select 'column'::text as kind,
         c.table_name::text as table_name,
         c.column_name::text as name,
         case when c.data_type = 'USER-DEFINED' then c.udt_name else c.data_type end
           || case when c.is_nullable = 'NO' then ' NOT NULL' else '' end
           || coalesce(' DEFAULT ' || c.column_default, '') as detail,
         c.ordinal_position as ord
  from information_schema.columns c
  join information_schema.tables t
    on t.table_schema = c.table_schema and t.table_name = c.table_name
  where c.table_schema = 'public' and t.table_type = 'BASE TABLE'
),
cons as (
  select case con.contype when 'p' then 'primary_key' when 'f' then 'foreign_key' when 'u' then 'unique' end as kind,
         cl.relname::text as table_name,
         con.conname::text as name,
         pg_get_constraintdef(con.oid) as detail,
         0 as ord
  from pg_constraint con
  join pg_class cl on cl.oid = con.conrelid
  join pg_namespace n on n.oid = cl.relnamespace
  where n.nspname = 'public' and con.contype in ('p', 'f', 'u')
),
uidx as (
  select 'unique_index'::text as kind,
         t.relname::text as table_name,
         i.relname::text as name,
         pg_get_indexdef(ix.indexrelid) as detail,
         0 as ord
  from pg_index ix
  join pg_class i on i.oid = ix.indexrelid
  join pg_class t on t.oid = ix.indrelid
  join pg_namespace n on n.oid = t.relnamespace
  where n.nspname = 'public' and ix.indisunique and not ix.indisprimary
    and not exists (select 1 from pg_constraint c where c.conindid = ix.indexrelid)
),
auth_pk as (
  select 'auth_users_pk'::text as kind, 'auth.users'::text as table_name,
         con.conname::text as name, pg_get_constraintdef(con.oid) as detail, 0 as ord
  from pg_constraint con
  join pg_class cl on cl.oid = con.conrelid
  join pg_namespace n on n.oid = cl.relnamespace
  where n.nspname = 'auth' and cl.relname = 'users' and con.contype = 'p'
)
select kind, table_name, name, detail
from (select * from cols union all select * from cons union all select * from uidx union all select * from auth_pk) x
order by table_name,
         case kind when 'primary_key' then 0 when 'column' then 1 when 'foreign_key' then 2 when 'unique' then 3 else 4 end,
         ord, name;
