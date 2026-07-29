-- LINGKOD Meneses - Documents: "Specify Document Type" when category is
-- "other". Same specified_type/custom-value pattern already used by
-- Feedback and Requests (feedback.specified_type / requests.
-- specified_type, both in 20260722000000_feedback_enhancements.sql /
-- 20260722020000_requests_enhancements.sql) - required and non-null only
-- when the category is 'other', null otherwise.

alter table public.documents add column if not exists custom_document_type text;

alter table public.documents drop constraint if exists documents_custom_document_type_check;
alter table public.documents add constraint documents_custom_document_type_check
  check (
    (category = 'other' and custom_document_type is not null and length(trim(custom_document_type)) > 0)
    or (category <> 'other' and custom_document_type is null)
  )
  not valid;

notify pgrst, 'reload schema';
