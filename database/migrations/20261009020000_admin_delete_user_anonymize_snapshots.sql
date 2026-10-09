-- admin_delete_user(): also anonymize the deleted user's *copied* identity
-- on the historical records they owned.
--
-- Why: clearing the owner column (ON DELETE SET NULL) isn't enough for
-- tables that store a snapshot of the person's name/contact details when
-- the row was written - requests.full_name / student_number,
-- feedback.full_name / email, reports.reporter_name,
-- documents.uploaded_by_name, document_activity_log.actor_name. Those
-- kept showing the deleted person's name, email and student number. The
-- records themselves are kept (organizational documentation); only the
-- identifying text is replaced with "Deleted User" (or cleared).
--
-- Each UPDATE also nulls the owner column itself, so the FK cascade that
-- follows finds nothing left to change (one trigger run per row, not two -
-- e.g. a single document_activity_log 'edit' entry instead of two).
-- Runs after the end-user context is cleared, like the delete itself, so
-- per-row guards/stampers treat it as the system operation it is.
-- Everything else is identical to 20261009010000_admin_delete_user.sql.

create or replace function public.admin_delete_user(p_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_caller uuid := auth.uid();
  v_caller_role public.user_role;
  v_caller_status public.profile_status;
  v_target public.profiles%rowtype;
  v_has_login boolean;
begin
  if v_caller is null then
    raise exception 'You are not logged in. Please log in again and retry.'
      using errcode = 'P0001', hint = 'not_authenticated';
  end if;

  select role, status into v_caller_role, v_caller_status
  from public.profiles where id = v_caller;
  if v_caller_role is distinct from 'osoa_eb' or v_caller_status is distinct from 'active' then
    raise exception 'Only active OSOA Executive Board accounts can delete registered users.'
      using errcode = 'P0001', hint = 'forbidden';
  end if;

  if p_user_id is null then
    raise exception 'A valid user ID is required.' using errcode = 'P0001', hint = 'invalid_target';
  end if;
  if p_user_id = v_caller then
    raise exception 'You cannot delete your own administrator account.'
      using errcode = 'P0001', hint = 'self_delete';
  end if;

  select * into v_target from public.profiles where id = p_user_id for update;
  select exists (select 1 from auth.users where id = p_user_id) into v_has_login;
  if v_target.id is null and not v_has_login then
    raise exception 'This user no longer exists. The list will refresh.'
      using errcode = 'P0001', hint = 'not_found';
  end if;

  if v_target.role = 'osoa_eb' and not exists (
    select 1 from public.profiles
    where role = 'osoa_eb' and status = 'active' and id <> p_user_id
  ) then
    raise exception 'At least one OSOA Executive Board account must remain active.'
      using errcode = 'P0001', hint = 'last_admin';
  end if;

  begin
    insert into public.audit_logs (actor_id, action, target_table, target_id, details)
    values (
      v_caller, 'user.delete', 'profiles', p_user_id,
      jsonb_build_object(
        'full_name', coalesce(v_target.full_name, 'Unlinked account'),
        'role', v_target.role,
        'organization', v_target.organization
      )
    );

    -- Authorization is done; run the rest as a system operation (see
    -- 20261009010000_admin_delete_user.sql for why guard_message_update
    -- requires this). Transaction-local.
    perform set_config('request.jwt.claim.sub', '', true);
    perform set_config('request.jwt.claims', '', true);

    -- Anonymize identity snapshots on records this user owned.
    update public.requests
       set full_name = 'Deleted User', student_number = null, user_id = null
     where user_id = p_user_id;
    update public.feedback
       set full_name = 'Deleted User', email = null, user_id = null
     where user_id = p_user_id;
    update public.reports
       set reporter_name = 'Deleted User', reporter_id = null
     where reporter_id = p_user_id;
    update public.documents
       set uploaded_by_name = 'Deleted User', uploaded_by = null
     where uploaded_by = p_user_id;
    update public.document_activity_log
       set actor_name = 'Deleted User', actor_id = null
     where actor_id = p_user_id;

    delete from auth.users where id = p_user_id;
    delete from public.profiles where id = p_user_id;
  exception
    when others then
      raise warning 'admin_delete_user(%) failed: % %', p_user_id, sqlstate, sqlerrm;
      raise exception 'The database could not delete this account. No changes were made.'
        using errcode = 'P0001', hint = 'db_error';
  end;

  return jsonb_build_object('success', true, 'deleted_user_id', p_user_id);
end;
$function$;

revoke all on function public.admin_delete_user(uuid) from public, anon;
grant execute on function public.admin_delete_user(uuid) to authenticated;
