import fs from 'node:fs'
import path from 'node:path'

const root = process.cwd()
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8')

const required = [
  'src/App.tsx',
  'src/styles.css',
  'src/lib/supabase.ts',
  'src/lib/i18n.ts',
  'src/lib/account-policy.ts',
  'src/lib/account-gate.ts',
  'src/lib/report-permissions.ts',
  'src/lib/report-details.ts',
  'src/lib/absence.ts',
  'src/lib/student-import.ts',
  'tests/student-import.test.ts',
  'supabase/migrations/20261119120402_daily_student_status_and_coach_report_template_access.sql',
  'supabase/migrations/20261119121224_move_restriction_rpc_to_private_schema.sql',
  'supabase/migrations/20261119132835_coach_management_report_forms.sql',
  'src/lib/report-template.ts',
  'src/lib/report-template-render.ts',
  'tests/otp-security.test.ts',
  'tests/account-policy.test.ts',
  'tests/account-permissions.test.ts',
  'tests/report-permissions.test.ts',
  'tests/report-details.test.ts',
  'tests/absence.test.ts',
  'tests/report-template.test.ts',
  'supabase/THE_TRAINERS_SETUP.sql',
  'supabase/pending/SUPABASE_PENDING_CHANGES_REVIEW_REQUIRED.sql',
  'supabase/INVITATIONS_OTP_INCREMENTAL.sql',
  'supabase/manual-applied/legacy/0003_account_management_repair.sql',
  'supabase/manual-applied/legacy/0004_report_templates_details_notifications.sql',
  'supabase/functions/invite-user/index.ts',
  'supabase/functions/verify-otp/index.ts',
  'supabase/functions/send-whatsapp/index.ts',
  'supabase/functions/send-sms/index.ts',
  'supabase/functions/_shared/http.ts',
  'supabase/config.toml',
  'public/manifest.webmanifest',
  'public/sw.js',
  'README.md',
  'cloudflare/DEPLOYMENT.md',
  '.gitignore',
  'wrangler.toml',
  '.env.example',
]

const missing = required.filter((file) => !fs.existsSync(path.join(root, file)))
if (missing.length) {
  console.error('Missing required files:', missing.join(', '))
  process.exit(1)
}

const sql = read('supabase/THE_TRAINERS_SETUP.sql')
const migration = read('supabase/INVITATIONS_OTP_INCREMENTAL.sql')
const repair = read('supabase/manual-applied/legacy/0003_account_management_repair.sql')
const policy = read('src/lib/account-policy.ts')
const app = read('src/App.tsx')
const studentImport = read('src/lib/student-import.ts')
const statusMigration = read('supabase/migrations/20261119120402_daily_student_status_and_coach_report_template_access.sql')
const privateRpcMigration = read('supabase/migrations/20261119121224_move_restriction_rpc_to_private_schema.sql')
const managementReportMigration = read('supabase/migrations/20261119132835_coach_management_report_forms.sql')
const styles = read('src/styles.css')
const envExample = read('.env.example')
const config = read('supabase/config.toml')
const invite = read('supabase/functions/invite-user/index.ts')
const verify = read('supabase/functions/verify-otp/index.ts')
const whatsapp = read('supabase/functions/send-whatsapp/index.ts')
const sms = read('supabase/functions/send-sms/index.ts')
const shared = read('supabase/functions/_shared/http.ts')
const verifyScript = fs.existsSync(path.join(root, 'verify_supabase.mjs'))
  ? read('verify_supabase.mjs')
  : ''

/**
 * Extract every `json(req, { ... })` object literal from a function. Used to
 * prove that no response body contains an OTP or its hash.
 */
