import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'

const app = fs.readFileSync('src/App.tsx', 'utf8')
const outbox = fs.readFileSync('src/lib/attendance-outbox.ts', 'utf8')
const deletion = fs.readFileSync('supabase/functions/delete-institution/index.ts', 'utf8')
const privateMigration = fs.readFileSync('supabase/migrations/20261119162052_private_institution_deletion_rpc.sql', 'utf8')
const storageMigration = fs.readFileSync('supabase/migrations/20261119162348_delegate_institution_storage_cleanup.sql', 'utf8')
const guardMigration = fs.readFileSync('supabase/migrations/20261119163829_institution_deletion_profile_guard_context.sql', 'utf8')

test('offline attendance is persisted in IndexedDB and retried on reconnect', () => {
  assert.match(outbox, /indexedDB\.open/)
  assert.match(outbox, /transaction\(STORE, mode\)/)
  assert.match(app, /queueAttendance\(/)
  assert.match(app, /addEventListener\('online'/)
  assert.match(app, /syncQueuedAttendance/)
  assert.match(outbox, /getQueuedAttendance/)
  assert.match(app, /getQueuedAttendance\(`\$\{profile\.institution_id\}/)
})

test('offline attendance cache retains the roster and open session key', () => {
  assert.match(outbox, /cacheAttendanceRoster/)
  assert.match(outbox, /cacheAttendanceSession/)
  assert.match(outbox, /cacheAttendanceSnapshot/)
  assert.match(app, /readAttendanceSession/)
  assert.match(app, /readAttendanceSnapshot/)
})

test('conversation members can leave through their own membership row', () => {
  const leave = app.slice(app.indexOf('async function leaveConversation'), app.indexOf('async function removeMember'))
  assert.match(leave, /\.delete\(\)/)
  assert.match(leave, /\.eq\('profile_id', profile\.id\)/)
  assert.match(app, /leaveConversation\(\)/)
})

test('student note follow-up supports open, done and reset states', () => {
  assert.match(app, /updateNoteStatus\(item\.id, 'open'\)/)
  assert.match(app, /updateNoteStatus\(item\.id, 'done'\)/)
  assert.match(app, /updateNoteStatus\(item\.id, 'none'\)/)
})

test('institution deletion is manager-checked, name-confirmed and uses Storage API', () => {
  assert.match(deletion, /actor\.role !== 'manager'/)
  assert.match(deletion, /institution\.name !== confirmationName/)
  assert.match(deletion, /storage\.from\(bucket\)\.remove/)
  assert.match(deletion, /userClient\.rpc\('delete_institution'/)
  assert.match(privateMigration.toLowerCase(), /security invoker/)
  assert.match(storageMigration, /Storage API/)
  assert.doesNotMatch(storageMigration, /delete from storage\.objects/i)
  assert.match(guardMigration, /set_config\('app\.account_repair', 'on', true\)/)
})

test('attendance can select a specific coach shift for multiple sessions on one day', () => {
  const attendance = fs.readFileSync('src/lib/attendance.ts', 'utf8')
  assert.match(attendance, /sessionKeyOverride\?: string/)
  assert.match(app, /from\('coach_shifts'\)[\s\S]*?gte\('started_at'/)
  assert.match(app, /<label>\{t\('sessionScope'\)\}/)
  assert.match(app, /loadAttendance\(date, effectiveCoachId, nextSessionKey\)/)
})
