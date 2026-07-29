-- LINGKOD Meneses - Messages page: real file attachments (Supabase
-- Storage) and per-user emoji recency/frequency tracking.

-- ===================================================================
-- 1. Attachment columns on messages. Named to exactly match the
-- file_name/file_path/file_type/file_size/storage_bucket shape every
-- other module (Submission & Tracking, Digital Repository, dashboard
-- previews) already uses - see lingkodGetSignedFileUrl/lingkodDownloadFile/
-- lingkodBuildFileInfoCell in js/common.js - so messages can reuse that
-- same shared preview/download/signed-URL infrastructure unmodified,
-- rather than inventing a second one.
-- ===================================================================

alter table public.messages add column if not exists file_name text;
alter table public.messages add column if not exists file_path text;
alter table public.messages add column if not exists file_type text;
alter table public.messages add column if not exists file_size bigint;
alter table public.messages add column if not exists storage_bucket text;

-- A message can now be attachment-only (no text) - make sure content
-- isn't blocking that. Safe to run even if it's already nullable.
alter table public.messages alter column content drop not null;

-- Defense in depth alongside the client-side check: a message needs a
-- non-blank text body, an attachment, or both - never neither.
alter table public.messages drop constraint if exists messages_not_empty;
alter table public.messages add constraint messages_not_empty
  check (coalesce(nullif(trim(content), ''), '') <> '' or file_path is not null) not valid;

-- ===================================================================
-- 2. Storage bucket. Private (not public) - same reasoning as the
-- submission-documents bucket: attachments are only ever reached through
-- a signed URL generated for someone who already passed the RLS check
-- below, never a guessable public link. file_size_limit/allowed_mime_types
-- are enforced by Storage itself, not just the client.
-- ===================================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'message-attachments',
  'message-attachments',
  false,
  26214400, -- 25 MB
  array[
    'image/jpeg','image/png','image/gif','image/webp',
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-powerpoint',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'text/plain',
    'video/mp4','video/quicktime','video/x-msvideo',
    'application/zip','application/x-zip-compressed',
    'application/vnd.rar','application/x-rar-compressed'
  ]
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- Objects are uploaded to "<conversation_id>/<uuid>-<filename>" - the
-- first path segment is the conversation, checked against membership via
-- the same public.is_conversation_member(uuid) the rest of messaging
-- already relies on. Only conversation members can upload, read (needed
-- for signed URLs), or remove an attachment - matches "users may only
-- access attachments belonging to conversations they participate in."

drop policy if exists message_attachments_insert on storage.objects;
create policy message_attachments_insert on storage.objects
for insert to authenticated
with check (
  bucket_id = 'message-attachments'
  and public.is_conversation_member(((storage.foldername(name))[1])::uuid)
);

drop policy if exists message_attachments_select on storage.objects;
create policy message_attachments_select on storage.objects
for select to authenticated
using (
  bucket_id = 'message-attachments'
  and public.is_conversation_member(((storage.foldername(name))[1])::uuid)
);

-- Lets a user remove an attachment they just uploaded but haven't sent
-- yet (the composer's "Remove" button, and a cancelled upload).
drop policy if exists message_attachments_delete on storage.objects;
create policy message_attachments_delete on storage.objects
for delete to authenticated
using (
  bucket_id = 'message-attachments'
  and public.is_conversation_member(((storage.foldername(name))[1])::uuid)
);

-- ===================================================================
-- 3. Per-user emoji usage - backs both "Recently Used" (order by
-- last_used_at) and "Frequently Used" (order by use_count) from one
-- table, persisted server-side so it survives logout/login rather than
-- living in localStorage.
-- ===================================================================

create table if not exists public.emoji_usage (
  user_id uuid not null references public.profiles(id) on delete cascade,
  emoji text not null,
  use_count integer not null default 0,
  last_used_at timestamptz not null default now(),
  primary key (user_id, emoji)
);

alter table public.emoji_usage enable row level security;

drop policy if exists emoji_usage_select on public.emoji_usage;
create policy emoji_usage_select on public.emoji_usage
for select to authenticated
using (user_id = auth.uid());

revoke all on public.emoji_usage from anon;

-- Insert/update both go through this function rather than direct
-- table policies, so "select an emoji" is always a single atomic
-- increment-or-create instead of a client-side read-then-write race.
create or replace function public.increment_emoji_usage(p_emoji text)
returns void
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.emoji_usage (user_id, emoji, use_count, last_used_at)
  values (auth.uid(), p_emoji, 1, now())
  on conflict (user_id, emoji)
  do update set use_count = public.emoji_usage.use_count + 1, last_used_at = now();
end;
$$;

grant execute on function public.increment_emoji_usage(text) to authenticated;

-- ===================================================================
-- 4. Attachments need to reach every open Messages page instantly too -
-- messages itself is already registered (see the first messaging
-- migration); this just re-confirms it defensively since the new
-- columns are read through the same realtime rows.
-- ===================================================================

do $$
begin
  alter publication supabase_realtime add table public.messages;
exception when duplicate_object then
  null;
end $$;
