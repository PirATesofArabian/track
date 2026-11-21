// Sync with your Pi server. Latest edit wins, per record.
// Every row has a `uid` and an `updatedAt` (stamped by the hooks in db.ts). We push rows edited since the last sync, plus deletions
// (tombstones), then pull whatever the server holds that is newer. The server keeps the higher updatedAt; ties keep what it has.
import { useSyncExternalStore } from 'react'
import type { IndexableType } from 'dexie'
import { ApiError, apiPost, downloadPhoto, forgetAccount, getAccount, uploadPhoto, type Account } from './account'
import { KEEP_ID, NATURAL_KEY, SYNC_TABLES, bigId, db, syncSignal, type Tombstone } from './db'

type Change = { uid: string; tbl: string; data: Record<string, unknown> | null; updatedAt: number; deleted: boolean }
type Reply = { cursor: number; changes: Change[]; more: boolean }
type State = { user: string; server: string; cursor: number; since: number; last: number }
export type Status = { running: boolean; error: string; last: number; pushed: number; pulled: number }

const KEY = 'tracker-sync'
const BATCH = 500, BATCH_BYTES = 4 * 1024 * 1024

let status: Status = { running: false, error: '', last: 0, pushed: 0, pulled: 0 }
const subs = new Set<() => void>()
const setStatus = (p: Partial<Status>) => { status = { ...status, ...p }; subs.forEach((f) => f()) }
export const useSyncStatus = () => useSyncExternalStore((f) => { subs.add(f); return () => { subs.delete(f) } }, () => status)

const load = (a: Account): State => {
  try {
    const s = JSON.parse(localStorage.getItem(KEY) ?? 'null') as State | null
    if (s && s.user === a.username && s.server === a.server) return s // another account or server starts over: a full merge
  } catch { /* fall through */ }
  return { user: a.username, server: a.server, cursor: 0, since: 0, last: 0 }
}
const save = (s: State) => localStorage.setItem(KEY, JSON.stringify(s))
export const lastSynced = (): number => { const a = getAccount(); return a ? load(a).last : 0 }

const dataOf = (name: string, r: Record<string, unknown>) => {
  const { uid: _u, updatedAt: _t, ...data } = r
  if (!NATURAL_KEY[name] && !KEEP_ID.has(name)) delete data.id // local auto-increment ids mean nothing on another device
  if (name === 'photos') delete data.blob // the image travels as a file (uploadPhoto), not inside the record
  return data
}

async function collect(since: number): Promise<Change[]> {
  const out: Change[] = []
  const live = new Map<string, number>()
  for (const name of SYNC_TABLES) {
    const rows = (await db.table(name).where('updatedAt').aboveOrEqual(since).toArray()) as Record<string, unknown>[]
    for (const r of rows) {
      live.set(r.uid as string, r.updatedAt as number)
      out.push({ uid: r.uid as string, tbl: name, data: dataOf(name, r), updatedAt: r.updatedAt as number, deleted: false })
    }
  }
  for (const t of await db.syncTombstones.toArray()) {
    const l = live.get(t.uid)
    if (l !== undefined && l >= t.updatedAt) { await db.syncTombstones.delete(t.uid); continue } // deleted, then added again
    out.push({ uid: t.uid, tbl: t.tbl, data: null, updatedAt: t.updatedAt, deleted: true })
  }
  return out
}

/** Write what the server sent. Never counts as a local edit, and never overwrites a newer local row. */
async function apply(changes: Change[], a: Account) {
  const known = changes.filter((c) => (SYNC_TABLES as readonly string[]).includes(c.tbl))
  if (!known.length) return
  // Photo images are fetched first (a transaction cannot wait on the network). A photo whose image the server no longer has is skipped.
  const images = new Map<string, Blob>()
  for (const c of known) {
    if (c.tbl !== 'photos' || c.deleted) continue
    if ((await db.photos.where('uid').equals(c.uid).first())?.blob) continue
    const b = await downloadPhoto(a, c.uid)
    if (b) images.set(c.uid, b)
  }
  await db.transaction('rw', [...SYNC_TABLES.map((n) => db.table(n)), db.syncTombstones], async (tx) => {
    ;(tx as unknown as { remote: boolean }).remote = true
    for (const c of known) {
      const t = db.table(c.tbl), kp = NATURAL_KEY[c.tbl]
      const rest = c.uid.slice(c.tbl.length + 1)
      const local = (kp ? await t.get(kp === 'id' ? Number(rest) : rest) : await t.where('uid').equals(c.uid).first()) as Record<string, unknown> | undefined
      if (local && ((local.updatedAt as number) ?? 0) >= c.updatedAt) continue
      const tomb = await db.syncTombstones.get(c.uid)
      if (tomb && tomb.updatedAt >= c.updatedAt) continue // deleted here, more recently than the server's copy
      if (c.deleted) { if (local) await t.delete((kp ? local[kp] : local.id) as IndexableType); continue }
      const row: Record<string, unknown> = { ...c.data, uid: c.uid, updatedAt: c.updatedAt }
      if (c.tbl === 'photos') {
        const blob = images.get(c.uid) ?? local?.blob
        if (!blob) continue
        row.blob = blob
      }
      if (!kp && !KEEP_ID.has(c.tbl) && local) row.id = local.id
      if (KEEP_ID.has(c.tbl)) { // a custom food or exercise whose id is already used here by a different record (made on an old device): keep both, give this one a new id
        const same = (await t.get(row.id as IndexableType)) as Record<string, unknown> | undefined
        if (same && same.uid !== c.uid) row.id = bigId()
      }
      await t.put(row)
    }
  })
}

