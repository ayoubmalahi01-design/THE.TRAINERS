// Render an uploaded .docx template in the browser.
//
// This module is imported dynamically so the template engine stays out of the
// initial bundle. It is deliberately thin: all value derivation lives in the
// pure `report-template.ts` module and is unit-tested there.

import PizZip from 'pizzip'
import Docxtemplater from 'docxtemplater'
import { templateValues, type TemplateReportInput } from './report-template'

export async function renderReportTemplate(
  bytes: ArrayBuffer,
  input: TemplateReportInput,
): Promise<Blob> {
  const zip = new PizZip(bytes)
  const doc = new Docxtemplater(zip, {
    paragraphLoop: true,
    linebreaks: true,
    // An unknown tag must not abort the export; the administrator may use a
    // richer template shared with another system.
    nullGetter: () => '',
  })
  doc.render(templateValues(input))
  return doc.getZip().generate({
    type: 'blob',
    mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  }) as Blob
}
