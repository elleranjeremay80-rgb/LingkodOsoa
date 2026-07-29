-- LINGKOD Meneses - Announcements & Updates redesign.
-- Adds the event-detail fields ("When" / "Where" / "Who") the redesigned
-- announcement cards and submission form need. "What" reuses the existing
-- title column and "Description" reuses the existing content column - no
-- schema change needed for either of those.

alter table public.announcements add column if not exists event_date date;
alter table public.announcements add column if not exists event_location text;
alter table public.announcements add column if not exists event_who text;
