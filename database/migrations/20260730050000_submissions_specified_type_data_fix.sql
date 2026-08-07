-- LINGKOD Meneses - Backfill pre-existing public.submissions rows that
-- violate submissions_specified_type_check (added NOT VALID in
-- 20260728050000_submissions_specified_type.sql - NOT VALID only skips
-- checking rows that already existed at ADD CONSTRAINT time, it does not
-- exempt them from being re-validated on every future UPDATE, so any row
-- that predates the constraint and doesn't satisfy it blocks ANY edit to
-- that row afterward, including one only touching status/remarks -
-- confirmed live: "new row for relation submissions violates check
-- constraint submissions_specified_type_check" when trying to review a
-- submission that has nothing to do with specified_type).
--
-- Two directions of drift are possible, matching the constraint's two
-- branches:
--   1. category <> 'other' but specified_type isn't null (e.g. an empty
--      string '' rather than null, or leftover text from before this
--      column's invariant was enforced) - safe to clear, since
--      specified_type is only ever meant to hold data for category='other'
--      (this mirrors requests_before_insert()/feedback_before_insert()
--      already nulling their own specified_type column the same way for
--      every non-"Others" row).
--   2. category = 'other' but specified_type is null/blank - there's no
--      way to recover what the submitter actually meant, so this uses a
--      clearly-labeled placeholder (not a guess dressed up as real data)
--      so the row becomes editable again; OSOA EB can replace it with
--      the real value via Documents/Submission review if known.

update public.submissions
set specified_type = null
where category <> 'other' and specified_type is not null;

update public.submissions
set specified_type = '(not specified)'
where category = 'other'
  and (specified_type is null or length(trim(specified_type)) = 0);

notify pgrst, 'reload schema';
