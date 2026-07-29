-- LINGKOD Meneses - Fix notifications column types.
--
-- notifications was originally created directly on the live project
-- (same "untracked object" pattern as message_reports/
-- is_conversation_member/notifications.read_at earlier this session) -
-- its `type` column already existed as an enum (notification_type)
-- before 20260728040000_notifications_and_audit_logs.sql ran, so that
-- migration's `add column if not exists type text` silently no-opped
-- and left the enum in place. Every notification trigger (the original
-- report notifier, plus announcements/submissions/officers/requests/
-- feedback/account-changes added since) inserts a plain string like
-- 'announcement' or 'submission_approved' - values that were never part
-- of whatever the untracked enum's original value list was, so every
-- insert fails with either "column is of type notification_type but
-- expression is of type text" (INSERT ... SELECT paths) or "invalid
-- input value for enum notification_type" (INSERT ... VALUES paths).
--
-- type was always meant to be a free-form category string, same as
-- audit_logs.action (plain text, holds arbitrary values like
-- 'user.deactivate' with no enum at all) - not a fixed enum. Converting
-- to text fixes every trigger at once, and matches the original design.
--
-- title/body/link_url get the same defensive treatment even though no
-- error has been seen on them yet - the same untracked-creation history
-- means they could just as easily be varchar(N) instead of text, and
-- several triggers build long strings into body (announcement previews,
-- submission/request remarks appended on) that would only fail the
-- first time someone writes something long enough to hit whatever limit
-- was silently already there. text has no length limit, so converting
-- removes that whole class of "works until it doesn't" failure rather
-- than waiting to hit it as a separate bug report.
--
-- Every ALTER below is safe to re-run even if already converted.

alter table public.notifications alter column type drop default;
alter table public.notifications alter column type type text using type::text;

alter table public.notifications alter column title type text using title::text;
alter table public.notifications alter column body type text using body::text;
alter table public.notifications alter column link_url type text using link_url::text;

notify pgrst, 'reload schema';
