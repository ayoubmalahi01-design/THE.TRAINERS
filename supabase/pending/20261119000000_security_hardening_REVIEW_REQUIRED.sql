-- THE TRAINERS — Security hardening migration (2026-11-19)
--
-- Closes the findings of the independent audit:
--   F-01 managers/admins could read coaches' drafts
--   F-02 platform owner could read coach reports and report exports
--   F-05 a coach could insert / force a report straight to "finalized"
--   F-07 institution admins could write invitations (any role) directly
--   F-08 avatar update lacked the institution check; media delete lacked it too;
--        buckets had no size / MIME limits
--   F-09 medical records and attachments must remain inaccessible to coaches
--   NEW  managers/admins could edit report_details of any (even final) report
--   NEW  a coach could not delete his own unsent draft ("Cancel" did nothing)
--
-- IMPORTANT
--   * Idempotent (drop ... if exists / create or replace). It is also appended to
--     THE_TRAINERS_SETUP.sql so a fresh install ends in the same state.
--   * Preserve the live submit_daily_report(uuid) function and its RETURNS
--     public.daily_reports signature. Do not replace it with a different return type.
--   * The existing daily_report_submitted_at_guard trigger records submitted_at.
--   * Read-only checks to run afterwards are listed at the bottom of this file.

begin;

-- ---------------------------------------------------------------------------
-- F-02  The platform owner must not read coach reports or their exports.
-- ---------------------------------------------------------------------------
drop policy if exists reports_owner_read_all on public.daily_reports;
drop policy if exists report_exports_owner_view on public.report_exports;
drop policy if exists audit_read_admin on public.audit_logs;
create policy audit_read_admin on public.audit_logs for select to authenticated
 using (
  (public.is_platform_owner() and table_name = 'institutions')
  or (institution_id = public.current_institution_id() and public.current_app_role() in ('manager','admin'))
 );

-- ---------------------------------------------------------------------------
-- F-01  Drafts belong to their coach only. Administration reads FINAL reports.
-- ---------------------------------------------------------------------------
drop policy if exists reports_read_own_admin on public.daily_reports;
create policy reports_read_own_admin on public.daily_reports for select to authenticated
 using (
  institution_id = public.current_institution_id()
  and not public.is_platform_owner()
  and (
   coach_id = auth.uid()
   or (is_finalized and public.current_app_role() in ('manager','admin'))
  )
 );

-- ---------------------------------------------------------------------------
-- Report details: readable by the coach (own) or by administration once the
-- parent report is final. Writable ONLY by the owning coach while it is a draft.
-- ---------------------------------------------------------------------------
drop policy if exists report_details_select on public.report_details;
create policy report_details_select on public.report_details for select to authenticated
 using (
  institution_id = public.current_institution_id()
  and not public.is_platform_owner()
  and exists (
   select 1 from public.daily_reports r
    where r.id = report_details.report_id
      and r.institution_id = report_details.institution_id
      and (
       r.coach_id = auth.uid()
       or (r.is_finalized and public.current_app_role() in ('manager','admin'))
      )
  )
 );

drop policy if exists report_details_insert on public.report_details;
create policy report_details_insert on public.report_details for insert to authenticated
 with check (
  institution_id = public.current_institution_id()
  and exists (
   select 1 from public.daily_reports r
    where r.id = report_details.report_id
      and r.institution_id = report_details.institution_id
      and r.coach_id = auth.uid()
      and not r.is_finalized
      and r.status = 'draft'
  )
  and (student_id is null or exists (
   select 1 from public.students s
    where s.id = report_details.student_id
      and s.institution_id = report_details.institution_id
  ))
 );

drop policy if exists report_details_update on public.report_details;
create policy report_details_update on public.report_details for update to authenticated
 using (
  institution_id = public.current_institution_id()
  and exists (
   select 1 from public.daily_reports r
    where r.id = report_details.report_id
      and r.institution_id = report_details.institution_id
      and r.coach_id = auth.uid()
      and not r.is_finalized
      and r.status = 'draft'
  )
 )
 with check (
  institution_id = public.current_institution_id()
  and exists (
   select 1 from public.daily_reports r
    where r.id = report_details.report_id
      and r.institution_id = report_details.institution_id
      and r.coach_id = auth.uid()
      and not r.is_finalized
      and r.status = 'draft'
  )
  and (student_id is null or exists (
   select 1 from public.students s
    where s.id = report_details.student_id
      and s.institution_id = report_details.institution_id
  ))
 );

drop policy if exists report_details_delete on public.report_details;
create policy report_details_delete on public.report_details for delete to authenticated
 using (
  institution_id = public.current_institution_id()
  and exists (
   select 1 from public.daily_reports r
    where r.id = report_details.report_id
      and r.institution_id = report_details.institution_id
      and r.coach_id = auth.uid()
      and not r.is_finalized
      and r.status = 'draft'
  )
 );

