// Student report details: one row per student, trimmed values, draft-first order.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  buildReportDetailRows,
  detailsInsertedCompletely,
  reportAcceptsDetails,
  upsertDetailDraft,
  type DetailDraft,
} from '../src/lib/report-details.ts'

const base: DetailDraft[] = [
  { student_id: 's1', student_name: ' أحمد ', observation: ' تحسن ', notes: '  ' },
  { student_id: 's2', student_name: '', observation: '', notes: 'ملاحظة' },
]

test('detail rows are trimmed and blank text becomes null', () => {
  const rows = buildReportDetailRows('r1', 'i1', base, 'u1')
  assert.equal(rows.length, 2)
  assert.deepEqual(rows[0], {
    report_id: 'r1',
    institution_id: 'i1',
    student_id: 's1',
    student_name_snapshot: 'أحمد',
    observation: 'تحسن',
    notes: null,
    created_by: 'u1',
  })
  assert.equal(rows[1].student_name_snapshot, '—')
  assert.equal(rows[1].observation, null)
  assert.equal(rows[1].notes, 'ملاحظة')
})

test('a student appears at most once even if the form added them twice', () => {
  const rows = buildReportDetailRows('r1', 'i1', [...base, base[0]], 'u1')
  assert.equal(rows.length, 2)
  assert.deepEqual(rows.map((row) => row.student_id), ['s1', 's2'])
})

test('detail rows without a student id are skipped', () => {
  const rows = buildReportDetailRows('r1', 'i1', [{ ...base[0], student_id: '   ' }], 'u1')
  assert.equal(rows.length, 0)
})

test('adding a second note for the same student replaces the first', () => {
  const first = upsertDetailDraft([], { student_id: 's1', student_name: 'أ', observation: '1', notes: '' })
  const second = upsertDetailDraft(first, { student_id: 's1', student_name: 'أ', observation: '2', notes: '' })
  assert.equal(second.length, 1)
  assert.equal(second[0].observation, '2')
})

test('upsert ignores an empty student id', () => {
  const list = upsertDetailDraft([], { student_id: '', student_name: 'x', observation: '', notes: '' })
  assert.deepEqual(list, [])
})

test('details are only accepted by a non-finalized report', () => {
  assert.equal(reportAcceptsDetails({ is_finalized: false }), true)
  assert.equal(reportAcceptsDetails({ is_finalized: true }), false)
  assert.equal(reportAcceptsDetails(null), false)
})

test('a partially inserted detail batch is a failure', () => {
  assert.equal(detailsInsertedCompletely(0, 0), true)
  assert.equal(detailsInsertedCompletely(3, 3), true)
  assert.equal(detailsInsertedCompletely(3, 2), false)
  assert.equal(detailsInsertedCompletely(3, null), false)
})
