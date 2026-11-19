import PizZip from 'pizzip'

export type WordInputField = { key: string; label: string; required: boolean }

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
const INPUT_TOKEN = /\{input_(required_)?([\p{L}\p{N}_-]+)\}|_{3,}/gu

function children(node: Element): Element[] {
  return Array.from(node.children)
}

function child(node: Element, localName: string): Element | undefined {
  return children(node).find((item) => item.localName === localName)
}

function value(node: Element | undefined): string {
  return node?.getAttributeNS(W, 'val') || node?.getAttribute('w:val') || ''
}

function escapeHtml(input: string): string {
  return input.replace(/[&<>"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[char] || char)
}

function fieldLabel(key: string): string {
  return key.replace(/[_-]+/g, ' ').trim()
}

function renderText(text: string, fields: Map<string, WordInputField>, responses: Record<string, string>, editable: boolean): string {
  let output = ''
  let last = 0
  INPUT_TOKEN.lastIndex = 0
  for (const match of text.matchAll(INPUT_TOKEN)) {
    const index = match.index ?? 0
    output += escapeHtml(text.slice(last, index))
    const isBlankLine = match[0].startsWith('_')
    const required = !isBlankLine && Boolean(match[1])
    const key = isBlankLine ? `auto_blank_${[...fields.keys()].filter((item) => item.startsWith('auto_blank_')).length + 1}` : match[2]
    const existing = fields.get(key)
    fields.set(key, { key, label: fieldLabel(key), required: required || Boolean(existing?.required) })
    const current = responses[key] || ''
    output += editable
      ? `<span class="word-fill-slot${required ? ' required' : ''}" contenteditable="true" role="textbox" aria-label="${escapeHtml(fieldLabel(key))}" data-word-field="${escapeHtml(key)}" data-required="${required ? 'true' : 'false'}">${escapeHtml(current)}</span>`
      : `<span class="word-filled-value">${escapeHtml(current || '—')}</span>`
    last = index + match[0].length
  }
  output += escapeHtml(text.slice(last))
  return output.replace(/\r?\n/g, '<br>')
}

function renderRun(run: Element, fields: Map<string, WordInputField>, responses: Record<string, string>, editable: boolean): string {
  const props = child(run, 'rPr')
  const styles: string[] = []
  const bold = props && child(props, 'b')
  const italic = props && child(props, 'i')
  const underline = props && child(props, 'u')
  const color = props && child(props, 'color')
  const size = props && child(props, 'sz')
  const fonts = props && child(props, 'rFonts')
  if (bold && value(bold) !== '0' && value(bold) !== 'false') styles.push('font-weight:700')
  if (italic && value(italic) !== '0' && value(italic) !== 'false') styles.push('font-style:italic')
  if (underline && value(underline) !== 'none') styles.push('text-decoration:underline')
  if (color && /^[0-9a-f]{6}$/i.test(value(color))) styles.push(`color:#${value(color)}`)
  if (size && /^\d+$/.test(value(size))) styles.push(`font-size:${Number(value(size)) / 2}pt`)
  if (fonts) {
    const font = fonts.getAttributeNS(W, 'ascii') || fonts.getAttribute('w:ascii')
    if (font && /^[\w\s-]{1,60}$/.test(font)) styles.push(`font-family:${JSON.stringify(font)}`)
  }
  let content = ''
  for (const item of children(run)) {
    if (item.localName === 't' || item.localName === 'delText') content += renderText(item.textContent || '', fields, responses, editable)
    else if (item.localName === 'tab') content += '&emsp;'
    else if (item.localName === 'br' || item.localName === 'cr') content += '<br>'
  }
  if (!content) return ''
  return styles.length ? `<span style="${styles.join(';')}">${content}</span>` : content
}

function renderParagraph(paragraph: Element, fields: Map<string, WordInputField>, responses: Record<string, string>, editable: boolean): string {
  const props = child(paragraph, 'pPr')
  const alignment = props && child(props, 'jc') ? value(child(props, 'jc')) : ''
  const styleName = props && child(props, 'pStyle') ? value(child(props, 'pStyle')) : ''
  const styles: string[] = []
  if (alignment === 'center') styles.push('text-align:center')
  else if (alignment === 'right' || alignment === 'end') styles.push('text-align:right')
  else if (alignment === 'left' || alignment === 'start') styles.push('text-align:left')
  const spacing = props && child(props, 'spacing')
  if (spacing) {
    const before = Number(spacing.getAttributeNS(W, 'before') || spacing.getAttribute('w:before') || 0)
    const after = Number(spacing.getAttributeNS(W, 'after') || spacing.getAttribute('w:after') || 0)
    if (before > 0) styles.push(`margin-top:${before / 20}pt`)
    if (after > 0) styles.push(`margin-bottom:${after / 20}pt`)
  }
  const content = children(paragraph).map((item) => {
    if (item.localName === 'r') return renderRun(item, fields, responses, editable)
    if (item.localName === 'hyperlink') return children(item).map((run) => run.localName === 'r' ? renderRun(run, fields, responses, editable) : '').join('')
    return ''
  }).join('')
  const heading = /^Heading([1-6])$/i.exec(styleName)
  const tag = heading ? `h${heading[1]}` : 'p'
  const className = styleName ? ` class="word-${escapeHtml(styleName.toLowerCase())}"` : ''
  const style = styles.length ? ` style="${styles.join(';')}"` : ''
  return `<${tag}${className}${style}>${content || '&nbsp;'}</${tag}>`
}

function renderTable(table: Element, fields: Map<string, WordInputField>, responses: Record<string, string>, editable: boolean): string {
  const rows = children(table).filter((item) => item.localName === 'tr').map((row) => {
    const cells = children(row).filter((item) => item.localName === 'tc').map((cell) => {
      const blocks = children(cell).map((block) => block.localName === 'p'
        ? renderParagraph(block, fields, responses, editable)
        : block.localName === 'tbl' ? renderTable(block, fields, responses, editable) : '').join('')
      const props = child(cell, 'tcPr')
      const span = props && child(props, 'gridSpan') ? Number(value(child(props, 'gridSpan'))) : 1
      return `<td${span > 1 ? ` colspan="${span}"` : ''}>${blocks || '&nbsp;'}</td>`
    }).join('')
    return `<tr>${cells}</tr>`
  }).join('')
  return `<table class="word-table"><tbody>${rows}</tbody></table>`
}

export function inspectWordTemplate(bytes: ArrayBuffer, responses: Record<string, string> = {}, editable = true): { html: string; fields: WordInputField[] } {
  const zip = new PizZip(bytes)
  const documentFile = zip.file('word/document.xml')
  if (!documentFile) throw new Error('Word document is missing its main document.xml part.')
  const fields = new Map<string, WordInputField>()
  const parser = new DOMParser()
  const renderPart = (source: string, partName: string): string => {
    const xml = parser.parseFromString(source, 'application/xml')
    if (xml.getElementsByTagName('parsererror').length) throw new Error('The uploaded Word file is invalid or damaged.')
    const root = partName === 'word/document.xml'
      ? xml.getElementsByTagNameNS(W, 'body')[0]
      : xml.documentElement
    if (!root) return ''
    const content = children(root).map((block) => {
      if (block.localName === 'p') return renderParagraph(block, fields, responses, editable)
      if (block.localName === 'tbl') return renderTable(block, fields, responses, editable)
      return ''
    }).join('')
    return partName === 'word/document.xml' ? content : `<section class="word-${partName.includes('header') ? 'header' : 'footer'}">${content}</section>`
  }
  let html = renderPart(documentFile.asText(), 'word/document.xml')
  const relatedParts = Object.keys(zip.files)
    .filter((name) => /^word\/(?:header|footer)\d+\.xml$/.test(name))
    .sort((a, b) => {
      const rank = (name: string) => name.includes('header') ? 1 : 2
      return rank(a) - rank(b) || a.localeCompare(b)
    })
  for (const name of relatedParts) {
    const part = zip.file(name)
    if (part) html += renderPart(part.asText(), name)
  }
  return { html, fields: [...fields.values()] }
}

export function readWordFieldValues(root: HTMLElement): Record<string, string> {
  const result: Record<string, string> = {}
  root.querySelectorAll<HTMLElement>('[data-word-field]').forEach((element) => {
    const key = element.dataset.wordField
    if (key) {
      const current = element.innerText.replace(/\u00a0/g, ' ').trimEnd()
      if (!(key in result) || (!result[key] && current)) result[key] = current
    }
  })
  return result
}

export function missingRequiredWordFields(fields: WordInputField[], responses: Record<string, string>): WordInputField[] {
  return fields.filter((field) => field.required && !(responses[field.key] || '').trim())
}
