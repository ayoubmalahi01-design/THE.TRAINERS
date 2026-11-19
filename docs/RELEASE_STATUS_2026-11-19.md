> **Historical snapshot:** This earlier report predates the final repair pass. Its migration counts, Edge Function deployment state, and test totals are superseded by `RELEASE_STATUS_2026-11-19_FINAL_REPAIR.md`. Use that file as the current release source of truth.

# THE TRAINERS — Release Status (2026-11-19)

## Verdict

This package is a reconciled release candidate, **not yet certified for public production rollout**. The project source and Supabase migration history have been reconciled and the static/unit suites pass. A production Vite build, full typecheck with installed dependencies, live role-based integration tests, Edge Function redeployment, and device tests remain unverified.

## Production Supabase snapshot

- Project ref: `rxkyryaplszuklagvidi`.
- Project URL: `https://rxkyryaplszuklagvidi.supabase.co`.
- Public schema: 28 base tables; RLS enabled on all 28; 79 public policies.
- Storage: four private buckets are present.
- Local migration directory contains all 22 versions listed in the remote Supabase migration history, with matching version prefixes.
- Production currently contains two institutions, two profiles, two students, two attendance records, eight coach shifts, and two reports. Most advanced modules have little or no real usage data; presence of a table is not proof of end-to-end testing.

## Production migrations applied in this repair session

1. `20261119112704_restrict_medical_records_to_institution_admins_20261119`
   - Removed coach SELECT policy on `student_medical_records` and coach read policy on `trainer-medical` storage.
   - Manager/Admin policies remain.
2. `20261119112715_limit_platform_owner_audit_to_institutions_20261119`
   - Platform Owner audit SELECT is limited to rows where `table_name = 'institutions'`.
   - Manager/Admin retain audit access scoped to their institution.
3. `20261119113041_enable_per_message_read_receipts_20261119`
   - Added member-scoped `message_reads` SELECT/INSERT policies.
   - `mark_conversation_read` now inserts per-message/per-reader receipts; `unread_counts` counts unread messages from this table.
   - Added `message_reads` to `supabase_realtime` publication.
4. `20261119113117_require_confirmed_email_for_pending_invitation_20261119`
   - `my_pending_invitation()` reveals invitation metadata only to the authenticated invitee after email confirmation.
5. `20261119113453_stamp_report_review_time_server_side_20261119`
   - `lock_final_report()` assigns `reviewed_at` using database transaction time, not a client clock.
6. `20261119113835_allow_admin_read_medical_attachments_20261119`
   - Restored SELECT access to private medical attachments for Manager/Admin only; Coach and Owner remain blocked.
7. `20261119114210_allow_admin_read_medical_records_20261119`
   - Restored SELECT access to medical record rows for Manager/Admin only after removing the broader member-read policy.

8. `20261119120402_daily_student_status_and_coach_report_template_access`
   - Active coaches can read only the current, non-archived institution Word template. Manager/Admin retain template management access.
   - Added `get_active_student_restrictions(date)`, an authenticated, institution-scoped RPC returning only student identity, restriction type, and validity dates; it never returns medical details or attachment paths. Platform Owner is excluded.
9. `20261119121224_move_restriction_rpc_to_private_schema`
   - Moved the privileged restriction lookup into non-exposed `app_private`; the public RPC is now `SECURITY INVOKER` and calls the private implementation. This removes the new public SECURITY DEFINER advisor finding while retaining the same narrow output and authorization checks.

Earlier applied migration `20261119105659_reports_draft_permissions_alignment_20261119` remains in effect. No business rows were deleted, truncated, or rewritten by these policy/function migrations.

## Code changes included in this package

- Follow-up queue reads trigger-generated `absence_followups`, is available to active institution members, and calls `mark_followup_handled(p_id)` using the actual production RPC signature. Handled state uses `handled_at`/`handled_by`; the two-session expiry is based on actual attendance sessions.
- Notice reader panel shows both readers and active institution members who have not read the notice. Only Manager/Admin can inspect the lists, consistent with RLS.
- Chat shows per-message readers for messages sent by the current user and refreshes receipts through Realtime.
- Medical record UI remains restricted to institution Manager/Admin; database and Storage policies now enforce the same restriction. Coaches have no medical read access.
- Platform Owner audit visibility is restricted to institution events, preventing report metadata from leaking through audit rows.
- Report review time is database-generated. Word export now includes attendance status, observations, incident/injury details, report submission time, review time, and reviewer name when available.
- `invite-user` now requires `APP_URL`; the shared CORS helper no longer falls back to localhost in a deployed Supabase runtime.
- Removed the nonfunctional Web Push subscription controls. In-app/Realtime and browser notifications while the app remains open or in the background remain. Web Push after app closure is not implemented.
- Restored SQL migration files to match the 21 remote version identifiers. Older manual/legacy SQL is moved outside the active migrations directory to avoid accidental replay.
- The unsafe/unapplied `20261119000000_security_hardening.sql` was moved to `supabase/pending/` and renamed `REVIEW_REQUIRED`; do not run it. Exact storage policies require separate review.


