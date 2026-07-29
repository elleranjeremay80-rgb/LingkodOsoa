-- LINGKOD Meneses - Submission & Tracking: "Please Specify" when category
-- is "other". Same specified_type/custom-value pattern already used by
-- Requests, Feedback, and Documents (requests.specified_type /
-- feedback.specified_type / documents.custom_document_type - see
-- 20260722020000_requests_enhancements.sql / 20260722000000_feedback_
-- enhancements.sql / 20260728000000_documents_custom_type.sql).
--
-- Submission & Tracking's upload form previously had two different-
-- looking dropdown options ("New Organization Application" and "Other
-- Documents") that both saved category = 'other' with no way to tell
-- them apart afterwards - this column lets the submitter say which one
-- they meant, same as every other module's "Other" already does.

alter table public.submissions add column if not exists specified_type text;

alter table public.submissions drop constraint if exists submissions_specified_type_check;
alter table public.submissions add constraint submissions_specified_type_check
  check (
    (category = 'other' and specified_type is not null and length(trim(specified_type)) > 0)
    or (category <> 'other' and specified_type is null)
  )
  not valid;

notify pgrst, 'reload schema';
