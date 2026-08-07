-- LINGKOD Meneses - Drop two legacy, hand-created triggers on
-- public.submissions that this repo never tracked (found live via
-- pg_trigger/pg_get_functiondef, same investigation as
-- 20260730030000_drop_legacy_requests_triggers.sql for public.requests):
-- trg_submissions_updated (-> touch_updated_at()) and
-- trg_notify_submission_status (-> notify_submission_status_change()).
--
-- Both are dead weight, fully superseded by this repo's actively
-- maintained equivalents that already fire on the same events:
--   - touch_updated_at() only does `new.updated_at := now()` - exactly
--     what set_submissions_updated_at (-> set_updated_at()) already
--     does. Same shared generic function already seen wired to
--     trg_requests_updated on public.requests - harmless but redundant,
--     not touched here (may still be used by other tables' triggers).
--   - notify_submission_status_change() is a broken legacy duplicate of
--     notify_on_submission_change() (-> trg_notify_on_submission_change):
--     it inserts into notifications using column names
--     (user_id, message) that no longer exist on that table (renamed to
--     recipient_id, body - see 20260728040000_notifications_and_audit_logs.sql),
--     so it throws on every submission status update. Unlike the
--     requests case, it does correctly reference new.submitted_by (that
--     column was never renamed) - the break here is entirely on the
--     notifications insert side.
--
-- Dropping these two triggers removes no user-facing behavior:
-- status-change notifications to the submitter are already handled by
-- notify_on_submission_change() (kept, unchanged, already using the
-- correct notifications columns and already free of the enum-coercion
-- CASE bug found in requests' equivalent trigger), and updated_at is
-- already handled by set_submissions_updated_at.

drop trigger if exists trg_submissions_updated on public.submissions;
drop trigger if exists trg_notify_submission_status on public.submissions;

notify pgrst, 'reload schema';
