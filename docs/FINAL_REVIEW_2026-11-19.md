> **Historical snapshot:** This document predates the final repair pass and contains older counts or deployment claims. The authoritative current status is `docs/RELEASE_STATUS_2026-11-19_FINAL_REPAIR.md`.

# THE TRAINERS — Final code and production reconciliation review

Date: 2026-11-19  
Target project: `rxkyryaplszuklagvidi`  
Source reviewed: `THE-TRAINERS-REPAIRED-FULL-2026-11-19-FIX1.zip`

## 1. Scope and safety

This pass reviewed the current source archive, application routes and navigation, role checks, report workflows, SQL migrations, production schema, RLS policies, Storage policies/buckets, SECURITY DEFINER functions, Supabase advisor findings, and the deployed Edge Function inventory.

Only the local source package and its documentation/tests were changed. No production table, row, column, policy, function, bucket, migration, Edge Function, Cloudflare Worker, or secret was changed in this pass. No SQL was executed against production except read-only catalog and advisor queries.

## 2. Live Supabase snapshot

- Project: `rxkyryaplszuklagvidi`.
- Public base tables: 28.
- Tables with RLS enabled: 28/28.
- Public RLS policies: 79.
- Applied migrations: 22.
- Local active migration files: 22; all version identifiers match the remote migration history.
- Private Storage buckets: `trainer-avatars`, `trainer-media`, `trainer-medical`, `trainer-report-templates`.
- Deployed Edge Functions: one, `invite-user`, active, version 1.

The 28 tables are: `absence_followups`, `academic_years`, `admin_notices`, `attendance_records`, `audit_logs`, `classes`, `coach_notebooks`, `coach_shifts`, `conversation_members`, `conversations`, `daily_reports`, `institutions`, `invitations`, `message_reads`, `messages`, `notice_reads`, `notifications`, `otp_codes`, `profiles`, `push_subscriptions`, `report_details`, `report_exports`, `report_templates`, `student_academic_enrollments`, `student_medical_records`, `student_notes`, `students`, and `template_reports`.

## 3. Role and page audit

| Area | Platform Owner | Manager | Admin | Coach |
|---|---|---|---|---|
| Institutions | Create/manage platform institutions | Own institution | Own institution context | No institution administration |
| Accounts/team | Platform account administration | Reviews institution accounts; invites Admin/Coach | Read-only team view; invites Admin/Coach | No invitation or account review |
| Students/classes | No institution student access | Manage | Manage | Read-only class access; operational student use |
| Attendance/follow-up | No institution operational data | Institution-wide | Institution-wide | Records own sessions/attendance and handles permitted follow-up |
| Daily reports | Blocked | Finalized reports only; manager deletion scope | Finalized reports only; reviewed-report deletion scope | Own drafts and own reports only |
| Management Word reports | Blocked | Finalized reports; review | Finalized reports; review | Own drafts and own submitted reports |
| Medical records/files | Blocked | Institution access | Institution access | Blocked |
| Notices | No institution notice access | Publish/delete/read receipts | Publish/delete/read receipts | Read published notices; cannot delete |
| Coach notebook | Blocked | Blocked | Blocked | Own `coach_notebooks` rows only |
| Messages | No institution membership | Active institution conversations | Active institution conversations | Active institution conversations |
| Audit | Institution-level platform events only | Own institution | Own institution | No audit page |

Notes:
- `daily_reports` and `report_details` SELECT policies exclude the platform owner. Coach reads are tied to `coach_id = auth.uid()`. Manager/Admin read only finalized reports.
- `template_reports` SELECT excludes the platform owner. Coaches read their own rows; Manager/Admin read finalized rows only.
- `student_medical_records` and `trainer-medical` Storage access are Manager/Admin only.
- `coach_notebooks` uses `coach_id = auth.uid()` for all operations.
- Manager/Admin notice reader policies expose reader and non-reader lists only to those roles.
- The distinction between `daily_reports` and `template_reports`, notices and notifications, attendance and daily status, coach notebook and student notes is intentional; these are not duplicate features to delete.

## 4. Local UI repairs in this package

1. Removed the permanent active-sidebar `Accept Invitation` item. The route remains for secure invitation deep links and the pending-invitation banner remains available.
2. Removed duplicate pending accounts from the Owner `All Accounts` section; pending accounts stay in the dedicated pending section.
3. Replaced Owner's institution-specific dashboard cards/recent reports with platform counts: institutions, active accounts, and pending accounts. Owner dashboard no longer queries or renders coach reports.
4. Removed dashboard quick links that duplicated the primary navigation.
5. Reduced Coach's mobile bottom navigation to five destinations; Messages remains in the full navigation drawer.
6. Added a DOCX-based Management Reports editor. The original Word file is stored unchanged. Coaches can edit only marked spaces: at least eight underscores (`________`) or named tags such as `{input_الملاحظات}` and `{input_required_الملاحظات}`. All ordinary source text is rendered as protected. The form-field metadata is derived from the Word file, not configured as a separate coach form. Drafts remain private; final submission still uses the existing database RPC.
7. Export renders a filled copy of the original DOCX. It does not overwrite the administration's original template.
8. Added Word template file-size validation and safe filename handling; the existing private bucket remains capped at 10 MiB.

## 5. SECURITY DEFINER review

Catalog query result:
- SECURITY DEFINER functions in `public`: 46 total.
- Executable by `authenticated`: 18.
- Executable by `anon`: 0.

