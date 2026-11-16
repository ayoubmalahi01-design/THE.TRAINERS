// Student-level report details (pure helpers).
//
// Migration 0004 restricts `report_details` INSERT/DELETE to reports whose
// `is_finalized` is still false. The submission workflow therefore has a fixed
// order:
//
//   1. persist/update the draft report,
//   2. replace the per-student details while the report is still a draft,
//   3. finalize the report.
//
// Doing it the other way round makes every detail write fail RLS while the
// report is already marked final — the old bug where submissions "succeeded"
// but lost all student notes.

export type DetailDraft = {
  student_id: string
  student_name: string
  observation: string
  notes: string
}

export type ReportDetailRow = {
  report_id: string
  institution_id: string | null
  student_id: string | null
  student_name_snapshot: string
  observation: string | null
  notes: string | null
  created_by: string
}

function clean(value: string | null | undefined): string {
  return typeof value === 'string' ? value.trim() : ''
}

/**
 * Build the rows to insert. A student always appears at most once, blank text
 * becomes NULL, and the student name is snapshotted because the student record
 * may later be renamed or archived.
 */
export function buildReportDetailRows(
  reportId: string,
  institutionId: string | null,
  details: DetailDraft[],
  createdBy: string,
  fallbackName = '—',
): ReportDetailRow[] {
  const seen = new Set<string>()
  const rows: ReportDetailRow[] = []
  for (const detail of details) {
    const studentId = clean(detail.student_id)
    if (!studentId || seen.has(studentId)) continue
    seen.add(studentId)
    rows.push({
      report_id: reportId,
      institution_id: institutionId,
      student_id: studentId,
      student_name_snapshot: clean(detail.student_name) || fallbackName,
      observation: clean(detail.observation) || null,
      notes: clean(detail.notes) || null,
      created_by: createdBy,
    })
  }
  return rows
}

/**
 * Add or replace a student's detail draft. Replacing instead of appending keeps
 * the list consistent with the one-row-per-student insert rule.
 */
export function upsertDetailDraft(details: DetailDraft[], next: DetailDraft): DetailDraft[] {
  const studentId = clean(next.student_id)
  if (!studentId) return details
  const kept = details.filter((detail) => detail.student_id !== studentId)
  return [...kept, { ...next, student_id: studentId }]
}

/** A report can only receive details while it is editable. */
export function reportAcceptsDetails(report: { is_finalized: boolean } | null | undefined): boolean {
  return Boolean(report) && report?.is_finalized === false
}

/** True when the number of inserted rows equals the number of planned rows. */
export function detailsInsertedCompletely(planned: number, inserted: number | null | undefined): boolean {
  return planned === 0 || (typeof inserted === 'number' && inserted === planned)
}
