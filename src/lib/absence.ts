// Consecutive-absence follow-up rules (pure, no Supabase import).
//
// Required behaviour:
//   * five consecutive absences raise a follow-up for the coach/administration;
//   * when the student returns within the next two actual sessions, the coach is
//     notified that the student is back after the absence run;
//   * older runs (more than two sessions ago) are no longer actionable.
//
// The queue is computed from `attendance_records`, not from a table that no
// trigger ever filled. `absence_followups` is only used for the manual
// "handled" state, so the screen works even before the database trigger is
// deployed.

export const ABSENCE_ALERT_STREAK = 5
export const RETURN_WINDOW_SESSIONS = 2

export type AttendanceHistoryRow = {
  student_id: string
  session_date: string
  status: string
  session_key?: string | null
}

export type AbsenceFollowUp = {
  studentId: string
  /** Length of the absence run that triggered the follow-up. */
  streak: number
  /** `open` = still absent; `returned` = came back within the window. */
  state: 'open' | 'returned'
  /** Number of sessions attended since the absence run (0 while still absent). */
  sessionsSinceReturn: number
  lastSessionDate: string
  lastAbsentDate: string
  totalAbsences: number
}

export type StoredFollowUp = {
  student_id: string
  status?: string | null
  streak?: number | null
  last_follow_up_at?: string | null
}

type Session = { key: string; date: string; absent: boolean }

function sessionOrder(row: AttendanceHistoryRow, index: number): Session {
  const date = typeof row.session_date === 'string' ? row.session_date : ''
  const key = typeof row.session_key === 'string' && row.session_key ? row.session_key : `row-${index}`
  return { key: `${date}|${key}`, date, absent: row.status === 'absent' }
}

function bySession(a: Session, b: Session): number {
  if (a.date === b.date) return a.key < b.key ? -1 : a.key > b.key ? 1 : 0
  return a.date < b.date ? -1 : 1
}

/**
 * Compute every actionable follow-up. Students without a qualifying absence run
 * are omitted, so an empty list is a valid, meaningful result.
 */
export function computeAbsenceFollowUps(rows: AttendanceHistoryRow[]): AbsenceFollowUp[] {
  const grouped = new Map<string, Session[]>()
  rows.forEach((row, index) => {
    if (!row || typeof row.student_id !== 'string' || !row.student_id) return
    const session = sessionOrder(row, index)
    if (!session.date) return
    const list = grouped.get(row.student_id) ?? []
    list.push(session)
    grouped.set(row.student_id, list)
  })

  const result: AbsenceFollowUp[] = []
  for (const [studentId, sessions] of grouped) {
    sessions.sort(bySession)
    // A duplicated (date, session) pair is one session, not two absences.
    const unique: Session[] = []
    for (const session of sessions) {
      if (unique.length && unique[unique.length - 1].key === session.key) continue
      unique.push(session)
    }
    if (!unique.length) continue

    const totalAbsences = unique.filter((session) => session.absent).length
    const last = unique[unique.length - 1]
    let trailingReturned = 0
    for (let index = unique.length - 1; index >= 0 && !unique[index].absent; index -= 1) {
      trailingReturned += 1
    }

    if (last.absent) {
      let streak = 0
      for (let index = unique.length - 1; index >= 0 && unique[index].absent; index -= 1) {
        streak += 1
      }
      if (streak < ABSENCE_ALERT_STREAK) continue
      const lastAbsentDate = unique
        .slice()
        .reverse()
        .find((session) => session.absent)?.date ?? last.date
      result.push({
        studentId,
        streak,
        state: 'open',
        sessionsSinceReturn: 0,
        lastSessionDate: last.date,
        lastAbsentDate,
        totalAbsences,
      })
      continue
    }

    if (trailingReturned < 1 || trailingReturned > RETURN_WINDOW_SESSIONS) continue
    let streak = 0
    for (let index = unique.length - trailingReturned - 1; index >= 0 && unique[index].absent; index -= 1) {
      streak += 1
    }
    if (streak < ABSENCE_ALERT_STREAK) continue
    let lastAbsentDate = ''
    for (let index = unique.length - trailingReturned - 1; index >= 0 && unique[index].absent; index -= 1) {
      lastAbsentDate = unique[index].date
    }
    result.push({
      studentId,
      streak,
      state: 'returned',
      sessionsSinceReturn: trailingReturned,
      lastSessionDate: last.date,
      lastAbsentDate,
      totalAbsences,
    })
  }

  const rank = (item: AbsenceFollowUp) => (item.state === 'open' ? 0 : 1)
  return result.sort((a, b) => rank(a) - rank(b) || b.streak - a.streak)
}

/** True when the administrator already marked this follow-up as handled. */
export function isFollowUpHandled(stored: StoredFollowUp | undefined): boolean {
  return stored?.status === 'done'
}

/** Overlay the manual handled state on the computed queue. */
export function withStoredState(
  computed: AbsenceFollowUp[],
  stored: StoredFollowUp[],
): (AbsenceFollowUp & { handled: boolean; lastFollowUpAt: string | null })[] {
  const byStudent = new Map<string, StoredFollowUp>()
  for (const row of stored) {
    if (row && typeof row.student_id === 'string') byStudent.set(row.student_id, row)
  }
  return computed.map((item) => {
    const row = byStudent.get(item.studentId)
    return {
      ...item,
      handled: isFollowUpHandled(row),
      lastFollowUpAt: row?.last_follow_up_at ?? null,
    }
  })
}
