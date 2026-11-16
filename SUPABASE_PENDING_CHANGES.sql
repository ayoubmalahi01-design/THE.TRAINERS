-- ============================================================================
-- THE TRAINERS – SUPABASE_PENDING_CHANGES.sql
-- Standalone pending SQL file (outside supabase/ at project root).
--
-- PURPOSE
--   Additive, data-preserving database changes required by the MASTER
--   EXECUTION PROMPT for the THE TRAINERS official-report feature set.
--
--   The live production database already contains the earlier report schema:
--     public.daily_reports (
--       ... report_date date,
--       ... shift_start timestamptz,
--       ... shift_end timestamptz,
--       ... finalized_at timestamptz,
--       ... reviewed_by uuid,
--       ... reviewed_at timestamptz,
--       ...
--     )
--
--   The application source (src/App.tsx, src/lib/report-export.ts) was extended
--   during this task to persist and export four independent report chronology
--   fields. The authoritative task requirements list these as independent
--   fields that must not be confused:
--     1. reporting_period_start  -> date   (start of the period covered)
--     2. reporting_period_end    -> date   (end of the period covered)
--     3. issue_date               -> date   (date the coach issued/prepared)
--     4. submitted_at             -> timestamptz (actual final submission time)
--
--   Migration 0004 has already been executed and must NOT be re-run.
--   No existing table, column, policy, trigger or function is modified here.
--   Only the genuinely missing additive columns above are added.
--
-- SAFETY
--   * Additive only: ADD COLUMN IF NOT EXISTS. No existing column is dropped,
--     renamed or rewritten.
--   * No table, data or row is deleted or modified.
--   * Nullable columns keep every existing report row valid immediately.
--   * The statements are tenant-aware by design because they only touch
--     public.daily_reports, whose institution scoping is already enforced by
--     existing RLS and triggers.
--   * No production execution is performed from this task; the file is prepared
--     here for explicit user approval only.

begin;

alter table public.daily_reports
  add column if not exists reporting_period_start date,
  add column if not exists reporting_period_end date,
  add column if not exists issue_date date,
  add column if not exists submitted_at timestamptz;

commit;

-- ============================================================================
-- SECTION 2 - TRUSTED OFFICIAL SUBMISSION TIMESTAMP (additive, pending approval)
-- ----------------------------------------------------------------------------
-- The official submission timestamp (public.daily_reports.submitted_at) must be
-- assigned by the trusted database workflow, never by the browser clock.
--
-- A BEFORE INSERT OR UPDATE trigger assigns submitted_at = now() only on the
-- transition of a report into the submitted/finalized state. Drafts keep
-- submitted_at = NULL. Already submitted reports are never re-assigned.
--
-- No existing table, column, policy, trigger or function is modified here;
-- only the new additive trigger function and trigger are created.
--
-- SAFETY
--   * Additive only: no existing object is dropped or rewritten (the trigger
--     name is new; drop trigger if exists guards the idempotent re-run).
--   * Drafts are never touched because they are not finalized.
--   * Historical valid submission timestamps are preserved; only NULL
--     submission timestamps of already-finalized reports are backfilled.

create or replace function public.set_daily_report_submitted_at() returns trigger
language plpgsql security definer set search_path=public,pg_temp
as $$
begin
  if tg_op = 'INSERT' then
    if new.is_finalized = true and new.status = 'submitted' then
      new.submitted_at := now();
    end if;
  else
    if new.is_finalized = true and new.status = 'submitted' and not old.is_finalized then
      new.submitted_at := now();
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists daily_report_submitted_at on public.daily_reports;
create trigger daily_report_submitted_at
  before insert or update on public.daily_reports
  for each row
  when (new.is_finalized = true and new.status = 'submitted')
  execute function public.set_daily_report_submitted_at();

update public.daily_reports
set submitted_at = now()
where status = 'submitted' and is_finalized = true and submitted_at is null;

