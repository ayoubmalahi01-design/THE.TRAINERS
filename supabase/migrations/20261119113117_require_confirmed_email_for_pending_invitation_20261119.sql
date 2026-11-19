-- Applied to production project rxkyryaplszuklagvidi on 2026-11-19.
-- Do not disclose invitation metadata before the authenticated email is confirmed.
CREATE OR REPLACE FUNCTION public.my_pending_invitation()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_email text;
  v_email_confirmed_at timestamptz;
  v_row record;
BEGIN
  IF v_uid IS NULL THEN RETURN NULL; END IF;
  SELECT lower(coalesce(u.email, '')), u.email_confirmed_at
    INTO v_email, v_email_confirmed_at
    FROM auth.users u WHERE u.id = v_uid;
  IF coalesce(v_email, '') = '' OR v_email_confirmed_at IS NULL THEN RETURN NULL; END IF;
  SELECT i.id, i.role, i.institution_id, i.invited_email, i.invited_name,
         i.delivery_method, i.expires_at, inst.name AS institution_name
    INTO v_row
    FROM public.invitations i
    LEFT JOIN public.institutions inst ON inst.id = i.institution_id
   WHERE i.status = 'pending' AND i.expires_at > now()
     AND lower(coalesce(i.invited_email, '')) = v_email
   ORDER BY i.created_at DESC, i.id DESC LIMIT 1;
  IF NOT FOUND THEN RETURN NULL; END IF;
  RETURN jsonb_build_object(
    'id', v_row.id, 'role', v_row.role::text,
    'institution_id', v_row.institution_id,
    'institution_name', v_row.institution_name,
    'invited_email', v_row.invited_email,
    'invited_name', v_row.invited_name,
    'delivery_method', v_row.delivery_method::text,
    'expires_at', v_row.expires_at
  );
END;
$function$;
REVOKE ALL ON FUNCTION public.my_pending_invitation() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.my_pending_invitation() TO authenticated;
