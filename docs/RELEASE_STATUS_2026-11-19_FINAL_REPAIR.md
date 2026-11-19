# THE TRAINERS — Final Repair Status (2026-11-19)

This document supersedes the earlier release notes and older audit summaries in this ZIP. It records the source and live Supabase state checked during the final repair pass.

## Release verdict

**Repaired release candidate; not yet certified for public production rollout.** The source-level verification and unit suite pass. A full dependency install, TypeScript typecheck, Vite production build, provider delivery test, authenticated role-based integration test, and real-device test remain unverified because the package registry could not resolve from this environment and no production test accounts/device session were available.

## Live Supabase project

- Project: `تدريب`
- Project ref: `rxkyryaplszuklagvidi`
- Status: `ACTIVE_HEALTHY`
- Database: PostgreSQL 17.11
- Public tables: 28
- Public tables with RLS: 28/28
- Storage buckets: 4/4 private (`trainer-avatars`, `trainer-media`, `trainer-medical`, `trainer-report-templates`)
- Remote migration history: 28 versions
- Local `supabase/migrations` directory: 28 versions; exact version-prefix comparison passed with no missing or extra versions.

### Live data preservation check

After applying the additive migrations, read-only counts remained:

- Institutions: 2
- Profiles: 2
- Students: 7
- Daily reports: 2
- Invitations: 0

No institution deletion was executed. No production business rows were deleted, truncated, or rewritten by this repair pass.

## Supabase migrations added in this repair pass

These are four additive institution-deletion migrations and one index migration. They are already recorded in the live migration history; do not replay them.

1. `20261119161736_secure_institution_deletion`
   - Added a manager-only, exact-name-confirmed deletion RPC as an initial implementation.
2. `20261119162052_private_institution_deletion_rpc`
   - Moved privileged work to `app_private.delete_institution_impl` (`SECURITY DEFINER`).
   - Public `delete_institution(uuid,text)` is a `SECURITY INVOKER` wrapper; it is callable by authenticated users only.
3. `20261119162348_delegate_institution_storage_cleanup`
   - Ensures Storage file deletion is performed through the Supabase Storage API, not by direct SQL mutation of `storage.objects`.
   - The private database procedure deletes institution-owned relational data, invitation and OTP rows; member profiles are detached and marked `rejected`; Auth identities are preserved; audit history is retained.
4. `20261119162926_index_template_report_foreign_keys`
   - Added covering indexes for `template_reports.reviewed_by` and `template_reports.template_id`, resolving the two unindexed-FK Advisor findings.
5. `20261119163829_institution_deletion_profile_guard_context`
   - Uses a transaction-local `app.account_repair` flag only after the private RPC verifies the active Manager and exact institution name, so the existing self-profile privilege trigger does not block detaching the Manager account during the deletion transaction.

## Deployed Edge Functions

- `invite-user`: ACTIVE, version 2, JWT verification enabled.
  - Email-only invitation flow; current role matrix remains Owner → Manager/Admin/Coach, Manager → Admin/Coach, Admin → Admin/Coach, Coach → none.
  - New accounts remain pending for human approval; rejected accounts can be invited again.
- `delete-institution`: ACTIVE, version 1, JWT verification enabled.
  - Checks the caller's active Manager profile, institution membership, and exact institution-name confirmation.
  - Lists and removes files under the institution prefix in all four private buckets using Storage API, then invokes the authenticated public RPC.
  - Former member Auth identities remain but profiles become rejected and detached. Audit history is retained.
  - The function was deployed, but its destructive flow was deliberately not executed against a real institution. CORS still depends on the configured `APP_URL` / `ALLOWED_ORIGINS` secrets matching the final Cloudflare origin.

## Source repairs in this package

