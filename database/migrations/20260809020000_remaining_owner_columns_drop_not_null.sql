-- LINGKOD Meneses - Four more columns carrying the exact same landmine
-- 20260809010000 just fixed for submissions.submitted_by: each already
-- has a `references profiles(id) on delete set null` foreign key (visible
-- in pg_constraint / the live project's own schema), but no migration
-- anywhere ever ran `drop not null` on the column itself, and each
-- belongs to a base table created directly against the live project
-- (never captured by a `CREATE TABLE` migration here) - so there was no
-- way to confirm from this repo alone whether the live column still
-- carries a leftover NOT NULL that would make the SET NULL action fail
-- exactly like submitted_by's did (SQLSTATE 23502) the moment someone
-- who authored/reviewed/approved one of these rows gets deleted:
--
--   announcements.created_by  - references auth.users(id) on delete set
--                                null since 20260715010000, but that
--                                migration's own CREATE TABLE IF NOT
--                                EXISTS was a no-op against the
--                                already-existing live table (see its
--                                header comment)
--   requests.approved_by      - only ever mentioned in a comment
--                                (20260808030000's header) confirming the
--                                FK action was already SET NULL live;
--                                never appears in any ADD COLUMN/ALTER
--                                COLUMN statement in this repo
--   feedback.reviewed_by      - same as requests.approved_by, only ever
--                                mentioned in that same comment
--   submissions.reviewed_by   - a distinct column from submissions.
--                                reviewer_id (which 20260716010000 did
--                                add nullable) - also only ever mentioned
--                                in that comment, never defined by a
--                                tracked migration
--
-- Each `drop not null` below is a no-op (not an error) if the column
-- turns out to already be nullable - safe to run more than once, safe
-- either way.

alter table public.announcements alter column created_by drop not null;
alter table public.requests alter column approved_by drop not null;
alter table public.feedback alter column reviewed_by drop not null;
alter table public.submissions alter column reviewed_by drop not null;
