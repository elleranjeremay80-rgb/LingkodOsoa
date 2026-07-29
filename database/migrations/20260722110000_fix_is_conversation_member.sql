-- LINGKOD Meneses - fixes "You don't have permission to upload to this
-- conversation." when attaching a file in Messages.
--
-- public.is_conversation_member(uuid) is referenced by three separate
-- migrations (20260719020000, 20260719030000, 20260719040000) and by the
-- message-attachments Storage policies below, but its own CREATE FUNCTION
-- never appears in this migrations folder anywhere - exactly the same
-- "created directly against the live project" gap that's caused every
-- other RLS bug fixed this session (missing GRANT SELECT on profiles, the
-- profiles_admin_org_select recursion, etc.). Conversations/messages
-- themselves still work today, so the function isn't entirely missing -
-- but this (re)creates it as an explicit, known-correct, security definer
-- function rather than continuing to rely on whatever's live and
-- unverified, and makes sure `authenticated` can actually execute it.
--
-- security definer matters here specifically: without it, a call from
-- inside the Storage policy runs as the caller, meaning it's subject to
-- conversation_members' OWN RLS while checking membership - if that
-- table's policies themselves lean on is_conversation_member() (the
-- messaging migrations' own comments describe exactly this kind of
-- circularity for the "add the other person" insert case), the check can
-- come back false even for a real member. Security definer breaks that
-- by evaluating the membership row directly, bypassing RLS for this one
-- internal read - same fix shape as every other RLS bug this session.

-- Parameter is named target_conversation, not p_conversation_id, to match
-- whatever the live project's original (never-migrated) definition
-- already called it - CREATE OR REPLACE FUNCTION can change a function's
-- body freely, but not an existing parameter's name, so guessing wrong
-- here fails with "cannot change name of input parameter" instead of
-- silently doing nothing. Every caller passes this argument
-- positionally (never by name), so the name itself is invisible to them
-- either way.
create or replace function public.is_conversation_member(target_conversation uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from public.conversation_members cm
    where cm.conversation_id = target_conversation
      and cm.profile_id = auth.uid()
  );
$$;

grant execute on function public.is_conversation_member(uuid) to authenticated;

notify pgrst, 'reload schema';