-- ---------------------------------------------------------------------------
-- F-05  A coach can only create / update DRAFTS directly. Finalising goes
--       through submit_daily_report(), which stamps the time from the database.
-- ---------------------------------------------------------------------------
drop policy if exists reports_insert_own on public.daily_reports;
create policy reports_insert_own on public.daily_reports for insert to authenticated
 with check (
  institution_id = public.current_institution_id()
  and coach_id = auth.uid()
  and public.current_app_role() = 'coach'
  and not is_finalized
  and status = 'draft'
  and submitted_at is null
  and finalized_at is null
 );

drop policy if exists reports_update_own_draft on public.daily_reports;
create policy reports_update_own_draft on public.daily_reports for update to authenticated
 using (
  institution_id = public.current_institution_id()
  and coach_id = auth.uid()
  and not is_finalized
 )
 with check (
  institution_id = public.current_institution_id()
  and coach_id = auth.uid()
  and not is_finalized
  and status = 'draft'
  and submitted_at is null
  and finalized_at is null
 );

-- Keep the production RPC signature unchanged. The live function returns
-- public.daily_reports (not jsonb), and its ownership/status checks are already
-- stricter than this migration's former replacement. The existing
-- daily_report_submitted_at_guard trigger stamps submitted_at using DB time.
-- Replacing the function with RETURNS jsonb would fail because PostgreSQL does
-- not allow CREATE OR REPLACE to change a function's return type.

-- ---------------------------------------------------------------------------
-- A coach may delete his OWN UNSENT draft ("Cancel" must really discard it).
-- Final reports stay undeletable by their coach (rule 6).
-- ---------------------------------------------------------------------------
drop policy if exists reports_delete_own_draft on public.daily_reports;
create policy reports_delete_own_draft on public.daily_reports for delete to authenticated
 using (
  institution_id = public.current_institution_id()
  and coach_id = auth.uid()
  and public.current_app_role() = 'coach'
  and not is_finalized
  and status = 'draft'
 );

-- Medical records and their private files are limited to institution Manager/Admin.
-- No coach read policy is created.

-- ---------------------------------------------------------------------------
-- F-07  Invitations are written only by the invite-user Edge Function
--       (service role). Administrators keep read access (invitations_read_admin).
-- ---------------------------------------------------------------------------
drop policy if exists invitations_admin_write on public.invitations;

-- ---------------------------------------------------------------------------
-- F-08  Storage: institution check on avatar update / media delete, bucket limits.
-- ---------------------------------------------------------------------------
drop policy if exists trainer_avatars_update on storage.objects;
create policy trainer_avatars_update on storage.objects for update to authenticated
 using (
  bucket_id = 'trainer-avatars'
  and (storage.foldername(name))[2] = auth.uid()::text
  and (storage.foldername(name))[1] in (public.current_institution_id()::text, 'platform')
 )
 with check (
  bucket_id = 'trainer-avatars'
  and (storage.foldername(name))[2] = auth.uid()::text
  and (storage.foldername(name))[1] in (public.current_institution_id()::text, 'platform')
 );

drop policy if exists trainer_media_delete on storage.objects;
create policy trainer_media_delete on storage.objects for delete to authenticated
 using (
  bucket_id = 'trainer-media'
  and (storage.foldername(name))[1] = public.current_institution_id()::text
  and (storage.foldername(name))[3] = auth.uid()::text
 );

-- Size limits for every bucket; MIME allow-lists only where the browser always
-- reports a clean type (images / PDF). Voice notes and .docx are left to the client.
update storage.buckets set file_size_limit = 5242880,
  allowed_mime_types = array['image/png','image/jpeg','image/webp']
 where id = 'trainer-avatars';
update storage.buckets set file_size_limit = 26214400
 where id = 'trainer-media';
update storage.buckets set file_size_limit = 26214400,
  allowed_mime_types = array['image/png','image/jpeg','image/webp','application/pdf']
 where id = 'trainer-medical';
update storage.buckets set file_size_limit = 10485760
 where id = 'trainer-report-templates';

commit;

-- ---------------------------------------------------------------------------
-- READ-ONLY verification (run after applying)
--   select tablename, policyname, cmd from pg_policies
--    where tablename in ('daily_reports','report_details','report_exports','invitations')
--    order by 1,2;
--   -- expected: no reports_owner_read_all, no report_exports_owner_view,
--   --           no invitations_admin_write.
--   select id, file_size_limit, allowed_mime_types from storage.buckets;
-- ---------------------------------------------------------------------------
