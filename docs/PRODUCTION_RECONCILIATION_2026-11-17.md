# THE TRAINERS — Production Reconciliation 2026-11-17

## 1. Actual Production State

### Database Tables (25 in public schema)
1. absence_followups
2. academic_years
3. admin_notices
4. attendance_records
5. audit_logs
6. classes
7. coach_notebooks
8. coach_shifts
9. conversation_members
10. conversations
11. daily_reports
12. institutions
13. invitations
14. message_reads
15. messages
16. notifications
17. otp_codes
18. profiles
19. report_details
20. report_exports
21. report_templates
22. student_academic_enrollments
23. student_medical_records
24. student_notes
25. students

### Additional Production Objects
- `push_subscriptions` table (created in Production, 2026-11-17)
- `notice_reads` table — NOT in Production (pending)
- `admin_notices_delete` policy — NOT in Production (pending)
- `submit_daily_report(p_report_id uuid)` RPC — EXISTS in Production
- `lock_final_report()` trigger — EXISTS in Production (per earlier audit)
- `set_daily_report_submitted_at()` trigger — EXISTS in Production (per earlier audit)
- `track_absence_followup()` trigger — EXISTS in Production
- `mark_followup_handled()` RPC — EXISTS in Production

### Storage Buckets (4, all private)
- trainer-avatars (5 MB limit)
- trainer-media (25 MB limit)
- trainer-medical (25 MB limit)
- trainer-report-templates (10 MB limit)

### Edge Functions
- 4 functions exist in source but are NOT deployed to Production
- invite-user, verify-otp, send-whatsapp, send-sms

## 2. Confirmed Completed Fixes (in Production)

| Change | Status | Evidence |
|--------|--------|----------|
| Migration 0004 (report templates/details/notifications) | CONFIRMED IN PRODUCTION | User confirmed |
| Migration 20261116065922 | CONFIRMED IN PRODUCTION | User confirmed |
| Migration 20261116065955 | CONFIRMED IN PRODUCTION | User confirmed |
| Migration 20261116070050 | CONFIRMED IN PRODUCTION | User confirmed |
| Migration 20261116073221 | CONFIRMED IN PRODUCTION | User confirmed |
| Migration 20261116073308 | CONFIRMED IN PRODUCTION | User confirmed |
| Migration 20261116192616 (remove obsolete trigger) | CONFIRMED IN PRODUCTION | User confirmed |
| Migration 20261116192646 (tighten storage policies) | CONFIRMED IN PRODUCTION | User confirmed |
| Migration 20261116192658 (exclude platform owner from reports) | CONFIRMED IN PRODUCTION | User confirmed |
| Migration 20261116213108 (secure daily report submission RPC) | CONFIRMED IN PRODUCTION | User confirmed |
| Notice notification trigger (notify_new_notice + UPDATE trigger) | CONFIRMED IN PRODUCTION | User confirmed |
| notifications.notice_id column + partial unique index | CONFIRMED IN PRODUCTION | User confirmed |
| push_subscriptions table | CONFIRMED IN PRODUCTION | User confirmed |
| trainer_media_delete_own stricter checks | CONFIRMED IN PRODUCTION | User confirmed |

## 3. Source-Only Fixes (implemented in code, not in Production)

| Change | Status | File |
|--------|--------|------|
| Report submission via RPC | IMPLEMENTED IN SOURCE | src/App.tsx |
| Read tracking for notices (notice_reads) | IMPLEMENTED IN SOURCE (SQL pending) | SUPABASE_PENDING_CHANGES.sql Section 13 |
| Notice delete policy (admin_notices_delete) | IMPLEMENTED IN SOURCE (SQL pending) | SUPABASE_PENDING_CHANGES.sql Section 14 |
| Push subscriptions table definition | IMPLEMENTED IN SOURCE (SQL pending) | supabase/push_subscriptions_pending.sql |
| Service Worker push handling | IMPLEMENTED IN SOURCE | public/sw.js |
| Push subscription management (frontend) | IMPLEMENTED IN SOURCE | src/App.tsx |
| i18n keys for notices and push | IMPLEMENTED IN SOURCE | src/lib/i18n.ts |
| Vite config fix (xlsx alias removal) | IMPLEMENTED IN SOURCE | vite.config.ts |
| Notice reader list UI | IMPLEMENTED IN SOURCE | src/App.tsx |
| Notice delete UI | IMPLEMENTED IN SOURCE | src/App.tsx |

## 4. Missing or Conflicting Changes

### Source/Production Mismatches
1. `THE_TRAINERS_SETUP.sql` still contains `reports_owner_read_all` policy (removed in production)
2. `THE_TRAINERS_SETUP.sql` still contains `report_exports_owner_view` policy (removed in production)
3. `reports_read_own_admin` allows admins to read drafts (business rule says "finalized only")
4. INSERT policy on daily_reports doesn't prevent direct finalized insertion
5. UPDATE policy on daily_reports doesn't prevent draft→finalized bypass
6. `trainer_media_delete` only checks user folder, not conversation membership
7. `trainer_avatars_update` lacks institution check

### Missing Source Files
1. `20261116073308_add_missing_public_foreign_key_indexes.sql.txt` — EMPTY (0 bytes)
2. `New Text Document.txt` — temporary file, should be removed
3. `otp_codes` table — exists in production but not defined in THE_TRAINERS_SETUP.sql
4. `trainer_storage_member_rw` policy — exists in production but not in source

### PowerShell Artifacts in SQL Files
1. `20261116192616_remove_obsolete_absence_followup_trigger.sql.txt` — `'@` on line 10
2. `20261116192658_exclude_platform_owner_from_report_reads.sql.txt` — `'@` on line 15

## 5. Unverified Items

- OTP_DELIVERY_SECRET existence (NOT VERIFIED)
- Edge Functions deployment status (BLOCKED — not deployed)
- Live RLS behavior with authenticated roles (BLOCKED — no test accounts)
- Storage policy OR combination effects (NOT VERIFIED)
- `lock_final_report()` trigger existence (REQUIRES VERIFICATION)
- `set_daily_report_submitted_at()` trigger existence (REQUIRES VERIFICATION)
- `submit_daily_report` RPC parameters and behavior (REQUIRES VERIFICATION)
- Web Push end-to-end on real devices (NOT TESTED)
- Notice read tracking in production (NOT APPLIED)

## 6. Remaining Work

### Requires User Approval
1. Apply pending SQL changes (Sections 13-14, push_subscriptions_pending.sql)
2. Deploy Edge Functions (requires OTP_DELIVERY_SECRET + API credentials)
3. Configure VAPID keys for Web Push

### Requires External Testing
1. Live RLS verification with authenticated sessions
2. Web Push testing on Android/Desktop
3. Storage policy interaction verification

### Source Code Improvements
1. Remove PowerShell artifacts from SQL files
2. Remove empty migration file
3. Remove temporary "New Text Document.txt"
4. Add otp_codes table definition to THE_TRAINERS_SETUP.sql
5. Update THE_TRAINERS_SETUP.sql to remove reports_owner_read_all policy
6. Add pagination to large queries (attendance records, profiles)

## 7. Test Results

| Check | Result |
|-------|--------|
| npm run typecheck | ✅ Pass (exit 0) |
| npm test | ✅ 151/151 passing |
| npm run verify | ✅ 95/95 checks passing |
| npm run build | ✅ Success (Vite production) |
| npm audit | ✅ 0 vulnerabilities |
