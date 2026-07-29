-- LINGKOD Meneses - Digital Repository real-time statistics support.
--
-- 1. "Organization Records" is a new stat card with no existing matching
-- category (file_category only had renewal/financial_report/policy/
-- memorandum/proposal/other) - added as a real, selectable category
-- rather than approximated from an existing one.
alter type public.file_category add value if not exists 'organization_records';

-- 2. Realtime: no table was in the supabase_realtime publication yet, so
-- postgres_changes subscriptions never fired for anything. Adding
-- repository_files specifically (not blanket-adding every table) keeps
-- the realtime footprint scoped to what this feature needs.
alter publication supabase_realtime add table public.repository_files;
