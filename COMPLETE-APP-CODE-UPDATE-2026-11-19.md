# THE TRAINERS — Application Code Update (2026-11-19)

This package is based on the complete repair project and includes the previously prepared email-invitation auto-activation change. It also incorporates the application-code changes requested after the earlier complete ZIP.

## Included application changes

- Restored a direct home portal with shortcuts to attendance, daily status/absences, reports, students, management reports, and notices. Existing navigation destinations remain available.
- Improved DOCX template selection on mobile and desktop: the picker accepts generic file-provider MIME types as well as DOCX, selected filename and size are shown immediately, and the input is reset so the same file can be selected again.
- Improved Excel/CSV picker compatibility with mobile file providers while preserving the existing parser and import preview.
- Added start/end date-time, notification time, actual return time, and duty completion time fields to attendance records and medical restriction records.
- Added an automatic chronological audit entry for insert/update/delete of timed attendance and restriction records. The audit payload excludes medical narrative text and attachment paths.
- Updated the service-worker cache version so deployed clients fetch the changed application shell.
- Preserved the email-only invitation acceptance flow: verified email link, then automatic account activation without an additional administrative approval.

## Database migration included, not executed

`supabase/migrations/20261119223000_attendance_timing_and_audit_history.sql` is additive. It adds nullable timestamp columns and audit triggers without deleting or rewriting existing business rows. The same additive setup is appended to `supabase/THE_TRAINERS_SETUP.sql` for fresh installations.

The migration has **not** been applied to the live Supabase project in this package update. The new time fields require this migration before those fields can be saved to the live database. The earlier invitation auto-activation migration is the one already applied in the live project.

## Deployment and verification boundary

No Cloudflare deployment was performed. No browser, end-to-end, or user acceptance tests were run, in accordance with the user's instruction that they will perform testing and Cloudflare upload themselves. This package is a source-code delivery, not a claim of live deployment or completed user testing.
