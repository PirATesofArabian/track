// Run: npx tsx scripts/sync-e2e.ts   (needs fake-indexeddb and tsx: npm i --no-save fake-indexeddb tsx)
// Drives the real src/lib/db.ts + sync.ts against a real server.py. Device B is played by a raw API client, and a "new phone" by wiping the local database.
import 'fake-indexeddb/auto'
import { spawn } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import assert from 'node:assert/strict'

const store = new Map<string, string>()
Object.assign(globalThis, { localStorage: { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) } })
Object.defineProperty(globalThis, 'navigator', { value: { platform: 'test', onLine: true }, configurable: true })

const PORT = 18900 + Math.floor(Math.random() * 500)
const base = `http://127.0.0.1:${PORT}`
const dir = mkdtempSync(join(tmpdir(), 'sync-e2e-'))
const srv = spawn('python3', ['server/server.py', 'serve'], { env: { ...process.env, PORT: String(PORT), HOST: '127.0.0.1', DB: join(dir, 'a.db'), ADMIN_PASSWORD: 'admin-pass-123', STATIC: dir }, stdio: 'ignore' })
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const post = async (path: string, body: object, token?: string) => {
  const r = await fetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) })
  return { status: r.status, body: (await r.json()) as Record<string, any> }
}

async function main() {
  for (let i = 0; i < 50; i++) { try { if ((await fetch(base + '/api/health')).ok) break } catch { /* not up yet */ } await sleep(100) }
  const reg = await post('/api/register', { username: 'tester', password: 'longenough1' })
  assert.equal(reg.status, 201)
  localStorage.setItem('tracker-account', JSON.stringify({ server: base, token: reg.body.token, username: 'tester', expiresAt: reg.body.expiresAt }))

  const { db, dataTables } = await import('../src/lib/db')
  const { syncNow } = await import('../src/lib/sync')
  const status = async () => { await syncNow(); const m = await import('../src/lib/sync'); return m }
  void status
  const raw = async (cursor = 0, changes: object[] = []) => (await post('/api/sync', { cursor, changes }, reg.body.token)).body as { changes: any[]; cursor: number; accepted: string[] }
  const ok = (m: string) => console.log('  ok  ' + m)

  // 1. local writes are stamped, and reach the server
  const exId = (await db.customExercises.add({ name: 'Cable fly', muscle: 'chest' } as any)) as number
  assert.ok(exId >= 1e9, 'custom exercise ids are unique across devices')
  const wid = (await db.workouts.add({ date: '2026-01-05', name: 'Push', startedAt: 1, exercises: [{ key: `custom:${exId}`, name: 'Cable fly', sets: [] }] } as any)) as number
  await db.bodyWeight.add({ date: '2026-01-05', kg: 80 })
  await db.water.put({ date: '2026-01-05', ml: 500 })
  await db.settings.put({ id: 1, kcal: 2400, p: 150, c: 280, f: 70, waterGoal: 3000, stepGoal: 8000 })
  const w = (await db.workouts.get(wid)) as any
  assert.ok(w.uid && w.updatedAt > 1e12)
  assert.equal(((await db.water.get('2026-01-05')) as any).uid, 'water:2026-01-05')
  await syncNow()
  let all = await raw(0)
  assert.equal(all.changes.length, 5)
  assert.ok(!('id' in all.changes.find((c) => c.tbl === 'bodyWeight').data), 'local auto-increment ids are not sent')
  assert.equal(all.changes.find((c) => c.tbl === 'customExercises').data.id, exId, 'custom exercise id is sent: references depend on it')
  ok('writes are stamped and pushed (5 records)')

  // 2. an edit on the phone, made later than the server copy, wins; one made earlier does not
  const bw = (await db.bodyWeight.toArray())[0] as any
  await db.bodyWeight.update(bw.id, { kg: 79.5 })
  await syncNow()
  all = await raw(0)
  assert.equal(all.changes.find((c) => c.uid === bw.uid).data.kg, 79.5)
  const stale = await raw(all.cursor, [{ uid: bw.uid, tbl: 'bodyWeight', data: { date: '2026-01-05', kg: 1 }, updatedAt: bw.updatedAt - 10, deleted: false }])
  assert.deepEqual(stale.accepted, [])
  ok('later edit wins, a stale edit is refused')

  // 3. device B edits and deletes; this device receives both
  await sleep(20)
  const fresh = Date.now()
  await raw(all.cursor, [
    { uid: bw.uid, tbl: 'bodyWeight', data: { date: '2026-01-05', kg: 78 }, updatedAt: fresh, deleted: false },
    { uid: 'b-1', tbl: 'foodLog', data: { date: '2026-01-06', meal: 'Lunch', name: 'Dal', qty: 1, serving: '1', kcal: 200, p: 10, c: 30, f: 5 }, updatedAt: fresh, deleted: false },
    { uid: w.uid, tbl: 'workouts', data: null, updatedAt: fresh, deleted: true },
  ])
  await syncNow()
  assert.equal(((await db.bodyWeight.toArray())[0] as any).kg, 78)
  assert.equal((await db.foodLog.count()), 1)
  assert.equal(await db.workouts.count(), 0, 'deletion from another device is applied')
  assert.equal(await db.syncTombstones.count(), 0, 'applying remote changes creates no tombstones')
  const echo = await raw(0)
  assert.equal(echo.changes.find((c) => c.uid === bw.uid).updatedAt, fresh, 'pulled rows keep the other device\'s edit time (not re-stamped)')
  ok('edits, new rows and deletes from another device arrive without being re-stamped')

  // 4. a delete here reaches the server and stays deleted
  await sleep(20)
  const food = (await db.foodLog.toArray())[0] as any
  await db.foodLog.delete(food.id)
  assert.equal(await db.syncTombstones.count(), 1)
  await syncNow()
  assert.equal((await raw(0)).changes.find((c) => c.uid === food.uid).deleted, true)
  assert.equal(await db.syncTombstones.count(), 0)
  await syncNow()
  assert.equal(await db.foodLog.count(), 0)
  ok('local delete is sent as a tombstone and does not come back')

  // 5. a brand-new phone signs in: it rebuilds everything, including custom-exercise references
  db.close(); await db.delete(); await db.open()
  localStorage.removeItem('tracker-sync')
  assert.equal(await db.workouts.count(), 0)
  await syncNow()
  assert.equal((await db.customExercises.get(exId))?.name, 'Cable fly', 'custom exercise restored under the same id')
  assert.equal(await db.water.count(), 1)
  assert.equal(((await db.settings.get(1)) as any).kcal, 2400)
  assert.equal(await db.bodyWeight.count(), 1)
  ok('a fresh device rebuilds everything from the server')

  // 6. restoring a backup is a new edit of every row, and undo/clear+bulkAdd does not duplicate or lose anything
  const before = await db.bodyWeight.toArray()
  await db.transaction('rw', dataTables(), async () => { await db.bodyWeight.clear(); await db.bodyWeight.bulkAdd(before.map(({ id: _i, ...r }: any) => r)) })
  await syncNow()
  const live = (await raw(0)).changes.filter((c) => c.tbl === 'bodyWeight' && !c.deleted)
  assert.equal(live.length, 1, 'clear + re-add leaves exactly one live row')
  await syncNow()
  assert.equal(await db.bodyWeight.count(), 1)
  ok('clear + bulkAdd (import / undo) converges to one row')

  // 7. an old install upgrades from schema 4: existing rows get stamped and small custom ids are made unique
  db.close(); await db.delete()
  const Dexie = (await import('dexie')).default
  const old = new Dexie('gym-food-tracker')
  old.version(4).stores({ workouts: '++id, date', foodLog: '++id, date', customFoods: '++id, name', routines: '++id, name', bodyWeight: '++id, date', water: 'date', settings: 'id', customExercises: '++id', measurements: '++id, date', activity: '++id, date', profile: 'id', goals: '++id, kind', events: '++id, start', pain: '++id, start', memories: '++id', reports: 'weekStart', photos: '++id, date', kv: 'key', supplements: '++id, date', sleep: 'date' })
  await old.open()
  await old.table('customExercises').add({ name: 'Old move' })
  await old.table('workouts').add({ date: '2025-12-01', name: 'Legs', startedAt: 1, exercises: [{ key: 'custom:1', name: 'Old move', sets: [] }] })
  await old.table('water').put({ date: '2025-12-01', ml: 900 })
  old.close()
  await db.open()
  const up = (await db.customExercises.toArray())[0] as any
  assert.ok(up.id >= 1e9 && up.uid && up.updatedAt === 1)
  assert.equal(((await db.workouts.toArray())[0] as any).exercises[0].key, `custom:${up.id}`, 'references follow the new id')
  assert.equal(((await db.water.get('2025-12-01')) as any).uid, 'water:2025-12-01')
  ok('upgrade from schema 4 stamps rows and remaps custom ids')

  // 8. first sync of that upgraded device merges with what the server already has, without losing either side
  localStorage.removeItem('tracker-sync')
  await syncNow()
  assert.equal(await db.water.count(), 2, 'old local row and server row both kept')
  assert.equal(await db.customExercises.count(), 2)
  ok('first sync merges local and server data')

  // 9. a wrong session shows an error and signs out instead of failing silently
  localStorage.setItem('tracker-account', JSON.stringify({ server: base, token: 'bad', username: 'tester', expiresAt: reg.body.expiresAt }))
  await syncNow()
  const { getAccount } = await import('../src/lib/account')
  assert.equal(getAccount(), null)
  ok('an ended session is dropped cleanly')
  console.log('\nALL PASSED')
}

main().then(() => { srv.kill(); process.exit(0) }, (e) => { console.error('\nFAILED', e); srv.kill(); process.exit(1) })
