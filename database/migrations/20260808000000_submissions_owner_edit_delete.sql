-- LINGKOD Meneses - Submission & Tracking: let a submitter edit/delete
-- their own document while it's still early in the workflow.
--
-- Before this migration, submissions_update (see
-- 20260716000000_submissions_visibility_and_workflow.sql) only ever let
-- osoa_eb update a row - the submitter (org_president or any other role
-- that can reach Submission & Tracking) had no UPDATE path at all, and
-- there was no DELETE policy on `submissions` whatsoever (default-deny
-- under RLS). Same story for the "submission-documents" Storage bucket -
-- only INSERT/SELECT policies exist (20260716020000_submission_documents_
-- storage.sql), no DELETE.
--
-- Scope: a submitter may edit/delete their own row only while it's still
-- 'pending' or 'needs_revision' - i.e. before OSOA EB has started
-- reviewing it (received/under_review) or made a decision (approved/
-- rejected/completed). This keeps the review workflow's audit trail
-- intact once OSOA has actually acted on a submission, while still
-- letting a submitter fix and resubmit something OSOA sent back
-- (needs_revision is exactly that case).
--
-- Safe to run more than once.

-- ===================================================================
-- 1. submissions - UPDATE: osoa_eb keeps full access (unchanged
-- condition, just merged into one policy with the new owner branch)
-- OR the submitter, only while still pending/needs_revision.
--
-- The frontend's edit form never includes `status` in its patch, so
-- Postgres leaves that column exactly as it was; `with check`'s
-- `status in (...)` therefore re-validates the *preserved* value after
-- the update, which is enough to stop a submitter from smuggling a
-- status change through this policy without needing an old-vs-new row
-- comparison.
-- ===================================================================

drop policy if exists "submissions_update" on public.submissions;

create policy "submissions_update"
  on public.submissions for update
  to authenticated
  using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.role = 'osoa_eb'
    )
    or (
      submitted_by = auth.uid()
      and status in ('pending', 'needs_revision')
    )
  )
  with check (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.role = 'osoa_eb'
    )
    or (
      submitted_by = auth.uid()
      and status in ('pending', 'needs_revision')
    )
  );

-- ===================================================================
-- 2. submissions - DELETE: submitter only, only while still
-- pending/needs_revision. osoa_eb has no delete path here - review
-- decisions (approve/reject/return) are the only action they take on a
-- submission, not deletion.
-- ===================================================================

drop policy if exists "submissions_delete" on public.submissions;

create policy "submissions_delete"
  on public.submissions for delete
  to authenticated
  using (
    submitted_by = auth.uid()
    and status in ('pending', 'needs_revision')
  );

-- ===================================================================
-- 3. Storage - DELETE for the submission-documents bucket, owner only.
-- Mirrors the existing owner-scoped submission_documents_insert policy.
-- Used both by the delete flow and by the edit flow's "remove the old
-- file after the replacement is uploaded and the row is updated" step.
-- ===================================================================

drop policy if exists "submission_documents_delete" on storage.objects;

create policy "submission_documents_delete"
  on storage.objects for delete
  to authenticated
  using (bucket_id = 'submission-documents' and owner = auth.uid());