The 18 authenticated-executable functions were enumerated and reviewed: `accept_email_invitation`, `create_conversation`, `current_app_role`, `current_institution_id`, `ensure_my_profile`, `is_active_member`, `is_conversation_member`, `is_institution_admin`, `is_platform_owner`, `mark_conversation_read`, `mark_followup_handled`, `my_pending_invitation`, `my_profile`, `review_account`, `submit_daily_report`, `submit_template_report`, `sync_missing_profiles`, and `unread_counts`.

Their current authorization patterns are scoped to the caller's Auth identity, active profile/institution, own report, conversation membership, allowed role, or Owner-only operation as appropriate. Service-only OTP RPCs and trigger functions are not granted to `anon` or `authenticated`. The Supabase advisor warning is therefore not treated as proof that all these functions are exploitable; no blanket revoke was applied because doing so would break core RLS helpers and workflows.

## 6. Supabase advisor findings still requiring targeted attention

- Security: leaked-password protection is disabled in Auth settings. Enable it in Supabase Auth security/password settings before public rollout.
- Security: one RLS-enabled table has no browser policies: `otp_codes`. This is intentional; OTP rows and RPCs are server-only and must remain inaccessible to browser roles.
- Security: 18 authenticated-executable SECURITY DEFINER functions are reported by the advisor; they have been inventoried and reviewed as described above. Keep reviewing changes to these functions and their grants.
- Performance: 33 RLS init-plan findings, 12 multiple-permissive-policy findings, two unindexed foreign keys, and 38 indexes reported unused. These require workload-aware review; unused indexes must not be dropped merely because the advisor has not seen enough traffic.
- No performance or policy rewrite was applied in this pass.

## 7. Edge Function and invitation status

The deployed project has only `invite-user` active, version 1. Its deployed source is older than the current ZIP source. The local source requires `APP_URL` and an origin allowlist, uses role/institution checks, rejects duplicate live invitations, and avoids returning secrets. The deployed function still contains the older wildcard-CORS implementation and hard-coded redirect URL.

Do not call invitations production-ready until the approved `invite-user` source is deployed and tested with the actual Cloudflare origin. Required Supabase secrets include the service-role key (Supabase Function secret only), `APP_URL`, and `ALLOWED_ORIGINS`; never place service-role credentials in Vite or Cloudflare browser variables.

The current application invitation UI is email-only. WhatsApp/SMS OTP sender code and schema exist in the repository/database history but are not deployed as Edge Functions and are not active in the current invitation UI. This remains a separate provider/configuration and real-delivery test item; no test message was sent.

## 8. Other production boundaries

- Four Storage buckets are private. Medical bucket policies are Manager/Admin only. Report template bucket paths are institution-scoped; managers/admins write templates, active institution members can read the institution's template files so saved drafts can still reference an older template version.
- Web Push after app closure is not implemented; do not claim it is active. In-app/Realtime and browser notifications while the app remains open/in the background are separate.
- No payroll feature/table/page exists in this source/schema review; there is no proven duplicate payroll item to remove.
- `student_notes` is institution-level student notes; it is not the private Coach notebook. Do not make it coach-private without an explicit product decision.

## 9. Verification performed

- `node scripts/verify-project.mjs`: 117/117 structural/security assertions passed.
- `node --experimental-strip-types --test tests/*.test.ts`: 185/185 tests passed.
- TypeScript/TSX syntax transpilation: 20 files, zero syntax diagnostics.
- Live SQL read-only checks: 28/28 public tables have RLS; 79 policies; 22 remote migrations match 22 local versions; Storage bucket/policy inventory; report/medical/notebook/invitation policy inspection; SECURITY DEFINER grants and selected function definitions.

## 10. Not yet certified

- `npm ci` timed out twice in this environment; the partial `node_modules` directory is incomplete.
- Consequently `npm run build`, semantic `tsc --noEmit`, and `npm audit` could not be completed. A syntax-only transpilation is not a replacement for a full typecheck or Vite production build.
- No live sign-in, email delivery, invitation acceptance, file upload/download, report submission/review, or cross-institution RLS test was run with four real test accounts.
- The Word editor has structural tests but still needs a real DOCX fixture test with tables, RTL content, multi-page documents, and a round-trip open in Microsoft Word/LibreOffice. The HTML editing preview supports paragraphs, tables, headers/footers, and basic run formatting; it is not a full Microsoft Word desktop rendering engine and does not reproduce every image, layout, or pagination feature.
- Android/iOS/desktop responsive and PWA install tests remain outstanding.
- Cloudflare deployment and Edge Function redeployment were not performed.

This ZIP should be treated as a **staging candidate for final build and role-based testing**, not as a fully certified public production release.

## 11. Cloudflare origin mismatch to resolve before Edge deployment

The latest user-provided URL in the conversation history was `https://salambo0.ayoubmalahi01.workers.dev/owner` (origin `https://salambo0.ayoubmalahi01.workers.dev`), while this source archive's `wrangler.toml` names the Worker `the-trainers`, and the currently deployed old `invite-user` function hard-codes `https://the-trainers.ayoubmalahi01.workers.dev/` as its redirect. These origins must not be assumed interchangeable. Confirm which HTTPS origin is the active target, then set `APP_URL` and `ALLOWED_ORIGINS` to that exact origin before deploying the function. No Worker rename or function deployment was performed.
