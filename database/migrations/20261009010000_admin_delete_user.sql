-- Registered Users "Delete": a database function instead of an Edge Function.
--
-- Why: the permanently-erase-account Edge Function was never deployed to
-- this Supabase project (every /functions/v1/* path returns 404), so the
-- browser's request never reached anything - "Couldn't reach the account
-- deletion service". This replaces it with a SECURITY DEFINER function the
-- page calls through supabase.rpc(): nothing to deploy separately, and the
-- whole delete runs in ONE transaction, so it can never be half-done (the
-- Edge Function deleted the login first and cleaned up afterwards).
--
-- What a delete does (unchanged from the Edge Function's design):
--   - deletes the auth.users row -> frees the email in Supabase Auth;
--   - profiles.id is ON DELETE CASCADE -> the profile, its unique student
--     number, and any single-holder position it held are released;
--   - personal state (conversation membership, reactions, blocks,
--     notifications, settings) is CASCADE-deleted; shared/historical
--     records (messages, announcements, submissions, requests, feedback,
--     documents, reports, audit logs) are kept with the owner column set
--     to NULL, which the UI shows without a name. They are linked by the
--     old UUID only, so a later re-registration (new UUID) can't inherit them.

/* ---------- 1. updated_by stampers: keep the value during system operations ----------
   These BEFORE UPDATE triggers set updated_by := auth.uid(). When a user is
   deleted, the FK cascade updates their rows (e.g. requests.user_id -> NULL)
   with no end-user in context, which used to overwrite updated_by - "which
   OSOA EB processed this request" - with NULL. coalesce() keeps the existing
   value in that case; every normal app update (auth.uid() present) behaves
   exactly as before. */

create or replace function public.requests_set_updated_by()
returns trigger language plpgsql security definer set search_path to 'public'
as $function$
begin
  new.updated_by := coalesce(auth.uid(), new.updated_by);
  return new;
end;
$function$;

create or replace function public.feedback_set_updated_by()
returns trigger language plpgsql security definer set search_path to 'public'
as $function$
begin
  new.updated_by := coalesce(auth.uid(), new.updated_by);
  return new;
end;
$function$;

create or replace function public.repository_files_set_updated_by()
returns trigger language plpgsql security definer set search_path to 'public'
as $function$
begin
  new.updated_by := coalesce(auth.uid(), new.updated_by);
  return new;
end;
$function$;

-- Body identical to the live version except the final stamp.
create or replace function public.guard_report_fields()
returns trigger language plpgsql security definer set search_path to 'public'
as $function$
begin
  if auth.uid() is not null then
    if (
      new.report_title is distinct from old.report_title
      or new.report_type is distinct from old.report_type
      or new.specified_type is distinct from old.specified_type
      or new.report_details is distinct from old.report_details
      or new.recipient_type is distinct from old.recipient_type
      or new.recipient_position is distinct from old.recipient_position
      or new.attachment_file_name is distinct from old.attachment_file_name
      or new.attachment_file_path is distinct from old.attachment_file_path
      or new.attachment_file_type is distinct from old.attachment_file_type
      or new.attachment_file_size is distinct from old.attachment_file_size
    ) then
      if old.reporter_id is distinct from auth.uid() then
        raise exception 'Only the reporter may edit this report.';
      end if;
      if old.status <> 'submitted' then
        raise exception 'This report can no longer be edited once the recipient has started processing it.';
      end if;
    end if;
    if (
      new.status is distinct from old.status
      or new.remarks is distinct from old.remarks
    ) then
      if not public.is_report_recipient(old.id) then
        raise exception 'Only the assigned recipient may update this report''s status.';
      end if;
    end if;
  end if;
  new.updated_by := coalesce(auth.uid(), new.updated_by);
  return new;
end;
$function$;

/* ---------- 2. admin_delete_user ----------
   Errors carry a machine-readable HINT the page maps to a message:
   not_authenticated, forbidden, invalid_target, self_delete, not_found,
   last_admin, db_error. */

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

  -- Trusted role data from the database - never from the request.
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

  -- Row lock: a second, concurrent delete of the same user waits here and
  -- then finds nothing (not_found) instead of racing.
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

    -- Authorization is done. Run the cascade as a system operation (no
    -- end-user in context), exactly as Supabase's Admin API deleteUser()
    -- would: per-row guards such as guard_message_update ("only the sender
    -- may edit a message") must not treat the FK's sender_id -> NULL as the
    -- admin editing someone else's message. Transaction-local; reverted
    -- automatically if anything below fails.
    perform set_config('request.jwt.claim.sub', '', true);
    perform set_config('request.jwt.claims', '', true);

    delete from auth.users where id = p_user_id;
    -- Normally already gone via the cascade; also covers a profile whose
    -- login was missing, so its student number is genuinely released.
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

/* ---------- 3. Let an active OSOA EB remove a deleted user's avatar ----------
   Storage rows can't be deleted from SQL (storage.protect_delete), so the
   page removes profile-images/<id>/avatar.jpg through the Storage API right
   after the delete succeeds. Existing policy only allows a user's own
   folder; this adds the administrator case. */

drop policy if exists profile_images_delete_admin on storage.objects;
create policy profile_images_delete_admin on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'profile-images'
    and exists (
      select 1 from public.profiles
      where id = auth.uid() and role = 'osoa_eb' and status = 'active'
    )
  );
