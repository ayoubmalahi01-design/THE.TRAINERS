-- Allow active coaches to read only the current, non-archived report template.
-- Managers/Admins retain their institution-scoped template management access.
DROP POLICY IF EXISTS report_templates_select ON public.report_templates;
CREATE POLICY report_templates_select
ON public.report_templates
FOR SELECT
TO authenticated
USING (
  institution_id = public.current_institution_id()
  AND public.is_active_member()
  AND (
    public.current_app_role() IN ('manager'::public.app_role, 'admin'::public.app_role)
    OR (
      public.current_app_role() = 'coach'::public.app_role
      AND is_current IS TRUE
      AND is_archived IS FALSE
    )
  )
);

-- Coaches need to know that a student is exempted or has a permission and
-- the validity dates, but must never receive medical notes or attachments.
CREATE OR REPLACE FUNCTION public.get_active_student_restrictions(p_on_date date DEFAULT CURRENT_DATE)
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

REVOKE ALL ON FUNCTION public.get_active_student_restrictions(date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_active_student_restrictions(date) TO authenticated;

COMMENT ON FUNCTION public.get_active_student_restrictions(date) IS
'Returns only operational student identity, restriction type, and validity dates to active institution members; never exposes medical details or attachment paths.';
