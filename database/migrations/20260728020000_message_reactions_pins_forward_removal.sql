-- LINGKOD Meneses - Messenger-style per-message features: reactions,
-- pinning, forwarding, and remove-for-me/remove-for-everyone.
--
-- Builds on the messaging schema from 20260719020000/30000/40000 - same
-- public.is_conversation_member(uuid) helper, same "conversation member"
-- read scope, same osoa_eb-or-sender write scoping pattern already
-- established there.

-- ===================================================================
-- 1. Reactions - one reaction per (message, user), replaced by upsert or
-- removed by delete (both handled client-side; toggling/replacing is a
-- UI concern, not a DB one - the PK just guarantees "at most one row per
-- user per message" so a replace can never accidentally leave two rows
-- behind).
-- ===================================================================

create table if not exists public.message_reactions (
  message_id uuid not null references public.messages(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  reaction text not null check (reaction in ('like','love','haha','wow','sad','angry')),
  created_at timestamptz not null default now(),
  primary key (message_id, user_id)
);

alter table public.message_reactions enable row level security;

drop policy if exists message_reactions_select on public.message_reactions;
create policy message_reactions_select on public.message_reactions
for select to authenticated
using (exists (
  select 1 from public.messages m
  where m.id = message_reactions.message_id
    and public.is_conversation_member(m.conversation_id)
));

drop policy if exists message_reactions_insert on public.message_reactions;
create policy message_reactions_insert on public.message_reactions
for insert to authenticated
with check (
  user_id = auth.uid()
  and exists (
    select 1 from public.messages m
    where m.id = message_reactions.message_id
      and public.is_conversation_member(m.conversation_id)
  )
);

drop policy if exists message_reactions_update on public.message_reactions;
create policy message_reactions_update on public.message_reactions
for update to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

drop policy if exists message_reactions_delete on public.message_reactions;
create policy message_reactions_delete on public.message_reactions
for delete to authenticated
using (user_id = auth.uid());

revoke all on public.message_reactions from anon;

-- ===================================================================
-- 2. Pinned messages - any conversation member can pin/unpin (matches
-- Messenger's group-chat behavior; symmetric in a 1:1 chat either way),
-- one row per message (a message is either pinned or it isn't, so no
-- pin history is kept - unpinning just deletes the row).
-- ===================================================================

create table if not exists public.pinned_messages (
  message_id uuid primary key references public.messages(id) on delete cascade,
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  pinned_by uuid not null references public.profiles(id) on delete cascade,
  pinned_at timestamptz not null default now()
);

alter table public.pinned_messages enable row level security;

drop policy if exists pinned_messages_select on public.pinned_messages;
create policy pinned_messages_select on public.pinned_messages
for select to authenticated
using (public.is_conversation_member(conversation_id));

drop policy if exists pinned_messages_insert on public.pinned_messages;
create policy pinned_messages_insert on public.pinned_messages
for insert to authenticated
with check (public.is_conversation_member(conversation_id) and pinned_by = auth.uid());

drop policy if exists pinned_messages_delete on public.pinned_messages;
create policy pinned_messages_delete on public.pinned_messages
for delete to authenticated
using (public.is_conversation_member(conversation_id));

revoke all on public.pinned_messages from anon;

-- ===================================================================
-- 3. Forwarding - a forwarded message is just a new messages row in the
-- destination conversation (sender = whoever forwarded it, matching
-- Messenger's own attribution), tagged with which message it came from
-- so the client can render the "Forwarded" label. Attachments are
-- copied into the destination conversation's own Storage folder by the
-- client (see messages/script.js's forwardMessageTo()) rather than reused
-- in place, since message_attachments_select scopes read access to
-- whichever conversation a file's folder name says it belongs to - a
-- copy is what makes it actually readable by the new conversation's
-- members.
-- ===================================================================

alter table public.messages add column if not exists forwarded_from_message_id uuid references public.messages(id) on delete set null;

-- ===================================================================
-- 4. Remove for Everyone - sender-only, enforced by extending
-- guard_message_update() (from 20260719020000) rather than just RLS,
-- since RLS here can only gate "is a conversation member", not "is the
-- sender" for an update whose USING/WITH CHECK is shared with the
-- mark-as-read policy. The trigger already blocks non-senders from
-- touching content/sender_id/conversation_id/created_at; these three
-- columns join that same protected set.
-- ===================================================================

alter table public.messages add column if not exists removed_for_everyone boolean not null default false;
alter table public.messages add column if not exists removed_by uuid references public.profiles(id);
alter table public.messages add column if not exists removed_at timestamptz;

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
       or new.created_at is distinct from old.created_at
       or new.removed_for_everyone is distinct from old.removed_for_everyone
       or new.removed_by is distinct from old.removed_by
       or new.removed_at is distinct from old.removed_at then
      raise exception 'Only the sender may edit or remove a message; other members may only mark it read.';
    end if;
  end if;
  return new;
end;
$$;

-- trigger already exists (trg_guard_message_update, before update on
-- messages) and just picks up the new function body - no need to
-- recreate it.

-- ===================================================================
-- 5. Remove for Me - per-user, per-message hide. Deliberately separate
-- from conversation_settings (that table is per-conversation; this is
-- per-message) and from removed_for_everyone (that's sender-only and
-- visible to everyone as a placeholder; this is a private, one-way
-- hide - no "undo" is offered, matching the spec).
-- ===================================================================

create table if not exists public.message_removals (
  message_id uuid not null references public.messages(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  removed_at timestamptz not null default now(),
  primary key (message_id, user_id)
);

alter table public.message_removals enable row level security;

drop policy if exists message_removals_select on public.message_removals;
create policy message_removals_select on public.message_removals
for select to authenticated
using (user_id = auth.uid());

drop policy if exists message_removals_insert on public.message_removals;
create policy message_removals_insert on public.message_removals
for insert to authenticated
with check (
  user_id = auth.uid()
  and exists (
    select 1 from public.messages m
    where m.id = message_removals.message_id
      and public.is_conversation_member(m.conversation_id)
  )
);

revoke all on public.message_removals from anon;

-- ===================================================================
-- 6. Message-level reports - message_reports (20260719030000) was built
-- for reporting a USER (from the conversation options menu); the
-- per-message Report action needs to record WHICH message triggered it
-- too. Nullable and reuses the same table/RLS rather than a parallel
-- one, since a message report is really just a user report with extra
-- context - reported_user_id is still set (to the message's sender) so
-- every existing admin-side query keeps working unchanged.
-- ===================================================================

alter table public.message_reports add column if not exists message_id uuid references public.messages(id) on delete set null;

-- ===================================================================
-- 7. Realtime - reactions/pins need to reach every open Messages page
-- instantly, same as messages/conversation_settings/user_blocks already
-- do. message_removals is deliberately NOT added - "remove for me" only
-- ever affects the acting user's own client, which already has the
-- result the moment its own insert succeeds.
-- ===================================================================

do $$
begin
  alter publication supabase_realtime add table public.message_reactions;
exception when duplicate_object then
  null;
end $$;

do $$
begin
  alter publication supabase_realtime add table public.pinned_messages;
exception when duplicate_object then
  null;
end $$;

notify pgrst, 'reload schema';
