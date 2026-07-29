-- LINGKOD Meneses - Messages page: per-conversation three-dot menu
-- (mark read/unread, mute, archive, delete, block, report, view profile).
--
-- Everything conversations/conversation_members/messages-related lives
-- directly on the live project (see the two prior messaging migrations),
-- so - same as those - this only adds new tables/columns/functions and
-- extends the one trigger function it already owns. It never rewrites an
-- RLS policy it can't inspect.

-- ===================================================================
-- 1. Per-user, per-conversation preferences: mute / archive / delete-for-me
-- / a manual "mark as unread" override. All scoped to (conversation_id,
-- user_id) - archiving or deleting a chat only ever affects your own view
-- of it, never the other participant's.
-- ===================================================================

create table if not exists public.conversation_settings (
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  is_muted boolean not null default false,
  is_archived boolean not null default false,
  is_deleted boolean not null default false,
  manually_marked_unread boolean not null default false,
  updated_at timestamptz not null default now(),
  primary key (conversation_id, user_id)
);

alter table public.conversation_settings enable row level security;

drop policy if exists conversation_settings_select on public.conversation_settings;
create policy conversation_settings_select on public.conversation_settings
for select to authenticated
using (user_id = auth.uid());

drop policy if exists conversation_settings_insert on public.conversation_settings;
create policy conversation_settings_insert on public.conversation_settings
for insert to authenticated
with check (user_id = auth.uid() and public.is_conversation_member(conversation_id));

drop policy if exists conversation_settings_update on public.conversation_settings;
create policy conversation_settings_update on public.conversation_settings
for update to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

revoke all on public.conversation_settings from anon;

-- ===================================================================
-- 2. Blocking is a relationship between two people, not scoped to one
-- conversation - blocking someone should stop them everywhere, not just
-- in whatever thread you happened to block them from.
-- ===================================================================

create table if not exists public.user_blocks (
  blocker_id uuid not null references public.profiles(id) on delete cascade,
  blocked_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker_id, blocked_id),
  constraint user_blocks_not_self check (blocker_id <> blocked_id)
);

alter table public.user_blocks enable row level security;

-- Both sides of a block relationship need to see it exists - the blocked
-- party's own client has to know it can't message the blocker anymore too.
drop policy if exists user_blocks_select on public.user_blocks;
create policy user_blocks_select on public.user_blocks
for select to authenticated
using (auth.uid() = blocker_id or auth.uid() = blocked_id);

drop policy if exists user_blocks_insert on public.user_blocks;
create policy user_blocks_insert on public.user_blocks
for insert to authenticated
with check (auth.uid() = blocker_id);

drop policy if exists user_blocks_delete on public.user_blocks;
create policy user_blocks_delete on public.user_blocks
for delete to authenticated
using (auth.uid() = blocker_id);

revoke all on public.user_blocks from anon;

-- ===================================================================
-- 3. User reports, for OSOA EB (this app's admin-equivalent role) to
-- review later. No review UI is built here - out of scope for the
-- Messages page itself - this just gives them somewhere to land.
-- ===================================================================

create table if not exists public.message_reports (
  id uuid primary key default gen_random_uuid(),
  reporter_id uuid not null references public.profiles(id) on delete cascade,
  reported_user_id uuid not null references public.profiles(id) on delete cascade,
  conversation_id uuid references public.conversations(id) on delete set null,
  reason text not null,
  description text,
  created_at timestamptz not null default now(),
  constraint message_reports_not_self check (reporter_id <> reported_user_id)
);

alter table public.message_reports enable row level security;

drop policy if exists message_reports_insert on public.message_reports;
create policy message_reports_insert on public.message_reports
for insert to authenticated
with check (auth.uid() = reporter_id);

drop policy if exists message_reports_select_own on public.message_reports;
create policy message_reports_select_own on public.message_reports
for select to authenticated
using (auth.uid() = reporter_id);

drop policy if exists message_reports_select_admin on public.message_reports;
create policy message_reports_select_admin on public.message_reports
for select to authenticated
using (exists (
  select 1 from public.profiles p
  where p.id = auth.uid() and p.role = 'osoa_eb'
));

revoke all on public.message_reports from anon;

-- ===================================================================
-- 4. "View Profile" needs to know whether the *other* person has turned
-- off show_profile_information (Settings page) - but user_settings is
-- locked to (user_id = auth.uid()) only, on purpose (see
-- 20260719000000_user_settings.sql). Rather than widen that policy for
-- everyone's whole settings row, this exposes exactly the one boolean
-- anyone's allowed to ask about someone else, and nothing more.
-- ===================================================================

create or replace function public.profile_visibility_allowed(target_id uuid)
returns boolean
language sql
security definer set search_path = public
stable
as $$
  select coalesce(
    (select show_profile_information from public.user_settings where user_id = target_id),
    true
  );
$$;

grant execute on function public.profile_visibility_allowed(uuid) to authenticated;

-- ===================================================================
-- 5. New activity on a conversation un-hides it for everyone in it -
-- matches Messenger (a fresh message brings an archived or "deleted"
-- thread back). Extends (create or replace, not a new function) the
-- trigger already installed by the previous messaging migration.
-- ===================================================================

create or replace function public.touch_conversation_on_message()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  update public.conversations
  set updated_at = new.created_at,
      last_message_content = new.content,
      last_message_at = new.created_at,
      last_message_sender_id = new.sender_id
  where id = new.conversation_id;

  update public.conversation_settings
  set is_archived = false,
      is_deleted = false,
      updated_at = now()
  where conversation_id = new.conversation_id;

  return new;
end;
$$;

-- ===================================================================
-- 6. Enforce blocking at the database layer, regardless of whatever the
-- existing messages INSERT policy already allows - a block should hold
-- even if that policy alone wouldn't otherwise stop the insert.
-- ===================================================================

create or replace function public.guard_message_insert_not_blocked()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  other_id uuid;
begin
  select cm.profile_id into other_id
  from public.conversation_members cm
  where cm.conversation_id = new.conversation_id
    and cm.profile_id <> new.sender_id
  limit 1;

  if other_id is not null and exists (
    select 1 from public.user_blocks b
    where (b.blocker_id = new.sender_id and b.blocked_id = other_id)
       or (b.blocker_id = other_id and b.blocked_id = new.sender_id)
  ) then
    raise exception 'You can''t message this user.';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_guard_message_insert_not_blocked on public.messages;
create trigger trg_guard_message_insert_not_blocked
before insert on public.messages
for each row execute function public.guard_message_insert_not_blocked();

-- ===================================================================
-- 7. Realtime - mute/archive/delete and block state both need to sync
-- live across tabs/devices for the same account.
-- ===================================================================

do $$
begin
  alter publication supabase_realtime add table public.conversation_settings;
exception when duplicate_object then
  null;
end $$;

do $$
begin
  alter publication supabase_realtime add table public.user_blocks;
exception when duplicate_object then
  null;
end $$;
