-- Applied to production project rxkyryaplszuklagvidi on 2026-11-19.
-- The database stamps review time; client clocks are not trusted.
CREATE OR REPLACE FUNCTION public.lock_final_report()
RETURNS trigger LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $function$
BEGIN
  IF OLD.is_finalized THEN
    IF public.current_app_role() IN ('manager','admin')
       AND NEW.id IS NOT DISTINCT FROM OLD.id
       AND NEW.institution_id IS NOT DISTINCT FROM OLD.institution_id
       AND NEW.coach_id IS NOT DISTINCT FROM OLD.coach_id
       AND NEW.shift_id IS NOT DISTINCT FROM OLD.shift_id
       AND NEW.coach_name_snapshot IS NOT DISTINCT FROM OLD.coach_name_snapshot
       AND NEW.report_date IS NOT DISTINCT FROM OLD.report_date
       AND NEW.shift_start IS NOT DISTINCT FROM OLD.shift_start
       AND NEW.shift_end IS NOT DISTINCT FROM OLD.shift_end
       AND NEW.present_count IS NOT DISTINCT FROM OLD.present_count
       AND NEW.absent_count IS NOT DISTINCT FROM OLD.absent_count
       AND NEW.late_count IS NOT DISTINCT FROM OLD.late_count
       AND NEW.injured_count IS NOT DISTINCT FROM OLD.injured_count
       AND NEW.excused_count IS NOT DISTINCT FROM OLD.excused_count
       AND NEW.notes IS NOT DISTINCT FROM OLD.notes
       AND NEW.is_finalized IS TRUE
       AND NEW.finalized_at IS NOT DISTINCT FROM OLD.finalized_at
       AND NEW.status = 'reviewed'
       AND NEW.reviewed_by = auth.uid() THEN
      NEW.reviewed_at := transaction_timestamp();
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'Finalized reports are immutable';
  END IF;
  IF NEW.is_finalized AND NEW.finalized_at IS NULL THEN
    NEW.finalized_at := transaction_timestamp();
  END IF;
  RETURN NEW;
END;
$function$;
