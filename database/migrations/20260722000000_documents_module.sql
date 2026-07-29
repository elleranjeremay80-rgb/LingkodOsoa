-- LINGKOD Meneses - Documents page: a distinct module from the existing
-- Digital Repository (public-files bucket / repository_files table).
-- Repository is general-purpose org file storage; Documents is formal
-- official-document management with a stricter category taxonomy and
-- per-uploader (not per-organization) edit/delete rights - deliberately
-- its own table and bucket rather than reusing Repository's, since the
-- permission model genuinely differs (Repository currently lets any
-- osoa_eb/org_president edit or delete *any* file; Documents only ever
-- lets an org_president touch what they personally uploaded).
-- Safe to run more than once.

create table if not exists public.documents (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  category text not null check (category in (
    'memorandum', 'resolution', 'financial_report', 'policy',
    'form', 'organization_document', 'other'
  )),
  organization text,
  status text not null default 'active' check (status in ('active', 'archived')),
  file_name text not null,
  file_url text not null,
  file_size bigint,
  file_type text,
  storage_bucket text not null default 'official-documents',
  uploaded_by uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists documents_category_idx on public.documents (category);
create index if not exists documents_uploaded_by_idx on public.documents (uploaded_by);

drop trigger if exists set_documents_updated_at on public.documents;
create trigger set_documents_updated_at
  before update on public.documents
  for each row execute function public.set_updated_at();

alter table public.documents enable row level security;

-- Every authenticated user (OSOA EB, Org President, Student alike) can
-- browse, search, preview, and download - matches "Preview/Download" being
-- available to all three roles with no restriction.
drop policy if exists documents_select on public.documents;
create policy documents_select on public.documents
for select to authenticated
using (true);

drop policy if exists documents_insert on public.documents;
create policy documents_insert on public.documents
for insert to authenticated
with check (
  uploaded_by = auth.uid()
  and exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.role in ('osoa_eb', 'org_president')
  )
);

-- osoa_eb may update/delete any document; org_president only the ones they
-- personally uploaded (uploaded_by = auth.uid(), not merely same
-- organization) - "Edit their own uploads" / "Delete their own uploads",
-- read literally.
drop policy if exists documents_update on public.documents;
create policy documents_update on public.documents
for update to authenticated
using (
  exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'osoa_eb')
  or uploaded_by = auth.uid()
)
with check (
  exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'osoa_eb')
  or uploaded_by = auth.uid()
);

drop policy if exists documents_delete on public.documents;
create policy documents_delete on public.documents
for delete to authenticated
using (
  exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'osoa_eb')
  or uploaded_by = auth.uid()
);

revoke all on public.documents from anon;

-- Public bucket (same reasoning as Repository's public-files and the
-- project cover images: these are meant to be freely previewed/downloaded
-- by every signed-in role, not gated to a specific reader).
insert into storage.buckets (id, name, public, file_size_limit)
values ('official-documents', 'official-documents', true, 26214400) -- 25 MB
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit;

drop policy if exists official_documents_select on storage.objects;
create policy official_documents_select on storage.objects
for select
using (bucket_id = 'official-documents');

drop policy if exists official_documents_insert on storage.objects;
create policy official_documents_insert on storage.objects
for insert to authenticated
with check (
  bucket_id = 'official-documents'
  and exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.role in ('osoa_eb', 'org_president')
  )
);

drop policy if exists official_documents_delete on storage.objects;
create policy official_documents_delete on storage.objects
for delete to authenticated
using (
  bucket_id = 'official-documents'
  and exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.role in ('osoa_eb', 'org_president')
  )
);

do $$
begin
  alter publication supabase_realtime add table public.documents;
exception when duplicate_object then
  null;
end $$;

notify pgrst, 'reload schema';
