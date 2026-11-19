-- Additive fix: a rejected invitation/account is not a permanent email block.
-- A fresh pending email invitation may be accepted by the same verified email.
-- The account is returned to pending (never auto-activated) for a new review.
-- Suspended accounts and active-account role/institution conflicts remain protected.
CREATE OR REPLACE FUNCTION public.accept_email_invitation(p_invitation_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_auth_email text;
  v_email_confirmed_at timestamptz;
  v_inv public.invitations%rowtype;
  v_profile public.profiles%rowtype;
  v_keep_active boolean := false;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'authentication_required');
  END IF;

  SELECT lower(coalesce(u.email, '')), u.email_confirmed_at
    INTO v_auth_email, v_email_confirmed_at
    FROM auth.users u WHERE u.id = v_uid;
  IF NOT FOUND OR coalesce(v_auth_email, '') = '' OR v_email_confirmed_at IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'confirmed_email_required');
  END IF;

  SELECT * INTO v_inv FROM public.invitations WHERE id = p_invitation_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', 'invitation_not_found'); END IF;
  IF v_inv.delivery_method::text <> 'email'
     OR lower(coalesce(v_inv.invited_email, '')) <> v_auth_email THEN
    RETURN jsonb_build_object('ok', false, 'error', 'recipient_mismatch');
  END IF;
  IF v_inv.role IS NULL OR v_inv.role::text = 'owner' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'owner_role_forbidden');
  END IF;
  IF v_inv.status::text = 'accepted' THEN
    IF v_inv.accepted_by = v_uid THEN
      RETURN jsonb_build_object('ok', true, 'already_accepted', true,
        'user_id', v_uid, 'role', v_inv.role::text,
        'institution_id', v_inv.institution_id, 'account_status', 'pending');
    END IF;
    RETURN jsonb_build_object('ok', false, 'error', 'invitation_already_accepted');
  END IF;
  IF v_inv.status::text <> 'pending' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invitation_not_pending');
  END IF;
  IF v_inv.expires_at IS NULL OR v_inv.expires_at <= now() THEN
    UPDATE public.invitations SET status = 'expired', updated_at = now() WHERE id = v_inv.id;
    RETURN jsonb_build_object('ok', false, 'error', 'invitation_expired');
  END IF;
  IF v_inv.institution_id IS NULL
     OR NOT EXISTS (SELECT 1 FROM public.institutions i WHERE i.id = v_inv.institution_id) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'institution_not_found');
  END IF;

  SELECT * INTO v_profile FROM public.profiles WHERE id = v_uid FOR UPDATE;
  IF NOT FOUND THEN
    INSERT INTO public.profiles (id, email, full_name, role, institution_id, account_status, created_by)
    VALUES (v_uid, v_auth_email, coalesce(v_inv.invited_name, ''),
      v_inv.role, v_inv.institution_id, 'pending', v_inv.inviter_id)
    ON CONFLICT (id) DO NOTHING;
    SELECT * INTO v_profile FROM public.profiles WHERE id = v_uid FOR UPDATE;
  END IF;

  IF lower(coalesce(v_profile.email, '')) <> v_auth_email THEN
    RETURN jsonb_build_object('ok', false, 'error', 'profile_email_mismatch');
  END IF;
  IF v_profile.role::text = 'owner' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'owner_protected');
  END IF;
  IF v_profile.account_status::text = 'suspended' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'account_not_eligible');
  END IF;
  IF v_profile.account_status::text = 'active' THEN
    IF v_profile.institution_id IS DISTINCT FROM v_inv.institution_id
       OR v_profile.role IS DISTINCT FROM v_inv.role THEN
      RETURN jsonb_build_object('ok', false, 'error', 'active_account_conflict');
    END IF;
    v_keep_active := true;
  ELSIF v_profile.account_status::text NOT IN ('pending', 'rejected') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'account_not_eligible');
  END IF;

  PERFORM set_config('app.account_repair', 'on', true);
  UPDATE public.profiles
     SET role = v_inv.role,
         institution_id = v_inv.institution_id,
         account_status = CASE WHEN v_keep_active THEN 'active' ELSE 'pending' END,
         full_name = coalesce(nullif(v_inv.invited_name, ''), full_name),
         email = v_auth_email,
         created_by = coalesce(created_by, v_inv.inviter_id),
         updated_at = now()
   WHERE id = v_uid;
  PERFORM set_config('app.account_repair', 'off', true);

  UPDATE public.invitations
     SET status = 'accepted', accepted_by = v_uid, accepted_at = now(), updated_at = now()
   WHERE id = v_inv.id;


  INSERT INTO public.audit_logs (
    institution_id, actor_id, action, table_name, record_id, old_data, new_data
  ) VALUES (
    v_inv.institution_id, v_uid, 'invitation_accepted', 'invitations', v_inv.id::text,
    jsonb_build_object('status', v_inv.status::text, 'role', v_profile.role::text,
      'institution_id', v_profile.institution_id, 'account_status', v_profile.account_status::text),
    jsonb_build_object('status', 'accepted', 'role', v_inv.role::text,
      'institution_id', v_inv.institution_id,
      'account_status', CASE WHEN v_keep_active THEN 'active' ELSE 'pending' END)
  );


  RETURN jsonb_build_object('ok', true, 'user_id', v_uid, 'role', v_inv.role::text,
    'institution_id', v_inv.institution_id,
    'account_status', CASE WHEN v_keep_active THEN 'active' ELSE 'pending' END,
    'message', 'invitation_accepted_pending_approval');
END;
$function$;
