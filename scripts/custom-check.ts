// Run: npx tsx scripts/custom-check.ts  — do custom foods and exercises survive sync, a wiped database, and two devices with small ids?
import 'fake-indexeddb/auto'
import { spawn } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import assert from 'node:assert/strict'

const store = new Map<string, string>()
Object.assign(globalThis, { localStorage: { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) } })
Object.defineProperty(globalThis, 'navigator', { value: { platform: 'test', onLine: true }, configurable: true })
const PORT = 19400 + Math.floor(Math.random() * 400), base = `http://127.0.0.1:${PORT}`, dir = mkdtempSync(join(tmpdir(), 'custom-'))
const srv = spawn('python3', ['server/server.py', 'serve'], { env: { ...process.env, PORT: String(PORT), HOST: '127.0.0.1', DB: join(dir, 'a.db'), ADMIN_PASSWORD: 'admin-pass-123', STATIC: dir }, stdio: 'ignore' })
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const post = async (path: string, body: object, token?: string) => { const r = await fetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) }); return { status: r.status, body: (await r.json()) as any } }
const ok = (m: string) => console.log('  ok  ' + m)
let failed = 0
const test = async (name: string, f: () => Promise<void>) => { try { await f(); ok(name) } catch (e) { failed++; console.log('  FAIL ' + name + '\n       ' + String((e as Error).message).split('\n').slice(0, 3).join(' | ')) } }

