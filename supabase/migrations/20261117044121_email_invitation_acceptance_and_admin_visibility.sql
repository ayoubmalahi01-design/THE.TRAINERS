-- Recovered current-state invitation acceptance and read-visibility objects.
-- The original 2026-11-17 source was absent from the ZIP; definitions below were
-- reconciled against the live production functions and policy state on 2026-11-19.
-- Safe to run after THE_TRAINERS_SETUP.sql and INVITATIONS_OTP_INCREMENTAL.sql.

DROP POLICY IF EXISTS invitations_select_admin ON public.invitations;
DROP POLICY IF EXISTS invitations_read_admin ON public.invitations;
CREATE POLICY invitations_select_admin ON public.invitations FOR SELECT TO authenticated
USING (
  public.is_platform_owner()
  OR (
    institution_id = public.current_institution_id()
    AND public.current_app_role() IN ('manager','admin')
  )
);

-- Email invitation acceptance. The invitee must authenticate with the same
-- confirmed email address that received the invitation. New accounts remain pending
-- until a Manager/Owner completes the separate account review.
create or replace function public.my_pending_invitation()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_email text;
  v_email_confirmed_at timestamptz;
  v_row record;
begin
  if v_uid is null then return null; end if;
  select lower(coalesce(u.email, '')), u.email_confirmed_at
    into v_email, v_email_confirmed_at
    from auth.users u where u.id = v_uid;
  if coalesce(v_email, '') = '' or v_email_confirmed_at is null then return null; end if;
  select i.id, i.role, i.institution_id, i.invited_email, i.invited_name,
         i.delivery_method, i.expires_at, inst.name as institution_name
    into v_row
    from public.invitations i
    left join public.institutions inst on inst.id = i.institution_id
   where i.status = 'pending' and i.expires_at > now()
     and lower(coalesce(i.invited_email, '')) = v_email
   order by i.created_at desc, i.id desc limit 1;
  if not found then return null; end if;
  return jsonb_build_object(
    'id', v_row.id, 'role', v_row.role::text,
    'institution_id', v_row.institution_id,
    'institution_name', v_row.institution_name,
    'invited_email', v_row.invited_email,
    'invited_name', v_row.invited_name,
    'delivery_method', v_row.delivery_method::text,
    'expires_at', v_row.expires_at
  );
end;
$$;

create or replace function public.accept_email_invitation(p_invitation_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_auth_email text;
  v_email_confirmed_at timestamptz;
  v_inv public.invitations%rowtype;
  v_profile public.profiles%rowtype;
  v_keep_active boolean := false;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'error', 'authentication_required');
  end if;
  select lower(coalesce(u.email, '')), u.email_confirmed_at
    into v_auth_email, v_email_confirmed_at
    from auth.users u where u.id = v_uid;
  if not found or coalesce(v_auth_email, '') = '' or v_email_confirmed_at is null then
    return jsonb_build_object('ok', false, 'error', 'confirmed_email_required');
  end if;
  select * into v_inv from public.invitations where id = p_invitation_id for update;
  if not found then return jsonb_build_object('ok', false, 'error', 'invitation_not_found'); end if;
  if v_inv.delivery_method::text <> 'email'
     or lower(coalesce(v_inv.invited_email, '')) <> v_auth_email then
    return jsonb_build_object('ok', false, 'error', 'recipient_mismatch');
  end if;
  if v_inv.role is null or v_inv.role::text = 'owner' then
    return jsonb_build_object('ok', false, 'error', 'owner_role_forbidden');
  end if;
  if v_inv.status::text = 'accepted' then
    if v_inv.accepted_by = v_uid then
      return jsonb_build_object('ok', true, 'already_accepted', true,
        'user_id', v_uid, 'role', v_inv.role::text,
        'institution_id', v_inv.institution_id, 'account_status', 'pending');
    end if;
    return jsonb_build_object('ok', false, 'error', 'invitation_already_accepted');
  end if;
  if v_inv.status::text <> 'pending' then
    return jsonb_build_object('ok', false, 'error', 'invitation_not_pending');
  end if;
  if v_inv.expires_at is null or v_inv.expires_at <= now() then
    update public.invitations set status = 'expired', updated_at = now() where id = v_inv.id;
    return jsonb_build_object('ok', false, 'error', 'invitation_expired');
  end if;
  if v_inv.institution_id is null
     or not exists (select 1 from public.institutions i where i.id = v_inv.institution_id) then
    return jsonb_build_object('ok', false, 'error', 'institution_not_found');
  end if;
  select * into v_profile from public.profiles where id = v_uid for update;
  if not found then
    insert into public.profiles (id, email, full_name, role, institution_id, account_status, created_by)
    values (v_uid, v_auth_email, coalesce(v_inv.invited_name, ''),
      v_inv.role, v_inv.institution_id, 'pending', v_inv.inviter_id)
    on conflict (id) do nothing;
    select * into v_profile from public.profiles where id = v_uid for update;
  end if;
  if lower(coalesce(v_profile.email, '')) <> v_auth_email then
    return jsonb_build_object('ok', false, 'error', 'profile_email_mismatch');
  end if;
  if v_profile.role::text = 'owner' then
    return jsonb_build_object('ok', false, 'error', 'owner_protected');
  end if;
  if v_profile.account_status::text in ('suspended', 'rejected') then
    return jsonb_build_object('ok', false, 'error', 'account_not_eligible');
  end if;
  if v_profile.account_status::text = 'active' then
    if v_profile.institution_id is distinct from v_inv.institution_id
       or v_profile.role is distinct from v_inv.role then
      return jsonb_build_object('ok', false, 'error', 'active_account_conflict');
    end if;
    v_keep_active := true;
  elsif v_profile.account_status::text <> 'pending' then
    return jsonb_build_object('ok', false, 'error', 'account_not_eligible');
  end if;
  perform set_config('app.account_repair', 'on', true);
  update public.profiles
     set role = v_inv.role,
         institution_id = v_inv.institution_id,
         account_status = case when v_keep_active then 'active' else 'pending' end,
         full_name = coalesce(nullif(v_inv.invited_name, ''), full_name),
         email = v_auth_email,
         created_by = coalesce(created_by, v_inv.inviter_id),
         updated_at = now()
   where id = v_uid;
  perform set_config('app.account_repair', 'off', true);
  update public.invitations
     set status = 'accepted', accepted_by = v_uid, accepted_at = now(), updated_at = now()
   where id = v_inv.id;
  insert into public.audit_logs (institution_id, actor_id, action, table_name, record_id, old_data, new_data)
  values (
    v_inv.institution_id, v_uid, 'invitation_accepted', 'invitations', v_inv.id::text,
    jsonb_build_object('status', v_inv.status::text, 'role', v_profile.role::text,
      'institution_id', v_profile.institution_id, 'account_status', v_profile.account_status::text),
    jsonb_build_object('status', 'accepted', 'role', v_inv.role::text,
      'institution_id', v_inv.institution_id,
      'account_status', case when v_keep_active then 'active' else 'pending' end)
  );
  return jsonb_build_object('ok', true, 'user_id', v_uid, 'role', v_inv.role::text,
    'institution_id', v_inv.institution_id,
    'account_status', case when v_keep_active then 'active' else 'pending' end,
    'message', 'invitation_accepted_pending_approval');
end;
$$;

revoke all on function public.my_pending_invitation() from public, anon;
revoke all on function public.accept_email_invitation(uuid) from public, anon;
grant execute on function public.my_pending_invitation() to authenticated;
grant execute on function public.accept_email_invitation(uuid) to authenticated;

