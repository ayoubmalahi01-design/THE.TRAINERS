// Five consecutive absences and the two-session return window.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  ABSENCE_ALERT_STREAK,
  RETURN_WINDOW_SESSIONS,
  computeAbsenceFollowUps,
  withStoredState,
  type AttendanceHistoryRow,
} from '../src/lib/absence.ts'

function day(n: number): string {
  return `2026-10-${String(n).padStart(2, '0')}`
}

function sessions(studentId: string, statuses: string[]): AttendanceHistoryRow[] {
  return statuses.map((status, index) => ({
    student_id: studentId,
    session_date: day(index + 1),
    session_key: 'shift-1',
    status,
  }))
}

test('the alert threshold is five absences and the return window is two sessions', () => {
  assert.equal(ABSENCE_ALERT_STREAK, 5)
  assert.equal(RETURN_WINDOW_SESSIONS, 2)
})

test('fewer than five consecutive absences do not raise a follow-up', () => {
  const rows = sessions('s1', ['absent', 'absent', 'absent', 'absent'])
  assert.deepEqual(computeAbsenceFollowUps(rows), [])
})

test('a non-absent day breaks the streak', () => {
  const rows = sessions('s1', ['absent', 'absent', 'absent', 'present', 'absent', 'absent', 'absent', 'absent'])
  assert.deepEqual(computeAbsenceFollowUps(rows), [])
})

test('five consecutive absences raise an open follow-up', () => {
  const rows = sessions('s1', ['absent', 'absent', 'absent', 'absent', 'absent'])
  const result = computeAbsenceFollowUps(rows)
  assert.equal(result.length, 1)
  assert.equal(result[0].state, 'open')
  assert.equal(result[0].streak, 5)
  assert.equal(result[0].sessionsSinceReturn, 0)
})

test('a return in the very next session is reported as returned', () => {
  const rows = sessions('s1', ['absent', 'absent', 'absent', 'absent', 'absent', 'present'])
  const result = computeAbsenceFollowUps(rows)
  assert.equal(result.length, 1)
  assert.equal(result[0].state, 'returned')
  assert.equal(result[0].streak, 5)
  assert.equal(result[0].sessionsSinceReturn, 1)
})

test('a return in the second session is still inside the window', () => {
  const rows = sessions('s1', ['absent', 'absent', 'absent', 'absent', 'absent', 'present', 'present'])
  const result = computeAbsenceFollowUps(rows)
  assert.equal(result.length, 1)
  assert.equal(result[0].sessionsSinceReturn, 2)
})

test('a return after more than two sessions is no longer actionable', () => {
  const rows = sessions('s1', ['absent', 'absent', 'absent', 'absent', 'absent', 'present', 'present', 'present'])
  assert.deepEqual(computeAbsenceFollowUps(rows), [])
})

test('a later short absence does not hide an older qualifying run', () => {
  const rows = sessions('s1', ['absent', 'absent', 'absent', 'absent', 'absent', 'present', 'absent'])
  // The latest session is absent, so the trailing streak is 1: not five.
  assert.deepEqual(computeAbsenceFollowUps(rows), [])
})

test('students are evaluated independently and ordered by urgency', () => {
  const rows = [
    ...sessions('open', ['absent', 'absent', 'absent', 'absent', 'absent']),
    ...sessions('returned', ['absent', 'absent', 'absent', 'absent', 'absent', 'present']),
    ...sessions('fine', ['present', 'present']),
  ]
  const result = computeAbsenceFollowUps(rows)
  assert.deepEqual(result.map((item) => item.studentId), ['open', 'returned'])
})

test('two sessions on the same day count separately when session keys differ', () => {
  const rows: AttendanceHistoryRow[] = [
    { student_id: 's1', session_date: day(1), session_key: 'a', status: 'absent' },
    { student_id: 's1', session_date: day(1), session_key: 'b', status: 'absent' },
    { student_id: 's1', session_date: day(2), session_key: 'a', status: 'absent' },
    { student_id: 's1', session_date: day(2), session_key: 'b', status: 'absent' },
    { student_id: 's1', session_date: day(3), session_key: 'a', status: 'absent' },
  ]
  const result = computeAbsenceFollowUps(rows)
  assert.equal(result.length, 1)
  assert.equal(result[0].streak, 5)
})

test('a duplicated identical session is counted once', () => {
  const rows: AttendanceHistoryRow[] = [
    { student_id: 's1', session_date: day(1), session_key: 'a', status: 'absent' },
    { student_id: 's1', session_date: day(1), session_key: 'a', status: 'absent' },
    { student_id: 's1', session_date: day(2), session_key: 'a', status: 'absent' },
    { student_id: 's1', session_date: day(3), session_key: 'a', status: 'absent' },
    { student_id: 's1', session_date: day(4), session_key: 'a', status: 'absent' },
  ]
  assert.deepEqual(computeAbsenceFollowUps(rows), [])
})

test('the stored handled state is overlaid without hiding the alert', () => {
  const rows = sessions('s1', ['absent', 'absent', 'absent', 'absent', 'absent'])
  const computed = computeAbsenceFollowUps(rows)
  const merged = withStoredState(computed, [{ student_id: 's1', status: 'done', last_follow_up_at: '2026-10-06T10:00:00Z' }])
  assert.equal(merged.length, 1)
  assert.equal(merged[0].handled, true)
  assert.equal(merged[0].lastFollowUpAt, '2026-10-06T10:00:00Z')
})

test('unknown students in the stored table are ignored', () => {
  const merged = withStoredState([], [{ student_id: 'ghost', status: 'done' }])
  assert.deepEqual(merged, [])
})
