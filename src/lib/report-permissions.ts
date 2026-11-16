// Report lifecycle permissions (pure, no Supabase import).
//
// Business rules enforced by the interface and mirrored in the database:
//   * the coach who submitted a report can never delete it;
//   * institution administrators (admin) may delete reviewed reports only;
//   * the institution director (manager) may delete finalized/historical reports;
//   * the platform owner has no institution scope and never deletes reports.
//
// Keeping the rule in one pure module means the button, the confirmation and the
// regression tests can never disagree.

export type ReportActor = {
  id: string
  role: string
}

export type ReportTarget = {
  coach_id: string
  status: string
  is_finalized: boolean
}

/** True when the actor is allowed to delete the given report. */
export function canDeleteReport(actor: ReportActor, target: ReportTarget): boolean {
  if (!target.is_finalized) return false
  if (target.coach_id === actor.id) return false
  if (actor.role === 'manager') return true
  if (actor.role === 'admin') return target.status === 'reviewed'
  return false
}

/** True when the actor may mark a submitted report as reviewed. */
export function canReviewReport(actor: ReportActor, target: ReportTarget): boolean {
  if (!target.is_finalized) return false
  if (target.status !== 'submitted') return false
  return actor.role === 'manager' || actor.role === 'admin'
}

/**
 * A delete/update is only successful when the server reports at least one
 * affected row. PostgREST returns the affected rows only when `.select()` is
 * chained, which is why the interface must check `rows.length`.
 */
export function affectedRows<T>(rows: T[] | null | undefined): number {
  return Array.isArray(rows) ? rows.length : 0
}

/** Human-readable reason used when a delete silently affected no rows. */
export function describeDeleteFailure(actorRole: string): string {
  if (actorRole === 'coach') return 'coach_cannot_delete'
  if (actorRole === 'owner') return 'owner_out_of_scope'
  return 'not_allowed_or_report_missing'
}
