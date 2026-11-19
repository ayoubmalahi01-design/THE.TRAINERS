# Deployment Readiness

The authoritative current status is `docs/RELEASE_STATUS_2026-11-19.md`.

The project has a reconciled source tree and Supabase migration history, and passes 100 structural checks plus 175 unit tests. It is **not certified for public production rollout yet** because the package install timed out in this environment, so Vite production build/typecheck/npm audit could not be completed. Real role-based RLS, invitation SMTP, Edge Function redeployment, and Android/iPhone tests also remain outstanding.

Do not run `supabase/THE_TRAINERS_SETUP.sql` against the existing production database. The current production Supabase project is `rxkyryaplszuklagvidi`; the local migration folder matches its 17 recorded migration versions. Never replay an applied migration.

Before release:
1. Run `npm ci`, `npm run typecheck`, `npm run build`, `npm test`, and `npm run verify` in a connected build environment.
2. Set Supabase Edge Function Secrets `SUPABASE_SERVICE_ROLE_KEY`, `APP_URL`, and `ALLOWED_ORIGINS` (the final Cloudflare HTTPS origin) and deploy `invite-user`.
3. Test invitations/SMTP and acceptance with real test accounts.
4. Run role-based RLS and cross-institution tests for Owner, Manager, Admin, and Coach.
5. Test reports, attendance, notices, messages, file access, and PWA installation on real devices.

The file `supabase/pending/20261119000000_security_hardening_REVIEW_REQUIRED.sql` is not applied and must not be executed as-is.
