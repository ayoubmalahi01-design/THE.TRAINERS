-- Applied to production project rxkyryaplszuklagvidi on 2026-11-19.
-- Coaches must not read medical records or files. Manager/Admin retain access.
DROP POLICY IF EXISTS medical_member_read ON public.student_medical_records;
DROP POLICY IF EXISTS trainer_medical_member_read ON storage.objects;
