-- LINGKOD Meneses - Same class of fix as
-- 20260730050000_submissions_specified_type_data_fix.sql, applied
-- proactively to public.requests and public.feedback: both have the
-- identical specified_type invariant, added the same way (NOT VALID,
-- see requests_specified_type_check in
-- 20260722020000_requests_enhancements.sql and
-- feedback_specified_type_check in 20260722000000_feedback_enhancements.sql).
-- NOT VALID only skips the bulk check at ADD CONSTRAINT time - any
-- pre-existing row that already violated the invariant back then still
-- re-validates (and can still block) on every future UPDATE, exactly
-- like the confirmed live submissions crash. Fixing proactively here
-- rather than waiting to hit the same error on an old request/feedback
-- row.

update public.requests
set specified_type = null
where request_type::text <> 'Others' and specified_type is not null;

update public.requests
set specified_type = '(not specified)'
where request_type::text = 'Others'
  and (specified_type is null or length(trim(specified_type)) = 0);

update public.feedback
set specified_type = null
where feedback_type::text <> 'others' and specified_type is not null;

update public.feedback
set specified_type = '(not specified)'
where feedback_type::text = 'others'
  and (specified_type is null or length(trim(specified_type)) = 0);

notify pgrst, 'reload schema';
