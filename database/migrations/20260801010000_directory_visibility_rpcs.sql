-- LINGKOD Meneses - Directory role-based visibility, enforced server-side.
--
-- Deliberately NOT implemented as a rewrite of profiles'/organization_
-- officers' own SELECT RLS policies: both tables are shared
-- infrastructure well beyond Directory (profiles is read by Messages'
-- cross-org account search, Reports' reported-user modal, Registered
-- Users, List of Members - none of which should suddenly lose the
-- ability to look up a profile outside the caller's own organization).
-- Narrowing the shared policy would risk breaking all of those. Instead,
-- two new security definer RPCs return exactly the rows Directory's
-- visibility rule allows for the calling user, leaving every existing
-- policy on both base tables completely untouched.
--
-- Visibility rule (matches the requested spec):
--   osoa_eb        - every organization's full roster.
--   org_president,
--   student (Member) - the OSOA EB panel, every organization's
--                       President, and their OWN organization's full
--                       roster (officers + members). Nothing else.
--
-- "Which profiles rows count as a President" reuses this session's
-- established idiom throughout (role = 'org_president'); "which
-- organization_officers rows count as a President" is derived from
-- organization_positions.system_role for that (organization_id,
-- position) pair, since organization_officers is a free-text roster
-- with no role column of its own - same join organization_officers'
-- own president/officer detection already uses elsewhere in this app.

create or replace function public.get_directory_visible_profiles()
returns setof public.profiles
language sql
security definer
set search_path = public
stable
as $$
  select p.*
  from public.profiles p
  where exists (
    select 1 from public.profiles me
    where me.id = auth.uid()
      and (
        me.role = 'osoa_eb'
        or p.role = 'osoa_eb'
        or p.role = 'org_president'
        or (me.organization_id is not null and p.organization_id = me.organization_id)
      )
  );
$$;

grant execute on function public.get_directory_visible_profiles() to authenticated;

create or replace function public.get_directory_visible_officers()
returns setof public.organization_officers
language sql
security definer
set search_path = public
stable
as $$
  select o.*
  from public.organization_officers o
  where exists (
    select 1 from public.profiles me
    where me.id = auth.uid()
      and (
        me.role = 'osoa_eb'
        or exists (select 1 from public.organizations org where org.id = o.organization_id and org.slug = 'osoa-meneses')
        or (me.organization_id is not null and o.organization_id = me.organization_id)
        or exists (
          select 1 from public.organization_positions op
          where op.organization_id = o.organization_id
            and op.position_name = o.position
            and op.system_role = 'org_president'
        )
      )
  );
$$;

grant execute on function public.get_directory_visible_officers() to authenticated;
