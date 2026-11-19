-- Applied to production project rxkyryaplszuklagvidi on 2026-11-19.
-- Manager/Admin can read their institution's medical records; Coach/Owner cannot.
DROP POLICY IF EXISTS medical_admin_read ON public.student_medical_records;
CREATE POLICY medical_admin_read
ON public.student_medical_records
FOR SELECT TO authenticated
USING (
  institution_id = public.current_institution_id()
  AND public.current_app_role() IN ('manager','admin')
);
