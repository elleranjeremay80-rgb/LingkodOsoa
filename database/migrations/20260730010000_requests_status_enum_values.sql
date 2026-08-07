-- LINGKOD Meneses - Guarantee requests.status's enum actually has all 6
-- values the frontend sends.
--
-- Live reproduction of the bug from the original spec confirmed the
-- underlying enum type is really named public.approval_status - a name
-- none of this repo's migrations knew (the base `requests` table was
-- hand-created live, so 20260722020000_requests_enhancements.sql could
-- only guess at the type via information_schema.udt_name, and silently
-- logged-and-continued if that guess didn't resolve to a real type, or
-- if a value failed to add for any other reason - see its `exception
-- when others then raise notice ...` handler). This migration targets
-- public.approval_status by its now-confirmed real name directly, so
-- there's no guessing left that could silently no-op.
--
-- ALTER TYPE ... ADD VALUE IF NOT EXISTS is safe to run repeatedly and
-- safe inside a transaction as long as the new value isn't used by an
-- INSERT/UPDATE in that same transaction - this migration only adds
-- values, it never uses them, so no COMMIT-before-use split is needed
-- here (unlike section 2 of 20260722020000_requests_enhancements.sql,
-- which does need that split because it goes on to use the values in
-- the same file).

do $$
begin
  if exists (select 1 from pg_type where typname = 'approval_status' and typnamespace = 'public'::regnamespace) then
    alter type public.approval_status add value if not exists 'pending';
    alter type public.approval_status add value if not exists 'received';
    alter type public.approval_status add value if not exists 'under_review';
    alter type public.approval_status add value if not exists 'approved';
    alter type public.approval_status add value if not exists 'rejected';
    alter type public.approval_status add value if not exists 'completed';
  else
    raise notice 'public.approval_status does not exist on this project - nothing to do (requests.status may be a different type/CHECK constraint here, already handled by 20260722020000_requests_enhancements.sql).';
  end if;
end $$;

notify pgrst, 'reload schema';
