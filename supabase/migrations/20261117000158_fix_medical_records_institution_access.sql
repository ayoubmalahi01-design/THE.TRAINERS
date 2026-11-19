-- Reconstructed from the current production policies on 2026-11-19.
-- Student medical information and attachments are restricted to institution Manager/Admin.
DROP POLICY IF EXISTS medical_admin_read ON public.student_medical_records;
CREATE POLICY medical_admin_read ON public.student_medical_records FOR SELECT TO authenticated
USING (institution_id = public.current_institution_id() AND public.current_app_role() IN ('manager','admin'));
DROP POLICY IF EXISTS medical_admin_insert ON public.student_medical_records;
CREATE POLICY medical_admin_insert ON public.student_medical_records FOR INSERT TO authenticated
WITH CHECK (
  institution_id = public.current_institution_id()
  AND public.current_app_role() IN ('manager','admin')
  AND created_by = auth.uid()
  AND EXISTS (SELECT 1 FROM public.students s WHERE s.id = student_id AND s.institution_id = institution_id)
);
DROP POLICY IF EXISTS medical_admin_update ON public.student_medical_records;
CREATE POLICY medical_admin_update ON public.student_medical_records FOR UPDATE TO authenticated
USING (institution_id = public.current_institution_id() AND public.current_app_role() IN ('manager','admin'))
WITH CHECK (
  institution_id = public.current_institution_id()
  AND public.current_app_role() IN ('manager','admin')
  AND EXISTS (SELECT 1 FROM public.students s WHERE s.id = student_id AND s.institution_id = institution_id)
);
DROP POLICY IF EXISTS medical_admin_delete ON public.student_medical_records;
CREATE POLICY medical_admin_delete ON public.student_medical_records FOR DELETE TO authenticated
USING (institution_id = public.current_institution_id() AND public.current_app_role() IN ('manager','admin'));

DROP POLICY IF EXISTS trainer_medical_manager_admin_read ON storage.objects;
CREATE POLICY trainer_medical_manager_admin_read ON storage.objects FOR SELECT TO authenticated
USING (
  bucket_id = 'trainer-medical'
  AND (storage.foldername(name))[1] = public.current_institution_id()::text
  AND public.current_app_role() IN ('manager','admin')
);
DROP POLICY IF EXISTS trainer_medical_manager_admin_upload ON storage.objects;
CREATE POLICY trainer_medical_manager_admin_upload ON storage.objects FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'trainer-medical'
  AND (storage.foldername(name))[1] = public.current_institution_id()::text
  AND (storage.foldername(name))[2] = auth.uid()::text
  AND public.current_app_role() IN ('manager','admin')
);
DROP POLICY IF EXISTS trainer_medical_manager_admin_update ON storage.objects;
CREATE POLICY trainer_medical_manager_admin_update ON storage.objects FOR UPDATE TO authenticated
USING (
  bucket_id = 'trainer-medical'
  AND (storage.foldername(name))[1] = public.current_institution_id()::text
  AND public.current_app_role() IN ('manager','admin')
)
WITH CHECK (
  bucket_id = 'trainer-medical'
  AND (storage.foldername(name))[1] = public.current_institution_id()::text
  AND public.current_app_role() IN ('manager','admin')
);
DROP POLICY IF EXISTS trainer_medical_manager_admin_delete ON storage.objects;
CREATE POLICY trainer_medical_manager_admin_delete ON storage.objects FOR DELETE TO authenticated
USING (
  bucket_id = 'trainer-medical'
  AND (storage.foldername(name))[1] = public.current_institution_id()::text
  AND public.current_app_role() IN ('manager','admin')
);
