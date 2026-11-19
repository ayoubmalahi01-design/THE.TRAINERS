# THE TRAINERS — Email invitation auto-activation

## Production backend
- Applied Supabase migration `20261119210841_invitation_acceptance_activates_without_admin_approval` to project `rxkyryaplszuklagvidi`.
- `public.accept_email_invitation(uuid)` now activates the account immediately after the authenticated recipient accepts their matching, unexpired email invitation.
- No additional Owner/Manager approval is required after email invitation acceptance.
- The invitation determines the role and institution; Platform Owner remains protected, suspended accounts remain blocked, and an already-active account cannot be moved to a different institution through an invitation.
- Duplicate pending invitations for the same email and institution are revoked when one is accepted.
- `approved_by` and `approved_at` remain null for this automatic activation; the audit log records `approval_required: false`.
- The invitation link still verifies access to the invited mailbox. This is not an administrative approval step. Global Supabase email confirmation settings were not weakened.

## Frontend source
- Updated invitation acceptance copy in Arabic, French and English.
- Updated comments and verification checks to reflect immediate activation.
- Bumped the service-worker shell cache to v5 so clients can receive the updated UI.

## Verification
- Production migration application: successful.
- Live database function definition: verified after deployment.
- Project structure/static verification: 124 checks passed.
- Full unit tests and production build: not run because `npm ci` timed out while installing dependencies in this environment.
- Cloudflare frontend deployment: not performed from this environment. Deploy the included source build to the existing Cloudflare project before considering the user-facing release complete.
