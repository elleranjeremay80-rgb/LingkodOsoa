-- Repair the one legacy document that predates
-- documents_custom_document_type_check, then VALIDATE the NOT VALID
-- "specified/custom type" constraints on user-linked tables.
--
-- Why: a NOT VALID check constraint isn't enforced on existing rows - until
-- that row is UPDATEd, at which point the whole row is re-checked and the
-- update fails. Deleting a user updates every record they own (the owner
-- column is ON DELETE SET NULL), so a single old non-conforming row made
-- its owner impossible to delete by any route - Registered Users' Delete
-- and Supabase's own Admin API alike ("violates check constraint
-- documents_custom_document_type_check"). Found 2026-10-09: exactly one
-- row, a document uploaded 2026-07-27 (one day before the constraint was
-- added) with category 'other' and no custom type. The Document Library
-- already displays such a row as "Others" (row.custom_document_type ||
-- "Others"), so storing that value changes nothing anyone sees.
--
-- feedback/requests/submissions had zero violating rows; validating them
-- now records that guarantee so the same trap can't reappear for old rows.

update public.documents
   set custom_document_type = 'Others'
 where category = 'other'
   and (custom_document_type is null or length(trim(custom_document_type)) = 0);

alter table public.documents   validate constraint documents_custom_document_type_check;
alter table public.feedback    validate constraint feedback_specified_type_check;
alter table public.requests    validate constraint requests_specified_type_check;
alter table public.submissions validate constraint submissions_specified_type_check;