-- ============================================================================
-- SECTION 3 - REPORT DELETION POLICY (additive, pending approval)
-- ----------------------------------------------------------------------------
-- Institution administrators (manager/admin) may delete a completed/processed
-- report (status = 'reviewed'). The institution-scoped condition keeps every
-- deletion tenant-aware; cross-institution access remains impossible.
--
-- The director-only historical deletion rule is intentionally not encoded here
-- until the director role mapping is confirmed against the live database.

drop policy if exists reports_admin_delete on public.daily_reports;
create policy reports_admin_delete on public.daily_reports for delete to authenticated
using (
  institution_id = public.current_institution_id()
  and public.current_app_role() in ('manager','admin')
  and status = 'reviewed'
);

-- ============================================================================
-- SECTION 4 - ACADEMIC YEAR LIFECYCLE (additive, pending approval)
-- ----------------------------------------------------------------------------
-- Additive academic-year structures required by the academic-year lifecycle
-- repair. They support institution-scoped academic years with start/end dates,
-- current/archived states and a stable student -> academic-year enrollment model.
--
-- No existing table, column, policy, trigger or function is modified here;
-- only new additive objects are created. Historical rows are never rewritten.

create table if not exists public.academic_years (
  id uuid primary key default gen_random_uuid(),
  institution_id uuid not null references public.institutions(id) on delete cascade,
  name text not null,
  start_date date,
  end_date date,
  is_current boolean not null default false,
  is_archived boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists academic_years_institution_idx on public.academic_years(institution_id, is_current, is_archived);

create table if not exists public.student_academic_enrollments (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.students(id) on delete cascade,
  academic_year_id uuid not null references public.academic_years(id) on delete cascade,
  institution_id uuid not null references public.institutions(id) on delete cascade,
  enrolled_on date,
  notes text,
  unique (student_id, academic_year_id)
);

create index if not exists student_academic_enrollments_year_idx on public.student_academic_enrollments(academic_year_id, institution_id);
create index if not exists student_academic_enrollments_student_idx on public.student_academic_enrollments(student_id, institution_id);

-- ============================================================================
-- SECTION 5 - INSTITUTION DELETION RPC (additive, pending approval)
-- ----------------------------------------------------------------------------
-- Director-only institution deletion workflow.
--
-- Authorization:
--   * Caller must be authenticated (auth.uid() is not null).
--   * Caller must hold the institution director role (public.current_app_role() = 'manager').
--   * Caller must belong to the target institution (public.current_institution_id() = p_institution_id).
--
-- Safety:
--   * The function is SECURITY DEFINER and runs with search_path = public, pg_temp.
--   * Permanent deletion only happens through this server-side function.
--   * Institution-owned child rows use ON DELETE CASCADE declared in the schema;
--     the institution row is the root of the institution-owned graph.
--   * Failures raise and never falsely report success.
--   * No production execution is performed here; the file is prepared for
--     explicit user approval only.

create or replace function public.delete_institution(p_institution_id uuid)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;
  if public.current_app_role() <> 'manager' then
    raise exception 'Only the institution director may delete an institution';
  end if;
  if public.current_institution_id() <> p_institution_id then
    raise exception 'Institution not found or not accessible';
  end if;
  -- profiles.institution_id is ON DELETE RESTRICT. Without this guard the
  -- DELETE fails with a raw foreign-key error after partially processing other
  -- cascades. Refuse cleanly instead; member accounts must be transferred by an
  -- explicitly approved administrative step first.
  if exists (select 1 from public.profiles where institution_id = p_institution_id) then
    raise exception 'Institution still has member profiles; transfer or remove them before deletion';
  end if;
  delete from public.institutions where id = p_institution_id;
  return json_build_object('deleted', true, 'institution_id', p_institution_id);
end;
$$;

revoke execute on function public.delete_institution(uuid) from anon;
grant execute on function public.delete_institution(uuid) to authenticated;

-- ============================================================================
-- SECTION 6 - DIRECTOR HISTORICAL REPORT DELETION (additive, pending approval)
-- ----------------------------------------------------------------------------
-- Institution directors (manager role) may delete finalized/historical reports
-- within their own institution. This is additive to section 3 and does not
-- modify or remove existing policies. RLS permissive policies are OR-combined;
-- section 3 remains as previously prepared.
--
-- Note: Section 3 already permits manager/admin to delete reviewed reports.
-- This section extends director-only deletion to other finalized historical
-- reports as required by the workflow, while administration (admin role)
-- remains limited to reviewed/completed reports per UI and policy intent.

drop policy if exists reports_director_delete_historical on public.daily_reports;
create policy reports_director_delete_historical on public.daily_reports for delete to authenticated
using (
  institution_id = public.current_institution_id()
  and public.current_app_role() = 'manager'
  and is_finalized = true
);

-- ============================================================================
-- SECTION 7 - REPORT TEMPLATE STORAGE BUCKET (additive, pending approval)
-- ----------------------------------------------------------------------------
-- The application stores institution report templates in a private bucket
-- named "trainer-report-templates" (see src/App.tsx). The baseline setup SQL
-- does not create this bucket. This section is additive and idempotent.
--
-- IMPORTANT
--   * This only ensures the bucket exists. Storage RLS/policies for
--     storage.objects (institution-scoped admin/coach access as required by the
--     app) MUST be reviewed against the live database before/with approval;
--     this file does not add permissive storage policies because live policy
--     state is unverified in this environment.

insert into storage.buckets (id, name, public)
values ('trainer-report-templates', 'trainer-report-templates', false)
on conflict (id) do nothing;

-- ============================================================================
-- SECTION 8 - PER-USER READ RECEIPTS (additive, pending approval)
-- ----------------------------------------------------------------------------
-- The live messages.read_at column is global per message: once any member reads
-- a message it becomes read for everybody. The application already calls
-- mark_conversation_read() / unread_counts(), so only the server side changes.
--
-- This section:
--   * ensures message_reads has the per-(message, reader) shape;
--   * replaces both RPCs with membership-checked, per-user implementations;
--   * does not rewrite or delete existing messages.
--
-- Existing global read_at values are intentionally NOT copied into per-user
-- receipts: doing so would fabricate "read" state for members who never opened
-- the message. Unread counts may therefore start higher after this change.

create table if not exists public.message_reads (
  message_id uuid not null references public.messages(id) on delete cascade,
  reader_id uuid not null references public.profiles(id) on delete cascade,
  read_at timestamptz not null default now(),
  primary key (message_id, reader_id)
);

create index if not exists message_reads_reader_idx
  on public.message_reads(reader_id, read_at desc);

alter table public.message_reads enable row level security;

drop policy if exists message_reads_read_own on public.message_reads;
create policy message_reads_read_own on public.message_reads for select to authenticated
using (reader_id = auth.uid());

drop policy if exists message_reads_insert_own on public.message_reads;
create policy message_reads_insert_own on public.message_reads for insert to authenticated
with check (
  reader_id = auth.uid()
  and exists (
    select 1 from public.messages m
    where m.id = message_id
      and public.is_conversation_member(m.conversation_id)
  )
);

drop policy if exists message_reads_update_own on public.message_reads;
create policy message_reads_update_own on public.message_reads for update to authenticated
using (reader_id = auth.uid()) with check (reader_id = auth.uid());

create or replace function public.mark_conversation_read(p_conversation_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if not public.is_conversation_member(p_conversation_id) then
    raise exception 'Not a conversation member';
  end if;
  insert into public.message_reads(message_id, reader_id, read_at)
  select m.id, auth.uid(), now()
    from public.messages m
   where m.conversation_id = p_conversation_id
     and m.sender_id <> auth.uid()
  on conflict (message_id, reader_id)
  do update set read_at = excluded.read_at;
end;
$$;

create or replace function public.unread_counts()
returns table (conversation_id uuid, unread bigint)
language sql
security definer
set search_path = public, pg_temp
as $$
  select m.conversation_id, count(*)::bigint as unread
    from public.messages m
    join public.conversation_members cm
      on cm.conversation_id = m.conversation_id
     and cm.profile_id = auth.uid()
   where m.sender_id <> auth.uid()
     and not exists (
       select 1 from public.message_reads r
        where r.message_id = m.id and r.reader_id = auth.uid()
     )
   group by m.conversation_id;
$$;

revoke all on function public.mark_conversation_read(uuid) from public, anon;
revoke all on function public.unread_counts() from public, anon;
grant execute on function public.mark_conversation_read(uuid) to authenticated;
grant execute on function public.unread_counts() to authenticated;

-- ============================================================================
-- SECTION 9 - ABSENCE FOLLOW-UP TRIGGER AND HANDLED RPC (pending approval)
-- ----------------------------------------------------------------------------
-- The application computes the five-consecutive-absence queue from
-- attendance_records. This section keeps a server-side record as well, so the
-- same information survives page reloads and can be audited.
--
-- The trigger counts the trailing run of 'absent' rows per student, ordered by
-- (session_date, session_key). It does not delete or rewrite attendance rows and
-- does not touch a manual 'done' mark for the same absence run.

create or replace function public.track_absence_followup() returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_streak int := 0;
  v_first_date date;
  v_first_key text;
  r record;
begin
  for r in
    select ar.status, ar.session_date, ar.session_key
      from public.attendance_records ar
     where ar.student_id = new.student_id
     order by ar.session_date desc, ar.session_key desc
  loop
    exit when r.status <> 'absent';
    v_streak := v_streak + 1;
    v_first_date := r.session_date;
    v_first_key := r.session_key;
  end loop;

  if v_streak >= 5 then
    update public.absence_followups
       set streak_start = v_first_date,
           streak_start_key = v_first_key,
           streak_end = new.session_date,
           streak_end_key = new.session_key,
           absences = v_streak,
           status = case
             when status = 'done'
              and streak_end is not distinct from new.session_date
              and streak_end_key is not distinct from new.session_key
             then 'done'
             else 'open'
           end,
           updated_at = now()
     where institution_id = new.institution_id
       and student_id = new.student_id;
    if not found then
      insert into public.absence_followups(
        institution_id, student_id, streak_start, streak_start_key,
        streak_end, streak_end_key, absences, status)
      values (
        new.institution_id, new.student_id, v_first_date, v_first_key,
        new.session_date, new.session_key, v_streak, 'open');
    end if;
  elsif new.status <> 'absent' then
    update public.absence_followups
       set status = 'returned',
           absences = v_streak,
           last_follow_up_at = coalesce(last_follow_up_at, now()),
           updated_at = now()
     where institution_id = new.institution_id
       and student_id = new.student_id
       and status in ('open','done');
  end if;
  return new;
end;
$$;

drop trigger if exists attendance_followup_trg on public.attendance_records;
create trigger attendance_followup_trg
  after insert or update of status on public.attendance_records
  for each row execute function public.track_absence_followup();

create or replace function public.mark_followup_handled(p_student_id uuid, p_status text default 'done')
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if not public.is_institution_admin() then raise exception 'Insufficient permission'; end if;
  if p_status not in ('open','done','none') then raise exception 'Invalid follow-up status'; end if;
  update public.absence_followups
     set status = p_status,
         last_follow_up_at = now(),
         updated_at = now()
   where student_id = p_student_id
     and institution_id = public.current_institution_id();
  if not found then raise exception 'Follow-up not found'; end if;
end;
$$;

revoke all on function public.mark_followup_handled(uuid, text) from public, anon;
grant execute on function public.mark_followup_handled(uuid, text) to authenticated;

drop policy if exists absence_followups_admin_update on public.absence_followups;
create policy absence_followups_admin_update on public.absence_followups for update to authenticated
using (institution_id = public.current_institution_id() and public.is_institution_admin())
with check (institution_id = public.current_institution_id() and public.is_institution_admin());

-- ============================================================================
-- SECTION 10 - STORAGE PATH SCOPING (pending approval)
-- ----------------------------------------------------------------------------
-- The baseline policies let any authenticated user read every medical object
-- and do not bind conversation media to a conversation. These replacements are
-- institution- and conversation-scoped. Object paths:
--   trainer-avatars          <institution|platform>/<user>/<file>
--   trainer-medical          <institution>/<user>/<file>
--   trainer-media            <institution>/<conversation>/<user>/<file>
--   trainer-report-templates <institution>/<file>

drop policy if exists trainer_medical_admin_read on storage.objects;
create policy trainer_medical_admin_read on storage.objects for select to authenticated
using (
  bucket_id = 'trainer-medical'
  and public.is_institution_admin()
  and (storage.foldername(name))[1] = public.current_institution_id()::text
);

drop policy if exists trainer_media_read on storage.objects;
create policy trainer_media_read on storage.objects for select to authenticated
using (
  bucket_id = 'trainer-media'
  and (storage.foldername(name))[1] = public.current_institution_id()::text
  and exists (
    select 1 from public.conversation_members cm
    where cm.profile_id = auth.uid()
      and cm.conversation_id::text = (storage.foldername(name))[2]
  )
);

-- Restrictive backstops: even if an older permissive policy still exists on the
-- live project, these cannot be OR-ed away.
drop policy if exists trainer_medical_scope_restrictive on storage.objects;
create policy trainer_medical_scope_restrictive on storage.objects as restrictive for select to authenticated
using (
  bucket_id <> 'trainer-medical'
  or (
    public.is_institution_admin()
    and (storage.foldername(name))[1] = public.current_institution_id()::text
  )
);

drop policy if exists trainer_media_scope_restrictive on storage.objects;
create policy trainer_media_scope_restrictive on storage.objects as restrictive for select to authenticated
using (
  bucket_id <> 'trainer-media'
  or (
    (storage.foldername(name))[1] = public.current_institution_id()::text
    and exists (
      select 1 from public.conversation_members cm
      where cm.profile_id = auth.uid()
        and cm.conversation_id::text = (storage.foldername(name))[2]
    )
  )
);

drop policy if exists trainer_avatars_read on storage.objects;
create policy trainer_avatars_read on storage.objects for select to authenticated
using (
  bucket_id = 'trainer-avatars'
  and (
    public.is_platform_owner()
    or (storage.foldername(name))[1] = public.current_institution_id()::text
    or (storage.foldername(name))[1] = 'platform'
  )
);

drop policy if exists trainer_report_templates_read on storage.objects;
create policy trainer_report_templates_read on storage.objects for select to authenticated
using (
  bucket_id = 'trainer-report-templates'
  and (storage.foldername(name))[1] = public.current_institution_id()::text
);

drop policy if exists trainer_report_templates_write on storage.objects;
create policy trainer_report_templates_write on storage.objects for insert to authenticated
with check (
  bucket_id = 'trainer-report-templates'
  and public.is_institution_admin()
  and (storage.foldername(name))[1] = public.current_institution_id()::text
);

-- ============================================================================
-- SECTION 11 - RLS COVERAGE WITHOUT LOCKOUT (pending approval)
-- ----------------------------------------------------------------------------
-- The repository enables RLS on only a few tables. Enabling it on a table that
-- still has no policy would make the app silently lose access. This block only
-- enables RLS on public tables that already have at least one policy, so it is
-- additive and cannot create a lockout by itself.

do $$
declare
  r record;
begin
  for r in
    select c.oid::regclass as qualified_name
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public'
       and c.relkind = 'r'
       and not c.relrowsecurity
       and exists (
         select 1 from pg_policies p
          where p.schemaname = 'public' and p.tablename = c.relname
       )
  loop
    execute format('alter table %s enable row level security', r.qualified_name);
  end loop;
end;
$$;

-- ============================================================================
-- SECTION 12 - COACH CAN NEVER DELETE A REPORT (pending approval)
-- ----------------------------------------------------------------------------
-- Permissive delete policies are OR-combined, so an old permissive coach policy
-- could survive the additions above. A RESTRICTIVE policy is AND-combined and
-- therefore guarantees that the coach role can never delete a report.

drop policy if exists reports_coach_never_delete on public.daily_reports;
create policy reports_coach_never_delete on public.daily_reports as restrictive for delete to authenticated
using (public.current_app_role() is distinct from 'coach');

-- ============================================================================
-- END OF PENDING CHANGES
-- Nothing in this file has been executed. Every section requires explicit
-- production approval. Do not paste this file into the SQL editor as a whole:
-- review and approve section by section.
-- ============================================================================
