
-- =========================================================
-- THE TRAINERS – DAILY REPORTS FIX
-- Reports chronology, submission timestamp, delete policies
-- =========================================================

BEGIN;

-- 1. Add report chronology columns
ALTER TABLE public.daily_reports
    ADD COLUMN IF NOT EXISTS reporting_period_start DATE,
    ADD COLUMN IF NOT EXISTS reporting_period_end DATE,
    ADD COLUMN IF NOT EXISTS issue_date DATE,
    ADD COLUMN IF NOT EXISTS submitted_at TIMESTAMPTZ;


-- 2. Protect and automatically manage submitted_at
CREATE OR REPLACE FUNCTION public.set_daily_report_submitted_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $function$
BEGIN
    IF TG_OP = 'INSERT' THEN

        IF NEW.is_finalized = TRUE
           AND NEW.status IN ('submitted', 'reviewed') THEN
            NEW.submitted_at := transaction_timestamp();
        ELSE
            NEW.submitted_at := NULL;
        END IF;

        RETURN NEW;
    END IF;

    -- Once finalized, preserve the original timestamp.
    IF OLD.is_finalized = TRUE THEN
        NEW.submitted_at := OLD.submitted_at;
        RETURN NEW;
    END IF;

    -- Record the database timestamp when the report is finalized.
    IF NEW.is_finalized = TRUE
       AND NEW.status IN ('submitted', 'reviewed') THEN
        NEW.submitted_at := transaction_timestamp();
    ELSE
        NEW.submitted_at := NULL;
    END IF;

    RETURN NEW;
END;
$function$;


-- 3. Create the timestamp protection trigger
DROP TRIGGER IF EXISTS daily_report_submitted_at_guard
ON public.daily_reports;

CREATE TRIGGER daily_report_submitted_at_guard
BEFORE INSERT OR UPDATE OF is_finalized, status, submitted_at
ON public.daily_reports
FOR EACH ROW
EXECUTE FUNCTION public.set_daily_report_submitted_at();


-- 4. Scoped delete permissions
-- Manager: can delete finalized reports in own institution.
-- Admin: can delete reviewed and finalized reports only.
-- Coach: cannot delete reports.

DROP POLICY IF EXISTS reports_admin_manager_delete_scoped
ON public.daily_reports;

CREATE POLICY reports_admin_manager_delete_scoped
ON public.daily_reports
FOR DELETE
TO authenticated
USING (
    institution_id = (SELECT public.current_institution_id())
    AND is_finalized = TRUE
    AND (
        (SELECT public.current_app_role()) = 'manager'
        OR (
            (SELECT public.current_app_role()) = 'admin'
            AND status = 'reviewed'
        )
    )
);


-- 5. Foreign-key performance indexes
CREATE INDEX IF NOT EXISTS daily_reports_institution_id_idx
ON public.daily_reports (institution_id);

CREATE INDEX IF NOT EXISTS daily_reports_reviewed_by_idx
ON public.daily_reports (reviewed_by);

CREATE INDEX IF NOT EXISTS daily_reports_shift_id_idx
ON public.daily_reports (shift_id);

COMMIT;
