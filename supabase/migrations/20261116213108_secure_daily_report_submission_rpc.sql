-- Recovered from the live production function definition on 2026-11-19.
CREATE OR REPLACE FUNCTION public.submit_daily_report(p_report_id uuid)
RETURNS public.daily_reports
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_report public.daily_reports;
  v_user_id uuid := auth.uid();
  v_institution_id uuid := public.current_institution_id();
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING errcode = '28000';
  END IF;
  IF public.current_app_role() <> 'coach'::public.app_role THEN
    RAISE EXCEPTION 'Only the report owner coach can submit a report' USING errcode = '42501';
  END IF;
  IF v_institution_id IS NULL THEN
    RAISE EXCEPTION 'Active institution context required' USING errcode = '42501';
  END IF;
  SELECT * INTO v_report
  FROM public.daily_reports
  WHERE id = p_report_id AND institution_id = v_institution_id
    AND coach_id = v_user_id AND is_finalized IS FALSE AND status = 'draft'
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Draft report not found, already submitted, or not owned by current coach'
      USING errcode = 'P0002';
  END IF;
  UPDATE public.daily_reports
     SET status = 'submitted', is_finalized = TRUE,
         finalized_at = coalesce(finalized_at, transaction_timestamp()),
         submitted_at = NULL
   WHERE id = p_report_id AND institution_id = v_institution_id
     AND coach_id = v_user_id AND is_finalized IS FALSE AND status = 'draft'
  RETURNING * INTO v_report;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Report could not be submitted because its state changed'
      USING errcode = '40001';
  END IF;
  RETURN v_report;
END;
$function$;
REVOKE ALL ON FUNCTION public.submit_daily_report(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.submit_daily_report(uuid) TO authenticated;
