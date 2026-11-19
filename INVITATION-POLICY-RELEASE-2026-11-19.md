> **Historical snapshot:** See `docs/RELEASE_STATUS_2026-11-19_FINAL_REPAIR.md` for the current release state, 192-test results, deployed Edge Function versions, and Supabase migration history.

# THE TRAINERS — Invitation Policy Release (2026-11-19)

## Invitation sender matrix
- Platform Owner: Manager, Admin, Coach.
- Manager: Admin, Coach only.
- Admin: another Admin, Coach only, within the same institution.
- Coach: no invitations.
- No invitation can create another Platform Owner.

Invitations are email-only. The recipient must open the invitation link and accept it from the matching authenticated email account. Acceptance immediately activates the invited account; no additional Owner/Manager approval is required. Email confirmation remains enabled as proof that the recipient controls the invited mailbox. Institution isolation, role restrictions, suspension protection, and audit logging remain enforced.

## Re-invitation after rejection
A rejected invitation/account is not a permanent block on the email. A new pending invitation may be created later. When the recipient opens and accepts that fresh invitation, a previously rejected profile becomes **active** immediately. Suspended profiles are not eligible; an already-active account cannot be moved to another institution through an invitation.

## Database change
Additive migration: `supabase/migrations/20261119155330_allow_reinvitation_after_rejection.sql`. It uses `CREATE OR REPLACE FUNCTION` only and does not drop tables, delete business data, or recreate accounts.

## Verification status
- `node scripts/verify-project.m`: passed all 120 checks.
- `tsc` isolated checks for `account-policy.ts` and `account-gate.ts`: passed.
- Full `npm ci`, unit tests, and production build were blocked because `registry.npmjs.org` DNS returned `EAI_AGAIN`; the ZIP is source-ready but not build-verified.
- Supabase invitation migration and `invite-user` Edge Function v2 are applied to the configured project. No Cloudflare frontend deployment was performed.

## Automatic activation change (2026-11-19)

Additive production migration: `20261119210841_invitation_acceptance_activates_without_admin_approval`. It updates only `public.accept_email_invitation(uuid)`. On valid recipient acceptance, the profile receives the invitation role and institution and becomes `active`; `approved_by`/`approved_at` remain null because no administrator approved it. Duplicate pending invitations for the same email and institution are revoked, and the accepted invitation is no longer pending. Email confirmation is intentionally retained: the invitation link is the proof of mailbox access, not an administrative approval step.
