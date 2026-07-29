-- LINGKOD Meneses - Submission & Tracking: reviewer audit trail for the
-- new "Review Submitted Documents" approval queue.
--
-- reviewer_name/reviewer_role are deliberately NOT added as columns here -
-- like announcements' created_by, only reviewer_id (uuid) is stored and
-- the display name/role is joined from `profiles` client-side (see
-- js/common.js's lingkodFetchProfilesById), so this never goes stale if
-- someone's name changes. Same reasoning for "Organization Name" on the
-- review table - joined from profiles.organization via submitted_by
-- rather than duplicated onto every submission row.
-- Safe to run more than once.

alter table public.submissions add column if not exists reviewer_id uuid references auth.users(id) on delete set null;
alter table public.submissions add column if not exists reviewed_at timestamptz;
alter table public.submissions add column if not exists approved_at timestamptz;
alter table public.submissions add column if not exists rejected_at timestamptz;

-- No RLS changes needed: 20260716000000_submissions_visibility_and_workflow.sql's
-- "submissions_update" policy (osoa_eb only) already governs every column
-- on the row, these included.
