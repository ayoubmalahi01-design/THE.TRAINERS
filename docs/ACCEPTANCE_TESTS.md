# Acceptance test plan (run after Supabase deployment)

Use separate test identities for each role and at least two institutions. Do not use production student records during this test.

## Identity and hierarchy
- [ ] Invite `ayoubmalleh772@gmail.com` after SQL installation; verify the profile is `owner`, `active`, and has `institution_id IS NULL`.
- [ ] Sign in as owner; create two institutions and invite one manager to each.
- [ ] Verify a manager can see only their own institution and cannot create institutions.
- [ ] Verify a manager can invite coaches and admins, and an admin can invite another admin or a coach.
- [ ] Verify invited accounts remain pending until approved (except owner-appointed managers).
- [ ] Verify a coach cannot change their own role, institution, or account status through direct Supabase API calls.

## Tenant and privacy boundaries
- [ ] Institution A users cannot read or modify Institution B students, reports, attendance, notices, messages, or audit logs.
- [ ] Coach A cannot select Coach B daily reports, including direct REST requests by report id.
- [ ] Coach A cannot select, update, or delete Coach B notebook rows.
- [ ] A coach cannot read medical records or objects in `trainer-medical`.
- [ ] An institution admin can read medical records only for their institution.
- [ ] Medical detail values are redacted in platform-wide audit snapshots.
- [ ] A finalized report cannot be updated or deleted through the API.

## Recently repaired workflows
- [ ] Record attendance in two or more coach shifts on the same date; switch the session selector and verify each session loads/saves independently.
- [ ] With a disposable test account, save attendance offline, reload the already-cached attendance screen, reconnect, and verify the queued records sync once without duplication.
- [ ] Leave a group conversation as a member and verify it disappears only from that member’s conversation list.
- [ ] Change a student note follow-up between open, done, and none using Manager/Admin accounts; verify Coach cannot change the status.
- [ ] On a disposable test institution only, verify Manager-only institution deletion, exact-name confirmation, Storage API cleanup in all four private buckets, former profiles becoming rejected/detached, and audit history remaining.

## Workflows and devices
- [ ] Start and end a coach shift; verify timestamps and one-open-shift constraint.
- [ ] Record attendance for a class and verify duplicate student/date entries are rejected/upserted as expected.
- [ ] Submit a report and verify the linked shift timestamps are accurate.
- [ ] Publish an admin notice; verify a notification is created for other active members, and only each recipient can mark their notification read.
- [ ] Send text, image, document, and voice messages; verify signed URLs and institution storage isolation.
- [ ] Test dictation in Arabic, French, and English on supported browsers; verify graceful fallback when unsupported.
- [ ] Install the PWA on a current Android phone and iPhone; verify navigation, upload, microphone permission, and layout.

## Release gate

Do not mark production acceptance complete until every applicable test above passes against the deployed Supabase project and on real target devices. Save test results and timestamps with the release record.


## 2026-11-19 follow-up repair acceptance checks

- Import an XLSX with Arabic headers `رقم التلميذ`, `الاسم`, `اللقب`; verify the preview combines the name and surname and preserves text codes such as `0012`.
- Repeat with French headers `Matricule`, `Nom`, `Prénom` and English headers `student_code`, `first_name`, `last_name`.
- Confirm duplicate codes already in the institution and duplicates within the same file are excluded before insert.
- Set a student exemption/permission period in the administration medical page. Verify Coach sees only student identity, type, and validity dates in Daily Status, and cannot read medical details or attachments.
- Verify a period is visible on its start/end dates and disappears from the active list after its end date without deleting the source record.
- As Coach, export a finalized report and verify the institution's current non-archived DOCX template is used; verify Coach cannot list or manage archived/older templates.
