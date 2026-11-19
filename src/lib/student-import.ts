export type ImportedStudent = { student_code: string; full_name: string }

function normalizeHeader(value: unknown): string {
  return String(value ?? '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[\u064B-\u065F\u0670\u0640]/g, '')
    .toLowerCase()
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/[ىي]/g, 'ي')
    .replace(/[^\p{L}\p{N}]+/gu, '')
}

const CODE_HEADERS = new Set([
  'code', 'studentcode', 'studentid', 'studentnumber', 'codeetudiant', 'codeeleve',
  'matricule', 'matriculeeleve', 'numero', 'numerodeleve', 'numereleve', 'numeroeleve', 'numeleve', 'identifiant', 'idstudent',
  'الرقم', 'رقم', 'رقمالتلميذ', 'رمز', 'رمزالتلميذ', 'معرف', 'معرفالتلميذ',
].map(normalizeHeader))
const FULL_NAME_HEADERS = new Set([
  'fullname', 'studentname', 'name', 'nomcomplet', 'nometprenom', 'nometprenom',
  'nomprenom', 'nomdeleve', 'nomdelevecomplet', 'اسمكامل', 'الاسمكامل',
  'الاسمالكامل', 'اسمالتلميذ', 'اسموتلميذ', 'الاسمواللقب',
].map(normalizeHeader))
const FIRST_NAME_HEADERS = new Set([
  'firstname', 'givenname', 'prenom', 'prénom', 'الاسم', 'اسم', 'اسمالاول', 'الاسم الشخصي',
].map(normalizeHeader))
const LAST_NAME_HEADERS = new Set([
  'lastname', 'surname', 'familyname', 'nom', 'nomfamille', 'لقب', 'اللقب', 'اسم العائلة',
].map(normalizeHeader))

function splitDelimitedLine(line: string, delimiter: string): string[] {
  const values: string[] = []
  let value = ''
  let quoted = false
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i]
    if (char === '"') {
      if (quoted && line[i + 1] === '"') { value += '"'; i += 1 }
      else quoted = !quoted
    } else if (char === delimiter && !quoted) {
      values.push(value.trim())
      value = ''
    } else value += char
  }
  values.push(value.trim())
  return values
}

function cellText(value: unknown): string {
  if (value instanceof Date) return value.toISOString().slice(0, 10)
  // Text-formatted Excel cells retain leading zeroes. Numeric cells do not carry
  // their display mask through read-excel-file, so users are warned in the UI.
  return String(value ?? '').trim()
}

export function parseStudentImportMatrix(matrix: unknown[][]): ImportedStudent[] {
  const rows = matrix.map((row) => row.map(cellText))
    .filter((row) => row.some((cell) => cell.trim().length > 0))
  if (!rows.length) return []

  const headers = rows[0].map(normalizeHeader)
  const codeIndex = headers.findIndex((header) => CODE_HEADERS.has(header))
  const fullNameIndex = headers.findIndex((header) => FULL_NAME_HEADERS.has(header))
  const firstNameIndex = headers.findIndex((header) => FIRST_NAME_HEADERS.has(header))
  const lastNameIndex = headers.findIndex((header) => LAST_NAME_HEADERS.has(header))
  const hasHeader = codeIndex >= 0 || fullNameIndex >= 0 || firstNameIndex >= 0 || lastNameIndex >= 0
  const data = hasHeader ? rows.slice(1) : rows

  return data.map((row) => {
    const code = row[hasHeader ? (codeIndex >= 0 ? codeIndex : 0) : 0] ?? ''
    let fullName = ''
    if (hasHeader && fullNameIndex >= 0) fullName = row[fullNameIndex] ?? ''
    else if (hasHeader && firstNameIndex >= 0 && lastNameIndex >= 0) {
      fullName = [row[firstNameIndex], row[lastNameIndex]].filter(Boolean).join(' ')
    } else if (hasHeader && (firstNameIndex >= 0 || lastNameIndex >= 0)) {
      fullName = row[firstNameIndex >= 0 ? firstNameIndex : lastNameIndex] ?? ''
    } else {
      fullName = row[hasHeader ? (codeIndex >= 0 ? (codeIndex === 0 ? 1 : 0) : 1) : 1] ?? ''
    }
    return { student_code: code.trim(), full_name: fullName.trim().replace(/\s+/g, ' ') }
  }).filter((row) => row.student_code.length > 0 && row.full_name.length > 0)
}

export function parseStudentImportText(raw: string): ImportedStudent[] {
  const lines = raw.replace(/^\uFEFF/, '').replace(/\r/g, '').split('\n').filter((line) => line.trim())
  if (!lines.length) return []
  const first = lines[0]
  const delimiter = first.includes('\t') ? '\t' : first.includes(';') ? ';' : ','
  return parseStudentImportMatrix(lines.map((line) => splitDelimitedLine(line, delimiter)))
}
