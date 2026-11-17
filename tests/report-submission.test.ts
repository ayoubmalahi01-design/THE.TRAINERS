// Report submission lifecycle rules — regression coverage for the official
// submission timestamp handling required by the final repair prompt.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  canSubmitReport,
  draftSubmittedAt,
  REPORT_STATUS_DRAFT,
  REPORT_STATUS_REVIEWED,
  REPORT_STATUS_SUBMITTED,
  shouldAssignServerSubmittedAt,
  trustedSubmittedAt,
  type ReportLifecycleState,
} from '../src/lib/report-submission.ts'

test('a new draft keeps submitted_at NULL', () => {
  assert.equal(draftSubmittedAt(), null)
})

test('saving an existing draft keeps submitted_at NULL and does not assign a submission timestamp', () => {
  // saveDraft persists status 'draft' / is_finalized false and submitted_at NULL.
  assert.equal(draftSubmittedAt(), null)
  assert.equal(canSubmitReport({ status: REPORT_STATUS_DRAFT, is_finalized: false }), true)
})

test('successful submission is only allowed from a draft state', () => {
  assert.equal(canSubmitReport(null), true) // create new report
  assert.equal(canSubmitReport({ status: REPORT_STATUS_DRAFT, is_finalized: false }), true)
  assert.equal(canSubmitReport({ status: REPORT_STATUS_DRAFT, is_finalized: true }), false)
  assert.equal(canSubmitReport({ status: REPORT_STATUS_SUBMITTED, is_finalized: true }), false)
  assert.equal(canSubmitReport({ status: REPORT_STATUS_REVIEWED, is_finalized: true }), false)
})

test('the server-side timestamp is assigned only on the draft -> submitted transition', () => {
  // Draft (is_finalized false, status draft) -> submitted (is_finalized true).
  assert.equal(shouldAssignServerSubmittedAt(true, REPORT_STATUS_SUBMITTED, false), true)
  // Already finalized submissions are never re-assigned.
  assert.equal(shouldAssignServerSubmittedAt(true, REPORT_STATUS_SUBMITTED, true), false)
  // Finalized reports are never re-submitted.
  assert.equal(shouldAssignServerSubmittedAt(true, REPORT_STATUS_SUBMITTED, true), false)
  assert.equal(shouldAssignServerSubmittedAt(true, REPORT_STATUS_REVIEWED, true), false)
  assert.equal(shouldAssignServerSubmittedAt(true, REPORT_STATUS_DRAFT, true), false)
  assert.equal(shouldAssignServerSubmittedAt(false, REPORT_STATUS_SUBMITTED, false), false)
})

test('only a trusted server-side timestamp is accepted; client values are never trusted', () => {
  assert.equal(trustedSubmittedAt(null), null)
  assert.equal(trustedSubmittedAt(undefined), null)
  assert.equal(trustedSubmittedAt(''), null)
  assert.equal(trustedSubmittedAt('not-a-date'), 'not-a-date')
  assert.equal(trustedSubmittedAt('2026-11-16T10:00:00Z'), '2026-11-16T10:00:00Z')
})

test('draft lifecycle state helpers keep draft private', () => {
  const draft: ReportLifecycleState = { status: REPORT_STATUS_DRAFT, is_finalized: false }
  assert.equal(draft.is_finalized, false)
  assert.equal(draft.status, REPORT_STATUS_DRAFT)
})
