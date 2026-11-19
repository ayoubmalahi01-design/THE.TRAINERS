begin;

-- Keep platform owner excluded from coach reports and details.
drop policy if exists reports_read_own_admin on public.daily_reports;
create policy reports_read_own_admin on public.daily_reports for select to authenticated
using (
  institution_id = public.current_institution_id()
  and not public.is_platform_owner()
  and (coach_id = auth.uid() or (is_finalized is true and public.current_app_role() in ('manager','admin')))
);

drop policy if exists report_details_select on public.report_details;
create policy report_details_select on public.report_details for select to authenticated
using (
  institution_id = public.current_institution_id()
  and not public.is_platform_owner()
  and exists (
    select 1 from public.daily_reports r where r.id = report_details.report_id
      and r.institution_id = report_details.institution_id
      and (r.coach_id = auth.uid() or (r.is_finalized is true and public.current_app_role() in ('manager','admin')))
  )
);

drop policy if exists report_details_insert on public.report_details;
create policy report_details_insert on public.report_details for insert to authenticated
with check (
  institution_id = public.current_institution_id()
  and exists (select 1 from public.daily_reports r where r.id = report_details.report_id
    and r.institution_id = report_details.institution_id and r.coach_id = auth.uid()
    and r.is_finalized is false and r.status = 'draft')
  and (student_id is null or exists (select 1 from public.students s
    where s.id = report_details.student_id and s.institution_id = report_details.institution_id))
);

drop policy if exists report_details_update on public.report_details;
create policy report_details_update on public.report_details for update to authenticated
using (
  institution_id = public.current_institution_id()
  and exists (select 1 from public.daily_reports r where r.id = report_details.report_id
    and r.institution_id = report_details.institution_id and r.coach_id = auth.uid()
    and r.is_finalized is false and r.status = 'draft')
)
with check (
  institution_id = public.current_institution_id()
  and exists (select 1 from public.daily_reports r where r.id = report_details.report_id
    and r.institution_id = report_details.institution_id and r.coach_id = auth.uid()
    and r.is_finalized is false and r.status = 'draft')
  and (student_id is null or exists (select 1 from public.students s
    where s.id = report_details.student_id and s.institution_id = report_details.institution_id))
);

drop policy if exists report_details_delete on public.report_details;
create policy report_details_delete on public.report_details for delete to authenticated
using (
  institution_id = public.current_institution_id()
  and exists (select 1 from public.daily_reports r where r.id = report_details.report_id
    and r.institution_id = report_details.institution_id and r.coach_id = auth.uid()
    and r.is_finalized is false and r.status = 'draft')
);

drop policy if exists reports_insert_own on public.daily_reports;
create policy reports_insert_own on public.daily_reports for insert to authenticated
with check (institution_id = public.current_institution_id() and coach_id = auth.uid()
  and public.current_app_role() = 'coach' and is_finalized is false and status = 'draft'
  and submitted_at is null and finalized_at is null);

drop policy if exists reports_update_own_draft on public.daily_reports;
create policy reports_update_own_draft on public.daily_reports for update to authenticated
using (institution_id = public.current_institution_id() and coach_id = auth.uid()
  and is_finalized is false and status = 'draft')
with check (institution_id = public.current_institution_id() and coach_id = auth.uid()
  and is_finalized is false and status = 'draft' and submitted_at is null and finalized_at is null);

drop policy if exists reports_delete_own_draft on public.daily_reports;
create policy reports_delete_own_draft on public.daily_reports for delete to authenticated
using (institution_id = public.current_institution_id() and coach_id = auth.uid()
  and public.current_app_role() = 'coach' and is_finalized is false and status = 'draft');

commit;
