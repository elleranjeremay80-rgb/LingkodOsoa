-- LINGKOD Meneses - Organization Information section (List of Organizations
-- page: name -> Organization Information card -> stats row).
--
-- Column naming: kept consistent with the columns organizations already
-- has (name, description, logo_url, theme_color - no "organization_"
-- prefix, since that's redundant on this table) rather than the literal
-- organization_name/organization_description names sometimes used in specs
-- - renaming the existing name/description columns would break every page
-- that already reads them (list-of-members, directory).
--
-- acronym/category/president_name/adviser/member_count/the four social
-- links are new. updated_at/updated_by are trigger-maintained (see below),
-- not client-writable, so a caller can't spoof who made a change.

alter table public.organizations add column if not exists acronym text;
alter table public.organizations add column if not exists category text
  check (category is null or category in ('Academic', 'Civic', 'Religious', 'Sports', 'Cultural', 'Special Interest'));
alter table public.organizations add column if not exists president_name text;
alter table public.organizations add column if not exists adviser text;
alter table public.organizations add column if not exists member_count integer
  check (member_count is null or member_count > 0);
alter table public.organizations add column if not exists facebook_url text
  check (facebook_url is null or facebook_url ~* '^https?://');
alter table public.organizations add column if not exists instagram_url text
  check (instagram_url is null or instagram_url ~* '^https?://');
alter table public.organizations add column if not exists twitter_url text
  check (twitter_url is null or twitter_url ~* '^https?://');
alter table public.organizations add column if not exists tiktok_url text
  check (tiktok_url is null or tiktok_url ~* '^https?://');
alter table public.organizations add column if not exists website_url text
  check (website_url is null or website_url ~* '^https?://');
alter table public.organizations add column if not exists updated_at timestamptz;
alter table public.organizations add column if not exists updated_by uuid references public.profiles(id) on delete set null;

-- ===================================================================
-- updated_at/updated_by: own trigger function (not the shared
-- public.set_updated_at(), which only touches updated_at) so both are
-- stamped together from auth.uid() - the client never sends either.
-- ===================================================================

create or replace function public.set_organizations_updated_meta()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.updated_at = now();
  new.updated_by = auth.uid();
  return new;
end;
$$;

drop trigger if exists set_organizations_updated_meta on public.organizations;
create trigger set_organizations_updated_meta
  before update on public.organizations
  for each row execute function public.set_organizations_updated_meta();

-- ===================================================================
-- Grants: organizations already has a working RLS policy for who's
-- allowed to write (organizations_update, from 20260722070000 -
-- osoa_eb any organization, org_president their own only via
-- current_user_can_manage_organization()) which already covers every
-- column on the row, including these new ones - no RLS change needed.
-- The only existing column-level grant on this table is
-- `update (logo_url)`, from before organizations had any other
-- editable fields; widened here to also cover the fields this new
-- Organization Information editor actually writes. Belt-and-suspenders
-- with whatever default public-schema privileges this project already
-- has - harmless if those already cover it, required if they don't.
-- ===================================================================

grant update (
  name, acronym, category, description, president_name, adviser, member_count,
  facebook_url, instagram_url, twitter_url, tiktok_url, website_url
) on public.organizations to authenticated;

-- ===================================================================
-- Realtime: organizations was never added to the publication despite
-- list-of-members/script.js already subscribing to it - that
-- subscription has been a silent no-op. The page's own save handler
-- applies its own optimistic local update regardless (so saving your
-- own edit always reflects immediately with no dependency on this),
-- but this is what makes a *second* concurrent viewer (e.g. another
-- OSOA EB member) see the change live too.
-- ===================================================================

do $$
begin
  alter publication supabase_realtime add table public.organizations;
exception when duplicate_object then null;
end $$;

notify pgrst, 'reload schema';
