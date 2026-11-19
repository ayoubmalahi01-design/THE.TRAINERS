-- Separate administration-defined fillable report workflow.
-- Additive only: preserves the existing daily_reports workflow and all existing data.
ALTER TABLE public.report_templates
  ADD COLUMN IF NOT EXISTS form_fields jsonb NOT NULL DEFAULT '[]'::jsonb;
COMMENT ON COLUMN public.report_templates.form_fields IS
  'Institution-admin-defined fillable fields for the separate coach management-report form; each item contains key, label and required.';

CREATE TABLE IF NOT EXISTS public.template_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id uuid NOT NULL REFERENCES public.institutions(id) ON DELETE CASCADE,
  template_id uuid NOT NULL REFERENCES public.report_templates(id) ON DELETE RESTRICT,
  template_version integer NOT NULL CHECK (template_version > 0),
  template_name_snapshot text NOT NULL,
  template_file_path_snapshot text NOT NULL,
  template_file_name_snapshot text NOT NULL,
  form_fields_snapshot jsonb NOT NULL DEFAULT '[]'::jsonb,
  coach_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  coach_name_snapshot text NOT NULL,
  report_date date NOT NULL DEFAULT CURRENT_DATE,
  responses jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','submitted','reviewed')),
  is_finalized boolean NOT NULL DEFAULT false,
  submitted_at timestamptz,
  finalized_at timestamptz,
  reviewed_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  reviewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT template_reports_fields_array CHECK (jsonb_typeof(form_fields_snapshot) = 'array'),
  CONSTRAINT template_reports_responses_object CHECK (jsonb_typeof(responses) = 'object'),
  CONSTRAINT template_reports_final_state CHECK (
    (status = 'draft' AND is_finalized IS FALSE AND submitted_at IS NULL AND finalized_at IS NULL)
    OR (status IN ('submitted','reviewed') AND is_finalized IS TRUE AND submitted_at IS NOT NULL AND finalized_at IS NOT NULL)
  )
);
CREATE INDEX IF NOT EXISTS template_reports_coach_created_idx
  ON public.template_reports (coach_id, created_at DESC);
CREATE INDEX IF NOT EXISTS template_reports_institution_status_idx
  ON public.template_reports (institution_id, status, created_at DESC);
ALTER TABLE public.template_reports ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.template_reports FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.template_reports TO authenticated;

DROP POLICY IF EXISTS template_reports_select ON public.template_reports;
CREATE POLICY template_reports_select ON public.template_reports FOR SELECT TO authenticated
USING (
  institution_id = public.current_institution_id()
  AND public.is_active_member()
  AND NOT public.is_platform_owner()
  AND (
    (public.current_app_role() = 'coach'::public.app_role AND coach_id = auth.uid())
    OR (public.current_app_role() IN ('manager'::public.app_role, 'admin'::public.app_role) AND is_finalized IS TRUE)
  )
);
DROP POLICY IF EXISTS template_reports_insert_own_draft ON public.template_reports;
CREATE POLICY template_reports_insert_own_draft ON public.template_reports FOR INSERT TO authenticated
WITH CHECK (
  institution_id = public.current_institution_id()
  AND public.is_active_member()
  AND public.current_app_role() = 'coach'::public.app_role
  AND coach_id = auth.uid()
  AND status = 'draft' AND is_finalized IS FALSE
  AND submitted_at IS NULL AND finalized_at IS NULL
  AND EXISTS (
    SELECT 1 FROM public.report_templates t
    WHERE t.id = template_id
      AND t.institution_id = template_reports.institution_id
      AND t.is_current IS TRUE AND t.is_archived IS FALSE
      AND t.version = template_version
      AND t.file_path = template_file_path_snapshot
      AND t.file_name = template_file_name_snapshot
      AND COALESCE(t.name, t.file_name) = template_name_snapshot
      AND t.form_fields = form_fields_snapshot
  )
);
DROP POLICY IF EXISTS template_reports_update_own_draft ON public.template_reports;
CREATE POLICY template_reports_update_own_draft ON public.template_reports FOR UPDATE TO authenticated
USING (
  institution_id = public.current_institution_id() AND coach_id = auth.uid()
  AND public.current_app_role() = 'coach'::public.app_role
  AND is_finalized IS FALSE AND status = 'draft'
)
WITH CHECK (
  institution_id = public.current_institution_id() AND coach_id = auth.uid()
  AND public.current_app_role() = 'coach'::public.app_role
  AND is_finalized IS FALSE AND status = 'draft'
  AND submitted_at IS NULL AND finalized_at IS NULL
);
DROP POLICY IF EXISTS template_reports_delete_own_draft ON public.template_reports;
CREATE POLICY template_reports_delete_own_draft ON public.template_reports FOR DELETE TO authenticated
USING (
  institution_id = public.current_institution_id() AND coach_id = auth.uid()
  AND public.current_app_role() = 'coach'::public.app_role
  AND is_finalized IS FALSE AND status = 'draft'
);
DROP POLICY IF EXISTS template_reports_admin_review ON public.template_reports;
CREATE POLICY template_reports_admin_review ON public.template_reports FOR UPDATE TO authenticated
USING (
  institution_id = public.current_institution_id()
  AND public.current_app_role() IN ('manager'::public.app_role, 'admin'::public.app_role)
  AND is_finalized IS TRUE AND status = 'submitted'
)
WITH CHECK (
  institution_id = public.current_institution_id()
  AND public.current_app_role() IN ('manager'::public.app_role, 'admin'::public.app_role)
  AND is_finalized IS TRUE AND status = 'reviewed' AND reviewed_by = auth.uid()
);

