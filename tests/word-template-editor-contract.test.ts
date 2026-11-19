import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'

const app = fs.readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8')
const editor = fs.readFileSync(new URL('../src/lib/word-template-editor.ts', import.meta.url), 'utf8')
const renderer = fs.readFileSync(new URL('../src/lib/report-template-render.ts', import.meta.url), 'utf8')

test('Word templates derive coach fields from the uploaded DOCX, not a separate field builder', () => {
  assert.match(app, /inspectWordTemplate\(await file\.arrayBuffer\(\), \{\}, false\)\.fields/)
  assert.match(app, /form_fields: detectedFields \|\| \[\]/)
  assert.doesNotMatch(app, /parseFieldLines|fieldLines/)
})

test('only marked input tokens become editable; ordinary document text remains static', () => {
  assert.match(editor, /INPUT_TOKEN = \/.*input_\(required_\)\?/)
  assert.match(editor, /contenteditable="true"/)
  assert.ok(editor.includes('_{3,}'))
  assert.match(editor, /escapeHtml\(text\.slice/)
})

test('required placeholders are tracked and validated before saving/submitting', () => {
  assert.match(editor, /required: required \|\| Boolean\(existing\?\.required\)/)
  assert.match(editor, /missingRequiredWordFields/)
  assert.match(app, /missingRequiredWordFields\(editorFields, currentResponses\)/)
})

test('the original DOCX is downloaded and rendered as a copy with saved responses', () => {
  assert.match(app, /storage\.from\('trainer-report-templates'\)\.download\(row\.template_file_path_snapshot\)/)
  assert.match(renderer, /new PizZip\(bytes\)/)
  assert.match(renderer, /doc\.render\(\{ \.\.\.templateValues\(input\), \.\.\.responseValues \}\)/)
  assert.match(renderer, /input_required_\$\{key\}/)
  assert.match(renderer, /input_auto_blank_/)
})

test('management reports remain separate from daily reports', () => {
  assert.match(app, /from\('template_reports'\)/)
  assert.match(app, /from\('daily_reports'\)/)
})

test('Word headers and footers are included when detecting and filling placeholders', () => {
  assert.match(editor, /header\|footer/)
  assert.match(renderer, /document\|header\|footer/)
})
