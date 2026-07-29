-- LINGKOD Meneses - live-updating announcements on the dashboard.
-- repository_files was already added to supabase_realtime in an earlier
-- migration; announcements needs the same so postgres_changes
-- subscriptions fire for it too.
alter publication supabase_realtime add table public.announcements;
