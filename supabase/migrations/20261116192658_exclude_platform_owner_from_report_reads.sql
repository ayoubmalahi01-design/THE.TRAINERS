-- Applied in production; the later reports_draft_permissions_alignment migration
-- replaces these SELECT policies with the final coach-private / admin-final rules.
DROP POLICY IF EXISTS reports_owner_read_all ON public.daily_reports;
DROP POLICY IF EXISTS report_exports_owner_view ON public.report_exports;
