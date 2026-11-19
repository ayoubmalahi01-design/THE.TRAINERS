import type { AttendanceInput } from './attendance-core'

export type AttendanceOutboxEntry = {
  id: string
  institution_id: string
  coach_id: string
  session_key: string
  session_date: string
  rows: AttendanceInput[]
  created_at: string
  attempts: number
  last_error?: string
}

const DB_NAME = 'the-trainers-offline'
const DB_VERSION = 1
const STORE = 'attendance-outbox'

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') return reject(new Error('IndexedDB unavailable'))
    const request = indexedDB.open(DB_NAME, DB_VERSION)
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'id' })
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error || new Error('Unable to open offline storage'))
  })
}

async function transact<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore, done: (value: T) => void, fail: (error: Error) => void) => void): Promise<T> {
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, mode)
    const store = tx.objectStore(STORE)
    let settled = false
    const done = (value: T) => { if (!settled) { settled = true; resolve(value) } }
    const fail = (error: Error) => { if (!settled) { settled = true; reject(error) } }
    tx.onabort = () => fail(tx.error || new Error('Offline transaction aborted'))
    tx.onerror = () => fail(tx.error || new Error('Offline transaction failed'))
    run(store, done, fail)
    tx.oncomplete = () => db.close()
  })
}

export async function queueAttendance(entry: AttendanceOutboxEntry): Promise<void> {
  await transact<void>('readwrite', (store, done, fail) => {
    const request = store.put(entry)
    request.onsuccess = () => done()
    request.onerror = () => fail(request.error || new Error('Could not queue attendance'))
  })
}

export async function listQueuedAttendance(institutionId?: string): Promise<AttendanceOutboxEntry[]> {
  return transact<AttendanceOutboxEntry[]>('readonly', (store, done, fail) => {
    const request = store.getAll()
    request.onsuccess = () => done((request.result as AttendanceOutboxEntry[]).filter(row => !institutionId || row.institution_id === institutionId).sort((a,b) => a.created_at.localeCompare(b.created_at)))
    request.onerror = () => fail(request.error || new Error('Could not read offline attendance'))
  })
}

export async function getQueuedAttendance(id: string): Promise<AttendanceOutboxEntry | null> {
  return transact<AttendanceOutboxEntry | null>('readonly', (store, done, fail) => {
    const request = store.get(id)
    request.onsuccess = () => done((request.result as AttendanceOutboxEntry | undefined) ?? null)
    request.onerror = () => fail(request.error || new Error('Could not read queued attendance'))
  })
}

export async function removeQueuedAttendance(id: string): Promise<void> {
  await transact<void>('readwrite', (store, done, fail) => {
    const request = store.delete(id)
    request.onsuccess = () => done()
    request.onerror = () => fail(request.error || new Error('Could not remove synced attendance'))
  })
}

export async function updateQueuedAttendanceError(id: string, message: string): Promise<void> {
  await transact<void>('readwrite', (store, done, fail) => {
    const get = store.get(id)
    get.onsuccess = () => {
      const row = get.result as AttendanceOutboxEntry | undefined
      if (!row) return done()
      const put = store.put({ ...row, attempts: row.attempts + 1, last_error: message })
      put.onsuccess = () => done()
      put.onerror = () => fail(put.error || new Error('Could not update queued attendance'))
    }
    get.onerror = () => fail(get.error || new Error('Could not read queued attendance'))
  })
}

export function cacheAttendanceRoster(institutionId: string, rows: { id: string; student_code: string; full_name: string }[]): void {
  try { localStorage.setItem(`tt-roster:${institutionId}`, JSON.stringify({ saved_at: new Date().toISOString(), rows })) } catch { /* private mode or quota: offline queue still works for open session */ }
}

export function readAttendanceRoster(institutionId: string): { id: string; student_code: string; full_name: string }[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(`tt-roster:${institutionId}`) || 'null') as { rows?: unknown }
    return Array.isArray(parsed?.rows) ? parsed.rows as { id: string; student_code: string; full_name: string }[] : []
  } catch { return [] }
}

export function cacheAttendanceSnapshot(key: string, status: Record<string, string>, reasons: Record<string, string>): void {
  try { localStorage.setItem(`tt-attendance:${key}`, JSON.stringify({ saved_at: new Date().toISOString(), status, reasons })) } catch { /* storage quota/private mode */ }
}

export function readAttendanceSnapshot(key: string): { status: Record<string, string>; reasons: Record<string, string> } | null {
  try {
    const value = JSON.parse(localStorage.getItem(`tt-attendance:${key}`) || 'null') as { status?: unknown; reasons?: unknown } | null
    if (!value || !value.status || typeof value.status !== 'object' || !value.reasons || typeof value.reasons !== 'object') return null
    return { status: value.status as Record<string, string>, reasons: value.reasons as Record<string, string> }
  } catch { return null }
}

export function cacheAttendanceSession(institutionId: string, coachId: string, date: string, sessionKey: string): void {
  try { localStorage.setItem(`tt-session:${institutionId}:${coachId}:${date}`, sessionKey) } catch { /* storage quota/private mode */ }
}

export function readAttendanceSession(institutionId: string, coachId: string, date: string): string | null {
  try { return localStorage.getItem(`tt-session:${institutionId}:${coachId}:${date}`) } catch { return null }
}
