-- LINGKOD Meneses - Second pass of 20260730050000_submissions_specified_
-- type_data_fix.sql's backfill. That migration was meant to be a one-time
-- fix for every public.submissions row violating submissions_specified_
-- type_check (added NOT VALID in 20260728050000, so it was never actually
-- checked against rows that already existed at ADD CONSTRAINT time - and
-- NOT VALID does NOT exempt a row from being re-validated the next time
-- ANY column on it is updated, however unrelated - see that migration's
-- own header comment for the first time this exact failure mode was
-- caught live).
--
-- Confirmed live again during this session (2026-08-09): deleting a user
-- via the Supabase Admin API triggers submitted_by's ON DELETE SET NULL
-- action, which is a plain UPDATE on the row from Postgres's perspective
-- - and at least one row is still failing this same check:
--   ERROR: new row for relation "submissions" violates check constraint
--   "submissions_specified_type_check" (SQLSTATE 23514)
--
-- Since the constraint is still NOT VALID (deliberately - see 20260728050000),
-- there's no way to ask Postgres up front which rows are still bad short of
-- running the exact same backfill logic again - re-running is always safe
-- (a no-op on any row that's already consistent), so rather than diagnose
-- exactly how this one row drifted (case difference in category, a write
-- path that predates full enforcement, whatever it was), this just repeats
-- the original fix so every row - old or newly drifted - is brought back
-- into a state the constraint accepts.

update public.submissions
set specified_type = null
where category is distinct from 'other' and specified_type is not null;

update public.submissions
set specified_type = '(not specified)'
where category = 'other'
  and (specified_type is null or length(trim(specified_type)) = 0);

notify pgrst, 'reload schema';
