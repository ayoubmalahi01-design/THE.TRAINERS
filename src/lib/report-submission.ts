// Official report submission rules.
//
// The official submission timestamp (`daily_reports.submitted_at`) must NEVER be
// fabricated or supplied by the browser. Drafts keep `submitted_at = NULL`.
// The transition from draft -> submitted is performed through the trusted
// database workflow (database trigger / server-side operation) that assigns the
// authoritative submission timestamp only after a successful persistence.

export const REPORT_STATUS_DRAFT = 'draft'
export const REPORT_STATUS_SUBMITTED = 'submitted'
export const REPORT_STATUS_REVIEWED = 'reviewed'

export type ReportLifecycleState = {
  status: string
  is_finalized: boolean
}

/**
 * A draft never carries an official submission timestamp.
 * The client must persist `submitted_at = NULL` for drafts (including updates
 * of an existing draft).
 */
export function draftSubmittedAt(): null {
  return null
}

/**
 * The official submission timestamp is only accepted from a trusted server-side
 * source. When no trusted value is supplied, the draft/finalized report keeps a
 * NULL submission timestamp and the database trigger assigns it on submission.
 */
export function trustedSubmittedAt(serverNowIso: string | null | undefined): string | null {
  return typeof serverNowIso === 'string' && serverNowIso ? serverNowIso : null
}

/**
 * A report may be submitted only while it is still an editable draft.
 * Once finalized (submitted) or reviewed, submission is blocked.
 */
export function canSubmitReport(state: ReportLifecycleState | null | undefined): boolean {
  if (!state) return true
  if (state.is_finalized) return false
  if (state.status === REPORT_STATUS_SUBMITTED || state.status === REPORT_STATUS_REVIEWED) return false
  return state.status === REPORT_STATUS_DRAFT
}

/**
 * The server-side trusted assignment runs only on the draft -> submitted
 * transition (finalized flipped to true while status becomes 'submitted').
 * It never re-assigns timestamps for drafts or already submitted reports.
 */
export function shouldAssignServerSubmittedAt(
  isFinalized: boolean,
  status: string,
  previousFinalized: boolean,
): boolean {
  if (!(isFinalized === true && status === REPORT_STATUS_SUBMITTED)) return false
  if (previousFinalized) return false
  return true
}
