// Institution Word templates — pure data mapping.
//
// The administrator uploads a .docx file in `report_templates`. The export uses
// that exact file as the document body and fills the placeholders below with
// the saved report. If the template has no placeholders it is still exported
// unchanged, which is the expected behaviour for a pre-printed form.
//
// Tags follow the docxtemplater syntax: {coach}, {date}, {present}, ...
// A student table can be produced with:
//   {#students}{name} | {observation} | {notes}{/students}

export type TemplateCounts = {
  present_count: number
  absent_count: number
  late_count: number
  injured_count: number
  excused_count: number
}

export type TemplateStudent = {
  name: string
  observation: string
  notes: string
}

export type TemplateReportInput = {
  institutionName?: string | null
  coachName: string
  reportDate: string
  counts: TemplateCounts
  notes?: string | null
  reportingPeriodStart?: string | null
  reportingPeriodEnd?: string | null
  issueDate?: string | null
  submittedAt?: string | null
  students?: TemplateStudent[]
}

export type TemplateValues = {
  institution: string
  coach: string
  date: string
  present: string
  absent: string
  late: string
  injured: string
  excused: string
  total: string
  notes: string
  period_start: string
  period_end: string
  issue_date: string
  submitted_at: string
  students: TemplateStudent[]
}

function text(value: string | null | undefined, fallback = '—'): string {
  const trimmed = typeof value === 'string' ? value.trim() : ''
  return trimmed || fallback
}

export function templateValues(input: TemplateReportInput): TemplateValues {
  const counts = input.counts
  const total =
    counts.present_count +
    counts.absent_count +
    counts.late_count +
    counts.injured_count +
    counts.excused_count
  return {
    institution: text(input.institutionName),
    coach: text(input.coachName),
    date: text(input.reportDate),
    present: String(counts.present_count),
    absent: String(counts.absent_count),
    late: String(counts.late_count),
    injured: String(counts.injured_count),
    excused: String(counts.excused_count),
    total: String(total),
    notes: text(input.notes),
    period_start: text(input.reportingPeriodStart),
    period_end: text(input.reportingPeriodEnd),
    issue_date: text(input.issueDate),
    submitted_at: text(input.submittedAt),
    students: (input.students ?? []).map((student) => ({
      name: text(student.name),
      observation: text(student.observation, ''),
      notes: text(student.notes, ''),
    })),
  }
}

/** Displayed in the templates screen so an administrator knows what to type. */
export const TEMPLATE_PLACEHOLDERS: { token: string; label: string }[] = [
  { token: '{institution}', label: 'institutionName' },
  { token: '{coach}', label: 'coach' },
  { token: '{date}', label: 'date' },
  { token: '{present}', label: 'present' },
  { token: '{absent}', label: 'absent' },
  { token: '{late}', label: 'late' },
  { token: '{injured}', label: 'injured' },
  { token: '{excused}', label: 'excused' },
  { token: '{total}', label: 'total' },
  { token: '{notes}', label: 'notes' },
  { token: '{period_start}', label: 'periodStart' },
  { token: '{period_end}', label: 'periodEnd' },
  { token: '{issue_date}', label: 'issueDate' },
  { token: '{submitted_at}', label: 'submittedAt' },
  { token: '{#students}{name} {observation} {notes}{/students}', label: 'reportDetails' },
]

/** File name for a template-based export, keeping the report's identity. */
export function templateExportFileName(coachName: string, reportDate: string): string {
  const safe = (coachName || 'report').replace(/[\\/:*?"<>|]/g, '_')
  return `daily-report-${safe}-${reportDate}.docx`
}
