-- Additive migration for timed attendance/restrictions and chronological audit history.
-- Does not delete or rewrite existing business data.

ALTER TABLE public.attendance_records
  ADD COLUMN IF NOT EXISTS start_at timestamptz,
  ADD COLUMN IF NOT EXISTS end_at timestamptz,
  ADD COLUMN IF NOT EXISTS notified_at timestamptz,
  ADD COLUMN IF NOT EXISTS actual_return_at timestamptz,
  ADD COLUMN IF NOT EXISTS duty_completed_at timestamptz;

ALTER TABLE public.student_medical_records
  ADD COLUMN IF NOT EXISTS start_at timestamptz,
  ADD COLUMN IF NOT EXISTS end_at timestamptz,
  ADD COLUMN IF NOT EXISTS notified_at timestamptz,
  ADD COLUMN IF NOT EXISTS actual_return_at timestamptz,
  ADD COLUMN IF NOT EXISTS duty_completed_at timestamptz;

CREATE INDEX IF NOT EXISTS attendance_records_inst_start_idx
  ON public.attendance_records(institution_id, start_at DESC);
CREATE INDEX IF NOT EXISTS student_medical_records_inst_start_idx
  ON public.student_medical_records(institution_id, start_at DESC);

-- Audit only operational fields. Medical narrative/details and attachment paths
-- are intentionally excluded from audit payloads.
CREATE OR REPLACE FUNCTION public.audit_timed_student_record()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_inst uuid;
  v_id text;
  v_old jsonb;
  v_new jsonb;
  v_action text;
BEGIN
  IF TG_OP = 'DELETE' THEN
    v_inst := OLD.institution_id;
    v_id := OLD.id::text;
    v_action := 'delete';
  ELSIF TG_OP = 'INSERT' THEN
    v_inst := NEW.institution_id;
    v_id := NEW.id::text;
    v_action := 'insert';
  ELSE
    v_inst := NEW.institution_id;
    v_id := NEW.id::text;
    v_action := 'update';
  END IF;

  IF TG_TABLE_NAME = 'attendance_records' THEN
    IF TG_OP <> 'INSERT' THEN
      v_old := jsonb_build_object(
        'status', OLD.status, 'reason', OLD.reason, 'start_at', OLD.start_at,
        'end_at', OLD.end_at, 'notified_at', OLD.notified_at,
        'actual_return_at', OLD.actual_return_at, 'duty_completed_at', OLD.duty_completed_at
      );
    END IF;
    IF TG_OP <> 'DELETE' THEN
      v_new := jsonb_build_object(
        'status', NEW.status, 'reason', NEW.reason, 'start_at', NEW.start_at,
        'end_at', NEW.end_at, 'notified_at', NEW.notified_at,
        'actual_return_at', NEW.actual_return_at, 'duty_completed_at', NEW.duty_completed_at
      );
    END IF;
  ELSE
    IF TG_OP <> 'INSERT' THEN
      v_old := jsonb_build_object(
        'record_type', OLD.record_type, 'start_date', OLD.start_date, 'end_date', OLD.end_date,
        'start_at', OLD.start_at, 'end_at', OLD.end_at, 'notified_at', OLD.notified_at,
        'actual_return_at', OLD.actual_return_at, 'duty_completed_at', OLD.duty_completed_at
      );
    END IF;
    IF TG_OP <> 'DELETE' THEN
      v_new := jsonb_build_object(
        'record_type', NEW.record_type, 'start_date', NEW.start_date, 'end_date', NEW.end_date,
        'start_at', NEW.start_at, 'end_at', NEW.end_at, 'notified_at', NEW.notified_at,
        'actual_return_at', NEW.actual_return_at, 'duty_completed_at', NEW.duty_completed_at
      );
    END IF;
  END IF;

  INSERT INTO public.audit_logs(institution_id, actor_id, action, table_name, record_id, old_data, new_data)
  VALUES (v_inst, auth.uid(), v_action, TG_TABLE_NAME, v_id, v_old, v_new);

  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS attendance_records_timed_audit ON public.attendance_records;
CREATE TRIGGER attendance_records_timed_audit
AFTER INSERT OR UPDATE OR DELETE ON public.attendance_records
FOR EACH ROW EXECUTE FUNCTION public.audit_timed_student_record();

DROP TRIGGER IF EXISTS student_medical_records_timed_audit ON public.student_medical_records;
CREATE TRIGGER student_medical_records_timed_audit
AFTER INSERT OR UPDATE OR DELETE ON public.student_medical_records
FOR EACH ROW EXECUTE FUNCTION public.audit_timed_student_record();

REVOKE ALL ON FUNCTION public.audit_timed_student_record() FROM PUBLIC, anon, authenticated;