function batches(all: Change[]): Change[][] {
  const out: Change[][] = []
  let cur: Change[] = [], bytes = 0
  for (const c of all) {
    const n = JSON.stringify(c).length
    if (cur.length && (cur.length >= BATCH || bytes + n > BATCH_BYTES)) { out.push(cur); cur = []; bytes = 0 }
    cur.push(c); bytes += n
  }
  if (cur.length) out.push(cur)
  return out.length ? out : [[]]
}

let inFlight: Promise<void> | null = null
export function syncNow(): Promise<void> {
  if (inFlight) return inFlight
  inFlight = run().finally(() => { inFlight = null })
  return inFlight
}

async function run() {
  const a = getAccount()
  if (!a) return
  setStatus({ running: true, error: '', pushed: 0, pulled: 0 })
  const state = load(a)
  const started = Date.now()
  let pushed = 0, pulled = 0
  try {
    let mine = await collect(state.since), refused = ''
    for (const c of [...mine]) { // a photo's image goes up before its record, so another device never sees a record without an image
      if (c.tbl !== 'photos' || c.deleted) continue
      const row = await db.photos.where('uid').equals(c.uid).first()
      try { if (row?.blob) await uploadPhoto(a, c.uid, row.blob) } catch (e) {
        if (!(e instanceof ApiError) || e.status !== 413) throw e // offline or signed out: the whole sync retries
        refused = e.message; mine = mine.filter((x) => x !== c) // storage full: leave this photo out, the rest still syncs
      }
    }
    for (const batch of batches(mine)) {
      let r = (await apiPost(a, '/api/sync', { cursor: state.cursor, changes: batch })) as unknown as Reply
      for (;;) {
        await apply(r.changes, a); pulled += r.changes.length; state.cursor = r.cursor
        if (!r.more) break
        r = (await apiPost(a, '/api/sync', { cursor: state.cursor, changes: [] })) as unknown as Reply
      }
      pushed += batch.length
    }
    // Forget exactly the deletions that were delivered; one made while syncing stays for the next round.
    const sent = new Map(mine.filter((c) => c.deleted).map((c) => [c.uid, c.updatedAt]))
    const done = (await db.syncTombstones.toArray()).filter((t: Tombstone) => sent.get(t.uid) === t.updatedAt).map((t) => t.uid)
    await db.syncTombstones.bulkDelete(done)
    state.since = started; state.last = Date.now()
    save(state)
    setStatus({ running: false, last: state.last, pushed, pulled, error: refused ? `A photo was not sent: ${refused}` : '' })
  } catch (e) {
    if (e instanceof ApiError && e.status === 401) { forgetAccount(); setStatus({ running: false, error: 'Your session ended. Sign in again.' }) }
    else setStatus({ running: false, error: (e as Error).message })
  }
}

// ── automatic sync: a couple of seconds after an edit, every few seconds while the app is open, and when it comes back to the front or online ──
const POLL_MS = 5000, EDIT_MS = 2000, RETRY_MS = 30000
let timer: ReturnType<typeof setTimeout> | undefined
let failedAt = 0
const soon = (ms: number) => {
  if (!getAccount() || (typeof navigator !== 'undefined' && navigator.onLine === false)) return
  clearTimeout(timer)
  timer = setTimeout(() => { void syncNow().then(() => { failedAt = status.error ? Date.now() : 0 }) }, ms)
}
let started = false
export function startAutoSync() {
  if (started) return
  started = true
  syncSignal.fn = () => soon(EDIT_MS)
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') soon(300) })
  window.addEventListener('online', () => soon(300))
  setInterval(() => {
    if (document.visibilityState !== 'visible' || status.running || Date.now() - failedAt < RETRY_MS) return // after a failure, wait before trying again
    soon(0)
  }, POLL_MS)
  soon(1000)
}
