-- THE TRAINERS / TADARRAB — production-oriented fresh-project schema
-- Run ONLY in a NEW, dedicated Supabase project. Never run in Sport Performance.
-- Owner bootstrap email: ayoubmalleh772@gmail.com
begin;
create extension if not exists pgcrypto;

do $$ begin
  create type public.app_role as enum ('owner','manager','admin','coach');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.otp_delivery_method as enum ('email','whatsapp','sms');
exception when duplicate_object then null; end $$;
do $$ begin
  create type public.otp_purpose as enum ('invitation','password_reset');
exception when duplicate_object then null; end $$;

create table if not exists public.institutions (
 id uuid primary key default gen_random_uuid(), name text not null,
 logo_path text, phone text, email text, address text,
 default_language text not null default 'ar' check(default_language in ('ar','fr','en')),
 is_active boolean not null default true, count_permissions_as_absence boolean not null default false,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table if not exists public.profiles (
 id uuid primary key references auth.users(id) on delete cascade,
 institution_id uuid references public.institutions(id) on delete restrict,
 full_name text not null default '', email text not null default '',
 role public.app_role not null default 'coach',
 account_status text not null default 'pending' check(account_status in ('pending','active','suspended','rejected')),
 preferred_language text not null default 'ar' check(preferred_language in ('ar','fr','en')),
 phone text, avatar_path text, created_by uuid references public.profiles(id),
 approved_by uuid references public.profiles(id), approved_at timestamptz,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 -- A non-owner account needs an institution before it can be active. Pending and
 -- rejected accounts may temporarily have no institution while the owner repairs
 -- an Auth/profile link; this is the safe state used by the repair RPCs.
 constraint profiles_role_institution_check check (
  (role='owner' and institution_id is null)
  or (role<>'owner' and institution_id is not null)
  or (institution_id is null and account_status in ('pending','rejected'))
 )
);
create index if not exists profiles_institution_role on public.profiles(institution_id,role,account_status);

create table if not exists public.classes (
 id uuid primary key default gen_random_uuid(), institution_id uuid not null references public.institutions(id) on delete cascade,
 name text not null, academic_year text, description text, created_at timestamptz not null default now(),
 unique(institution_id,name,academic_year)
);
create table if not exists public.students (
 id uuid primary key default gen_random_uuid(), institution_id uuid not null references public.institutions(id) on delete cascade,
 class_id uuid references public.classes(id) on delete set null, student_code text not null, full_name text not null,
 date_of_birth date, gender text check(gender in ('female','male','other')),
 is_active boolean not null default true,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 unique(institution_id,student_code)
);
create index if not exists students_name_search on public.students(institution_id,full_name);
create table if not exists public.student_medical_records (
 id uuid primary key default gen_random_uuid(), institution_id uuid not null references public.institutions(id) on delete cascade,
 student_id uuid not null references public.students(id) on delete cascade,
 record_type text not null check(record_type in ('medical','injury','exemption','permission','other')),
 details text not null, start_date date, end_date date, attachment_path text,
 created_by uuid not null references public.profiles(id), created_at timestamptz not null default now()
);
create table if not exists public.coach_shifts (
 id uuid primary key default gen_random_uuid(), institution_id uuid not null references public.institutions(id) on delete cascade,
 coach_id uuid not null references public.profiles(id) on delete restrict,
 started_at timestamptz not null default now(), ended_at timestamptz,
 notes text, created_at timestamptz not null default now(), check(ended_at is null or ended_at>=started_at)
);
create unique index if not exists one_open_shift_per_coach on public.coach_shifts(coach_id) where ended_at is null;
create table if not exists public.daily_reports (
 id uuid primary key default gen_random_uuid(), institution_id uuid not null references public.institutions(id) on delete cascade,
 coach_id uuid not null references public.profiles(id) on delete restrict, shift_id uuid references public.coach_shifts(id) on delete set null,
 coach_name_snapshot text not null, report_date date not null default current_date,
 shift_start timestamptz, shift_end timestamptz,
 present_count int not null default 0 check(present_count>=0), absent_count int not null default 0 check(absent_count>=0),
 late_count int not null default 0 check(late_count>=0), injured_count int not null default 0 check(injured_count>=0),
 excused_count int not null default 0 check(excused_count>=0), notes text,
 status text not null default 'draft' check(status in ('draft','submitted','reviewed')),
 is_finalized boolean not null default false, finalized_at timestamptz, submitted_at timestamptz,
 reporting_period_start date, reporting_period_end date, issue_date date,
 reviewed_by uuid references public.profiles(id), reviewed_at timestamptz,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index if not exists reports_coach_date on public.daily_reports(coach_id,report_date desc);
-- Word template storage for institution-specific report templates
create table if not exists public.report_templates (
 id uuid primary key default gen_random_uuid(), institution_id uuid not null references public.institutions(id) on delete cascade,
 name text, description text, instructions text, is_archived boolean not null default false,
 file_name text not null, file_path text not null, version int not null default 1,
 is_current boolean not null default false, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
-- Only one active template may exist per institution. This is a partial unique
-- index (a table constraint cannot carry a WHERE clause).
create unique index if not exists current_template_per_institution
 on public.report_templates(institution_id) where is_current = true;
-- Report export log for tracking downloads
create table if not exists public.report_exports (
 id uuid primary key default gen_random_uuid(), institution_id uuid not null references public.institutions(id) on delete cascade,
 report_id uuid not null references public.daily_reports(id) on delete cascade,
 exported_by uuid not null references public.profiles(id) on delete cascade,
 export_type text not null check(export_type in ('single','institution','all','template')),
 exported_at timestamptz not null default now(), file_name text, file_path text
);
-- ============================================================================
-- CORE TABLES
--
-- Every table is created before any trigger, policy or SECURITY DEFINER
-- function can reference it. The original file interleaved table creation with
-- triggers/policies, which made a fresh-project run fail at the first trigger
-- whose table did not exist yet. The later `create table if not exists`
-- statements are intentionally kept: on a fresh project they are no-ops, and on
-- a partially provisioned project they still complete missing objects.
-- ============================================================================

create table if not exists public.student_notes (
 id uuid primary key default gen_random_uuid(),
 institution_id uuid not null references public.institutions(id) on delete cascade,
 student_id uuid not null references public.students(id) on delete cascade,
 author_id uuid not null references public.profiles(id) on delete restrict,
 note_type text not null default 'general',
 body text not null,
 follow_up_status text not null default 'none', last_follow_up_at timestamptz,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index if not exists student_notes_student_idx on public.student_notes(student_id, created_at desc);

create table if not exists public.admin_notices (
 id uuid primary key default gen_random_uuid(),
 institution_id uuid not null references public.institutions(id) on delete cascade,
 author_id uuid not null references public.profiles(id) on delete restrict,
 title text not null, body text not null,
 is_published boolean not null default true, published_at timestamptz default now(),
 created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index if not exists admin_notices_institution_idx on public.admin_notices(institution_id, created_at desc);

create table if not exists public.notifications (
 id uuid primary key default gen_random_uuid(),
 institution_id uuid references public.institutions(id) on delete cascade,
 recipient_id uuid not null references public.profiles(id) on delete cascade,
 title text not null default '', body text not null default '',
 notification_type text not null default 'general',
 read_at timestamptz, created_at timestamptz not null default now(),
 notice_id uuid references public.admin_notices(id) on delete set null
);
create index if not exists notifications_recipient_unread on public.notifications(recipient_id, read_at);


create table if not exists public.push_subscriptions (
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null references public.profiles(id) on delete cascade,
 institution_id uuid not null references public.institutions(id) on delete cascade,
 endpoint text not null,
 p256dh text not null,
 auth text not null,
 user_agent text,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 unique (user_id, endpoint)
);
create index if not exists push_subscriptions_user_idx on public.push_subscriptions(user_id);
create index if not exists push_subscriptions_institution_idx on public.push_subscriptions(institution_id);

create table if not exists public.coach_notebooks (
 id uuid primary key default gen_random_uuid(),
 institution_id uuid not null references public.institutions(id) on delete cascade,
 coach_id uuid not null references public.profiles(id) on delete cascade,
 title text not null, body text not null,
 entry_date date not null default current_date,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index if not exists coach_notebooks_coach_idx on public.coach_notebooks(coach_id, entry_date desc);

create table if not exists public.audit_logs (
 id bigserial primary key,
 institution_id uuid references public.institutions(id) on delete set null,
 actor_id uuid references public.profiles(id) on delete set null,
 action text not null, table_name text not null, record_id text,
 old_data jsonb, new_data jsonb, created_at timestamptz not null default now()
);
create index if not exists audit_logs_institution_created on public.audit_logs(institution_id, created_at desc);

create table if not exists public.invitations (
 id uuid primary key default gen_random_uuid(),
 inviter_id uuid references public.profiles(id) on delete set null,
 institution_id uuid not null references public.institutions(id) on delete restrict,
 role public.app_role not null,
 invited_email text,
 invited_phone text,
 invited_name text,
 delivery_method public.otp_delivery_method not null default 'email',
 status text not null default 'pending' check (status in ('pending','accepted','expired','revoked')),
 accepted_by uuid references public.profiles(id) on delete set null,
 accepted_at timestamptz,
 expires_at timestamptz not null default (now() + interval '7 days'),
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 check (role <> 'owner'),
 check (invited_email is not null or invited_phone is not null),
 check ((delivery_method = 'email' and invited_email is not null) or (delivery_method in ('whatsapp','sms') and invited_phone is not null)),
 check (expires_at > created_at)
);
create index if not exists invitations_institution_idx on public.invitations(institution_id, created_at desc);

create table if not exists public.academic_years (
 id uuid primary key default gen_random_uuid(),
 institution_id uuid not null references public.institutions(id) on delete cascade,
 name text not null, start_date date, end_date date,
 is_current boolean not null default false, is_archived boolean not null default false,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 constraint academic_year_dates_valid check (start_date is null or end_date is null or end_date >= start_date)
);
create index if not exists academic_years_institution_idx on public.academic_years(institution_id, is_current, is_archived);

create table if not exists public.student_academic_enrollments (
 id uuid primary key default gen_random_uuid(),
 student_id uuid not null references public.students(id) on delete cascade,
 academic_year_id uuid not null references public.academic_years(id) on delete cascade,
 institution_id uuid not null references public.institutions(id) on delete cascade,
 created_at timestamptz not null default now(),
 unique (student_id, academic_year_id)
);
create index if not exists student_academic_enrollments_year_idx on public.student_academic_enrollments(academic_year_id, student_id);

create table if not exists public.report_details (
 id uuid primary key default gen_random_uuid(),
 report_id uuid not null references public.daily_reports(id) on delete cascade,
 institution_id uuid not null references public.institutions(id) on delete cascade,
 student_id uuid references public.students(id) on delete set null,
 student_name_snapshot text, attendance_status text, observation text,
 incident text, injury_details text, notes text,
 created_by uuid references public.profiles(id) on delete set null,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index if not exists report_details_report_idx on public.report_details(report_id);

create table if not exists public.conversations (
 id uuid primary key default gen_random_uuid(),
 institution_id uuid not null references public.institutions(id) on delete cascade,
 title text,
 conversation_type text not null default 'direct' check (conversation_type in ('direct','group')),
 created_by uuid not null references public.profiles(id) on delete cascade,
 created_at timestamptz not null default now()
);
create index if not exists conversations_institution_idx on public.conversations(institution_id, created_at desc);

create table if not exists public.conversation_members (
 id uuid primary key default gen_random_uuid(),
 conversation_id uuid not null references public.conversations(id) on delete cascade,
 profile_id uuid not null references public.profiles(id) on delete cascade,
 joined_at timestamptz not null default now(),
 unique (conversation_id, profile_id)
);
create index if not exists conversation_members_conversation_idx on public.conversation_members(conversation_id, profile_id);

create table if not exists public.messages (
 id uuid primary key default gen_random_uuid(),
 sender_id uuid not null references public.profiles(id) on delete cascade,
 institution_id uuid not null references public.institutions(id) on delete cascade,
 conversation_id uuid not null references public.conversations(id) on delete cascade,
 body text,
 message_type text not null default 'text' check (message_type in ('text','image','audio','file')),
 media_path text, read_at timestamptz,
 created_at timestamptz not null default now()
);
create index if not exists messages_conversation_created_idx on public.messages(conversation_id, created_at);

-- Per-user read receipts. The legacy `messages.read_at` column is kept for
-- compatibility, but read state is recorded per (message, reader) so one
-- member reading a message never marks it read for everybody.
create table if not exists public.message_reads (
 message_id uuid not null references public.messages(id) on delete cascade,
 reader_id uuid not null references public.profiles(id) on delete cascade,
 read_at timestamptz not null default now(),
 primary key (message_id, reader_id)
);
create index if not exists message_reads_reader_idx on public.message_reads(reader_id, read_at desc);

create table if not exists public.attendance_records (
 id uuid primary key default gen_random_uuid(),
 institution_id uuid not null references public.institutions(id) on delete cascade,
 student_id uuid not null references public.students(id) on delete cascade,
 coach_id uuid not null references public.profiles(id) on delete cascade,
 session_date date not null default current_date,
 session_key text not null default 'unspecified',
 status text not null,
 reason text,
 recorded_at timestamptz not null default now(),
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);
create index if not exists attendance_records_inst_idx on public.attendance_records(institution_id, session_date);
create unique index if not exists attendance_records_session_unique
 on public.attendance_records(student_id, session_date, session_key);
create index if not exists attendance_date_idx on public.attendance_records(institution_id, session_date desc);

create table if not exists public.absence_followups (
 id uuid primary key default gen_random_uuid(),
 institution_id uuid not null references public.institutions(id) on delete cascade,
 student_id uuid not null references public.students(id) on delete cascade,
 streak_start date not null,
 streak_start_key text not null default 'unspecified',
 streak_end date not null,
 streak_end_key text not null default 'unspecified',
 absences integer not null check (absences >= 5),
 status text not null default 'awaiting_return' check (status in ('awaiting_return','active','completed')),
 return_date date,
 return_session_key text,
 sessions_seen integer not null default 0 check (sessions_seen between 0 and 2),
 last_counted_date date,
 last_counted_session_key text,
 handled_at timestamptz,
 handled_by uuid references public.profiles(id),
 streak integer not null default 0,
 last_follow_up_at timestamptz,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 unique (student_id, streak_start, streak_start_key)
);
create index if not exists absence_followups_inst_status on public.absence_followups(institution_id, status);

-- Identity and authorization helpers. SECURITY DEFINER functions.
create or replace function public.my_profile() returns public.profiles
language sql stable security definer set search_path=public,pg_temp
as $$ select p from public.profiles p where p.id=auth.uid() and p.account_status='active' limit 1 $$;
create or replace function public.current_institution_id() returns uuid
language sql stable security definer set search_path=public,pg_temp
as $$ select institution_id from public.profiles where id=auth.uid() and account_status='active' $$;
create or replace function public.current_app_role() returns public.app_role
language sql stable security definer set search_path=public,pg_temp
as $$ select role from public.profiles where id=auth.uid() and account_status='active' $$;
create or replace function public.is_platform_owner() returns boolean
language sql stable security definer set search_path=public,pg_temp
as $$ select exists(select 1 from public.profiles where id=auth.uid() and role='owner' and account_status='active') $$;
create or replace function public.is_institution_admin() returns boolean
language sql stable security definer set search_path=public,pg_temp
as $$ select public.current_app_role() in ('manager','admin','owner') $$;
create or replace function public.is_active_member() returns boolean
language sql stable security definer set search_path=public,pg_temp
as $$ select exists(select 1 from public.profiles where id=auth.uid() and account_status='active') $$;
create or replace function public.is_conversation_member(cid uuid) returns boolean
language sql stable security definer set search_path=public,pg_temp
as $$ select exists(select 1 from public.conversation_members cm where cm.conversation_id=cid and cm.profile_id=auth.uid()) $$;

-- Daily reports and templates are per-institution. Identity and authorization.
-- Identity and authorization helpers. SECURITY DEFINER functions have fixed search_path.
create or replace function public.create_conversation(p_title text default null,p_member_ids uuid[] default '{}')
returns uuid language plpgsql security definer set search_path=public,pg_temp
as $$
 declare v_institution uuid; v_id uuid; v_type text; v_count integer;
 begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  select institution_id into v_institution from public.profiles where id=auth.uid() and account_status='active';
  if v_institution is null then raise exception 'Active institution membership required'; end if;
  select count(distinct x) into v_count from unnest(coalesce(p_member_ids,'{}'::uuid[])) x where x<>auth.uid();
  if v_count<1 then raise exception 'Select at least one other member'; end if;
  if v_count>100 then raise exception 'A conversation can have at most 100 other members'; end if;
  if exists(select 1 from unnest(coalesce(p_member_ids,'{}'::uuid[])) x left join public.profiles p on p.id=x and p.institution_id=v_institution and p.account_status='active' where x<>auth.uid() and p.id is null) then
   raise exception 'Every participant must be an active member of your institution';
  end if;
  v_type:=case when v_count=1 and nullif(trim(coalesce(p_title,'')),'') is null then 'direct' else 'group' end;
  insert into public.conversations(institution_id,title,conversation_type,created_by) values(v_institution,nullif(trim(coalesce(p_title,'')),''),v_type,auth.uid()) returning id into v_id;
  insert into public.conversation_members(conversation_id,profile_id) values(v_id,auth.uid()) on conflict do nothing;
  insert into public.conversation_members(conversation_id,profile_id) select v_id,x from unnest(coalesce(p_member_ids,'{}'::uuid[])) x on conflict do nothing;
  return v_id;
end $$;

-- Owner bootstrap: only the configured e-mail can receive the platform-owner
-- role, and only after that e-mail is confirmed. The role is never read from
-- user-supplied metadata, so a sign-up cannot promote itself.
create or replace function public.handle_new_auth_user() returns trigger
language plpgsql security definer set search_path=public,pg_temp
as $$ declare
 v_owner_email constant text := 'ayoubmalleh772@gmail.com';
 v_role public.app_role;
 v_owner boolean;
 v_confirmed boolean;
 begin
  v_owner := lower(coalesce(new.email,'')) = v_owner_email;
  v_confirmed := new.email_confirmed_at is not null;
  v_role := case when v_owner then 'owner'::public.app_role else 'coach'::public.app_role end;
  if v_owner and exists(select 1 from public.profiles where role='owner' and id<>new.id) then
   raise exception 'A platform owner already exists';
  end if;
  insert into public.profiles(id,email,full_name,role,institution_id,account_status)
  values(new.id,lower(coalesce(new.email,'')),coalesce(new.raw_user_meta_data->>'full_name',''),v_role,null,
  case when v_owner and v_confirmed then 'active' else 'pending' end)
  on conflict(id) do nothing;
  return new;
end $$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users for each row execute function public.handle_new_auth_user();

-- Activate a pending owner only when the owner e-mail is actually confirmed.
create or replace function public.confirm_platform_owner() returns trigger
language plpgsql security definer set search_path=public,pg_temp
as $$ begin
 if lower(coalesce(new.email,''))='ayoubmalleh772@gmail.com' and new.email_confirmed_at is not null then
  update public.profiles set account_status='active',updated_at=now()
   where id=new.id and role='owner' and account_status='pending';
 end if;
 return new;
end $$;
drop trigger if exists on_auth_user_confirmed on auth.users;
create trigger on_auth_user_confirmed after update of email_confirmed_at on auth.users
 for each row when (old.email_confirmed_at is null and new.email_confirmed_at is not null)
 execute function public.confirm_platform_owner();

-- Protect role, institution and activation fields from self-promotion.
-- Final rule set:
--   * owner  : may review any non-owner account and may correct its role or
--              institution; the owner account itself is immutable here;
--   * manager: may approve/reject/suspend/reactivate admin and coach accounts
--              inside the manager's own institution only; may never change a
--              role or move an account to another institution;
--   * admin  : may not manage other accounts at all;
--   * coach  : may not manage other accounts at all;
--   * nobody : may change their own role, institution or status.
--
-- `review_account()` and `ensure_my_profile()` mark their transaction with
-- `app.account_repair=on` after performing the same checks server-side, so the
-- two trusted repair paths do not trip this trigger.
create or replace function public.guard_profile_privileges() returns trigger
language plpgsql security definer set search_path=public,pg_temp
as $$ declare actor_role public.app_role; actor_institution uuid; begin
 if auth.uid() is null then return new; end if;
 if current_setting('app.account_repair', true) = 'on' then return new; end if;
 if old.id=auth.uid() then
  if new.role is distinct from old.role or new.institution_id is distinct from old.institution_id or new.account_status is distinct from old.account_status or new.email is distinct from old.email or new.created_by is distinct from old.created_by or new.approved_by is distinct from old.approved_by or new.approved_at is distinct from old.approved_at then
   raise exception 'You cannot change your own role, institution or account status';
  end if;
  return new;
 end if;
 if new.role='owner' and old.role<>'owner' then raise exception 'The platform-owner role is provisioned by bootstrap only'; end if;
 if old.role='owner' then raise exception 'The platform-owner role cannot be reassigned or modified here'; end if;
 actor_role:=public.current_app_role();
 actor_institution:=public.current_institution_id();
 if actor_role='owner' then return new; end if;
 if actor_role<>'manager' then raise exception 'Insufficient permission'; end if;
 if actor_institution is null or old.institution_id is distinct from actor_institution then raise exception 'Insufficient permission'; end if;
 if old.role not in ('admin','coach') then raise exception 'Managers may review institution administrators and coaches only'; end if;
 if new.role is distinct from old.role then raise exception 'Managers cannot change account roles'; end if;
 if new.institution_id is distinct from old.institution_id then raise exception 'Managers cannot move accounts between institutions'; end if;
 if new.email is distinct from old.email or new.created_by is distinct from old.created_by then raise exception 'Protected profile fields'; end if;
 if new.account_status is distinct from old.account_status then
  if new.account_status='active' and old.account_status in ('pending','rejected') then
   if new.approved_by is distinct from auth.uid() or new.approved_at is null then raise exception 'Approval fields must record the approving manager'; end if;
  elsif new.account_status='rejected' and old.account_status in ('pending','active','suspended') then
   null;
  elsif new.account_status='suspended' and old.account_status='active' then
   null;
  elsif new.account_status='active' and old.account_status='suspended' then
   if new.approved_by is distinct from old.approved_by or new.approved_at is distinct from old.approved_at then raise exception 'Reactivation does not change approval fields'; end if;
  else
   raise exception 'Invalid account status transition';
  end if;
 elsif new.approved_by is distinct from old.approved_by or new.approved_at is distinct from old.approved_at then
  raise exception 'Approval fields can only be set during approval';
 end if;
 return new;
end $$;
drop trigger if exists profiles_privilege_guard on public.profiles;
create trigger profiles_privilege_guard before update on public.profiles for each row execute function public.guard_profile_privileges();

create or replace function public.set_updated_at() returns trigger language plpgsql set search_path=public,pg_temp
as $$ begin new.updated_at=now(); return new; end $$;
do $$ declare t text; begin foreach t in array array['institutions','profiles','students','student_notes','coach_notebooks','daily_reports','report_templates','report_exports'] loop
 execute format('drop trigger if exists %I on public.%I',t||'_set_updated_at',t);
 execute format('create trigger %I before update on public.%I for each row execute function public.set_updated_at()',t||'_set_updated_at',t);
 end loop; end $$;

-- Audit selected business-table mutations, storing before/after snapshots.
create or replace function public.write_audit_log() returns trigger
language plpgsql security definer set search_path=public,pg_temp
as $$ declare v_old jsonb; v_new jsonb; v_inst uuid; v_id text; begin
 if tg_op<>'INSERT' then v_old:=to_jsonb(old); end if;
 if tg_op<>'DELETE' then v_new:=to_jsonb(new); end if;
 -- Medical details are deliberately redacted from the platform-wide audit view.
 if tg_table_name='student_medical_records' then
  if v_old is not null then v_old:=jsonb_set(v_old,'{details}','"[REDACTED]"'::jsonb,true); end if;
  if v_new is not null then v_new:=jsonb_set(v_new,'{details}','"[REDACTED]"'::jsonb,true); end if;
 elsif tg_table_name='student_notes' then
  if v_old is not null then v_old:=jsonb_set(v_old,'{body}','"[REDACTED]"'::jsonb,true); end if;
  if v_new is not null then v_new:=jsonb_set(v_new,'{body}','"[REDACTED]"'::jsonb,true); end if;
 elsif tg_table_name='daily_reports' then
  if v_old is not null then v_old:=jsonb_set(v_old,'{notes}','"[REDACTED]"'::jsonb,true); end if;
  if v_new is not null then v_new:=jsonb_set(v_new,'{notes}','"[REDACTED]"'::jsonb,true); end if;
 elsif tg_table_name='report_templates' then
  if v_old is not null then v_old:=jsonb_set(v_old,'{file_path}','"[REDACTED]"'::jsonb,true); end if;
  if v_new is not null then v_new:=jsonb_set(v_new,'{file_path}','"[REDACTED]"'::jsonb,true); end if;
 elsif tg_table_name='report_exports' then
  if v_old is not null then v_old:=jsonb_set(v_old,'{file_path}','"[REDACTED]"'::jsonb,true); end if;
  if v_new is not null then v_new:=jsonb_set(v_new,'{file_path}','"[REDACTED]"'::jsonb,true); end if;
 elsif tg_table_name='students' then
  if v_old is not null then v_old:=v_old-'date_of_birth'; end if;
  if v_new is not null then v_new:=v_new-'date_of_birth'; end if;
 elsif tg_table_name='attendance_records' then
  if v_old is not null then v_old:=v_old-'reason'; end if;
  if v_new is not null then v_new:=v_new-'reason'; end if;
 elsif tg_table_name='profiles' then
  if v_old is not null then v_old:=v_old-'phone'; end if;
  if v_new is not null then v_new:=v_new-'phone'; end if;
 end if;
 if tg_table_name='institutions' then v_inst:=coalesce((v_new->>'id')::uuid,(v_old->>'id')::uuid); else v_inst:=coalesce((v_new->>'institution_id')::uuid,(v_old->>'institution_id')::uuid); end if;
 v_id:=coalesce(v_new->>'id',v_old->>'id');
 insert into public.audit_logs(institution_id,actor_id,action,table_name,record_id,old_data,new_data)
 values(v_inst,auth.uid(),tg_op,tg_table_name,v_id,v_old,v_new);
 if tg_op='DELETE' then return old; else return new; end if;
 end $$;
 do $$ declare t text; begin foreach t in array array['institutions','students','coach_shifts','daily_reports','attendance_records','student_medical_records','student_notes','admin_notices','profiles','report_templates','report_exports'] loop
  execute format('drop trigger if exists %I on public.%I',t||'_audit',t);
  execute format('create trigger %I after insert or update or delete on public.%I for each row execute function public.write_audit_log()',t||'_audit',t);
 end loop; end $$;

-- Coaches cannot edit finalized reports; institution administrators may only mark them reviewed.
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
drop trigger if exists daily_report_lock on public.daily_reports;
create trigger daily_report_lock before update on public.daily_reports for each row execute function public.lock_final_report();

-- Cross-tenant relationship guards. RLS constrains who may write; these triggers
-- constrain what may be written, so two institutions can never be linked even
-- through a trusted RPC, a service-role import or a future client bug.
create or replace function public.guard_student_class() returns trigger
language plpgsql security definer set search_path=public,pg_temp
as $$ begin
 if new.class_id is not null and not exists(select 1 from public.classes c where c.id=new.class_id and c.institution_id=new.institution_id) then
  raise exception 'Class and student must belong to the same institution';
 end if;
 return new;
end $$;
drop trigger if exists students_class_guard on public.students;
create trigger students_class_guard before insert or update of class_id,institution_id on public.students for each row execute function public.guard_student_class();

create or replace function public.guard_attendance_relation() returns trigger
language plpgsql security definer set search_path=public,pg_temp
as $$ begin
 if not exists(select 1 from public.students s where s.id=new.student_id and s.institution_id=new.institution_id) then
  raise exception 'Attendance student must belong to the same institution';
 end if;
 if not exists(select 1 from public.profiles p where p.id=new.coach_id and p.institution_id=new.institution_id and p.account_status in ('active','suspended')) then
  raise exception 'Attendance coach must be an established member of the same institution';
 end if;
 if tg_op='UPDATE' and (new.institution_id is distinct from old.institution_id or new.student_id is distinct from old.student_id or new.coach_id is distinct from old.coach_id or new.session_date is distinct from old.session_date or new.session_key is distinct from old.session_key) then
  raise exception 'Attendance identity is immutable; correct status or reason only';
 end if;
 return new;
end $$;
drop trigger if exists attendance_relation_guard on public.attendance_records;
create trigger attendance_relation_guard before insert or update of institution_id,student_id,coach_id,session_date,session_key on public.attendance_records for each row execute function public.guard_attendance_relation();

create or replace function public.guard_student_note_relation() returns trigger
language plpgsql security definer set search_path=public,pg_temp
as $$ begin
 if not exists(select 1 from public.students s where s.id=new.student_id and s.institution_id=new.institution_id) then
  raise exception 'Note student must belong to the same institution';
 end if;
 if not exists(select 1 from public.profiles p where p.id=new.author_id and p.institution_id=new.institution_id and p.account_status='active') then
  raise exception 'Note author must be an active member of the same institution';
 end if;
 if tg_op='UPDATE' and (new.institution_id is distinct from old.institution_id or new.student_id is distinct from old.student_id or new.author_id is distinct from old.author_id) then
  raise exception 'Note identity is immutable';
 end if;
 return new;
end $$;
drop trigger if exists student_notes_relation_guard on public.student_notes;
create trigger student_notes_relation_guard before insert or update of institution_id,student_id,author_id on public.student_notes for each row execute function public.guard_student_note_relation();

create or replace function public.guard_medical_record_relation() returns trigger
language plpgsql security definer set search_path=public,pg_temp
as $$ begin
 if not exists(select 1 from public.students s where s.id=new.student_id and s.institution_id=new.institution_id) then
  raise exception 'Medical record student must belong to the same institution';
 end if;
 if not exists(select 1 from public.profiles p where p.id=new.created_by and p.institution_id=new.institution_id and p.account_status='active') then
  raise exception 'Medical record author must be an active member of the same institution';
 end if;
 if new.attachment_path is not null and new.attachment_path not like new.institution_id::text||'/%' then
  raise exception 'Medical attachment must live under the institution folder';
 end if;
 if tg_op='UPDATE' and (new.institution_id is distinct from old.institution_id or new.student_id is distinct from old.student_id or new.created_by is distinct from old.created_by) then
  raise exception 'Medical record identity is immutable';
 end if;
 return new;
end $$;
drop trigger if exists medical_record_relation_guard on public.student_medical_records;
create trigger medical_record_relation_guard before insert or update of institution_id,student_id,created_by,attachment_path on public.student_medical_records for each row execute function public.guard_medical_record_relation();

create or replace function public.guard_daily_report_relation() returns trigger
language plpgsql security definer set search_path=public,pg_temp
as $$ begin
 if not exists(select 1 from public.profiles p where p.id=new.coach_id and p.institution_id=new.institution_id and p.role='coach' and p.account_status='active') then
  raise exception 'Report coach must be an active coach of the same institution';
 end if;
 if new.shift_id is not null and not exists(select 1 from public.coach_shifts s where s.id=new.shift_id and s.coach_id=new.coach_id and s.institution_id=new.institution_id) then
  raise exception 'Report shift must belong to the same coach and institution';
 end if;
 if tg_op='UPDATE' and (new.institution_id is distinct from old.institution_id or new.coach_id is distinct from old.coach_id or new.shift_id is distinct from old.shift_id) then
  raise exception 'Report identity is immutable';
 end if;
 return new;
end $$;
drop trigger if exists daily_report_relation_guard on public.daily_reports;
create trigger daily_report_relation_guard before insert or update of institution_id,coach_id,shift_id on public.daily_reports for each row execute function public.guard_daily_report_relation();

create or replace function public.guard_coach_shift_relation() returns trigger
language plpgsql security definer set search_path=public,pg_temp
as $$ begin
 if not exists(select 1 from public.profiles p where p.id=new.coach_id and p.institution_id=new.institution_id and p.role='coach' and p.account_status='active') then
  raise exception 'Shift coach must be an active coach of the same institution';
 end if;
 if tg_op='UPDATE' and (new.institution_id is distinct from old.institution_id or new.coach_id is distinct from old.coach_id) then
  raise exception 'Shift identity is immutable';
 end if;
 return new;
end $$;
drop trigger if exists coach_shift_relation_guard on public.coach_shifts;
create trigger coach_shift_relation_guard before insert or update of institution_id,coach_id on public.coach_shifts for each row execute function public.guard_coach_shift_relation();

create or replace function public.guard_message_relation() returns trigger
language plpgsql security definer set search_path=public,pg_temp
as $$ begin
 if not exists(select 1 from public.conversations c where c.id=new.conversation_id and c.institution_id=new.institution_id) then
  raise exception 'Message conversation must belong to the same institution';
 end if;
 if not exists(select 1 from public.conversation_members cm where cm.conversation_id=new.conversation_id and cm.profile_id=new.sender_id) then
  raise exception 'Message sender must be a member of the conversation';
 end if;
 if tg_op='UPDATE' and (new.institution_id is distinct from old.institution_id or new.conversation_id is distinct from old.conversation_id or new.sender_id is distinct from old.sender_id) then
  raise exception 'Message identity is immutable';
 end if;
 return new;
end $$;
drop trigger if exists message_relation_guard on public.messages;
create trigger message_relation_guard before insert or update of institution_id,conversation_id,sender_id on public.messages for each row execute function public.guard_message_relation();

create or replace function public.guard_conversation_member_relation() returns trigger
language plpgsql security definer set search_path=public,pg_temp
as $$ begin
 if not exists(select 1 from public.conversations c join public.profiles p on p.id=new.profile_id where c.id=new.conversation_id and p.institution_id=c.institution_id and p.account_status='active') then
  raise exception 'Conversation member must be an active member of the conversation institution';
 end if;
 return new;
end $$;
drop trigger if exists conversation_member_relation_guard on public.conversation_members;
create trigger conversation_member_relation_guard before insert on public.conversation_members for each row execute function public.guard_conversation_member_relation();

create or replace function public.guard_conversation_creator() returns trigger
language plpgsql security definer set search_path=public,pg_temp
as $$ begin
 if not exists(select 1 from public.profiles p where p.id=new.created_by and p.institution_id=new.institution_id and p.account_status='active') then
  raise exception 'Conversation creator must be an active member of the same institution';
 end if;
 return new;
end $$;
drop trigger if exists conversation_creator_guard on public.conversations;
create trigger conversation_creator_guard before insert on public.conversations for each row execute function public.guard_conversation_creator();

create or replace function public.guard_institution_activation() returns trigger
language plpgsql security definer set search_path=public,pg_temp
as $$ begin
 if auth.uid() is not null and new.is_active is distinct from old.is_active and public.current_app_role()<>'manager' and not public.is_platform_owner() then
  raise exception 'Only the institution manager or the platform owner may change institution activation';
 end if;
 return new;
end $$;
drop trigger if exists institution_activation_guard on public.institutions;
create trigger institution_activation_guard before update on public.institutions for each row execute function public.guard_institution_activation();

-- =============================================================
-- REPORT TEMPLATES & EXPORT POLICIES
-- =============================================================

-- Platform owner can see/manage institutions. Members only see their own institution.
drop policy if exists institutions_select on public.institutions;
create policy institutions_select on public.institutions for select to authenticated using(id=public.current_institution_id() or public.is_platform_owner());
drop policy if exists institutions_owner_insert on public.institutions;
create policy institutions_owner_insert on public.institutions for insert to authenticated with check(public.is_platform_owner());
drop policy if exists institutions_owner_update on public.institutions;
create policy institutions_owner_update on public.institutions for update to authenticated using(public.is_platform_owner()) with check(public.is_platform_owner());
drop policy if exists institutions_manager_update on public.institutions;
create policy institutions_manager_update on public.institutions for update to authenticated using(id=public.current_institution_id() and public.current_app_role() in ('manager','admin')) with check(id=public.current_institution_id() and public.current_app_role() in ('manager','admin'));

-- == Profile policies (preserved from previous repair) ==
drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles for select to authenticated using(id=auth.uid() or public.is_platform_owner() or (institution_id=public.current_institution_id() and public.is_active_member()));
drop policy if exists profiles_update_self_safe on public.profiles;
create policy profiles_update_self_safe on public.profiles for update to authenticated using(id=auth.uid()) with check(id=auth.uid());
drop policy if exists profiles_admin_update on public.profiles;
create policy profiles_admin_update on public.profiles for update to authenticated
using (
 public.is_platform_owner()
 or (
  public.current_app_role()='manager'
  and institution_id=public.current_institution_id()
  and role in ('admin','coach')
 )
)
with check (
 public.is_platform_owner()
 or (
  public.current_app_role()='manager'
  and institution_id=public.current_institution_id()
  and role in ('admin','coach')
 )
);
-- Owner profiles are created only by the auth bootstrap function; even the
-- platform owner cannot insert a second owner through the API.
drop policy if exists profiles_owner_insert on public.profiles;
create policy profiles_owner_insert on public.profiles for insert to authenticated with check(public.is_platform_owner() and role<>'owner');

-- Common institution read policies.
drop policy if exists classes_read on public.classes;
create policy classes_read on public.classes for select to authenticated using(institution_id=public.current_institution_id());
drop policy if exists classes_admin_write on public.classes;
create policy classes_admin_write on public.classes for all to authenticated using(institution_id=public.current_institution_id() and public.is_institution_admin()) with check(institution_id=public.current_institution_id() and public.is_institution_admin());
drop policy if exists students_read on public.students;
create policy students_read on public.students for select to authenticated using(institution_id=public.current_institution_id());
drop policy if exists students_admin_write on public.students;
create policy students_admin_write on public.students for all to authenticated using(institution_id=public.current_institution_id() and public.is_institution_admin()) with check(institution_id=public.current_institution_id() and public.is_institution_admin() and (class_id is null or exists(select 1 from public.classes c where c.id=class_id and c.institution_id=institution_id)));

drop policy if exists medical_admin_read on public.student_medical_records;
create policy medical_admin_read on public.student_medical_records for select to authenticated using(institution_id=public.current_institution_id() and public.current_app_role() in ('manager','admin'));
drop policy if exists medical_admin_insert on public.student_medical_records;
create policy medical_admin_insert on public.student_medical_records for insert to authenticated with check(institution_id=public.current_institution_id() and public.current_app_role() in ('manager','admin') and created_by=auth.uid() and exists(select 1 from public.students s where s.id=student_id and s.institution_id=institution_id));
drop policy if exists medical_admin_update on public.student_medical_records;
create policy medical_admin_update on public.student_medical_records for update to authenticated using(institution_id=public.current_institution_id() and public.current_app_role() in ('manager','admin')) with check(institution_id=public.current_institution_id() and public.current_app_role() in ('manager','admin') and exists(select 1 from public.students s where s.id=student_id and s.institution_id=institution_id));
drop policy if exists medical_admin_delete on public.student_medical_records;
create policy medical_admin_delete on public.student_medical_records for delete to authenticated using(institution_id=public.current_institution_id() and public.current_app_role() in ('manager','admin'));

drop policy if exists shifts_read_own_admin on public.coach_shifts;
create policy shifts_read_own_admin on public.coach_shifts for select to authenticated using(institution_id=public.current_institution_id() and (coach_id=auth.uid() or public.is_institution_admin()));
drop policy if exists shifts_insert_own on public.coach_shifts;
create policy shifts_insert_own on public.coach_shifts for insert to authenticated with check(institution_id=public.current_institution_id() and coach_id=auth.uid() and public.current_app_role()='coach');
drop policy if exists shifts_update_own_admin on public.coach_shifts;
create policy shifts_update_own_admin on public.coach_shifts for update to authenticated using(institution_id=public.current_institution_id() and (coach_id=auth.uid() or public.is_institution_admin())) with check(institution_id=public.current_institution_id() and (coach_id=auth.uid() or public.is_institution_admin()));

-- == Daily Reports Policies ==

-- Coaches can only see and edit their own daily reports
drop policy if exists reports_read_own_admin on public.daily_reports;
create policy reports_read_own_admin on public.daily_reports for select to authenticated using(institution_id=public.current_institution_id() and (coach_id=auth.uid() or public.is_institution_admin()));

-- Coaches can insert their own daily reports (draft status)
drop policy if exists reports_insert_own on public.daily_reports;
create policy reports_insert_own on public.daily_reports for insert to authenticated with check(institution_id=public.current_institution_id() and coach_id=auth.uid() and public.current_app_role()='coach');

-- Coaches can update their own draft reports (not finalized)
drop policy if exists reports_update_own_draft on public.daily_reports;
create policy reports_update_own_draft on public.daily_reports for update to authenticated using(institution_id=public.current_institution_id() and coach_id=auth.uid() and not is_finalized) with check(institution_id=public.current_institution_id() and coach_id=auth.uid());

-- Institution administrators may mark reports as reviewed
drop policy if exists reports_admin_review on public.daily_reports;
create policy reports_admin_review on public.daily_reports for update to authenticated using(institution_id=public.current_institution_id() and public.current_app_role() in ('manager','admin') and is_finalized) with check(institution_id=public.current_institution_id() and public.current_app_role() in ('manager','admin') and is_finalized);

-- Platform owner can see all reports but cannot edit them (the trigger lock blocks edits)
drop policy if exists reports_owner_read_all on public.daily_reports;
create policy reports_owner_read_all on public.daily_reports for select to authenticated using(public.is_platform_owner());

-- == Report Template Policies ==

-- Only institution administrators can manage their templates
drop policy if exists report_templates_select on public.report_templates;
create policy report_templates_select on public.report_templates for select to authenticated
 using (
  institution_id = public.current_institution_id()
  and public.is_active_member()
  and (
   public.current_app_role() in ('manager','admin')
   or (public.current_app_role() = 'coach' and is_current is true and is_archived is false)
  )
 );
drop policy if exists report_templates_insert on public.report_templates;
create policy report_templates_insert on public.report_templates for insert to authenticated with check(institution_id=public.current_institution_id() and public.current_app_role() in ('manager','admin'));
drop policy if exists report_templates_update on public.report_templates;
create policy report_templates_update on public.report_templates for update to authenticated using(institution_id=public.current_institution_id() and public.current_app_role() in ('manager','admin')) with check(institution_id=public.current_institution_id() and public.current_app_role() in ('manager','admin'));
drop policy if exists report_templates_delete on public.report_templates;
create policy report_templates_delete on public.report_templates for delete to authenticated using(institution_id=public.current_institution_id() and public.current_app_role() in ('manager','admin'));

-- Platform owner can see all templates
drop policy if exists report_templates_owner_view on public.report_templates;
create policy report_templates_owner_view on public.report_templates for select to authenticated using(public.is_platform_owner());

-- Return only operational restriction labels and validity dates to active
-- institution members. The privileged implementation stays in a non-exposed
-- schema; the public API wrapper is SECURITY INVOKER.
create schema if not exists app_private;
revoke all on schema app_private from public, anon;
grant usage on schema app_private to authenticated;

create or replace function app_private.get_active_student_restrictions(p_on_date date default current_date)
returns table (
 student_id uuid,
 student_code text,
 full_name text,
 record_type text,
 start_date date,
 end_date date
)
language sql stable security definer
set search_path = public, pg_temp
as $function$
 select s.id, s.student_code, s.full_name, smr.record_type, smr.start_date, smr.end_date
 from public.student_medical_records smr
 join public.students s on s.id = smr.student_id and s.institution_id = smr.institution_id
 where auth.uid() is not null
  and public.is_active_member()
  and public.current_app_role() in ('coach'::public.app_role, 'manager'::public.app_role, 'admin'::public.app_role)
  and smr.institution_id = public.current_institution_id()
  and s.is_active is true
  and smr.record_type in ('exemption','permission')
  and (smr.start_date is null or smr.start_date <= p_on_date)
  and (smr.end_date is null or smr.end_date >= p_on_date)
 order by s.full_name, smr.start_date nulls first;
$function$;
revoke all on function app_private.get_active_student_restrictions(date) from public, anon;
grant execute on function app_private.get_active_student_restrictions(date) to authenticated;

create or replace function public.get_active_student_restrictions(p_on_date date default current_date)
returns table (
 student_id uuid,
 student_code text,
 full_name text,
 record_type text,
 start_date date,
 end_date date
)
language sql stable security invoker
set search_path = public, app_private, pg_temp
as $function$
 select * from app_private.get_active_student_restrictions(p_on_date);
$function$;
revoke all on function public.get_active_student_restrictions(date) from public, anon;
grant execute on function public.get_active_student_restrictions(date) to authenticated;

-- == Report Export Policies ==

-- Institution admins can export their reports
drop policy if exists report_exports_institution on public.report_exports;
create policy report_exports_institution on public.report_exports for select to authenticated using(institution_id=public.current_institution_id() and public.current_app_role() in ('manager','admin'));
drop policy if exists report_exports_owner_view on public.report_exports;
create policy report_exports_owner_view on public.report_exports for select to authenticated using(public.is_platform_owner());

-- == Institution policies (preserved) ==
drop policy if exists institutions_select on public.institutions;
create policy institutions_select on public.institutions for select to authenticated using(id=public.current_institution_id() or public.is_platform_owner());
drop policy if exists institutions_owner_insert on public.institutions;
create policy institutions_owner_insert on public.institutions for insert to authenticated with check(public.is_platform_owner());
drop policy if exists institutions_owner_update on public.institutions;
create policy institutions_owner_update on public.institutions for update to authenticated using(public.is_platform_owner()) with check(public.is_platform_owner());
drop policy if exists institutions_manager_update on public.institutions;
create policy institutions_manager_update on public.institutions for update to authenticated using(id=public.current_institution_id() and public.current_app_role() in ('manager','admin')) with check(id=public.current_institution_id() and public.current_app_role() in ('manager','admin'));

-- == Audit log policies (preserved) ==
drop policy if exists audit_read_admin on public.audit_logs;
create policy audit_read_admin on public.audit_logs for select to authenticated
using (
 (public.is_platform_owner() and table_name = 'institutions')
 or (
  institution_id = public.current_institution_id()
  and public.current_app_role() in ('manager', 'admin')
 )
);

-- == Shift policies (preserved) ==
drop policy if exists shifts_read_own_admin on public.coach_shifts;
create policy shifts_read_own_admin on public.coach_shifts for select to authenticated using(institution_id=public.current_institution_id() and (coach_id=auth.uid() or public.is_institution_admin()));
drop policy if exists shifts_insert_own on public.coach_shifts;
create policy shifts_insert_own on public.coach_shifts for insert to authenticated with check(institution_id=public.current_institution_id() and coach_id=auth.uid() and public.current_app_role()='coach');
drop policy if exists shifts_update_own_admin on public.coach_shifts;
create policy shifts_update_own_admin on public.coach_shifts for update to authenticated using(institution_id=public.current_institution_id() and (coach_id=auth.uid() or public.is_institution_admin())) with check(institution_id=public.current_institution_id() and (coach_id=auth.uid() or public.is_institution_admin()));

-- == Student policies (preserved) ==
drop policy if exists students_read on public.students;
create policy students_read on public.students for select to authenticated using(institution_id=public.current_institution_id());
drop policy if exists students_admin_write on public.students;
create policy students_admin_write on public.students for all to authenticated using(institution_id=public.current_institution_id() and public.is_institution_admin()) with check(institution_id=public.current_institution_id() and public.is_institution_admin() and (class_id is null or exists(select 1 from public.classes c where c.id=class_id and c.institution_id=institution_id)));

-- == Medical policies (preserved) ==
drop policy if exists medical_admin_read on public.student_medical_records;
create policy medical_admin_read on public.student_medical_records for select to authenticated using(institution_id=public.current_institution_id() and public.current_app_role() in ('manager','admin'));
drop policy if exists medical_admin_insert on public.student_medical_records;
create policy medical_admin_insert on public.student_medical_records for insert to authenticated with check(institution_id=public.current_institution_id() and public.current_app_role() in ('manager','admin') and created_by=auth.uid() and exists(select 1 from public.students s where s.id=student_id and s.institution_id=institution_id));
drop policy if exists medical_admin_update on public.student_medical_records;
create policy medical_admin_update on public.student_medical_records for update to authenticated using(institution_id=public.current_institution_id() and public.current_app_role() in ('manager','admin')) with check(institution_id=public.current_institution_id() and public.current_app_role() in ('manager','admin') and exists(select 1 from public.students s where s.id=student_id and s.institution_id=institution_id));
drop policy if exists medical_admin_delete on public.student_medical_records;
create policy medical_admin_delete on public.student_medical_records for delete to authenticated using(institution_id=public.current_institution_id() and public.current_app_role() in ('manager','admin'));

-- == Notices policies (preserved) ==
drop policy if exists notices_read on public.admin_notices;
create policy notices_read on public.admin_notices for select to authenticated using(institution_id=public.current_institution_id() and (is_published or public.is_institution_admin()));
drop policy if exists notices_admin_write on public.admin_notices;
create policy notices_admin_write on public.admin_notices for all to authenticated using(institution_id=public.current_institution_id() and public.is_institution_admin()) with check(institution_id=public.current_institution_id() and public.is_institution_admin() and author_id=auth.uid());

-- == Conversations policies (preserved) ==
drop policy if exists conversations_read_member on public.conversations;
create policy conversations_read_member on public.conversations for select to authenticated using(institution_id=public.current_institution_id() and public.is_conversation_member(id));
drop policy if exists conversation_members_read on public.conversation_members;
create policy conversation_members_read on public.conversation_members for select to authenticated using(
 exists(select 1 from public.conversations c where c.id=conversation_id and c.institution_id=public.current_institution_id())
 and (public.is_conversation_member(conversation_id) or public.is_institution_admin())
);

-- == Student Notes policies (preserved) ==
drop policy if exists student_notes_read_shared on public.student_notes;
create policy student_notes_read_shared on public.student_notes for select to authenticated using(institution_id=public.current_institution_id() and (author_id=auth.uid() or public.is_institution_admin() or note_type<>'health_permission'));
drop policy if exists student_notes_insert_self on public.student_notes;
create policy student_notes_insert_self on public.student_notes for insert to authenticated with check(institution_id=public.current_institution_id() and author_id=auth.uid() and exists(select 1 from public.students s where s.id=student_id and s.institution_id=institution_id));
drop policy if exists student_notes_update_self_admin on public.student_notes;
create policy student_notes_update_self_admin on public.student_notes for update to authenticated using(institution_id=public.current_institution_id() and (author_id=auth.uid() or public.is_institution_admin())) with check(institution_id=public.current_institution_id() and exists(select 1 from public.students s where s.id=student_id and s.institution_id=institution_id));

-- == Admin Notices insert policy (preserved) ==
drop policy if exists notices_admin_write on public.admin_notices;
create policy notices_admin_write on public.admin_notices for all to authenticated using(institution_id=public.current_institution_id() and public.is_institution_admin()) with check(institution_id=public.current_institution_id() and public.is_institution_admin() and author_id=auth.uid());

-- == Ensure session_key column exists (additive) ==
alter table public.attendance_records add column if not exists session_key text not null default 'unspecified';

create unique index if not exists attendance_records_session_unique on public.attendance_records(student_id,session_date,session_key);

create index if not exists attendance_date_idx on public.attendance_records(institution_id,session_date desc);

-- Identity and authorization helpers. SECURITY DEFINER functions have fixed search_path.
create or replace function public.notify_new_notice() returns trigger
language plpgsql security definer set search_path=public,pg_temp
as $$ begin
 insert into public.notifications(institution_id,recipient_id,title,body,notification_type)
 select new.institution_id,p.id,new.title,new.body,'notice'
 from public.profiles p where p.institution_id=new.institution_id and p.account_status='active' and p.id<>new.author_id;
 return new;
end $$;
drop trigger if exists admin_notice_notify on public.admin_notices;
create trigger admin_notice_notify after insert on public.admin_notices for each row when (new.is_published=true) execute function public.notify_new_notice();

create or replace function public.notify_submitted_report() returns trigger language plpgsql security definer set search_path=public,pg_temp
as $$ begin
  if (TG_OP = 'INSERT' and new.is_finalized = true)
     or (TG_OP = 'UPDATE' and new.is_finalized = true
         and coalesce(old.is_finalized, false) = false) then
    insert into public.notifications(institution_id,recipient_id,title,body,notification_type)
    select new.institution_id,p.id,'Daily report submitted',new.coach_name_snapshot||' submitted a report for '||new.report_date::text,'report'
    from public.profiles p where p.institution_id=new.institution_id and p.account_status='active' and p.role in ('manager','admin');
  end if;
  return new;
end $$;
drop trigger if exists daily_report_notify on public.daily_reports;
create trigger daily_report_notify after insert or update on public.daily_reports for each row when (new.is_finalized=true) execute function public.notify_submitted_report();

-- Tell every other conversation member about a new message.
create or replace function public.notify_new_message() returns trigger
language plpgsql security definer set search_path=public,pg_temp
as $$ declare v_name text; v_preview text; begin
 select coalesce(nullif(p.full_name,''),p.email) into v_name from public.profiles p where p.id=new.sender_id;
 v_preview:=left(coalesce(nullif(trim(new.body),''),'[attachment]'),160);
 insert into public.notifications(institution_id,recipient_id,title,body,notification_type)
 select new.institution_id,cm.profile_id,'رسالة جديدة',coalesce(v_name,'')||': '||v_preview,'message'
 from public.conversation_members cm
 join public.profiles p on p.id=cm.profile_id and p.account_status='active'
 where cm.conversation_id=new.conversation_id and cm.profile_id<>new.sender_id;
 return new;
end $$;
drop trigger if exists message_notify on public.messages;
create trigger message_notify after insert on public.messages for each row execute function public.notify_new_message();

-- == Messaging tables (additive completion of the documented schema) ==
create table if not exists public.conversations (
  id uuid primary key default gen_random_uuid(),
  institution_id uuid not null references public.institutions(id) on delete cascade,
  title text,
  conversation_type text not null default 'direct' check (conversation_type in ('direct','group')),
  created_by uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now()
);
create index if not exists conversations_institution_idx on public.conversations(institution_id, created_at desc);

create table if not exists public.conversation_members (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  joined_at timestamptz not null default now(),
  unique (conversation_id, profile_id)
);
create index if not exists conversation_members_conversation_idx on public.conversation_members(conversation_id, profile_id);

create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  sender_id uuid not null references public.profiles(id) on delete cascade,
  institution_id uuid not null references public.institutions(id) on delete cascade,
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  body text,
  message_type text not null default 'text' check (message_type in ('text','image','audio','file')),
  media_path text,
  read_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists messages_conversation_created_idx on public.messages(conversation_id, created_at);

create table if not exists public.message_reads (
  message_id uuid not null references public.messages(id) on delete cascade,
  reader_id uuid not null references public.profiles(id) on delete cascade,
  read_at timestamptz not null default now(),
  primary key (message_id, reader_id)
);

-- == Messaging read and insert policies: conversation membership required ==
drop policy if exists messages_read_member on public.messages;
create policy messages_read_member on public.messages for select to authenticated using(institution_id=public.current_institution_id() and public.is_conversation_member(conversation_id));
drop policy if exists messages_insert_member on public.messages;
create policy messages_insert_member on public.messages for insert to authenticated with check(institution_id=public.current_institution_id() and public.is_conversation_member(conversation_id));

-- == Messaging read receipts and unread counts ==
-- Receipts are per user: one member reading a message never marks it read for
-- the rest of the conversation.
create or replace function public.mark_conversation_read(p_conversation_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$ begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if not public.is_conversation_member(p_conversation_id) then
    raise exception 'Not a conversation member';
  end if;
  insert into public.message_reads(message_id, reader_id, read_at)
  select m.id, auth.uid(), now()
    from public.messages m
   where m.conversation_id = p_conversation_id
     and m.sender_id <> auth.uid()
  on conflict (message_id, reader_id) do nothing;
  update public.conversation_members set last_read_at = now()
   where conversation_id = p_conversation_id and profile_id = auth.uid();
end $$;

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

-- == Attendance records table (additive) ==
create table if not exists public.attendance_records (
  id uuid primary key default gen_random_uuid(),
  institution_id uuid not null references public.institutions(id) on delete cascade,
  student_id uuid not null references public.students(id) on delete cascade,
  coach_id uuid not null references public.profiles(id) on delete cascade,
  session_date date not null,
  session_key text not null default 'unspecified',
  status text not null default 'present',
  reason text,
  created_at timestamptz not null default now()
);
create index if not exists attendance_records_inst_idx on public.attendance_records(institution_id, session_date);

-- == Absence follow-up tracking ==
create table if not exists public.absence_followups (
 id uuid primary key default gen_random_uuid(),
 institution_id uuid not null references public.institutions(id) on delete cascade,
 student_id uuid not null references public.students(id) on delete cascade,
 streak_start date not null,
 streak_start_key text not null default 'unspecified',
 streak_end date not null,
 streak_end_key text not null default 'unspecified',
 absences integer not null check (absences >= 5),
 status text not null default 'awaiting_return' check (status in ('awaiting_return','active','completed')),
 return_date date,
 return_session_key text,
 sessions_seen integer not null default 0 check (sessions_seen between 0 and 2),
 last_counted_date date,
 last_counted_session_key text,
 handled_at timestamptz,
 handled_by uuid references public.profiles(id),
 streak integer not null default 0,
 last_follow_up_at timestamptz,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 unique (student_id, streak_start, streak_start_key)
);
create index if not exists absence_followups_inst_status on public.absence_followups(institution_id, status);

drop policy if exists absence_followups_admin_insert on public.absence_followups;
create policy absence_followups_admin_insert on public.absence_followups for insert to authenticated
 with check (institution_id = public.current_institution_id() and public.is_institution_admin());

create or replace function public.track_absence_followup() returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
 v_perm boolean;
 v_count integer := 0;
 v_seen integer := 0;
 v_start_date date;
 v_start_key text;
 v_latest_date date;
 v_latest_key text;
 v_latest_status text;
 v_fu public.absence_followups%rowtype;
 v_name text;
 r record;
begin
 select coalesce(i.count_permissions_as_absence,false) into v_perm
  from public.institutions i where i.id=new.institution_id;
 v_perm:=coalesce(v_perm,false);

 select a.session_date,a.session_key,a.status
  into v_latest_date,v_latest_key,v_latest_status
  from public.attendance_records a
  where a.institution_id=new.institution_id and a.student_id=new.student_id
  order by a.session_date desc,a.session_key desc
  limit 1;
 if v_latest_date is null then return new; end if;

 for r in
  select s.session_date as sd,s.session_key as sk,a.status as st
  from (
   select distinct x.session_date,x.session_key
   from public.attendance_records x
   where x.institution_id=new.institution_id
     and (x.session_date<v_latest_date or (x.session_date=v_latest_date and x.session_key<=v_latest_key))
  ) s
  left join public.attendance_records a
    on a.institution_id=new.institution_id and a.student_id=new.student_id
   and a.session_date=s.session_date and a.session_key=s.session_key
  order by s.session_date desc,s.session_key desc
 loop
  exit when r.st is null or not (r.st='absent' or (v_perm and r.st in ('excused','medical_exemption','permission')));
  v_count:=v_count+1;
  v_start_date:=r.sd;
  v_start_key:=r.sk;
 end loop;

 if v_latest_status='absent' or (v_perm and v_latest_status in ('excused','medical_exemption','permission')) then
  if v_count>=5 then
   insert into public.absence_followups(institution_id,student_id,streak_start,streak_start_key,streak_end,streak_end_key,absences,streak)
   values(new.institution_id,new.student_id,v_start_date,v_start_key,v_latest_date,v_latest_key,v_count,v_count)
   on conflict(student_id,streak_start,streak_start_key) do update
     set streak_end=excluded.streak_end,
         streak_end_key=excluded.streak_end_key,
         absences=excluded.absences,
         streak=excluded.streak,
         updated_at=now()
     where public.absence_followups.status='awaiting_return';
  else
   update public.absence_followups f
    set status='completed',updated_at=now()
    where f.institution_id=new.institution_id and f.student_id=new.student_id
      and f.status='awaiting_return'
      and exists(
       select 1 from public.attendance_records a
       where a.institution_id=f.institution_id and a.student_id=f.student_id
         and (a.session_date,a.session_key) between (f.streak_start,f.streak_start_key) and (f.streak_end,f.streak_end_key)
         and not (a.status='absent' or (v_perm and a.status in ('excused','medical_exemption','permission')))
      );
  end if;
 elsif v_latest_status in ('present','late') then
  select * into v_fu from public.absence_followups
   where institution_id=new.institution_id and student_id=new.student_id and status='awaiting_return'
     and (v_latest_date,v_latest_key)>(streak_end,streak_end_key)
   order by streak_end desc,streak_end_key desc limit 1;
  if found then
   update public.absence_followups
     set status='active',return_date=v_latest_date,return_session_key=v_latest_key,
         sessions_seen=0,last_counted_date=v_latest_date,last_counted_session_key=v_latest_key,
         updated_at=now()
     where id=v_fu.id;
   select coalesce(nullif(full_name,''),'') into v_name from public.students where id=new.student_id;
   insert into public.notifications(institution_id,recipient_id,title,body,notification_type)
   values(new.institution_id,new.coach_id,'عودة تلميذ بعد غياب متتالٍ',
     'عاد التلميذ '||coalesce(v_name,'')||' بعد خمس غيابات متتالية أو أكثر. يرجى متابعته خلال الحصتين القادمتين.',
     'absence_followup');
  end if;
 end if;

 select * into v_fu from public.absence_followups
  where institution_id=new.institution_id and student_id=new.student_id and status='active'
  order by return_date desc,return_session_key desc limit 1;
 if found then
  select count(*)::integer into v_seen
  from (
   select distinct x.session_date,x.session_key
   from public.attendance_records x
   where x.institution_id=new.institution_id
     and (x.session_date>v_fu.return_date
          or (x.session_date=v_fu.return_date and x.session_key>coalesce(v_fu.return_session_key,'')))
     and (x.session_date<v_latest_date
          or (x.session_date=v_latest_date and x.session_key<=v_latest_key))
  ) s;
  update public.absence_followups
   set sessions_seen=least(v_seen,2),
       last_counted_date=v_latest_date,
       last_counted_session_key=v_latest_key,
       status=case when v_seen>=2 then 'completed' else 'active' end,
       updated_at=now()
   where id=v_fu.id;
 end if;
 return new;
end;
$$;

drop trigger if exists attendance_followup_trg on public.attendance_records;
create trigger attendance_followup_trg after insert or update of status on public.attendance_records for each row execute function public.track_absence_followup();

create or replace function public.mark_followup_handled(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
 if public.current_app_role() not in ('coach','admin','manager') then
  raise exception 'Only a coach, an administrator or the manager may handle a follow-up';
 end if;
 update public.absence_followups
  set handled_at=now(),handled_by=auth.uid(),updated_at=now()
  where id=p_id and institution_id=public.current_institution_id() and handled_at is null;
 if not found then raise exception 'Follow-up not found or already handled'; end if;
end;
$$;
revoke all on function public.mark_followup_handled(uuid) from public, anon;
grant execute on function public.mark_followup_handled(uuid) to authenticated;

DO $publication$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename='message_reads') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.message_reads;
  END IF;
END;
$publication$;

drop policy if exists absence_followups_admin_read on public.absence_followups;
drop policy if exists absence_followups_read on public.absence_followups;
create policy absence_followups_read on public.absence_followups for select to authenticated using(institution_id=public.current_institution_id() and public.is_active_member());

-- =============================================================
-- ROW LEVEL SECURITY
--
-- Every public table is protected. Policies are dropped and recreated so this
-- script is idempotent. The helper functions are SECURITY DEFINER, so a policy
-- can read the caller's profile without recursion.
-- =============================================================

alter table public.institutions enable row level security;
alter table public.profiles enable row level security;
alter table public.classes enable row level security;
alter table public.students enable row level security;
alter table public.student_medical_records enable row level security;
alter table public.coach_shifts enable row level security;
alter table public.daily_reports enable row level security;
alter table public.report_templates enable row level security;
alter table public.report_exports enable row level security;
alter table public.report_details enable row level security;
alter table public.student_notes enable row level security;
alter table public.admin_notices enable row level security;
alter table public.notifications enable row level security;
alter table public.coach_notebooks enable row level security;
alter table public.audit_logs enable row level security;
alter table public.invitations enable row level security;
alter table public.academic_years enable row level security;
alter table public.student_academic_enrollments enable row level security;
alter table public.conversations enable row level security;
alter table public.conversation_members enable row level security;
alter table public.messages enable row level security;
alter table public.message_reads enable row level security;
alter table public.attendance_records enable row level security;
alter table public.absence_followups enable row level security;
alter table public.push_subscriptions enable row level security;

-- Report deletion rules:
--   coach  : never (no delete policy at all);
--   admin  : reviewed reports only;
--   manager: any finalized report of the institution;
--   owner  : never (platform owner has no institution scope).
drop policy if exists reports_delete_manager on public.daily_reports;
create policy reports_delete_manager on public.daily_reports for delete to authenticated
 using (institution_id = public.current_institution_id() and public.current_app_role() = 'manager' and is_finalized);
drop policy if exists reports_delete_admin on public.daily_reports;
create policy reports_delete_admin on public.daily_reports for delete to authenticated
 using (institution_id = public.current_institution_id() and public.current_app_role() = 'admin' and is_finalized and status = 'reviewed');

-- Report exports: a coach exports their own finalized report; admins export
-- institution reports. The owner is read-only.
drop policy if exists report_exports_insert on public.report_exports;
create policy report_exports_insert on public.report_exports for insert to authenticated
 with check (
  institution_id = public.current_institution_id()
  and exported_by = auth.uid()
  and exists (
   select 1 from public.daily_reports r
    where r.id = report_id and r.institution_id = report_exports.institution_id
  )
 );

-- Student-level report details. Migration 0004 allows inserts/deletes only while
-- the parent report is still a draft; the same rule is repeated here.
drop policy if exists report_details_select on public.report_details;
create policy report_details_select on public.report_details for select to authenticated
 using (
  institution_id = public.current_institution_id()
  and (
   public.current_app_role() in ('manager','admin')
   or exists (select 1 from public.daily_reports r where r.id = report_details.report_id and r.institution_id = report_details.institution_id and r.coach_id = auth.uid())
  )
 );
drop policy if exists report_details_insert on public.report_details;
create policy report_details_insert on public.report_details for insert to authenticated
 with check (
  institution_id = public.current_institution_id()
  and (
   public.current_app_role() in ('manager','admin')
   or exists (select 1 from public.daily_reports r where r.id = report_details.report_id and r.institution_id = report_details.institution_id and r.coach_id = auth.uid() and not r.is_finalized)
  )
  and (student_id is null or exists (select 1 from public.students s where s.id = report_details.student_id and s.institution_id = report_details.institution_id))
 );
drop policy if exists report_details_update on public.report_details;
create policy report_details_update on public.report_details for update to authenticated
 using (
  institution_id = public.current_institution_id()
  and (
   public.current_app_role() in ('manager','admin')
   or exists (select 1 from public.daily_reports r where r.id = report_details.report_id and r.institution_id = report_details.institution_id and r.coach_id = auth.uid() and not r.is_finalized)
  )
 )
 with check (
  institution_id = public.current_institution_id()
  and (
   public.current_app_role() in ('manager','admin')
   or exists (select 1 from public.daily_reports r where r.id = report_details.report_id and r.institution_id = report_details.institution_id and r.coach_id = auth.uid() and not r.is_finalized)
  )
  and (student_id is null or exists (select 1 from public.students s where s.id = report_details.student_id and s.institution_id = report_details.institution_id))
 );
drop policy if exists report_details_delete on public.report_details;
create policy report_details_delete on public.report_details for delete to authenticated
 using (
  institution_id = public.current_institution_id()
  and (
   public.current_app_role() in ('manager','admin')
   or exists (select 1 from public.daily_reports r where r.id = report_details.report_id and r.institution_id = report_details.institution_id and r.coach_id = auth.uid() and not r.is_finalized)
  )
 );

drop policy if exists student_notes_delete_admin on public.student_notes;
create policy student_notes_delete_admin on public.student_notes for delete to authenticated
 using (institution_id = public.current_institution_id() and public.is_institution_admin());

drop policy if exists notifications_read_own on public.notifications;
create policy notifications_read_own on public.notifications for select to authenticated
 using (recipient_id = auth.uid());
drop policy if exists notifications_update_own on public.notifications;
create policy notifications_update_own on public.notifications for update to authenticated
 using (recipient_id = auth.uid()) with check (recipient_id = auth.uid());

-- The coach notebook is private: not even an administrator can read it.
drop policy if exists coach_notebooks_own on public.coach_notebooks;
create policy coach_notebooks_own on public.coach_notebooks for all to authenticated
 using (coach_id = auth.uid() and institution_id = public.current_institution_id())
 with check (coach_id = auth.uid() and institution_id = public.current_institution_id());

drop policy if exists audit_read_admin on public.audit_logs;
create policy audit_read_admin on public.audit_logs for select to authenticated
 using (
  (public.is_platform_owner() and table_name = 'institutions')
  or (institution_id = public.current_institution_id() and public.current_app_role() in ('manager','admin'))
 );

drop policy if exists invitations_read_admin on public.invitations;
create policy invitations_read_admin on public.invitations for select to authenticated
 using (public.is_platform_owner() or (institution_id = public.current_institution_id() and public.is_institution_admin()));
drop policy if exists invitations_admin_write on public.invitations;
create policy invitations_admin_write on public.invitations for all to authenticated
 using (institution_id = public.current_institution_id() and public.is_institution_admin())
 with check (institution_id = public.current_institution_id() and public.is_institution_admin());

-- Email invitation acceptance. The invitee must authenticate with the same
-- confirmed email address that received the invitation. New accounts remain pending
-- until a Manager/Owner completes the separate account review.
create or replace function public.my_pending_invitation()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_email text;
  v_email_confirmed_at timestamptz;
  v_row record;
begin
  if v_uid is null then return null; end if;
  select lower(coalesce(u.email, '')), u.email_confirmed_at
    into v_email, v_email_confirmed_at
    from auth.users u where u.id = v_uid;
  if coalesce(v_email, '') = '' or v_email_confirmed_at is null then return null; end if;
  select i.id, i.role, i.institution_id, i.invited_email, i.invited_name,
         i.delivery_method, i.expires_at, inst.name as institution_name
    into v_row
    from public.invitations i
    left join public.institutions inst on inst.id = i.institution_id
   where i.status = 'pending' and i.expires_at > now()
     and lower(coalesce(i.invited_email, '')) = v_email
   order by i.created_at desc, i.id desc limit 1;
  if not found then return null; end if;
  return jsonb_build_object(
    'id', v_row.id, 'role', v_row.role::text,
    'institution_id', v_row.institution_id,
    'institution_name', v_row.institution_name,
    'invited_email', v_row.invited_email,
    'invited_name', v_row.invited_name,
    'delivery_method', v_row.delivery_method::text,
    'expires_at', v_row.expires_at
  );
end;
$$;

create or replace function public.accept_email_invitation(p_invitation_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_auth_email text;
  v_email_confirmed_at timestamptz;
  v_inv public.invitations%rowtype;
  v_profile public.profiles%rowtype;
  v_keep_active boolean := false;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'error', 'authentication_required');
  end if;
  select lower(coalesce(u.email, '')), u.email_confirmed_at
    into v_auth_email, v_email_confirmed_at
    from auth.users u where u.id = v_uid;
  if not found or coalesce(v_auth_email, '') = '' or v_email_confirmed_at is null then
    return jsonb_build_object('ok', false, 'error', 'confirmed_email_required');
  end if;
  select * into v_inv from public.invitations where id = p_invitation_id for update;
  if not found then return jsonb_build_object('ok', false, 'error', 'invitation_not_found'); end if;
  if v_inv.delivery_method::text <> 'email'
     or lower(coalesce(v_inv.invited_email, '')) <> v_auth_email then
    return jsonb_build_object('ok', false, 'error', 'recipient_mismatch');
  end if;
  if v_inv.role is null or v_inv.role::text = 'owner' then
    return jsonb_build_object('ok', false, 'error', 'owner_role_forbidden');
  end if;
  if v_inv.status::text = 'accepted' then
    if v_inv.accepted_by = v_uid then
      return jsonb_build_object('ok', true, 'already_accepted', true,
        'user_id', v_uid, 'role', v_inv.role::text,
        'institution_id', v_inv.institution_id, 'account_status', 'pending');
    end if;
    return jsonb_build_object('ok', false, 'error', 'invitation_already_accepted');
  end if;
  if v_inv.status::text <> 'pending' then
    return jsonb_build_object('ok', false, 'error', 'invitation_not_pending');
  end if;
  if v_inv.expires_at is null or v_inv.expires_at <= now() then
    update public.invitations set status = 'expired', updated_at = now() where id = v_inv.id;
    return jsonb_build_object('ok', false, 'error', 'invitation_expired');
  end if;
  if v_inv.institution_id is null
     or not exists (select 1 from public.institutions i where i.id = v_inv.institution_id) then
    return jsonb_build_object('ok', false, 'error', 'institution_not_found');
  end if;
  select * into v_profile from public.profiles where id = v_uid for update;
  if not found then
    insert into public.profiles (id, email, full_name, role, institution_id, account_status, created_by)
    values (v_uid, v_auth_email, coalesce(v_inv.invited_name, ''),
      v_inv.role, v_inv.institution_id, 'pending', v_inv.inviter_id)
    on conflict (id) do nothing;
    select * into v_profile from public.profiles where id = v_uid for update;
  end if;
  if lower(coalesce(v_profile.email, '')) <> v_auth_email then
    return jsonb_build_object('ok', false, 'error', 'profile_email_mismatch');
  end if;
  if v_profile.role::text = 'owner' then
    return jsonb_build_object('ok', false, 'error', 'owner_protected');
  end if;
  if v_profile.account_status::text in ('suspended', 'rejected') then
    return jsonb_build_object('ok', false, 'error', 'account_not_eligible');
  end if;
  if v_profile.account_status::text = 'active' then
    if v_profile.institution_id is distinct from v_inv.institution_id
       or v_profile.role is distinct from v_inv.role then
      return jsonb_build_object('ok', false, 'error', 'active_account_conflict');
    end if;
    v_keep_active := true;
  elsif v_profile.account_status::text <> 'pending' then
    return jsonb_build_object('ok', false, 'error', 'account_not_eligible');
  end if;
  perform set_config('app.account_repair', 'on', true);
  update public.profiles
     set role = v_inv.role,
         institution_id = v_inv.institution_id,
         account_status = case when v_keep_active then 'active' else 'pending' end,
         full_name = coalesce(nullif(v_inv.invited_name, ''), full_name),
         email = v_auth_email,
         created_by = coalesce(created_by, v_inv.inviter_id),
         updated_at = now()
   where id = v_uid;
  perform set_config('app.account_repair', 'off', true);
  update public.invitations
     set status = 'accepted', accepted_by = v_uid, accepted_at = now(), updated_at = now()
   where id = v_inv.id;
  insert into public.audit_logs (institution_id, actor_id, action, table_name, record_id, old_data, new_data)
  values (
    v_inv.institution_id, v_uid, 'invitation_accepted', 'invitations', v_inv.id::text,
    jsonb_build_object('status', v_inv.status::text, 'role', v_profile.role::text,
      'institution_id', v_profile.institution_id, 'account_status', v_profile.account_status::text),
    jsonb_build_object('status', 'accepted', 'role', v_inv.role::text,
      'institution_id', v_inv.institution_id,
      'account_status', case when v_keep_active then 'active' else 'pending' end)
  );
  return jsonb_build_object('ok', true, 'user_id', v_uid, 'role', v_inv.role::text,
    'institution_id', v_inv.institution_id,
    'account_status', case when v_keep_active then 'active' else 'pending' end,
    'message', 'invitation_accepted_pending_approval');
end;
$$;

revoke all on function public.my_pending_invitation() from public, anon;
revoke all on function public.accept_email_invitation(uuid) from public, anon;
grant execute on function public.my_pending_invitation() to authenticated;
grant execute on function public.accept_email_invitation(uuid) to authenticated;

drop policy if exists academic_years_read on public.academic_years;
create policy academic_years_read on public.academic_years for select to authenticated
 using (institution_id = public.current_institution_id());
drop policy if exists academic_years_admin_write on public.academic_years;
create policy academic_years_admin_write on public.academic_years for all to authenticated
 using (institution_id = public.current_institution_id() and public.is_institution_admin())
 with check (institution_id = public.current_institution_id() and public.is_institution_admin());

drop policy if exists academic_enrollments_read on public.student_academic_enrollments;
create policy academic_enrollments_read on public.student_academic_enrollments for select to authenticated
 using (institution_id = public.current_institution_id());
drop policy if exists academic_enrollments_admin_write on public.student_academic_enrollments;
create policy academic_enrollments_admin_write on public.student_academic_enrollments for all to authenticated
 using (institution_id = public.current_institution_id() and public.is_institution_admin())
 with check (
  institution_id = public.current_institution_id()
  and public.is_institution_admin()
  and exists (select 1 from public.students s where s.id = student_id and s.institution_id = institution_id)
  and exists (select 1 from public.academic_years y where y.id = academic_year_id and y.institution_id = institution_id)
 );

drop policy if exists attendance_read on public.attendance_records;
create policy attendance_read on public.attendance_records for select to authenticated
 using (institution_id = public.current_institution_id() and (coach_id = auth.uid() or public.is_institution_admin()));
drop policy if exists attendance_insert on public.attendance_records;
create policy attendance_insert on public.attendance_records for insert to authenticated
 with check (
  institution_id = public.current_institution_id()
  and (coach_id = auth.uid() or public.is_institution_admin())
 );
drop policy if exists attendance_update on public.attendance_records;
create policy attendance_update on public.attendance_records for update to authenticated
 using (institution_id = public.current_institution_id() and (coach_id = auth.uid() or public.is_institution_admin()))
 with check (institution_id = public.current_institution_id() and (coach_id = auth.uid() or public.is_institution_admin()));
drop policy if exists attendance_delete_admin on public.attendance_records;
create policy attendance_delete_admin on public.attendance_records for delete to authenticated
 using (institution_id = public.current_institution_id() and public.is_institution_admin());

drop policy if exists push_subscriptions_own on public.push_subscriptions;
create policy push_subscriptions_own on public.push_subscriptions for all to authenticated
 using (user_id = auth.uid())
 with check (user_id = auth.uid() and institution_id = public.current_institution_id());
drop policy if exists absence_followups_admin_update on public.absence_followups;
create policy absence_followups_admin_update on public.absence_followups for update to authenticated
 using (institution_id = public.current_institution_id() and public.is_institution_admin())
 with check (institution_id = public.current_institution_id() and public.is_institution_admin());

drop policy if exists message_reads_read_own on public.message_reads;
drop policy if exists message_reads_select on public.message_reads;
create policy message_reads_select on public.message_reads for select to authenticated
 using (exists (select 1 from public.messages m where m.id = message_id and public.is_conversation_member(m.conversation_id) and (reader_id = auth.uid() or m.sender_id = auth.uid())));
drop policy if exists message_reads_insert_own on public.message_reads;
create policy message_reads_insert_own on public.message_reads for insert to authenticated
 with check (
  reader_id = auth.uid()
  and exists (select 1 from public.messages m where m.id = message_id and public.is_conversation_member(m.conversation_id))
 );
drop policy if exists message_reads_update_own on public.message_reads;

-- == Private storage buckets for medical and conversation media ==
insert into storage.buckets (id, name, public) values
  ('trainer-avatars','trainer-avatars',false),
  ('trainer-media','trainer-media',false),
  ('trainer-medical','trainer-medical',false),
  ('trainer-report-templates','trainer-report-templates',false)
on conflict (id) do nothing;

-- Object paths are always scoped by institution:
--   trainer-avatars          <institution|platform>/<user>/<file>
--   trainer-medical          <institution>/<user>/<file>
--   trainer-media            <institution>/<conversation>/<user>/<file>
--   trainer-report-templates <institution>/<file>
-- A policy therefore never grants access to another institution's folder.

-- Avatars and institution logos: readable by the institution, writable only by
-- the owning user inside their own folder.
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
drop policy if exists trainer_avatars_insert on storage.objects;
create policy trainer_avatars_insert on storage.objects for insert to authenticated
 with check (
  bucket_id = 'trainer-avatars'
  and (storage.foldername(name))[2] = auth.uid()::text
  and (storage.foldername(name))[1] in (public.current_institution_id()::text, 'platform')
 );
drop policy if exists trainer_avatars_update on storage.objects;
create policy trainer_avatars_update on storage.objects for update to authenticated
 using (
  bucket_id = 'trainer-avatars'
  and (storage.foldername(name))[2] = auth.uid()::text
 )
 with check (
  bucket_id = 'trainer-avatars'
  and (storage.foldername(name))[2] = auth.uid()::text
 );

-- Medical attachments: institution Manager/Admin only. Coaches and Owner cannot read.
drop policy if exists trainer_medical_admin_read on storage.objects;
drop policy if exists trainer_medical_manager_admin_read on storage.objects;
create policy trainer_medical_manager_admin_read on storage.objects for select to authenticated
 using (
  bucket_id = 'trainer-medical'
  and public.current_app_role() in ('manager','admin')
  and (storage.foldername(name))[1] = public.current_institution_id()::text
 );
drop policy if exists trainer_medical_admin_insert on storage.objects;
drop policy if exists trainer_medical_manager_admin_upload on storage.objects;
create policy trainer_medical_manager_admin_upload on storage.objects for insert to authenticated
 with check (
  bucket_id = 'trainer-medical'
  and public.current_app_role() in ('manager','admin')
  and (storage.foldername(name))[1] = public.current_institution_id()::text
  and (storage.foldername(name))[2] = auth.uid()::text
 );
drop policy if exists trainer_medical_manager_admin_update on storage.objects;
create policy trainer_medical_manager_admin_update on storage.objects for update to authenticated
 using (
  bucket_id = 'trainer-medical'
  and public.current_app_role() in ('manager','admin')
  and (storage.foldername(name))[1] = public.current_institution_id()::text
 )
 with check (
  bucket_id = 'trainer-medical'
  and public.current_app_role() in ('manager','admin')
  and (storage.foldername(name))[1] = public.current_institution_id()::text
 );
drop policy if exists trainer_medical_admin_delete on storage.objects;
drop policy if exists trainer_medical_manager_admin_delete on storage.objects;
create policy trainer_medical_manager_admin_delete on storage.objects for delete to authenticated
 using (
  bucket_id = 'trainer-medical'
  and public.current_app_role() in ('manager','admin')
  and (storage.foldername(name))[1] = public.current_institution_id()::text
 );

-- Conversation media: only members of that conversation may read or write.
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
drop policy if exists trainer_media_insert on storage.objects;
create policy trainer_media_insert on storage.objects for insert to authenticated
 with check (
  bucket_id = 'trainer-media'
  and (storage.foldername(name))[1] = public.current_institution_id()::text
  and (storage.foldername(name))[3] = auth.uid()::text
  and exists (
   select 1 from public.conversation_members cm
    where cm.profile_id = auth.uid()
      and cm.conversation_id::text = (storage.foldername(name))[2]
  )
 );
drop policy if exists trainer_media_delete on storage.objects;
create policy trainer_media_delete on storage.objects for delete to authenticated
 using (
  bucket_id = 'trainer-media'
  and (storage.foldername(name))[3] = auth.uid()::text
 );

-- Institution Word templates: readable by members (a coach exports their own
-- report), writable by institution administrators only.
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

-- Table privileges. RLS still decides row visibility; these grants only allow
-- signed-in users to reach the tables through the API.
grant usage on schema public to authenticated;
grant select, insert, update, delete on all tables in schema public to authenticated;
revoke all on all tables in schema public from anon;

-- Application RPCs are for signed-in users only.
revoke all on function public.create_conversation(text, uuid[]) from public, anon;
revoke all on function public.mark_conversation_read(uuid) from public, anon;
revoke all on function public.unread_counts() from public, anon;
revoke all on function public.mark_followup_handled(uuid) from public, anon;
grant execute on function public.create_conversation(text, uuid[]) to authenticated;
grant execute on function public.mark_conversation_read(uuid) to authenticated;
grant execute on function public.unread_counts() to authenticated;
grant execute on function public.mark_followup_handled(uuid) to authenticated;

commit;

-- ============================================================================
-- SECTION 99 — SECURITY HARDENING 2026-11-19 (same content as
-- migrations/20261119000000_security_hardening.sql)
-- ============================================================================

-- ---------------------------------------------------------------------------
-- F-02  The platform owner must not read coach reports or their exports.
-- ---------------------------------------------------------------------------
drop policy if exists reports_owner_read_all on public.daily_reports;
drop policy if exists report_exports_owner_view on public.report_exports;

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

create or replace function public.submit_daily_report(p_report_id uuid)
returns public.daily_reports
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_report public.daily_reports;
  v_user_id uuid := auth.uid();
  v_institution_id uuid := public.current_institution_id();
begin
  if v_user_id is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;

  if public.current_app_role() <> 'coach'::public.app_role then
    raise exception 'Only the report owner coach can submit a report' using errcode = '42501';
  end if;

  if v_institution_id is null then
    raise exception 'Active institution context required' using errcode = '42501';
  end if;

  select * into v_report
  from public.daily_reports
  where id = p_report_id
    and institution_id = v_institution_id
    and coach_id = v_user_id
    and is_finalized is false
    and status = 'draft'
  for update;

  if not found then
    raise exception 'Draft report not found, already submitted, or not owned by current coach'
      using errcode = 'P0002';
  end if;

  update public.daily_reports
     set status = 'submitted',
         is_finalized = true,
         finalized_at = coalesce(finalized_at, transaction_timestamp()),
         submitted_at = null
   where id = p_report_id
     and institution_id = v_institution_id
     and coach_id = v_user_id
     and is_finalized is false
     and status = 'draft'
  returning * into v_report;

  if not found then
    raise exception 'Report could not be submitted because its state changed'
      using errcode = '40001';
  end if;

  return v_report;
end;
$$;
revoke all on function public.submit_daily_report(uuid) from public, anon;
grant execute on function public.submit_daily_report(uuid) to authenticated;

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

