// Report deletion / review authorization rules.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  affectedRows,
  canDeleteReport,
  canReviewReport,
  describeDeleteFailure,
} from '../src/lib/report-permissions.ts'

const coach = { id: 'coach-1', role: 'coach' }
const otherCoach = { id: 'coach-2', role: 'coach' }
const manager = { id: 'manager-1', role: 'manager' }
const admin = { id: 'admin-1', role: 'admin' }
const owner = { id: 'owner-1', role: 'owner' }

const submitted = { coach_id: 'coach-1', status: 'submitted', is_finalized: true }
const reviewed = { coach_id: 'coach-1', status: 'reviewed', is_finalized: true }
const draft = { coach_id: 'coach-1', status: 'draft', is_finalized: false }

test('a coach can never delete a report, even their own', () => {
  assert.equal(canDeleteReport(coach, submitted), false)
  assert.equal(canDeleteReport(coach, reviewed), false)
  assert.equal(canDeleteReport(coach, draft), false)
})

test('the platform owner has no institution report scope', () => {
  assert.equal(canDeleteReport(owner, reviewed), false)
})

test('the director (manager) may delete finalized historical reports', () => {
  assert.equal(canDeleteReport(manager, submitted), true)
  assert.equal(canDeleteReport(manager, reviewed), true)
  assert.equal(canDeleteReport(manager, draft), false)
})

test('administration may delete reviewed reports only', () => {
  assert.equal(canDeleteReport(admin, reviewed), true)
  assert.equal(canDeleteReport(admin, submitted), false)
  assert.equal(canDeleteReport(admin, draft), false)
})

test('a coach cannot delete another coach report either', () => {
  assert.equal(canDeleteReport(otherCoach, reviewed), false)
})

test('drafts are never deletable from the reports screen', () => {
  for (const actor of [manager, admin]) {
    assert.equal(canDeleteReport(actor, draft), false)
  }
})

test('review is limited to managers/admins and submitted reports', () => {
  assert.equal(canReviewReport(manager, submitted), true)
  assert.equal(canReviewReport(admin, submitted), true)
  assert.equal(canReviewReport(coach, submitted), false)
  assert.equal(canReviewReport(owner, submitted), false)
  assert.equal(canReviewReport(manager, reviewed), false)
  assert.equal(canReviewReport(manager, draft), false)
})

test('an update that affected no row is not a success', () => {
  assert.equal(affectedRows([]), 0)
  assert.equal(affectedRows(null), 0)
  assert.equal(affectedRows(undefined), 0)
  assert.equal(affectedRows([{ id: 'x' }]), 1)
})

test('delete failures carry a reason, not a false success', () => {
  assert.equal(describeDeleteFailure('coach'), 'coach_cannot_delete')
  assert.equal(describeDeleteFailure('owner'), 'owner_out_of_scope')
  assert.equal(describeDeleteFailure('manager'), 'not_allowed_or_report_missing')
})
