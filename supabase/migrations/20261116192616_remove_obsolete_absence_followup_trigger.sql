-- Applied in production: remove the obsolete duplicate trigger only.
DROP TRIGGER IF EXISTS attendance_followup_refresh ON public.attendance_records;
-- attendance_followup_trg remains and calls public.track_absence_followup().
