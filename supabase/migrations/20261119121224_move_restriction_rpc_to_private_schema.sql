-- Keep the authenticated RPC in public as SECURITY INVOKER, while moving the
-- narrowly-scoped SECURITY DEFINER implementation into a non-exposed schema.
CREATE SCHEMA IF NOT EXISTS app_private;
REVOKE ALL ON SCHEMA app_private FROM PUBLIC, anon;
GRANT USAGE ON SCHEMA app_private TO authenticated;

CREATE OR REPLACE FUNCTION app_private.get_active_student_restrictions(p_on_date date DEFAULT CURRENT_DATE)
RETURNS TABLE (
  student_id uuid,
  student_code text,
  full_name text,
  record_type text,
  start_date date,
  end_date date
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
  SELECT
    s.id,
    s.student_code,
    s.full_name,
    smr.record_type,
    smr.start_date,
    smr.end_date
  FROM public.student_medical_records AS smr
  JOIN public.students AS s
    ON s.id = smr.student_id
   AND s.institution_id = smr.institution_id
  WHERE auth.uid() IS NOT NULL
    AND public.is_active_member()
    AND public.current_app_role() IN (
      'coach'::public.app_role,
      'manager'::public.app_role,
      'admin'::public.app_role
    )
    AND smr.institution_id = public.current_institution_id()
    AND s.is_active IS TRUE
    AND smr.record_type IN ('exemption', 'permission')
    AND (smr.start_date IS NULL OR smr.start_date <= p_on_date)
    AND (smr.end_date IS NULL OR smr.end_date >= p_on_date)
  ORDER BY s.full_name, smr.start_date NULLS FIRST;
$function$;

REVOKE ALL ON FUNCTION app_private.get_active_student_restrictions(date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION app_private.get_active_student_restrictions(date) TO authenticated;

DROP FUNCTION public.get_active_student_restrictions(date);
CREATE FUNCTION public.get_active_student_restrictions(p_on_date date DEFAULT CURRENT_DATE)
RETURNS TABLE (
  student_id uuid,
  student_code text,
  full_name text,
  record_type text,
  start_date date,
  end_date date
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public, app_private, pg_temp
AS $function$
  SELECT * FROM app_private.get_active_student_restrictions(p_on_date);
$function$;

REVOKE ALL ON FUNCTION public.get_active_student_restrictions(date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_active_student_restrictions(date) TO authenticated;

COMMENT ON FUNCTION public.get_active_student_restrictions(date) IS
'Authenticated RPC wrapper; the security-definer implementation lives in the non-exposed app_private schema and returns only operational status fields.';
