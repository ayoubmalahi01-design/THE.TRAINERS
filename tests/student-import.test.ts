import test from 'node:test'
import assert from 'node:assert/strict'
import { parseStudentImportMatrix, parseStudentImportText } from '../src/lib/student-import.ts'

test('imports Arabic code, first name and surname headers', () => {
  assert.deepEqual(parseStudentImportMatrix([
    ['رقم التلميذ', 'الاسم', 'اللقب'],
    ['0012', 'محمد', 'بن سالم'],
  ]), [{ student_code: '0012', full_name: 'محمد بن سالم' }])
})

test('imports French matricule, nom and prénom columns', () => {
  assert.deepEqual(parseStudentImportText('Matricule;Nom;Prénom\n0007;Dupont;Élodie'), [
    { student_code: '0007', full_name: 'Élodie Dupont' },
  ])
})

test('imports English student code and full name headers', () => {
  assert.deepEqual(parseStudentImportText('student_code,full_name\n0001,"Sara Ahmed"'), [
    { student_code: '0001', full_name: 'Sara Ahmed' },
  ])
})

test('supports files without headers and quoted delimiters', () => {
  assert.deepEqual(parseStudentImportText('001,"Ali, Mohamed"\n002,Sana Ben Ali'), [
    { student_code: '001', full_name: 'Ali, Mohamed' },
    { student_code: '002', full_name: 'Sana Ben Ali' },
  ])
})
