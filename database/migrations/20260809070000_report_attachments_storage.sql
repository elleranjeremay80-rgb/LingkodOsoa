-- LINGKOD Meneses - report-attachments Storage bucket. Private (only the
-- reporter and the report's resolved recipient can read), unlike every
-- existing bucket in this app: submission-documents gates on a blanket
-- role check, message-attachments on conversation membership - neither
-- fits a per-report, per-position recipient. Reuses can_view_report()
-- (previous migration) so the bucket and the reports table itself share
-- one single definition of "who's allowed to see this."
--
-- Path convention <uploaderId>/<timestamp>-<sanitized filename>, same as
-- submission-documents - the report's own row doesn't exist until AFTER
-- a successful upload (upload-then-insert, so a failed upload never
-- leaves an orphan report row), so the path can't be keyed on the
-- report's id the way message-attachments keys on an already-existing
-- conversation id.
--
-- Safe to run more than once.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'report-attachments', 'report-attachments', false, 20971520,
  array['application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document']
)
on conflict (id) do nothing;

drop policy if exists report_attachments_insert on storage.objects;
create policy report_attachments_insert on storage.objects
for insert to authenticated
with check (
  bucket_id = 'report-attachments'
  and (storage.foldername(name))[1] = auth.uid()::text
);

drop policy if exists report_attachments_select on storage.objects;
create policy report_attachments_select on storage.objects
for select to authenticated
using (
  bucket_id = 'report-attachments'
  and exists (
    select 1 from public.reports r
    where r.attachment_file_path = storage.objects.name
      and public.can_view_report(r.id)
  )
);

drop policy if exists report_attachments_delete on storage.objects;
create policy report_attachments_delete on storage.objects
for delete to authenticated
using (
  bucket_id = 'report-attachments'
  and (storage.foldername(name))[1] = auth.uid()::text
);

notify pgrst, 'reload schema';