- Added manual session selection from the selected coach’s shifts for the chosen date, allowing more than one attendance session on the same day. The selected session is passed explicitly to the attendance loader and saver.
- Added IndexedDB attendance outbox with stable per-institution/coach/date/session keys, reconnect retry, and cached roster/session/attendance snapshot for an already-open or previously loaded attendance screen.
- Added a visible pending-sync count and user feedback when attendance is queued offline.
- Added the missing self-leave action for conversations; it removes only the current user's membership row.
- Completed student-note follow-up controls for `none`, `open`, and `done` for institution Manager/Admin.
- Connected the institution deletion UI to the deployed `delete-institution` Edge Function with exact institution-name confirmation and explicit impact text.
- Updated the source-level verifier and added tests for the repaired workflows.
- Updated README to point to this final status and to distinguish deployed Edge Functions from historical notes.

### Offline limitation

Offline write queuing is implemented for attendance only. Other forms (messages, student edits, reports, notes, settings, uploads) still require an active network connection. The app-shell cache is not a universal offline database.

## Verification performed

- `node scripts/verify-project.mjs`: **124/124 structural/security assertions passed**.
- Node 22 native TypeScript stripping test run: **193/193 tests passed** using:
  `node --experimental-strip-types --experimental-specifier-resolution=node --test tests/*.test.ts`
- TypeScript syntax transpilation: 47 `.ts`/`.tsx` source/test/Edge Function files, zero syntax diagnostics (declaration files excluded).
- Live RLS check: 28 public tables, 0 without RLS.
- Live migrations: 28 remote / 28 local; exact version set match.
- Live Edge Function check: `invite-user` v2 and `delete-institution` v1 active, both JWT verification enabled.
- Live security/performance Advisors rerun after the migrations.

## Remaining Supabase findings

- **Leaked Password Protection remains disabled.** The available Supabase connection exposes project/database tools but no Auth security-settings setter, so this could not be enabled from this session.
- Security Advisor still reports 18 authenticated-callable `SECURITY DEFINER` functions. These pre-existed and several are required application RPCs; they were not globally revoked because doing so would break valid workflows. Each function still requires a targeted body/authorization review.
- Security Advisor reports one INFO finding: `otp_codes` has RLS enabled and no policies. This is intentional: OTP rows are server-only and RPC grants are restricted.
- Performance Advisor after adding the two FK indexes: 33 RLS init-plan warnings, 12 multiple-permissive-policy warnings, and 40 unused-index INFO findings. The unused-index count increased because the two new FK indexes have not yet been exercised by production workloads. No existing index or permissive policy was removed because their usage and role semantics need workload-specific review.
- The `APP_URL` and `ALLOWED_ORIGINS` secret values cannot be read through the available tool connection; browser-origin delivery must be confirmed against the final Cloudflare hostname.

## Remaining product and release tests

1. Web Push after app closure is still not implemented. The existing UI notifications are in-app/Realtime and browser notifications while the app is open or in the background. There is no VAPID sender deployed and no configured VAPID key pair.
2. Real email invitation delivery and acceptance must be tested with a real invitee account.
3. RLS must be integration-tested using Owner, Manager, Admin, and Coach accounts across two institutions, especially reports, medical files, notebooks, conversations, and audit visibility.
4. Storage upload/download and deletion should be tested with a disposable test institution before using the institution deletion action on a real institution.
5. Word `.docx` template editing/export must be tested with real documents containing complex tables, images, headers/footers and page layouts.
6. Excel import currently supports `.xlsx`; student codes with leading zeroes must be stored as Text in Excel.
7. Android, iPhone, desktop, RTL/LTR, microphone, file picker, PWA installation, offline attendance replay and post-reconnect conflict behavior remain device-level tests.
8. Full `npm ci`, `npm run typecheck`, `npm run build`, and `npm audit` remain blocked. `npm ping` returned `EAI_AGAIN registry.npmjs.org`; offline install failed because the npm cache lacked `yallist@3.1.1`. The partial `node_modules` folder is excluded from the release ZIP. The lockfile is included.

## Data and deployment safety

- Do not run `supabase/THE_TRAINERS_SETUP.sql` on production.
- Do not run files in `supabase/pending/` or `supabase/manual-applied/legacy/` as migrations.
- Do not replay any of the 27 migrations already present in the live history.
- No Cloudflare deployment was performed. The user controls Cloudflare publishing and device tests.
