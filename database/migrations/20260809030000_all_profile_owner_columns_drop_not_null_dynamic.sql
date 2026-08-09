-- LINGKOD Meneses - Comprehensive, schema-driven fix for the landmine
-- class of bug 20260809010000 and 20260809020000 fixed one column at a
-- time by hand (submissions.submitted_by, then announcements.created_by/
-- requests.approved_by/feedback.reviewed_by/submissions.reviewed_by):
-- a foreign key correctly says `on delete set null`, but the column
-- ALSO still carries a leftover NOT NULL constraint from before this
-- migrations folder existed (several base tables here were created
-- directly against the live project by hand), so the SET NULL action
-- itself fails with a NOT NULL violation (SQLSTATE 23502) the moment the
-- referenced profile/auth user is actually deleted.
--
-- Rather than keep finding these one at a time from a 500 error on the
-- next admin deletion, this walks pg_constraint directly and drops NOT
-- NULL on every column that has an ON DELETE SET NULL foreign key
-- pointing at public.profiles(id) or auth.users(id) - covering every
-- column already known about above AND any other one that was never
-- specifically audited. Confirmed nullable columns are untouched (this
-- is a no-op on them, not an error).
--
-- Safe to run more than once, in any state, on any environment (a fresh
-- database included - it will simply find nothing to do until some of
-- these owner-column foreign keys exist).

do $$
declare
  r record;
begin
  for r in
    select
      con.conrelid::regclass::text as tbl,
      att.attname as col
    from pg_constraint con
    join pg_attribute att
      on att.attrelid = con.conrelid
     and att.attnum = con.conkey[1]
    where con.contype = 'f'
      and con.confdeltype = 'n'  -- 'n' = ON DELETE SET NULL
      and array_length(con.conkey, 1) = 1  -- single-column FKs only, matching every owner column in this schema
      and con.confrelid in ('public.profiles'::regclass, 'auth.users'::regclass)
  loop
    execute format('alter table %s alter column %I drop not null', r.tbl, r.col);
    raise notice 'Dropped NOT NULL on %.% (if it had one)', r.tbl, r.col;
  end loop;
end $$;

notify pgrst, 'reload schema';
