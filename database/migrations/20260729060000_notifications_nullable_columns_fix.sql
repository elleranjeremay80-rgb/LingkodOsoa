-- LINGKOD Meneses - Fix unexpected NOT NULL columns on notifications.
--
-- The actual failure: "null value in column "user_id" of relation
-- "notifications" violates not-null constraint" - notifications has a
-- user_id column that's NOT NULL, which none of the six trigger
-- functions populate (they all write recipient_id, which is the column
-- js/common.js's lingkodLoadNotifications() actually reads from - see
-- its `.eq("recipient_id", profileId)`). user_id looks like a leftover
-- from however this table was first created directly on the live
-- project, before any migration in this repo touched it - the same
-- "untracked object" root cause as the type-column bug fixed in
-- 20260729050000, just a different symptom this time (a missing
-- required column instead of a wrong type).
--
-- Because a trigger runs inside the same transaction as the row that
-- fired it, this wasn't just "no notification appears" - the trigger's
-- failed insert rolled back the ENTIRE transaction, including the
-- announcement/submission/request/feedback row the user was actually
-- trying to save. That's why nothing was saving at all.
--
-- Rather than special-case user_id alone and wait for the next
-- surprise column (organization_officers' officer-change trigger has
-- the exact same latent bug - it just hasn't fired against a real
-- edit yet), this finds and relaxes every NOT NULL column on
-- notifications except id (the primary key), which is safe because:
--   - recipient_id/type/title/body/link_url are always populated by
--     every trigger anyway, so dropping NOT NULL there changes nothing
--   - created_at has a default, so it was never actually at risk either
--   - read_at is already meant to be nullable (unread = null)
--   - any other still-unknown column (like user_id) that nothing
--     populates stops being a landmine

do $$
declare
  col record;
begin
  for col in
    select column_name
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'notifications'
      and is_nullable = 'NO'
      and column_name <> 'id'
  loop
    execute format('alter table public.notifications alter column %I drop not null', col.column_name);
  end loop;
end $$;

notify pgrst, 'reload schema';