## Follow-up repairs in this release candidate

- Student import now recognizes Arabic, French, and English student-code/name headers and combines separate first-name/surname columns. Import preview is a scrollable table and duplicate codes remain skipped. For leading zeroes, the Excel student-code column must be stored as Text before saving; numeric Excel cells do not preserve a display-only zero mask through the current parser.
- Added a daily status page and daily status page for all active institution members. It lists non-present attendance statuses for the selected date and active permission/exemption periods. Ended periods are filtered from the active list by date; source records remain untouched.
- The daily status RPC deliberately returns no medical notes, diagnoses, or attachment paths. The medical-record page and its direct table/storage access remain Manager/Admin only.
- Word template access was aligned so coaches can read only the institution's active template, allowing the existing Word export to use the uploaded template instead of falling back to the built-in document.

## Verification results

- `node scripts/verify-project.mjs`: 117/117 structural/security assertions passed.
- Test files executed individually with Node type stripping: 185/185 tests passed (including four new student-import tests).
- TypeScript/TSX syntax transpilation: 20 source files parsed with 0 syntax diagnostics (declaration files excluded).
- Migration version comparison: all 22 local migration versions match the remote migration history.
- Live SQL read-only checks: 28/28 public tables have RLS enabled; medical access policies are Manager/Admin only; owner audit policy is institution-only; message receipts policies and Realtime publication are present.

## Not verified / blockers before public launch

1. `npm ci` timed out in this environment; offline install had no complete package cache. Therefore `npm run build`, full `npm run typecheck`, and `npm audit` were not completed. Do not infer a successful Vite build from the 179 unit tests.
2. Supabase's deployed `invite-user` Edge Function is older than the source in this ZIP. Redeploy is pending the final Cloudflare HTTPS origin and confirmation that `SUPABASE_SERVICE_ROLE_KEY`, `APP_URL`, and `ALLOWED_ORIGINS` are configured as Supabase Secrets. Never put the service-role key in this repository or browser config.
3. Real authentication, SMTP delivery, invitation acceptance, and RLS tests with four distinct roles across two institutions have not been performed.
4. Realtime message receipts, notice read lists, medical attachment access, report submission/review/deletion, and storage upload/download have not been exercised with real user accounts.
5. Android/iPhone PWA installation, offline attendance behavior, RTL rendering, microphone/file-picker behavior, and desktop tests remain outstanding.
6. Web Push after the app is closed is not available. This release does not claim that feature.

## Important operating rules

- Never run `THE_TRAINERS_SETUP.sql` on the existing production project. It is only for a new empty Supabase project.
- Never replay a migration already present in Supabase migration history.
- `supabase/manual-applied/legacy/` is historical/manual reference, not an active migration directory.
- `supabase/pending/` is not approved for execution.
- Do not send any secret keys through chat.


## Final local repair pass (2026-11-19)

- Owner dashboard now reports institution/account metrics only; it does not query or render coach reports.
- Pending accounts are no longer duplicated in the Owner "All Accounts" section.
- Invitation acceptance remains available by deep link/banner, not as a permanent active sidebar item.
- Coach mobile bottom navigation is reduced to five primary destinations; messages remain in the full drawer. Redundant dashboard quick links that duplicated the main navigation were removed.
- Management reports now use the uploaded Word document as the editing surface. Only marked blank spaces (`________`) or named placeholders (`{input_key}` / `{input_required_key}`) are editable; all other document text is rendered as protected. A filled copy is generated from the unchanged original DOCX. The existing `form_fields` JSON is now internal metadata derived from the DOCX placeholders, not a separately configured coach form.
- No new Supabase migration was added or applied. The 22 local migration versions exactly match the 22 production migration versions.
- Live advisor snapshot: 18 authenticated SECURITY DEFINER findings, one RLS-enabled/no-policy finding on `otp_codes` (server-only by design), leaked-password protection disabled; performance advisors report 33 RLS init-plan findings, 12 multiple-permissive-policy findings, two unindexed foreign keys, and 38 unused indexes. These are documented for targeted review; no blanket function revocation or index deletion was performed.
- The only deployed Edge Function is `invite-user` (active, version 1). Its deployed source is older than the ZIP source and must be redeployed only after the final Cloudflare origin and required Supabase Secrets are confirmed.
- Local verification after this pass: `scripts/verify-project.mjs` 117/117; Node tests 185/185; TypeScript/TSX syntax transpilation 20 files, zero syntax diagnostics. Full `npm ci`, `npm run build`, semantic typecheck, and `npm audit` remain blocked because dependency installation timed out and the local `node_modules` cache is incomplete. This package is a staging candidate, not yet a certified production build.
- Cloudflare origin must be confirmed before Edge deployment: conversation history's latest user-supplied URL was `https://salambo0.ayoubmalahi01.workers.dev/owner`, while this ZIP's `wrangler.toml` Worker name is `the-trainers` and the deployed old invitation function redirects to `the-trainers.ayoubmalahi01.workers.dev`. No origin was changed or assumed.
