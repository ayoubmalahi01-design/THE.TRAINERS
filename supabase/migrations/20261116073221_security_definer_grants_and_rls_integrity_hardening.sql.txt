
-- THE TRAINERS
-- Security Definer grants and RLS integrity hardening
-- Applied to Supabase: 20261116073221

BEGIN;

-- Remove direct anonymous execution from every
-- SECURITY DEFINER function in public.
-- Preserve authenticated access to application RPC/helpers.
-- Trigger and event-trigger functions are not direct RPC endpoints.
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT
      p.oid,
      p.prorettype::regtype::text AS return_type
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.prosecdef
  LOOP
    EXECUTE format(
      'REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon',
      r.oid::regprocedure
    );

    IF r.return_type IN ('trigger', 'event_trigger') THEN
      EXECUTE format(
        'REVOKE EXECUTE ON FUNCTION %s FROM authenticated',
        r.oid::regprocedure
      );
    END IF;
  END LOOP;
END $$;


-- Attendance INSERT: one institution-safe policy.
DROP POLICY IF EXISTS attendance_insert
ON public.attendance_records;

DROP POLICY IF EXISTS attendance_insert_member
ON public.attendance_records;

CREATE POLICY attendance_insert_member
ON public.attendance_records
FOR INSERT
TO authenticated
WITH CHECK (
  institution_id = (SELECT public.current_institution_id())

  AND EXISTS (
    SELECT 1
    FROM public.students s
    WHERE s.id = attendance_records.student_id
      AND s.institution_id = attendance_records.institution_id
  )

  AND (
    (
      (SELECT public.current_app_role()) = 'coach'
      AND coach_id = (SELECT auth.uid())
    )
    OR
    (
      (SELECT public.current_app_role()) IN ('manager', 'admin')
      AND EXISTS (
        SELECT 1
        FROM public.profiles p
        WHERE p.id = attendance_records.coach_id
          AND p.institution_id = attendance_records.institution_id
          AND p.account_status IN ('active', 'suspended')
      )
    )
  )
);


-- Attendance UPDATE: enforce same-institution student relation.
DROP POLICY IF EXISTS attendance_update
ON public.attendance_records;

DROP POLICY IF EXISTS attendance_update_own_admin
ON public.attendance_records;

CREATE POLICY attendance_update_own_admin
ON public.attendance_records
FOR UPDATE
TO authenticated
USING (
  institution_id = (SELECT public.current_institution_id())
  AND (
    coach_id = (SELECT auth.uid())
    OR (SELECT public.is_institution_admin())
  )
)
WITH CHECK (
  institution_id = (SELECT public.current_institution_id())

  AND EXISTS (
    SELECT 1
    FROM public.students s
    WHERE s.id = attendance_records.student_id
      AND s.institution_id = attendance_records.institution_id
  )

  AND (
    coach_id = (SELECT auth.uid())
    OR (SELECT public.is_institution_admin())
  )
);


-- Student notes INSERT: correct the institution comparison.
DROP POLICY IF EXISTS student_notes_insert_self
ON public.student_notes;

CREATE POLICY student_notes_insert_self
ON public.student_notes
FOR INSERT
TO authenticated
WITH CHECK (
  institution_id = (SELECT public.current_institution_id())
  AND author_id = (SELECT auth.uid())

  AND EXISTS (
    SELECT 1
    FROM public.students s
    WHERE s.id = student_notes.student_id
      AND s.institution_id = student_notes.institution_id
  )
);


-- Student notes UPDATE: correct the institution comparison.
DROP POLICY IF EXISTS student_notes_update_self_admin
ON public.student_notes;

CREATE POLICY student_notes_update_self_admin
ON public.student_notes
FOR UPDATE
TO authenticated
USING (
  institution_id = (SELECT public.current_institution_id())
  AND (
    author_id = (SELECT auth.uid())
    OR (SELECT public.is_institution_admin())
  )
)
WITH CHECK (
  institution_id = (SELECT public.current_institution_id())

  AND EXISTS (
    SELECT 1
    FROM public.students s
    WHERE s.id = student_notes.student_id
      AND s.institution_id = student_notes.institution_id
  )
);


-- Remove exact duplicate policies.
DROP POLICY IF EXISTS notebooks_own
ON public.coach_notebooks;

DROP POLICY IF EXISTS notifications_read_own
ON public.notifications;

DROP POLICY IF EXISTS notifications_update_own
ON public.notifications;


-- Keep the canonical audit index.
DROP INDEX IF EXISTS public.audit_institution_created;

COMMIT;
