-- Reconstructed from the live policy definition on 2026-11-19.
-- Manager may delete finalized reports; Admin may delete reviewed finalized reports.
DROP POLICY IF EXISTS reports_delete_manager ON public.daily_reports;
DROP POLICY IF EXISTS reports_delete_admin ON public.daily_reports;
DROP POLICY IF EXISTS reports_admin_manager_delete ON public.daily_reports;
CREATE POLICY reports_admin_manager_delete ON public.daily_reports
FOR DELETE TO authenticated
USING (
  institution_id = public.current_institution_id()
  AND is_finalized IS TRUE
  AND (
    public.current_app_role() = 'manager'
    OR (public.current_app_role() = 'admin' AND status = 'reviewed')
  )
);
