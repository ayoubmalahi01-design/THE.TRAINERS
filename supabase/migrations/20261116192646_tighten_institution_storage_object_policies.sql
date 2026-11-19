-- Reconstructed from the current production storage policy set on 2026-11-19.
-- Remove the old permissive ALL policy, then recreate scoped per-purpose policies.
DROP POLICY IF EXISTS trainer_storage_member_rw ON storage.objects;

DROP POLICY IF EXISTS trainer_avatar_upload ON storage.objects;
CREATE POLICY trainer_avatar_upload ON storage.objects FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'trainer-avatars'
  AND (storage.foldername(name))[1] = public.current_institution_id()::text
  AND (storage.foldername(name))[2] = auth.uid()::text
);
DROP POLICY IF EXISTS trainer_avatar_update ON storage.objects;
CREATE POLICY trainer_avatar_update ON storage.objects FOR UPDATE TO authenticated
USING (
  bucket_id = 'trainer-avatars'
  AND (storage.foldername(name))[1] = public.current_institution_id()::text
  AND (storage.foldername(name))[2] = auth.uid()::text
)
WITH CHECK (
  bucket_id = 'trainer-avatars'
  AND (storage.foldername(name))[1] = public.current_institution_id()::text
  AND (storage.foldername(name))[2] = auth.uid()::text
);
DROP POLICY IF EXISTS trainer_avatar_delete_own ON storage.objects;
CREATE POLICY trainer_avatar_delete_own ON storage.objects FOR DELETE TO authenticated
USING (
  bucket_id = 'trainer-avatars'
  AND (storage.foldername(name))[1] = public.current_institution_id()::text
  AND (storage.foldername(name))[2] = auth.uid()::text
);

DROP POLICY IF EXISTS trainer_media_upload ON storage.objects;
CREATE POLICY trainer_media_upload ON storage.objects FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'trainer-media'
  AND (storage.foldername(name))[1] = public.current_institution_id()::text
  AND (storage.foldername(name))[3] = auth.uid()::text
  AND EXISTS (
    SELECT 1 FROM public.conversations c
    WHERE c.id::text = (storage.foldername(name))[2]
      AND c.institution_id = public.current_institution_id()
      AND public.is_conversation_member(c.id)
  )
);
DROP POLICY IF EXISTS trainer_media_read ON storage.objects;
CREATE POLICY trainer_media_read ON storage.objects FOR SELECT TO authenticated
USING (
  (bucket_id = 'trainer-avatars' AND (storage.foldername(name))[1] = public.current_institution_id()::text)
  OR (
    bucket_id = 'trainer-media'
    AND (storage.foldername(name))[1] = public.current_institution_id()::text
    AND EXISTS (
      SELECT 1 FROM public.messages m
      WHERE m.media_path = objects.name
        AND m.conversation_id IS NOT NULL
        AND public.is_conversation_member(m.conversation_id)
    )
  )
);
DROP POLICY IF EXISTS trainer_media_update_own ON storage.objects;
CREATE POLICY trainer_media_update_own ON storage.objects FOR UPDATE TO authenticated
USING (
  bucket_id = 'trainer-media'
  AND (storage.foldername(name))[1] = public.current_institution_id()::text
  AND (storage.foldername(name))[3] = auth.uid()::text
  AND EXISTS (
    SELECT 1 FROM public.conversations c
    WHERE c.id::text = (storage.foldername(name))[2]
      AND c.institution_id = public.current_institution_id()
      AND public.is_conversation_member(c.id)
  )
)
WITH CHECK (
  bucket_id = 'trainer-media'
  AND (storage.foldername(name))[1] = public.current_institution_id()::text
  AND (storage.foldername(name))[3] = auth.uid()::text
  AND EXISTS (
    SELECT 1 FROM public.conversations c
    WHERE c.id::text = (storage.foldername(name))[2]
      AND c.institution_id = public.current_institution_id()
      AND public.is_conversation_member(c.id)
  )
);
DROP POLICY IF EXISTS trainer_media_delete_own ON storage.objects;
CREATE POLICY trainer_media_delete_own ON storage.objects FOR DELETE TO authenticated
USING (
  bucket_id = 'trainer-media'
  AND (storage.foldername(name))[1] = public.current_institution_id()::text
  AND (storage.foldername(name))[3] = auth.uid()::text
  AND EXISTS (
    SELECT 1 FROM public.messages m
    JOIN public.conversations c ON c.id = m.conversation_id
    WHERE m.media_path = objects.name
      AND m.sender_id = auth.uid()
      AND m.institution_id = public.current_institution_id()
      AND c.institution_id = public.current_institution_id()
      AND public.is_conversation_member(m.conversation_id)
  )
);

DROP POLICY IF EXISTS report_templates_read ON storage.objects;
CREATE POLICY report_templates_read ON storage.objects FOR SELECT TO authenticated
USING (
  bucket_id = 'trainer-report-templates'
  AND public.is_active_member()
  AND (storage.foldername(name))[1] = public.current_institution_id()::text
  AND (storage.foldername(name))[2] = 'report-templates'
);
DROP POLICY IF EXISTS report_templates_write ON storage.objects;
CREATE POLICY report_templates_write ON storage.objects FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'trainer-report-templates'
  AND public.is_active_member()
  AND public.current_app_role() IN ('manager','admin')
  AND (storage.foldername(name))[1] = public.current_institution_id()::text
  AND (storage.foldername(name))[2] = 'report-templates'
);
DROP POLICY IF EXISTS report_templates_update ON storage.objects;
CREATE POLICY report_templates_update ON storage.objects FOR UPDATE TO authenticated
USING (
  bucket_id = 'trainer-report-templates'
  AND public.is_active_member()
  AND public.current_app_role() IN ('manager','admin')
  AND (storage.foldername(name))[1] = public.current_institution_id()::text
  AND (storage.foldername(name))[2] = 'report-templates'
)
WITH CHECK (
  bucket_id = 'trainer-report-templates'
  AND public.is_active_member()
  AND public.current_app_role() IN ('manager','admin')
  AND (storage.foldername(name))[1] = public.current_institution_id()::text
  AND (storage.foldername(name))[2] = 'report-templates'
);
DROP POLICY IF EXISTS report_templates_delete ON storage.objects;
CREATE POLICY report_templates_delete ON storage.objects FOR DELETE TO authenticated
USING (
  bucket_id = 'trainer-report-templates'
  AND public.is_active_member()
  AND public.current_app_role() IN ('manager','admin')
  AND (storage.foldername(name))[1] = public.current_institution_id()::text
  AND (storage.foldername(name))[2] = 'report-templates'
);
