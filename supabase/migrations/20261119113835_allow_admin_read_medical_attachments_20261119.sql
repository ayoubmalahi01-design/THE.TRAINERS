-- Applied to production project rxkyryaplszuklagvidi on 2026-11-19.
-- Medical files are private; only Manager/Admin in the owning institution may read.
DROP POLICY IF EXISTS trainer_medical_manager_admin_read ON storage.objects;
CREATE POLICY trainer_medical_manager_admin_read
ON storage.objects FOR SELECT TO authenticated
USING (
  bucket_id = 'trainer-medical'
  AND (storage.foldername(name))[1] = public.current_institution_id()::text
  AND public.current_app_role() IN ('manager','admin')
);