function jsonResponseBodies(source) {
  const bodies = []
  const marker = /json\s*\(\s*req\s*,\s*\{/g
  let match
  while ((match = marker.exec(source)) !== null) {
    let index = marker.lastIndex - 1
    let depth = 0
    let end = index
    for (; end < source.length; end += 1) {
      if (source[end] === '{') depth += 1
      if (source[end] === '}') {
        depth -= 1
        if (depth === 0) {
          end += 1
          break
        }
      }
    }
    bodies.push(source.slice(index, end))
  }
  return bodies
}

/** Source between two markers, for checking one component at a time. */
function between(source, start, end) {
  const from = source.indexOf(start)
  if (from < 0) return ''
  const to = source.indexOf(end, from)
  return to > from ? source.slice(from, to) : ''
}

const responseBodies = [invite, verify, whatsapp, sms].flatMap(jsonResponseBodies)
const edgeFunctions = [invite, verify, whatsapp, sms, shared]
const otpFunctions = [
  'generate_otp_code(uuid, uuid)',
  'verify_otp_code(uuid, text, uuid)',
  'revoke_otp_code(uuid, text)',
  'get_otp_statistics()',
  'expire_stale_invitations()',
]

const checks = [
  // ---------------------------------------------------------------- existing app
  ['absence follow-up flag', /track_absence_followup/.test(sql) && /absence_followups/.test(sql)],
  ['message read receipts', /mark_conversation_read/.test(sql) && /unread_counts/.test(sql)],
  ['rejected account status', /'rejected'/.test(sql)],
  ['env key name consistent', /VITE_SUPABASE_ANON_KEY/.test(envExample)],
  ['platform owner role', /create\s+type\s+public\.app_role\s+as\s+enum\s*\([^)]*'owner'/is.test(sql)],
  ['coach-private notebook RLS', /coach_notebooks[\s\S]*?coach_id=auth\.uid\(\)/i.test(sql)],
  ['coach report privacy RLS', /reports_read_own_admin[\s\S]*?coach_id=auth\.uid\(\)/i.test(sql)],
  ['medical records admin-only RLS', /medical_admin_read[\s\S]*?current_app_role\(\)\s+in\s+\('manager','admin'\)/i.test(sql)],
  ['medical media private bucket', /trainer_medical_manager_admin_read[\s\S]*?trainer-medical/i.test(sql)],
  ['private notebook excluded from audit snapshots', !/coach_notebooks.*_audit/.test(sql)],
  ['institution isolation', /current_institution_id\(\)/i.test(sql)],
  ['owner email bootstrap', /ayoubmalleh772@gmail\.com/i.test(sql)],
  ['self-promotion guard', /guard_profile_privileges[\s\S]*?cannot change your own role/i.test(sql)],
  ['final report immutability', /lock_final_report[\s\S]*?Finalized reports are immutable/i.test(sql)],
  ['notice notifications', /notify_new_notice[\s\S]*?insert into public\.notifications/i.test(sql)],
  ['edge invite function', /inviteUserByEmail/.test(invite)],
  ['attendance workflow', /function Attendance\(/.test(app)],
  ['private notebook UI', /function Notebook\(/.test(app)],
  ['team invitation UI', /function Team\(/.test(app)],
  ['media upload and audio capture', /MediaRecorder/.test(app) && /storage\.from\('trainer-media'\)\.upload/.test(app)],
  ['bulk Excel/CSV student import', /parseStudentImportText/.test(app) && /parseStudentImportMatrix/.test(studentImport) && /importBulk/.test(app)],
  ['Arabic/French/English student import headers', /matricule/.test(studentImport) && /اللقب/.test(studentImport) && /full_name/.test(studentImport)],
  ['daily status dashboard and page', /daily-status/.test(app) && /function DailyStatus/.test(app)],
  ['sanitized active restriction RPC', /get_active_student_restrictions/.test(statusMigration) && /RETURNS TABLE[\s\S]*?record_type text[\s\S]*?start_date date[\s\S]*?end_date date/i.test(statusMigration) && !/smr\.(details|attachment_path)/i.test(statusMigration)],
  ['coach current Word template access', /current_app_role\(\) = 'coach'[\s\S]*?is_current IS TRUE[\s\S]*?is_archived IS FALSE/i.test(statusMigration)],
  ['restriction lookup uses private definer and public invoker', /CREATE SCHEMA IF NOT EXISTS app_private/i.test(privateRpcMigration) && /app_private\.get_active_student_restrictions[\s\S]*?SECURITY DEFINER/i.test(privateRpcMigration) && /CREATE FUNCTION public\.get_active_student_restrictions[\s\S]*?SECURITY INVOKER/i.test(privateRpcMigration)],
  ['direct and group conversation creation', /create_conversation/.test(app) && /conversation_type/.test(app)],
  ['conversation-scoped message reads and writes', /eq\('conversation_id',id\)/.test(app) && /conversation_id:current\.id/.test(app)],
  ['owner cannot read coach reports (policy removed)', !/create policy reports_owner_read_all/i.test(sql.split('SECTION 99')[0]) || /drop policy if exists reports_owner_read_all/i.test(sql.split('SECTION 99')[1] ?? '')],
  ['drafts are private to their coach', /create policy reports_read_own_admin[\s\S]*?is_finalized and public\.current_app_role\(\) in \('manager','admin'\)/i.test(sql)],
  ['coach may delete only his own unsent draft', /create policy reports_delete_own_draft[\s\S]*?not is_finalized/i.test(sql)],
  ['submit_daily_report is defined in the repository', /create or replace function public\.submit_daily_report/i.test(sql)],
  ['conversation membership enforced for messages', /messages_read_member[\s\S]*?is_conversation_member\(conversation_id\)/i.test(sql) && /create policy messages_insert_member on public\.messages for insert[\s\S]*?is_conversation_member\(conversation_id\)/i.test(sql) && !/drop policy[^;]*messages_insert_member[^;]*\bfor insert\b/i.test(sql)],
  ['private conversation media storage', /trainer_media_read[\s\S]*?conversation_id::text = \(storage\.foldername\(name\)\)\[2\]/i.test(sql)],
  ['medical storage is admin and institution scoped', /trainer_medical_manager_admin_read[\s\S]*?current_app_role\(\)\s+in\s+\('manager','admin'\)[\s\S]*?current_institution_id\(\)::text/i.test(sql)],
  ['automatic report counts from attendance', /attendance_records[\s\S]*?present_count/.test(app)],
  ['admin report review workflow', /reports_admin_review/.test(sql) && /reviewed_by/.test(app)],
  ['owner, manager and admin invitation matrix', /owner:\s*\['manager',\s*'admin',\s*'coach'\]/.test(policy) && /manager:\s*\['admin',\s*'coach'\]/.test(policy) && /admin:\s*\['coach'\]/.test(policy) && /coach:\s*\[\]/.test(policy)],
  ['administration invites coaches only', /admin:\s*\['coach'\]/.test(invite) && /coach:\s*\[\]/.test(invite) && !/Coaches may invite coaches only/.test(invite)],
  ['account review uses atomic RPC', /review_account/.test(repair) && /reviewAccount\(person\.id, action\)/.test(app)],
  ['team screen no longer writes profiles directly', !between(app, 'function Team', 'function Medical').includes("profiles').update")],
  ['administration team screen is read-only', /readOnlyAccounts/.test(app) && /canReviewAccount\(/.test(app)],
  ['messages screen no longer invites coaches', !between(app, 'function Messages', 'function OwnerConsole').includes('invite-user') && !between(app, 'function Messages', 'function OwnerConsole').includes('inviteCoach')],
  ['owner console can sync orphan profiles', /sync_missing_profiles/.test(repair) && /sync_missing_profiles/.test(app)],
  ['pending gate accepts the caller’s live email invitation', /my_pending_invitation/.test(repair) && /my_pending_invitation/.test(app) && /accept_email_invitation/.test(app)],
  ['invitation acceptance never activates the account', /awaitingApproval/.test(app) && /invitationNoActivation/.test(app)],
  ['edge-unreachable errors are mapped', /FunctionsFetchError/.test(app) && /edge_unreachable/.test(app)],

  // ------------------------------------------------------- migration integrity
  ['incremental migration avoids ROWTYPE', !/%rowtype/i.test(migration)],
  ['incremental migration is one transaction', /^\s*begin\s*;/im.test(migration) && /^\s*commit\s*;/im.test(migration)],
  ['migration never drops an application table', !/drop\s+table\s+(if\s+exists\s+)?public\./i.test(migration)],
  ['migration never truncates business data', !/truncate\s+(table\s+)?public\./i.test(migration)],
  ['hashed OTP column has no plaintext value', /otp_codes_no_plaintext_check/.test(migration) && /SET\s+code\s*=\s*NULL/i.test(migration)],
  ['OTP uses pgcrypto randomness', /gen_random_bytes\s*\(/.test(migration) && /digest\s*\([^)]*sha256/i.test(migration)],
  ['OTP is single-use and attempt-limited', /SET\s+used_at\s*=\s*now\(\)/i.test(migration) && /max_attempts/i.test(migration) && /too_many_attempts/.test(migration)],
  ['OTP verification locks the invitation row', /verify_otp_code[\s\S]*?FOR UPDATE/i.test(migration)],
  ['duplicate live codes are revoked before the unique index', /row_number\(\)\s+OVER[\s\S]*?otp_codes_one_live_per_invitation/i.test(migration)],
  ['owner can never be invited or activated', /owner_invitation_forbidden/.test(migration) && /owner_role_forbidden/.test(migration)],
  ['every OTP RPC is revoked from browser roles', otpFunctions.every((signature) => migration.includes(`REVOKE ALL ON FUNCTION public.${signature} FROM anon, authenticated`))],
  ['every OTP RPC is granted only to service_role', otpFunctions.every((signature) => migration.includes(`GRANT EXECUTE ON FUNCTION public.${signature} TO service_role`))],
  ['no OTP RPC is granted to authenticated', !/GRANT\s+EXECUTE\s+ON\s+FUNCTION\s+public\.(generate_otp_code|verify_otp_code|revoke_otp_code|get_otp_statistics|expire_stale_invitations)[^;]*TO[^;]*authenticated/i.test(migration)],
  ['invitations and OTP rows are hidden from browser roles', /REVOKE ALL ON TABLE public\.invitations FROM anon, authenticated/.test(migration) && /REVOKE ALL ON TABLE public\.otp_codes FROM anon, authenticated/.test(migration)],
  ['invitation RLS baseline is Owner/Director and never Coach', /CREATE POLICY invitations_select_admin[\s\S]*?current_app_role\(\) = 'manager'[\s\S]*?\);/.test(migration) && !/CREATE POLICY invitations_select_admin[\s\S]*?current_app_role\(\) = 'coach'/.test(migration)],
  ['OTP acceptance leaves new accounts pending', /WHEN v_profile_status = 'active'[\s\S]*?ELSE 'pending'/.test(migration)],
  ['profile update RLS is owner/director only', /create policy profiles_admin_update[\s\S]*?current_app_role\(\)='manager'[\s\S]*?role in \('admin','coach'\)/.test(sql)],
  ['platform owner audit is limited to institution events', /create policy audit_read_admin[\s\S]*?is_platform_owner\(\)[\s\S]*?table_name\s*=\s*'institutions'[\s\S]*?\);/.test(sql)],

  // ------------------------------------------------------- account repair migration
  ['repair migration is transactional and non-destructive', /^\s*begin\s*;/im.test(repair) && /^\s*commit\s*;/im.test(repair) && !/drop\s+table\s+(if\s+exists\s+)?public\./i.test(repair) && !/truncate\s+(table\s+)?public\./i.test(repair) && !/delete\s+from\s+public\./i.test(repair)],
  ['repair migration can run twice', /create or replace function public\.ensure_my_profile/i.test(repair) && /create or replace function public\.review_account/i.test(repair) && /drop policy if exists/i.test(repair)],
  ['repair migration adds all four account RPCs', ['ensure_my_profile()', 'sync_missing_profiles()', 'review_account(', 'my_pending_invitation()'].every((name) => repair.includes(name))],
  ['repair migration blocks self and owner review', /self_review_forbidden/.test(repair) && /owner_protected/.test(repair) && /owner_role_forbidden/.test(repair) && /role_change_forbidden/.test(repair)],
  ['repair migration patches legacy OTP auto-activation', /account_status = ''active''/.test(repair) && /execute v_def/.test(repair) && /still auto-activates accounts/.test(repair)],
  ['repair RPCs are not executable by anon', /revoke all on function public\.review_account[^;]*from public, anon/i.test(repair) && /revoke all on function public\.ensure_my_profile\(\) from public, anon/i.test(repair)],

  // ------------------------------------------------------- edge-function rules
  ['no wildcard CORS in Edge Functions', !edgeFunctions.some((source) => /Access-Control-Allow-Origin['"]?\s*:\s*['"]\*['"]/.test(source))],
  ['CORS reflects only configured origins', /allowedOrigins\(\)[\s\S]*?includes/.test(shared)],
  ['no OTP or hash in any JSON response', !responseBodies.some((body) => /otp_code|code_hash|otp\s*:/.test(body))],
  ['invite-user is email-only and never returns the code', /delivery_method: 'email'/.test(invite) && /email_only/.test(invite) && !/message: 'otp_sent'/.test(invite) && !/json\(req,\s*\{[^}]*otp_code/s.test(invite)],
  ['verify-otp returns only acceptance metadata', /message: 'invitation_accepted'/.test(verify) && !jsonResponseBodies(verify).some((body) => /otp_code|code_hash/.test(body))],
  ['internal senders require x-internal-secret', /x-internal-secret/.test(whatsapp) && /x-internal-secret/.test(sms) && /x-internal-secret/.test(shared)],
  ['internal senders compare secrets in constant time', /timingSafeEqual/.test(whatsapp) && /timingSafeEqual/.test(sms)],
  ['invite-user sends email invitations without the delivery secret', !/x-internal-secret/.test(invite) && /inviteUserByEmail/.test(invite)],
  ['invite-user is JWT-protected', /\[functions\.invite-user\][\s\S]*?verify_jwt\s*=\s*true/.test(config)],
  ['verify-otp is JWT-protected', /\[functions\.verify-otp\][\s\S]*?verify_jwt\s*=\s*true/.test(config)],
  ['delivery functions do not require a browser JWT', /\[functions\.send-whatsapp\][\s\S]*?verify_jwt\s*=\s*false/.test(config) && /\[functions\.send-sms\][\s\S]*?verify_jwt\s*=\s*false/.test(config)],
  ['invitee accepts the invitation from their own session', /rpc\('my_pending_invitation'\)/.test(app) && /rpc\('accept_email_invitation'[\s\S]{0,120}?p_invitation_id:\s*invitation\.id/.test(app)],
  ['browser never supplies a foreign invitation id', !/accept_email_invitation[\s\S]{0,200}?p_invitation_id:\s*(?!invitation\.id)[a-zA-Z_]+\s*[,}]/.test(app)],
  ['role matrix: owner may not invite owners', /owner:\s*\['manager',\s*'admin',\s*'coach'\]/.test(invite) && /manager:\s*\['admin',\s*'coach'\]/.test(invite) && /admin:\s*\['coach'\]/.test(invite) && /coach:\s*\[\]/.test(invite)],
  ['email invitation flow is preserved', /inviteUserByEmail/.test(invite) && /delivery_method: 'email'/.test(invite)],

  // ------------------------------------------------------- repair integrity
  ['setup creates every table the app queries', [
    'institutions','profiles','classes','students','student_medical_records','coach_shifts',
    'daily_reports','report_templates','report_exports','report_details','student_notes',
    'admin_notices','notifications','coach_notebooks','audit_logs','invitations',
    'academic_years','student_academic_enrollments','conversations','conversation_members',
    'messages','message_reads','attendance_records','absence_followups',
  ].every((table) => new RegExp(`create table if not exists public\\.${table}\\b`, 'i').test(sql))],
  ['setup has no invalid partial unique constraint', !/constraint\s+\w+\s+unique\s*\([^)]*\)\s*where/i.test(sql)],
  ['setup dollar-quoted functions are balanced', ((sql.match(/\$\$/g) || []).length % 2) === 0],
  ['setup enables RLS on core tables', ['daily_reports','report_details','attendance_records','messages','message_reads','notifications','coach_notebooks','audit_logs'].every((table) => new RegExp(`alter table public\\.${table} enable row level security`, 'i').test(sql))],
  ['report deletion is restricted by role', /reports_delete_manager[\s\S]*?current_app_role\(\) = 'manager'[\s\S]*?reports_delete_admin[\s\S]*?current_app_role\(\) = 'admin'/i.test(sql) && !(sql.match(/create policy [a-z_]*delete[a-z_]* on public\.daily_reports[^;]*?current_app_role\(\) = 'coach'[^;]*;/gi) ?? []).some((policy) => !/not is_finalized/i.test(policy))],
  ['report details are written before finalization', (() => {
    const details = app.indexOf('Step 2 — replace student details')
    const finalize = app.indexOf('Step 3 — finalize')
    return details > 0 && finalize > details && app.indexOf('buildReportDetailRows(savedId', details) > details
  })()],
  ['vulnerable xlsx dependency is gone', !/from ['"]xlsx['"]/.test(app) && !/"xlsx"\s*:/.test(read('package.json')) && !/xlsx@/.test(read('package-lock.json'))],
  ['Excel import uses read-excel-file', /read-excel-file\/browser/.test(app)],
  ['unknown routes render a not-found screen', /path="\*" element=\{<NotFound/.test(app)],
  ['Word export uses the uploaded template with a fallback', /renderReportTemplate/.test(app) && /buildReportDocument/.test(app)],
  ['coach can open institution classes in read-only mode', /path="\/classes" element=\{!owner \? <ClassManagement/.test(app) && /const canManage = profile.role === 'manager' \|\| profile.role === 'admin'/.test(app) && /from\('students'\).*class_id/.test(app)],
  ['mobile sidebar has a contained vertical scroll region', /\.sidebar nav\{flex:1 1 auto;min-height:0;overflow-y:auto/.test(styles)],
  ['management report form is separate from daily reports', /path="\/management-reports"/.test(app) && /from\('template_reports'\)/.test(app) && /from\('daily_reports'\)/.test(app)],
  ['admin can configure fillable template fields', /form_fields: parseFieldLines\(\)/.test(app) && /managementReportFields/.test(app)],
  ['management reports use immutable final submission RPC', /submit_template_report/.test(app) && /CREATE OR REPLACE FUNCTION public.submit_template_report/.test(managementReportMigration) && /Submitted management report is immutable/.test(managementReportMigration)],
  ['management report migration preserves institution and role isolation', /current_institution_id\(\)/.test(managementReportMigration) && /is_platform_owner\(\)/.test(managementReportMigration) && /coach_id = auth\.uid\(\)/.test(managementReportMigration)],
  ['absence queue uses persisted trigger-generated follow-ups', /absence_followups/.test(between(app, 'function FollowUpQueue', 'function InstitutionSettings')) && /mark_followup_handled/.test(between(app, 'function FollowUpQueue', 'function InstitutionSettings')) && !/computeAbsenceFollowUps/.test(between(app, 'function FollowUpQueue', 'function InstitutionSettings'))],
  ['read receipts are per message and reader', /message_reads\(message_id, reader_id, read_at\)/i.test(sql) && /primary key \(message_id, reader_id\)/i.test(sql) && /on conflict \(message_id, reader_id\)/i.test(sql)],
  ['institution deletion is not called from the browser', !/rpc\('delete_institution'/.test(app) && /institutionDeleteUnavailable/.test(app)],
  ['pending production SQL stays approval-gated', /SECTION 12/.test(read('supabase/pending/SUPABASE_PENDING_CHANGES_REVIEW_REQUIRED.sql')) && /requires\s+explicit[\s\S]{0,40}?production\s+approval/i.test(read('supabase/pending/SUPABASE_PENDING_CHANGES_REVIEW_REQUIRED.sql'))],
  ['web manifest carries valid Arabic metadata and icons', (() => {
    try {
      const manifest = JSON.parse(read('public/manifest.webmanifest'))
      return manifest.short_name === 'تدريب'
        && /[\u0600-\u06FF]/.test(manifest.description)
        && Array.isArray(manifest.icons) && manifest.icons.length >= 2
        && !/\uFFFD/.test(read('public/manifest.webmanifest'))
    } catch { return false }
  })()],
  ['page title and description are readable', /<title>The Trainers — تدريب<\/title>/.test(read('index.html')) && /[\u0600-\u06FF]/.test(read('index.html')) && !/\uFFFD/.test(read('index.html'))],

  // ----------------------------------------------------------- secret hygiene
  ['no service-role key in frontend', !/SUPABASE_SERVICE_ROLE_KEY|service_role_key|serviceRoleKey/.test(app) && !/SUPABASE_SERVICE_ROLE_KEY|service_role_key|serviceRoleKey/.test(read('src/lib/supabase.ts'))],
  ['env example targets the configured Supabase project with public credentials only', /https:\/\/rxkyryaplszuklagvidi\.supabase\.co/.test(envExample) && /sb_publishable_[A-Za-z0-9_-]{10,}/.test(envExample) && !/VITE_[A-Z0-9_]*SERVICE_ROLE|VITE_[A-Z0-9_]*service_role|postgresql:\/\//i.test(envExample)],
  ['verification script has no hardcoded credentials', !/https:\/\/[a-z0-9]{15,}\.supabase\.co/i.test(verifyScript) && !/sb_publishable_[A-Za-z0-9_-]{10,}/.test(verifyScript)],
]

let failed = false
for (const [name, ok] of checks) {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}`)
  if (!ok) failed = true
}

if (failed) process.exit(1)
console.log(`Project structure verified (${required.length} required files, ${checks.length} checks). This is not a substitute for a real Supabase RLS integration test, PostgreSQL migration run, provider delivery test or device test.`)