async function main() {
  for (let i = 0; i < 50; i++) { try { if ((await fetch(base + '/api/health')).ok) break } catch { /* not up */ } await sleep(100) }
  const reg = await post('/api/register', { username: 'tester', password: 'longenough1' })
  const acct = { server: base, token: reg.body.token, username: 'tester', expiresAt: reg.body.expiresAt }
  localStorage.setItem('tracker-account', JSON.stringify(acct))
  const { db } = await import('../src/lib/db')
  const { syncNow } = await import('../src/lib/sync')
  const raw = async (cursor = 0, changes: object[] = []) => (await post('/api/sync', { cursor, changes }, reg.body.token)).body as { changes: any[]; cursor: number }
  const names = async () => ({ f: (await db.customFoods.toArray()).map((x: any) => x.name).sort(), e: (await db.customExercises.toArray()).map((x: any) => x.name).sort() })

  const foodId = (await db.customFoods.add({ name: 'Oats', serving: '1', kcal: 300, p: 10, c: 50, f: 5 } as any)) as number
  const exId = (await db.customExercises.add({ name: 'Belt squat' } as any)) as number
  await db.foodLog.add({ date: '2026-01-01', meal: 'Breakfast', name: 'Oats', qty: 1, serving: '1', foodId: `custom-${foodId}`, kcal: 300, p: 10, c: 50, f: 5 })
  await syncNow()

  await test('the local database is emptied but this device\'s sync state survives: everything comes back', async () => {
    db.close(); await db.delete(); await db.open() // e.g. the browser clears IndexedDB but keeps localStorage
    assert.equal((await db.customFoods.count()), 0)
    await syncNow()
    assert.deepEqual(await names(), { f: ['Oats'], e: ['Belt squat'] })
    assert.equal(await db.foodLog.count(), 1)
  })

  await test('restoring a backup gives custom foods and exercises unique ids and keeps every reference', async () => {
    const { uniqueCustomIds } = await import('../src/lib/db')
    const backup: any = {
      customFoods: [{ id: 1, name: 'Rice', serving: '1', kcal: 130, p: 3, c: 28, f: 0 }, { id: 2, name: 'Dal', serving: '1', kcal: 150, p: 9, c: 20, f: 3 }],
      customExercises: [{ id: 1, name: 'Mine' }],
      foodLog: [{ date: '2026-01-02', meal: 'Lunch', name: 'Rice', qty: 1, serving: '1', foodId: 'custom-1', kcal: 130, p: 3, c: 28, f: 0 }, { date: '2026-01-02', meal: 'Lunch', name: 'Dal', qty: 1, serving: '1', foodId: 'custom-2', kcal: 150, p: 9, c: 20, f: 3 }],
      workouts: [{ date: '2026-01-02', name: 'Legs', startedAt: 1, exercises: [{ key: 'custom:1', name: 'Mine', sets: [] }] }],
    }
    assert.equal(uniqueCustomIds(backup), 3)
    assert.ok(backup.customFoods.every((x: any) => x.id >= 1e9) && backup.customExercises[0].id >= 1e9)
    assert.equal(backup.foodLog[0].foodId, `custom-${backup.customFoods[0].id}`)
    assert.equal(backup.foodLog[1].foodId, `custom-${backup.customFoods[1].id}`)
    assert.equal(backup.workouts[0].exercises[0].key, `custom:${backup.customExercises[0].id}`)
    await db.customFoods.bulkAdd(backup.customFoods); await db.customExercises.bulkAdd(backup.customExercises)
    await syncNow(); await syncNow()
    const live = (await raw(0)).changes.filter((c) => !c.deleted && c.tbl === 'customFoods').map((c) => c.data.name)
    assert.ok(live.includes('Rice') && live.includes('Dal'), JSON.stringify(live))
  })

  await test('a pulled custom food that has the same id as a different local one is kept next to it, not over it', async () => {
    await db.syncTombstones.clear(); localStorage.removeItem('tracker-sync')
    await post('/api/sync', { cursor: 0, changes: [{ uid: 'clash', tbl: 'customFoods', data: { id: 7, name: 'Other Oats', serving: '1', kcal: 100, p: 1, c: 1, f: 1 }, updatedAt: Date.now() - 5000, deleted: false }] }, reg.body.token)
    await db.customFoods.add({ id: 7, name: 'Rice 2', serving: '1', kcal: 130, p: 3, c: 28, f: 0 } as any)
    await syncNow(); await syncNow()
    const mine = (await db.customFoods.get(7)) as any
    assert.equal(mine.name, 'Rice 2', 'the local food is kept under its id')
    const rows = (await db.customFoods.toArray()) as any[]
    assert.ok(rows.some((x) => x.name === 'Other Oats') && rows.some((x) => x.name === 'Rice 2'), 'both foods are kept')
    assert.equal(new Set(rows.map((x) => x.id)).size, rows.length, 'with different ids')
  })

  await test('editing a custom food (with fibre) reaches the server as the same record, and a second device gets the edit, not a copy', async () => {
    const before = (await raw(0)).changes.filter((c) => c.tbl === 'customFoods' && !c.deleted).length
    const row = (await db.customFoods.toArray())[0] as any
    await new Promise((r) => setTimeout(r, 20))
    await db.customFoods.update(row.id, { name: 'Renamed', fib: 9, kcal: 111 })
    await syncNow()
    const all = (await raw(0)).changes.filter((c) => c.tbl === 'customFoods' && !c.deleted)
    assert.equal(all.length, before, 'no copy was made')
    const sent = all.find((c) => c.uid === row.uid)
    assert.deepEqual([sent.data.name, sent.data.fib, sent.data.kcal], ['Renamed', 9, 111])
    // another device that already had the old version pulls the edit
    db.close(); await db.delete(); await db.open(); localStorage.removeItem('tracker-sync'); await syncNow()
    const back = (await db.customFoods.toArray()).find((x: any) => x.uid === row.uid) as any
    assert.deepEqual([back.name, back.fib], ['Renamed', 9])
    assert.equal((await db.customFoods.count()), before)
  })

  await test('deleting a custom food reaches the server, keeps logged meals, and stays gone on a fresh device', async () => {
    const { deleteWithUndo } = await import('../src/lib/undo')
    const row = (await db.customFoods.where('name').equals('Other Oats').first()) as any
    const logsBefore = await db.foodLog.count()
    await new Promise((r) => setTimeout(r, 20))
    await deleteWithUndo(db.customFoods, row.id, 'Deleted')
    await syncNow()
    const gone = (await raw(0)).changes.find((c) => c.uid === row.uid)
    assert.equal(gone.deleted, true, 'server has a tombstone')
    assert.equal(await db.foodLog.count(), logsBefore, 'logged meals untouched')
    db.close(); await db.delete(); await db.open(); localStorage.removeItem('tracker-sync'); await syncNow()
    assert.ok(!(await db.customFoods.toArray()).some((x: any) => x.uid === row.uid), 'does not come back')
  })

  await test('Undo after a delete puts the same food back and the server has it live again', async () => {
    const { deleteWithUndo } = await import('../src/lib/undo')
    const row = (await db.customFoods.where('name').equals('Dal').first()) as any
    await new Promise((r) => setTimeout(r, 20))
    await deleteWithUndo(db.customFoods, row.id, 'Deleted Dal')
    await syncNow()
    assert.equal((await raw(0)).changes.find((c) => c.uid === row.uid).deleted, true)
    await new Promise((r) => setTimeout(r, 20))
    await db.customFoods.put(row) // what the Undo button does
    await syncNow()
    assert.equal((await raw(0)).changes.find((c) => c.uid === row.uid).deleted, false, 'live again on the server')
    assert.equal(((await db.customFoods.get(row.id)) as any).name, 'Dal')
  })

  await test('a rest day syncs to the server and a second device, and undoing it removes it there too', async () => {
    const { setRestDay, restDatesOf } = await import('../src/lib/derived')
    await setRestDay('2026-02-02', true); await syncNow()
    assert.ok((await raw(0)).changes.some((c) => c.tbl === 'kv' && c.data?.key === 'rest:2026-02-02' && !c.deleted), 'on the server')
    db.close(); await db.delete(); await db.open(); localStorage.removeItem('tracker-sync'); await syncNow()
    assert.ok(restDatesOf(await db.kv.toArray()).has('2026-02-02'), 'a fresh device gets it')
    await setRestDay('2026-02-02', false); await syncNow()
    db.close(); await db.delete(); await db.open(); localStorage.removeItem('tracker-sync'); await syncNow()
    assert.ok(!restDatesOf(await db.kv.toArray()).has('2026-02-02'), 'undo reaches a fresh device too')
  })

  await test('everything on the server is still there afterwards', async () => {
    const live = (await raw(0)).changes.filter((c) => !c.deleted && (c.tbl === 'customFoods' || c.tbl === 'customExercises')).map((c) => c.data.name).sort()
    assert.ok(live.includes('Rice') && live.includes('Dal') && live.includes('Renamed') && !live.includes('Other Oats') && live.includes('Oats') && live.includes('Belt squat') && live.includes('Mine'), JSON.stringify(live))
  })
  console.log(failed ? `\n${failed} FAILED` : '\nALL PASSED')
}
main().then(() => { srv.kill(); process.exit(failed ? 1 : 0) }, (e) => { console.error('\nERROR', e); srv.kill(); process.exit(1) })
