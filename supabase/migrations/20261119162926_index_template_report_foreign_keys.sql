-- Add covering indexes for the two live foreign keys flagged by Supabase Advisor.
-- Additive only; no rows, constraints or existing indexes are changed.
create index if not exists template_reports_reviewed_by_idx
  on public.template_reports (reviewed_by);
create index if not exists template_reports_template_id_idx
  on public.template_reports (template_id);
