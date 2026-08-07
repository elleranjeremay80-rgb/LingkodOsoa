-- LINGKOD Meneses - permanent conversation deletion, for both parties.
--
-- Today's "Delete Conversation" (menuDeleteChat() in
-- frontend/pages/messages/script.js) only upserts is_deleted=true into
-- conversation_settings, scoped to the deleting user alone - the other
-- participant, the conversations/conversation_members/messages rows, and
-- any attachment files are all completely untouched. This is an
-- explicit, confirmed decision to replace that with real, irreversible
-- deletion for both participants.
--
-- conversations/conversation_members/messages were created directly
-- against the live project (per this session's earlier research - no
-- CREATE TABLE for any of the three exists anywhere in this repo, and no
-- migration grants authenticated DELETE on any of them). Rather than
-- guess at unknown RLS and risk a silently-blocked client-side delete,
-- this is a single security definer RPC that bypasses table RLS
-- entirely and re-implements the one check that actually matters itself
-- (caller must be a member of the conversation being deleted).
--
-- Order of operations: messages -> conversation_members -> conversations.
-- conversation_settings/pinned_messages already cascade on
-- conversations.id (confirmed: conversation_settings.conversation_id at
-- 20260719030000_messaging_conversation_options.sql:18, pinned_messages.
-- conversation_id at 20260728020000_message_reactions_pins_forward_
-- removal.sql:70) and message_reactions/message_removals already cascade
-- on messages.id - so deleting messages/conversations explicitly is
-- enough; conversation_members' own cascade behavior was never
-- confirmed anywhere in this repo, so it's deleted explicitly too rather
-- than assumed.
--
-- Storage cleanup (message-attachments bucket) is NOT done here - a raw
-- SQL delete against storage.objects doesn't reliably remove the actual
-- file from the storage backend, only the metadata row (a known Supabase
-- limitation) - same reasoning every other Storage cleanup in this
-- codebase already follows (repository/requests/documents all delete
-- the DB row first, then call the real Storage API client-side). This
-- function instead collects and returns every attachment's file_path
-- before deleting, so the caller can remove the actual objects via
-- supabaseClient.storage...remove() after this RPC succeeds.

create or replace function public.hard_delete_conversation(p_conversation_id uuid)
returns text[]
language plpgsql
security definer
set search_path = public
as $$
declare
  v_is_member boolean;
  v_attachment_paths text[];
begin
  select exists(
    select 1 from public.conversation_members cm
    where cm.conversation_id = p_conversation_id and cm.profile_id = auth.uid()
  ) into v_is_member;

  if not v_is_member then
    raise exception 'You are not a member of this conversation.';
  end if;

  select array_agg(m.file_path) into v_attachment_paths
  from public.messages m
  where m.conversation_id = p_conversation_id and m.file_path is not null;

  delete from public.messages where conversation_id = p_conversation_id;
  delete from public.conversation_members where conversation_id = p_conversation_id;
  delete from public.conversations where id = p_conversation_id;

  return coalesce(v_attachment_paths, array[]::text[]);
end;
$$;

grant execute on function public.hard_delete_conversation(uuid) to authenticated;
