// Word-template value mapping used by report export.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  TEMPLATE_PLACEHOLDERS,
  templateExportFileName,
  templateValues,
  type TemplateReportInput,
} from '../src/lib/report-template.ts'

const input: TemplateReportInput = {
  institutionName: 'مؤسسة النجاح',
  coachName: 'محمد',
  reportDate: '2026-11-16',
  counts: { present_count: 10, absent_count: 2, late_count: 1, injured_count: 0, excused_count: 1 },
  notes: 'ملاحظة',
  reportingPeriodStart: '2026-11-01',
  reportingPeriodEnd: '2026-11-15',
  issueDate: '2026-11-16',
  submittedAt: '2026-11-16T10:00:00Z',
  students: [{ name: 'سارة', observation: 'تحسن', notes: 'متابعة' }],
}

test('counts and total are mapped as plain text', () => {
  const values = templateValues(input)
  assert.equal(values.present, '10')
  assert.equal(values.absent, '2')
  assert.equal(values.late, '1')
  assert.equal(values.injured, '0')
  assert.equal(values.excused, '1')
  assert.equal(values.total, '14')
})

test('report metadata keeps the independent chronology fields', () => {
  const values = templateValues(input)
  assert.equal(values.date, '2026-11-16')
  assert.equal(values.period_start, '2026-11-01')
  assert.equal(values.period_end, '2026-11-15')
  assert.equal(values.issue_date, '2026-11-16')
  assert.equal(values.submitted_at, '2026-11-16T10:00:00Z')
  assert.equal(values.institution, 'مؤسسة النجاح')
})

test('missing optional values fall back to an em dash instead of "null"', () => {
  const values = templateValues({
    coachName: 'coach',
    reportDate: '2026-11-16',
    counts: { present_count: 0, absent_count: 0, late_count: 0, injured_count: 0, excused_count: 0 },
    notes: null,
  })
  assert.equal(values.notes, '—')
  assert.equal(values.period_start, '—')
  assert.equal(values.issue_date, '—')
  assert.equal(values.institution, '—')
  assert.equal(values.total, '0')
})

test('student rows are trimmed and empty observation stays empty, not a dash', () => {
  const values = templateValues({ ...input, students: [{ name: ' سارة ', observation: '', notes: '' }] })
  assert.deepEqual(values.students, [{ name: 'سارة', observation: '', notes: '' }])
})

test('the placeholder list documents the supported tokens', () => {
  const tokens = TEMPLATE_PLACEHOLDERS.map((item) => item.token)
  for (const token of ['{coach}', '{date}', '{present}', '{absent}', '{total}', '{notes}']) {
    assert.ok(tokens.includes(token), `${token} is documented`)
  }
  assert.ok(tokens.some((token) => token.includes('{#students}')))
})

test('template export file names are safe on every platform', () => {
  assert.equal(templateExportFileName('a/b:c', '2026-11-16'), 'daily-report-a_b_c-2026-11-16.docx')
})
