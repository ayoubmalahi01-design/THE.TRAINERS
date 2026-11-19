import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

// Static contract tests: they read the repository files. They do NOT replace a live
// RLS test against Supabase with real accounts (see docs).
const sql = readFileSync(new URL('../supabase/THE_TRAINERS_SETUP.sql', import.meta.url), 'utf8')
const migration = readFileSync(new URL('../supabase/pending/20261119000000_security_hardening_REVIEW_REQUIRED.sql', import.meta.url), 'utf8')
const app = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8')
const hardening = sql.split('SECTION 99')[1] ?? ''

test('setup SQL contains no malformed "drop policy ... for/with check" statement', () => {
  const bad = sql.split('\n').filter((line) => /^\s*drop policy\b/i.test(line) && /\b(for (select|insert|update|delete|all)|with check|using\s*\()/i.test(line))
  assert.deepEqual(bad, [])
})

test('messages INSERT policy is created (not only dropped)', () => {
  assert.match(sql, /create policy messages_insert_member on public\.messages for insert/i)
})

test('platform owner read policies on coach reports and exports are removed', () => {
  assert.match(hardening, /drop policy if exists reports_owner_read_all on public\.daily_reports/i)
  assert.match(hardening, /drop policy if exists report_exports_owner_view on public\.report_exports/i)
})

test('administration reads only FINAL reports; drafts stay private to the coach', () => {
  assert.match(hardening, /create policy reports_read_own_admin[\s\S]*?coach_id = auth\.uid\(\)[\s\S]*?is_finalized and public\.current_app_role\(\) in \('manager','admin'\)/i)
})

test('report_details can be written only by the owning coach on a non-final report', () => {
  for (const name of ['report_details_insert', 'report_details_update', 'report_details_delete']) {
    const block = hardening.split(`create policy ${name}`)[1]?.split('create policy')[0] ?? ''
    assert.match(block, /r\.coach_id = auth\.uid\(\)/, name)
    assert.match(block, /not r\.is_finalized/, name)
    assert.doesNotMatch(block, /'manager'|'admin'/, name)
  }
})

test('coach inserts and updates are drafts only; finalising uses submit_daily_report', () => {
  assert.match(hardening, /create policy reports_insert_own[\s\S]*?not is_finalized[\s\S]*?status = 'draft'/i)
  assert.match(hardening, /create or replace function public\.submit_daily_report/i)
  assert.match(hardening, /revoke all on function public\.submit_daily_report\(uuid\) from public, anon/i)
})

test('a coach may delete only his own unsent draft', () => {
  const block = hardening.split('create policy reports_delete_own_draft')[1]?.split('create policy')[0] ?? ''
  assert.match(block, /coach_id = auth\.uid\(\)/)
  assert.match(block, /not is_finalized/)
})

test('medical records and files are restricted to institution managers/admins', () => {
  assert.doesNotMatch(hardening, /medical_coach_read|medical_member_read|trainer_medical_coach_read|trainer_medical_member_read/i)
  assert.match(sql, /medical_admin_read[\s\S]*?public\.current_app_role\(\)\s+in\s+\('manager','admin'\)/i)
  assert.match(sql, /trainer_medical_manager_admin_read[\s\S]*?public\.current_app_role\(\)\s+in\s+\('manager','admin'\)/i)
})

test('institution admins cannot write invitations directly', () => {
  assert.match(hardening, /drop policy if exists invitations_admin_write on public\.invitations/i)
})

test('avatar update and media delete are institution scoped', () => {
  const avatar = hardening.split('create policy trainer_avatars_update')[1]?.split('create policy')[0] ?? ''
  const media = hardening.split('create policy trainer_media_delete')[1]?.split('update storage.buckets')[0] ?? ''
  assert.match(avatar, /current_institution_id\(\)::text/)
  assert.match(media, /\[1\] = public\.current_institution_id\(\)::text/)
})

test('security hardening migration is transactional and non-destructive', () => {
  assert.ok(migration.length > 1000)
  assert.doesNotMatch(migration, /drop\s+table\s+public\.|truncate\s+table\s+public\./i)
  assert.match(migration, /review required|security hardening/i)
})

test('report updates never resend the immutable identity columns', () => {
  assert.match(app, /function withoutReportIdentity/)
  assert.match(app, /\.update\(withoutReportIdentity\(payload\)\)/)
  assert.match(app, /\.\.\.withoutReportIdentity\(content\)/)
})

test('Cancel in the report form discards the draft after confirmation', () => {
  assert.match(app, /async function cancelReport\(\)/)
  assert.match(app, /onClick=\{cancelReport\}/)
  const body = app.split('async function cancelReport()')[1]?.split('function continueDraft')[0] ?? ''
  assert.match(body, /clearReportDraft\(profile\.id\)/)
  assert.match(body, /\.from\('daily_reports'\)\s*\.delete\(\)/)
  assert.match(body, /\.eq\('is_finalized', false\)/)
})

test('returning from the file picker does not reload the profile of the same user', () => {
  assert.match(app, /profileRef\.current\?\.id === next\.user\.id/)
})

test('archiving a student asks for confirmation and checks the affected row', () => {
  const body = app.split('async function toggleActive(student: Student)')[1]?.split('async function openNotes')[0] ?? ''
  assert.match(body, /window\.confirm\(/)
  assert.match(body, /affectedRows\(data\)/)
})

test('logout clears the locally stored report draft', () => {
  assert.match(app, /clearReportDraft\(profile\.id\)\s*\n\s*await supabase\.auth\.signOut\(\)/)
})


test('follow-up UI uses the production RPC signature and persisted handled timestamp', () => {
  const app = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8')
  const queue = app.slice(app.indexOf('function FollowUpQueue'), app.indexOf('function InstitutionSettings'))
  assert.match(queue, /mark_followup_handled', \{ p_id: item\.id \}/)
  assert.match(queue, /handled_at/)
  assert.doesNotMatch(queue, /p_student_id|p_status|status: nextStatus/)
})

test('platform owner audit policy exposes institution events only', () => {
  assert.match(sql, /is_platform_owner\(\)\s+and table_name = 'institutions'/i)
})

test('message read receipts are visible only to a conversation member who is reader or sender', () => {
  const block = sql.split('create policy message_reads_select')[1]?.split('create policy')[0] ?? ''
  assert.match(block, /is_conversation_member\(m\.conversation_id\)/)
  assert.match(block, /reader_id = auth\.uid\(\) or m\.sender_id = auth\.uid\(\)/)
  assert.match(sql, /create policy message_reads_insert_own[\s\S]*?reader_id = auth\.uid\(\)/i)
  assert.match(sql, /alter publication supabase_realtime add table public\.message_reads/i)
})

test('chat displays sender read receipts and refreshes them through Realtime', () => {
  assert.match(app, /from\('message_reads'\)[\s\S]*?select\('message_id,reader_id,read_at'\)/)
  assert.match(app, /messageReadBy/)
  assert.match(app, /table: 'message_reads'/)
})

test('notice readers and non-readers are both computed from active institution members', () => {
  const block = app.slice(app.indexOf('async function loadReaders'), app.indexOf('async function deleteNotice'))
  assert.match(block, /from\('notice_reads'\)/)
  assert.match(block, /from\('profiles'\)/)
  assert.match(block, /account_status', 'active'/)
  assert.match(block, /setNonReaders\(members\.filter/)
  assert.match(app, /whoNotRead/)
})


test('review timestamp is assigned by the database, not the client clock', () => {
  const reviewBlock = app.slice(app.indexOf('async function review('), app.indexOf('async function currentTemplate'))
  assert.match(reviewBlock, /update\(\{ status: 'reviewed', reviewed_by: profile\.id \}\)/)
  assert.doesNotMatch(reviewBlock, /reviewed_at|new Date\(/)
  assert.match(readFileSync(new URL('../supabase/migrations/20261119113453_stamp_report_review_time_server_side_20261119.sql', import.meta.url), 'utf8'), /NEW\.reviewed_at := transaction_timestamp\(\)/)
})

test('Word export includes report review metadata and full student detail fields', () => {
  assert.match(app, /select\('student_name_snapshot,attendance_status,observation,incident,injury_details,notes'\)/)
  assert.match(app, /reviewedAt: row\.reviewed_at/)
  assert.match(app, /injuryDetails: detail\.injury_details/)
  const template = readFileSync(new URL('../src/lib/report-template.ts', import.meta.url), 'utf8')
  assert.match(template, /reviewed_at/)
  assert.match(template, /injuryDetails/)
  const exportModule = readFileSync(new URL('../src/lib/report-export.ts', import.meta.url), 'utf8')
  assert.match(exportModule, /Student details/)
  assert.match(exportModule, /Reviewed at/)
})
