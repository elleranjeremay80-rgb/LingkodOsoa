-- LINGKOD Meneses - Add the missing 'needs_revision' label to
-- public.approval_status.
--
-- 20260716000000_submissions_visibility_and_workflow.sql tried to add
-- this value to a guessed type name (public.submission_status), wrapped
-- in an exception handler that silently logs and continues on failure.
-- Live reproduction during this session's troubleshooting (see
-- 20260730010000_requests_status_enum_values.sql for the first half of
-- this discovery, on public.requests) confirms submissions.status
-- actually shares the SAME underlying enum as requests.status -
-- public.approval_status, not a separate submission_status type - so
-- that original guess never landed, and 'needs_revision' was never
-- actually added to the real enum. 'pending'/'approved'/'rejected' all
-- already work because 20260730010000 already added those (they're
-- shared with the requests status vocabulary); 'needs_revision' is
-- submissions-only and was never covered by that migration.

do $$
begin
  if exists (select 1 from pg_type where typname = 'approval_status' and typnamespace = 'public'::regnamespace) then
    alter type public.approval_status add value if not exists 'needs_revision';
  else
    raise notice 'public.approval_status does not exist on this project - nothing to do.';
  end if;
end $$;

notify pgrst, 'reload schema';
