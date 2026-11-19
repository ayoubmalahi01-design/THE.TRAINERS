// Render an institution's original .docx template with saved coach responses.
// The uploaded document is never edited in place; only placeholder values are
// filled into a generated copy, preserving the original Word package/styles.

import PizZip from 'pizzip'
import Docxtemplater from 'docxtemplater'
import { templateValues, type TemplateReportInput } from './report-template'

export async function renderReportTemplate(
  bytes: ArrayBuffer,
  input: TemplateReportInput,
  responses: Record<string, string> = {},
): Promise<Blob> {
  const source = new PizZip(bytes)
  if (!source.file('word/document.xml')) throw new Error('Word document is missing its main document.xml part.')
  let blankIndex = 0
  const parts = Object.keys(source.files).filter((name) => /^word\/(?:document|header|footer)\d*\.xml$/.test(name)).sort((a, b) => {
    const rank = (name: string) => name.includes('document') ? 0 : name.includes('header') ? 1 : 2
    return rank(a) - rank(b) || a.localeCompare(b)
  })
  for (const name of parts) {
    const part = source.file(name)
    if (!part) continue
    const preparedXml = part.asText().replace(/(<w:t\b[^>]*>)([\s\S]*?)(<\/w:t>)/g, (_match, open: string, text: string, close: string) =>
      open + text.replace(/_{3,}/g, () => `{input_auto_blank_${++blankIndex}}`) + close,
    )
    source.file(name, preparedXml)
  }
  const doc = new Docxtemplater(source, {
    paragraphLoop: true,
    linebreaks: true,
    nullGetter: () => '',
  })
  const responseValues: Record<string, string> = {}
  for (const [key, value] of Object.entries(responses)) {
    responseValues[`input_${key}`] = value
    responseValues[`input_required_${key}`] = value
  }
  doc.render({ ...templateValues(input), ...responseValues })
  return doc.getZip().generate({
    type: 'blob',
    mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  }) as Blob
}
