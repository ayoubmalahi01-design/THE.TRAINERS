# Security & correctness fixes — 2026-11-19

Current verified state and outstanding checks are documented in `docs/RELEASE_STATUS_2026-11-19.md`.

## Applied production corrections

- Report draft permissions aligned by migration `20261119105659_reports_draft_permissions_alignment_20261119`.
- Coach read access to student medical records and medical attachments removed by `20261119112704_restrict_medical_records_to_institution_admins_20261119`. Manager/Admin remain authorized.
- Platform Owner audit visibility restricted to institution events only by `20261119112715_limit_platform_owner_audit_to_institutions_20261119`; this prevents report metadata leakage through audit rows.
- Per-message read receipts enabled and scoped to conversation members by `20261119113041_enable_per_message_read_receipts_20261119`.
- Pending invitation metadata now requires a confirmed authenticated email through `20261119113117_require_confirmed_email_for_pending_invitation_20261119`.
- Report review time is stamped by the database through `20261119113453_stamp_report_review_time_server_side_20261119`.

## Frontend corrections

- Follow-up queue uses the persisted trigger-generated `absence_followups` rows and the real `mark_followup_handled(p_id)` RPC signature.
- Notice reader modal lists readers and non-readers; only Manager/Admin can open it.
- Chat displays read receipts for sent messages and refreshes them via Realtime.
- Report review no longer sends a browser-generated `reviewed_at` value.
- Word exports include detailed student status/observations/incidents/injury information and review metadata.
- Medical screens remain unavailable to coaches, matching the database privacy rule.
- `invite-user` requires configured `APP_URL`; deployed CORS no longer defaults to localhost.
- Removed dead Web Push subscription UI because no VAPID sender exists. In-app/Realtime and browser notifications while the app is active remain.

## Pending / not certified

- `invite-user` redeployment waits for the final Cloudflare origin and Supabase Secrets.
- `npm ci` could not complete in this environment, so build/typecheck/audit remain unverified.
- Real multi-role/two-institution RLS tests, SMTP delivery, and device tests remain outstanding.
- `supabase/pending/20261119000000_security_hardening_REVIEW_REQUIRED.sql` is not applied; do not run it.
