-- LINGKOD Meneses - Announcement notifications.
--
-- First of several notification sources being added incrementally.
-- Reuses the existing notifications table and security-definer-trigger
-- pattern already established by notify_osoa_eb_on_report() in
-- 20260728040000_notifications_and_audit_logs.sql - no new table, no new
-- backend. Supabase Realtime (js/common.js is already subscribed to the
-- notifications table) delivers this to every open tab the moment the
-- row is inserted, with zero frontend changes needed.
--
-- Recipient targeting deliberately mirrors announcements_select's own
-- RLS exactly (20260715010000_announcements_rls_and_updates.sql), so a
-- notification can never point someone at a row they aren't actually
-- allowed to open:
--   visibility = 'public'                        -> every active account
--   visibility in ('organization', 'department')  -> every active osoa_eb
--     account (who can always see any announcement regardless of
--     visibility) plus every active account in the announcement's own
--     organization
-- The poster never gets notified about their own post. Only fires on
-- INSERT (posting), not on edits - matches what was actually asked for.

create or replace function public.notify_on_announcement()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  poster_name text;
  content_preview text;
begin
  if new.is_published is distinct from true then
    return new;
  end if;

  select full_name into poster_name from public.profiles where id = new.created_by;
  content_preview := left(new.content, 120) || (case when length(new.content) > 120 then '...' else '' end);

  insert into public.notifications (recipient_id, type, title, body, link_url)
  select distinct p.id,
    'announcement',
    '📢 New Announcement: ' || new.title,
    coalesce(poster_name, 'Someone') || ' posted: ' || content_preview,
    '../announcements/index.html'
  from public.profiles p
  where p.status = 'active'
    and p.id is distinct from new.created_by
    and (
      new.visibility = 'public'
      or p.role = 'osoa_eb'
      or p.organization = new.organization
    );

  return new;
end;
$$;

drop trigger if exists trg_notify_on_announcement on public.announcements;
create trigger trg_notify_on_announcement
after insert on public.announcements
for each row execute function public.notify_on_announcement();

notify pgrst, 'reload schema';
