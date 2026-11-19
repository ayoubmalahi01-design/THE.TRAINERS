-- Reconstructed from the production schema on 2026-11-19.
-- Adds report chronology/review fields and the original role-scoped delete rules.
ALTER TABLE public.daily_reports ADD COLUMN IF NOT EXISTS reporting_period_start date;
ALTER TABLE public.daily_reports ADD COLUMN IF NOT EXISTS reporting_period_end date;
ALTER TABLE public.daily_reports ADD COLUMN IF NOT EXISTS issue_date date;
ALTER TABLE public.daily_reports ADD COLUMN IF NOT EXISTS reviewed_by uuid REFERENCES public.profiles(id);
ALTER TABLE public.daily_reports ADD COLUMN IF NOT EXISTS reviewed_at timestamptz;
ALTER TABLE public.daily_reports ADD COLUMN IF NOT EXISTS submitted_at timestamptz;

DROP POLICY IF EXISTS reports_delete_manager ON public.daily_reports;
CREATE POLICY reports_delete_manager ON public.daily_reports
FOR DELETE TO authenticated
USING (
  institution_id = public.current_institution_id()
  AND public.current_app_role() = 'manager'
  AND is_finalized IS TRUE
);

DROP POLICY IF EXISTS reports_delete_admin ON public.daily_reports;
CREATE POLICY reports_delete_admin ON public.daily_reports
FOR DELETE TO authenticated
USING (
  institution_id = public.current_institution_id()
  AND public.current_app_role() = 'admin'
  AND is_finalized IS TRUE
  AND status = 'reviewed'
);