CREATE OR REPLACE FUNCTION public.guard_template_report_update()
RETURNS trigger LANGUAGE plpgsql SET search_path = public, pg_temp AS $function$
BEGIN
  IF OLD.is_finalized IS TRUE THEN
    IF public.current_app_role() IN ('manager'::public.app_role, 'admin'::public.app_role)
      AND OLD.status = 'submitted' AND NEW.status = 'reviewed' AND NEW.reviewed_by = auth.uid()
      AND (to_jsonb(NEW) - ARRAY['status','reviewed_by','reviewed_at','updated_at'])
        = (to_jsonb(OLD) - ARRAY['status','reviewed_by','reviewed_at','updated_at']) THEN
      NEW.reviewed_at := transaction_timestamp();
      NEW.updated_at := transaction_timestamp();
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'Submitted management report is immutable';
  END IF;
  IF public.current_app_role() <> 'coach'::public.app_role OR OLD.coach_id <> auth.uid()
    OR NEW.id IS DISTINCT FROM OLD.id OR NEW.institution_id IS DISTINCT FROM OLD.institution_id
    OR NEW.template_id IS DISTINCT FROM OLD.template_id OR NEW.template_version IS DISTINCT FROM OLD.template_version
    OR NEW.template_name_snapshot IS DISTINCT FROM OLD.template_name_snapshot
    OR NEW.template_file_path_snapshot IS DISTINCT FROM OLD.template_file_path_snapshot
    OR NEW.template_file_name_snapshot IS DISTINCT FROM OLD.template_file_name_snapshot
    OR NEW.form_fields_snapshot IS DISTINCT FROM OLD.form_fields_snapshot
    OR NEW.coach_id IS DISTINCT FROM OLD.coach_id OR NEW.coach_name_snapshot IS DISTINCT FROM OLD.coach_name_snapshot
    OR NOT (
      (NEW.status = 'draft' AND NEW.is_finalized IS FALSE AND NEW.submitted_at IS NULL AND NEW.finalized_at IS NULL)
      OR (NEW.status = 'submitted' AND NEW.is_finalized IS TRUE AND NEW.submitted_at IS NOT NULL AND NEW.finalized_at IS NOT NULL)
    ) THEN
    RAISE EXCEPTION 'Only the owning coach can edit an unsubmitted draft or submit it';
  END IF;
  NEW.updated_at := transaction_timestamp();
  RETURN NEW;
END;
$function$;
DROP TRIGGER IF EXISTS template_reports_guard_update ON public.template_reports;
CREATE TRIGGER template_reports_guard_update BEFORE UPDATE ON public.template_reports
FOR EACH ROW EXECUTE FUNCTION public.guard_template_report_update();
REVOKE ALL ON FUNCTION public.guard_template_report_update() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.submit_template_report(p_report_id uuid)
RETURNS public.template_reports LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp AS $function$
DECLARE v_report public.template_reports;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required' USING errcode = '28000'; END IF;
  IF public.current_app_role() <> 'coach'::public.app_role OR NOT public.is_active_member() THEN
    RAISE EXCEPTION 'Only an active coach can submit this report' USING errcode = '42501';
  END IF;
  SELECT * INTO v_report FROM public.template_reports
  WHERE id = p_report_id AND institution_id = public.current_institution_id()
    AND coach_id = auth.uid() AND status = 'draft' AND is_finalized IS FALSE FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Draft not found or not owned by current coach' USING errcode = 'P0002'; END IF;
  IF jsonb_array_length(v_report.form_fields_snapshot) = 0 THEN
    RAISE EXCEPTION 'Template has no fillable fields' USING errcode = '22023';
  END IF;
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(v_report.form_fields_snapshot) AS f
    WHERE COALESCE((f->>'required')::boolean, false)
      AND NULLIF(BTRIM(v_report.responses->>(f->>'key')), '') IS NULL
  ) THEN RAISE EXCEPTION 'Required report fields are missing' USING errcode = '22023'; END IF;
  UPDATE public.template_reports SET status = 'submitted', is_finalized = TRUE,
    submitted_at = transaction_timestamp(), finalized_at = transaction_timestamp(), updated_at = transaction_timestamp()
  WHERE id = p_report_id RETURNING * INTO v_report;
  RETURN v_report;
END;
$function$;
REVOKE ALL ON FUNCTION public.submit_template_report(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.submit_template_report(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.notify_submitted_template_report()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $function$
BEGIN
  IF OLD.status = 'draft' AND NEW.status = 'submitted' AND NEW.is_finalized IS TRUE THEN
    INSERT INTO public.notifications (institution_id, recipient_id, title, body, notification_type)
    SELECT NEW.institution_id, p.id, 'Management report submitted',
      NEW.coach_name_snapshot || ' submitted ' || NEW.template_name_snapshot || ' (' || NEW.report_date::text || ')', 'report'
    FROM public.profiles p
    WHERE p.institution_id = NEW.institution_id AND p.account_status = 'active'
      AND p.role IN ('manager','admin');
  END IF;
  RETURN NEW;
END;
$function$;
DROP TRIGGER IF EXISTS template_reports_notify_submitted ON public.template_reports;
CREATE TRIGGER template_reports_notify_submitted AFTER UPDATE OF status ON public.template_reports
FOR EACH ROW EXECUTE FUNCTION public.notify_submitted_template_report();
REVOKE ALL ON FUNCTION public.notify_submitted_template_report() FROM PUBLIC, anon, authenticated;
COMMENT ON TABLE public.template_reports IS
  'Separate management-defined report submissions. Coach-owned drafts, immutable final submissions, institution manager/admin review; deliberately separate from daily_reports.';
