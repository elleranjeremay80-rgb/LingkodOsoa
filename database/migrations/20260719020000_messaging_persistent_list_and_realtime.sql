-- LINGKOD Meneses - Messages page: persistent Messenger-style conversation
-- list, read/unread tracking, and live updates.
--
-- Everything conversations/conversation_members/messages-related was
-- created directly on the live project in an earlier session and was
-- never captured in a tracked migration, so this file only *adds* columns,
-- triggers, and one policy on top of whatever already exists - it never
-- touches the base tables' existing RLS. It assumes a
-- public.is_conversation_member(uuid) function already exists (referenced
-- by the working app code) - if that assumption is wrong this migration
-- will fail loudly on the policy below rather than silently doing nothing.

-- ===================================================================
-- 1. Denormalized "last message" summary on conversations, so the
-- sidebar can list + sort conversations with a single query instead of
-- scanning every message in every conversation on every page load.
-- ===================================================================

alter table public.conversations add column if not exists updated_at timestamptz not null default now();
alter table public.conversations add column if not exists last_message_content text;
alter table public.conversations add column if not exists last_message_at timestamptz;
alter table public.conversations add column if not exists last_message_sender_id uuid references public.profiles(id);

-- ===================================================================
-- 2. Read/unread tracking on messages, for the sidebar's unread badge
-- and the chat window's sent/read receipts.
-- ===================================================================

alter table public.messages add column if not exists is_read boolean not null default false;

-- ===================================================================
-- 3. Keep conversations.last_message_* (and updated_at, used for sort
-- order) in sync automatically whenever a message is inserted. Runs as
-- security definer since the inserting user (a conversation member) has
-- no reason to otherwise hold UPDATE rights on conversations directly.
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
  return new;
end;
$$;

drop trigger if exists trg_touch_conversation_on_message on public.messages;
create trigger trg_touch_conversation_on_message
after insert on public.messages
for each row execute function public.touch_conversation_on_message();

-- ===================================================================
-- 4. Allow a conversation member to mark another member's messages as
-- read (needed for the unread badge / read receipts to ever clear).
-- Guarded by a trigger so this broader UPDATE grant can only ever be
-- used to flip is_read - not to rewrite someone else's message content.
-- ===================================================================

create or replace function public.guard_message_update()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  if auth.uid() <> old.sender_id then
    if new.content is distinct from old.content
       or new.sender_id is distinct from old.sender_id
       or new.conversation_id is distinct from old.conversation_id
       or new.created_at is distinct from old.created_at then
      raise exception 'Only the sender may edit a message; other members may only mark it read.';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_guard_message_update on public.messages;
create trigger trg_guard_message_update
before update on public.messages
for each row execute function public.guard_message_update();

drop policy if exists messages_mark_read on public.messages;
create policy messages_mark_read on public.messages
for update
to authenticated
using (public.is_conversation_member(conversation_id))
with check (public.is_conversation_member(conversation_id));

-- ===================================================================
-- 5. Realtime - new messages, read-receipt updates, and conversation
-- summary changes all need to reach every open Messages page instantly.
-- ===================================================================

do $$
begin
  alter publication supabase_realtime add table public.messages;
exception when duplicate_object then
  null;
end $$;

do $$
begin
  alter publication supabase_realtime add table public.conversations;
exception when duplicate_object then
  null;
end $$;
