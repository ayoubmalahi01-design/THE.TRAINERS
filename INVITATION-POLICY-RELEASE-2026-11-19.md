> **Historical snapshot:** See `docs/RELEASE_STATUS_2026-11-19_FINAL_REPAIR.md` for the current release state, 192-test results, deployed Edge Function versions, and Supabase migration history.

# THE TRAINERS — Invitation Policy Release (2026-11-19)

## Invitation sender matrix
- Platform Owner: Manager, Admin, Coach.
- Manager: Admin, Coach only.
- Admin: another Admin, Coach only, within the same institution.
- Coach: no invitations.
- No invitation can create another Platform Owner.

Invitations are email-only. Existing account permissions, institution scoping, account approval flow, and other app features remain intact.

## Re-invitation after rejection
A rejected invitation/account is not a permanent block on the email. A new pending invitation may be created later. When the same verified email accepts that fresh invitation, a previously rejected profile is reset to **pending** for review, not automatically activated. Suspended profiles are not eligible; active profiles cannot be silently changed across institution or role conflicts.

## Database change
Additive migration: `supabase/migrations/20261119155330_allow_reinvitation_after_rejection.sql`. It uses `CREATE OR REPLACE FUNCTION` only and does not drop tables, delete business data, or recreate accounts.

## Verification status
- `node scripts/verify-project.m`: passed all 120 checks.
- `tsc` isolated checks for `account-policy.ts` and `account-gate.ts`: passed.
- Full `npm ci`, unit tests, and production build were blocked because `registry.npmjs.org` DNS returned `EAI_AGAIN`; the ZIP is source-ready but not build-verified.
- Supabase invitation migration and `invite-user` Edge Function v2 are applied to the configured project. No Cloudflare frontend deployment was performed.
