-- LINGKOD Meneses - Supabase Storage for Submission & Tracking documents.
--
-- Wires up real file upload/retrieval: a private bucket, storage RLS
-- (only the submitter and osoa_eb can read/write a given file), and the
-- submissions columns needed to locate + re-sign a file on demand. Signed
-- URLs are generated client-side on demand (see submission/script.js) and
-- never stored in the database, since a stored URL would go stale the
-- moment it expires - only the permanent `file_path` is persisted.
-- Safe to run more than once.

-- ===================================================================
-- 1. Bucket. Private (public=false) - every read goes through a signed
-- URL, gated by the storage RLS policies below. No public/anon access.
-- ===================================================================

insert into storage.buckets (id, name, public)
values ('submission-documents', 'submission-documents', false)
on conflict (id) do nothing;

-- ===================================================================
-- 2. submissions columns to locate the file. The earlier `file_url`
-- column is left in place (harmless, unused) rather than dropped - new
-- uploads populate file_path instead and a signed URL is generated fresh
-- on every preview/download request.
-- ===================================================================

alter table public.submissions add column if not exists file_name text;
alter table public.submissions add column if not exists file_path text;
alter table public.submissions add column if not exists storage_bucket text default 'submission-documents';
alter table public.submissions add column if not exists file_type text;
alter table public.submissions add column if not exists file_size bigint;
alter table public.submissions add column if not exists uploaded_at timestamptz;

-- ===================================================================
-- 3. Storage RLS - mirrors submissions_select/submissions_insert: the
-- uploader (storage.objects.owner is auto-set to auth.uid() on upload)
-- can always read/write their own files; osoa_eb can read (review /
-- download) every file in this bucket for their approval queue.
-- ===================================================================

drop policy if exists "submission_documents_insert" on storage.objects;
drop policy if exists "submission_documents_select" on storage.objects;

create policy "submission_documents_insert"
  on storage.objects for insert
  to authenticated
  with check (bucket_id = 'submission-documents' and owner = auth.uid());

create policy "submission_documents_select"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'submission-documents'
    and (
      owner = auth.uid()
      or exists (
        select 1 from public.profiles p
        where p.id = auth.uid() and p.role = 'osoa_eb'
      )
    )
  );
