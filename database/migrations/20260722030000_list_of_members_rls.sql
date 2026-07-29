-- LINGKOD Meneses - "List of Members" page: lets osoa_eb browse every
-- registered member, and org_president browse only members of their own
-- organization. Every column the page needs (username, department,
-- contact_number, status, avatar_url, created_at, etc.) already exists on
-- public.profiles from earlier migrations - this migration only adds the
-- RLS policy that makes cross-user reads possible for these two roles.
--
-- Directory already queries every profile successfully today, which means
-- some broad "authenticated can read all profiles" policy already exists
-- live in this project - but it isn't captured in any migration file here
-- (same "hand-patched live" situation documented for several other
-- tables), so it can't be relied on or reproduced from this repo alone.
-- Rather than assume it exists (or matches the access matrix this page
-- actually needs), this adds an explicit, correctly-scoped policy of its
-- own: RLS policies are OR'd together, so this is purely additive and
-- can't reduce access anyone already has.
--
-- A policy DEFINED on public.profiles cannot safely subquery
-- public.profiles directly to check the caller's own row (every other
-- table's RLS in this codebase does exactly that against profiles, but
-- always from a *different* table's policy - doing it from profiles' own
-- policy makes Postgres re-evaluate profiles' RLS to answer the subquery,
-- which re-triggers the same policy, forever: "infinite recursion
-- detected in policy for relation profiles"). The fix is the same
-- technique already used for profile_visibility_allowed() elsewhere in
-- this codebase: a `security definer` function performs the self-lookup
-- with the function owner's privileges, bypassing RLS for that one
-- internal read, so there's nothing left to recurse into.

-- Dropped first (rather than a plain CREATE OR REPLACE) because a prior
-- attempt at this migration may have left a same-named function behind
-- with a different return type - CREATE OR REPLACE can't change that,
-- only DROP + CREATE can.
drop function if exists public.current_profile_role();
drop function if exists public.current_profile_organization();

create function public.current_profile_role()
returns text
language sql
security definer
set search_path = public
stable
as $$
  select role from public.profiles where id = auth.uid();
$$;

create function public.current_profile_organization()
returns text
language sql
security definer
set search_path = public
stable
as $$
  select organization from public.profiles where id = auth.uid();
$$;

grant execute on function public.current_profile_role() to authenticated;
grant execute on function public.current_profile_organization() to authenticated;

alter table public.profiles enable row level security;

drop policy if exists "profiles_admin_org_select" on public.profiles;

create policy "profiles_admin_org_select"
  on public.profiles for select
  to authenticated
  using (
    public.current_profile_role() = 'osoa_eb'
    or (
      public.current_profile_role() = 'org_president'
      and public.current_profile_organization() = profiles.organization
    )
  );

notify pgrst, 'reload schema';
