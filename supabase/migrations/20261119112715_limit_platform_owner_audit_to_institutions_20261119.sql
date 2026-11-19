-- Applied to production project rxkyryaplszuklagvidi on 2026-11-19.
-- Platform Owner may inspect platform institution events only, never institution
-- operational audit entries (including report metadata). Manager/Admin retain
-- audit access scoped to their own institution.
DROP POLICY IF EXISTS audit_read_admin ON public.audit_logs;
CREATE POLICY audit_read_admin
ON public.audit_logs
FOR SELECT
TO authenticated
USING (
  (public.is_platform_owner() AND table_name = 'institutions')
  OR (
    institution_id = public.current_institution_id()
    AND public.current_app_role() IN ('manager', 'admin')
  )
);
