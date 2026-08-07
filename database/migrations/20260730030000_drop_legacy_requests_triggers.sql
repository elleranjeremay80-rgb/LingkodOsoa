-- LINGKOD Meneses - Drop two legacy, hand-created triggers on
-- public.requests that this repo never tracked (found live via
-- pg_trigger/pg_get_functiondef during troubleshooting): trg_requests_updated
-- (-> touch_updated_at()) and trg_notify_request_status
-- (-> notify_request_status_change()).
--
-- Both are dead weight, fully superseded by this repo's actively
-- maintained equivalents that already fire on the same events:
--   - touch_updated_at() only does `new.updated_at := now()` - exactly
--     what set_requests_updated_at (-> set_updated_at()) already does.
--     Harmless but redundant.
--   - notify_request_status_change() is a broken legacy duplicate of
--     notify_on_request_change() (-> trg_notify_on_request_change): it
--     references `new.requester_id`, a column renamed to `user_id`
--     back in 20260722020000_requests_enhancements.sql, and inserts
--     into notifications using column names (user_id, message) that no
--     longer match that table's shape (recipient_id, body - see
--     20260728040000_notifications_and_audit_logs.sql). This is the
--     trigger that was actually throwing "record 'new' has no field
--     'requester_id'" on every status update.
--
-- Dropping these two triggers removes no user-facing behavior:
-- status-change notifications to the submitter are already handled by
-- notify_on_request_change() (kept, already fixed separately for its
-- own enum-cast bug in 20260730020000), and updated_at is already
-- handled by set_requests_updated_at.
--
-- Deliberately NOT dropping the underlying functions themselves
-- (touch_updated_at(), notify_request_status_change()) - touch_updated_at
-- in particular has a generic enough name that it could still be wired
-- to a trigger on some other table this session never inspected;
-- dropping just the two requests-specific triggers is the safe, fully
-- sufficient fix.

drop trigger if exists trg_requests_updated on public.requests;
drop trigger if exists trg_notify_request_status on public.requests;

notify pgrst, 'reload schema';
