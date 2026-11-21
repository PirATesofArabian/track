// Run: npx tsx scripts/daysummary-check.ts  — the Day tab: one day against other days, and what tomorrow should look like.
import assert from 'node:assert/strict'
import { compareDay, tomorrowPlan, stalled } from '../src/lib/daysummary'
import { buildExerciseIndex } from '../src/lib/perf'
import { DEFAULT_PROFILE, DEFAULT_SETTINGS } from '../src/lib/db'
import { shiftDate } from '../src/lib/util'

const idx = buildExerciseIndex([]), TODAY = '2026-03-10', s = { ...DEFAULT_SETTINGS, kcal: 2300, p: 170, c: 268, f: 65 }
const food = (date: string, kcal: number, p: number, f: number) => ({ date, meal: 'Lunch' as const, name: 'x', qty: 1, serving: '1', kcal, p, c: 100, f })
const S = (w: number, r: number, rir: number | null = 2) => ({ weightKg: w, reps: r, rir, setType: 'working' as const, done: true, durationSec: null, distanceM: null })
const wk = (date: string, id: number, row: any[]) => ({ id, date, name: 'Pull', dayName: 'Pull B', startedAt: 1, finishedAt: 3_600_001, exercises: [{ key: 'chest-supported-row', name: 'Chest-supported row', sets: row }] })
const logs: any[] = [food(TODAY, 2500, 150, 80)]
for (let i = 1; i <= 10; i++) logs.push(food(shiftDate(TODAY, -i), 2200, 165, 60))
const workouts: any[] = [wk(shiftDate(TODAY, -14), 1, [S(45, 12), S(50, 12), S(55, 12)]), wk(shiftDate(TODAY, -7), 2, [S(50, 12), S(55, 12), S(60, 12)]), wk(TODAY, 3, [S(50, 12), S(55, 12), S(60, 12)])]
const d: any = { logs, workouts, activity: [{ date: TODAY, kind: 'steps', steps: 5000, kcal: 0, kcalSource: 'estimated' }], water: [{ date: TODAY, ml: 2000 }], weights: [{ date: '2026-03-01', kg: 82.5 }], profile: DEFAULT_PROFILE }
let failed = 0
const test = (n: string, f: () => void) => { try { f(); console.log('  ok  ' + n) } catch (e) { failed++; console.log('  FAIL ' + n + '\n       ' + String((e as Error).message).split('\n').slice(0, 3).join(' | ')) } }
const cmp = compareDay(TODAY, d, idx, s), row = (id: string) => cmp.rows.find((r) => r.id === id)!

test('calories: compared with your usual 2,200 and ranked among the last days', () => {
  assert.equal(row('kcal').value, 2500); assert.equal(Math.round(row('kcal').usual!), 2200); assert.equal(Math.round(row('kcal').diff!), 300)
  assert.deepEqual(row('kcal').place, { n: 1, of: 11 })
})
test('fat over its limit is flagged, protein under target is flagged', () => { assert.equal(row('f').tone, 'off'); assert.equal(row('p').tone, 'off') })
test('water and steps are measured against the goals; things not logged show nothing', () => {
  assert.equal(row('water').tone, 'off'); assert.equal(row('steps').value, 5000); assert.equal(row('fib').value, null)
})
test('training: sets, volume and minutes are counted from the finished workout only', () => {
  assert.equal(row('sets').value, 3); assert.equal(row('volume').value, (50 + 55 + 60) * 12 * 2) // per-hand dumbbells count both hands; assert.equal(row('minutes').value, 60)
})
test('a workout left open overnight is not counted as 15 hours or thousands of calories', async () => {
  const { workoutMinutes } = await import('../src/lib/derived')
  const w: any = { date: TODAY, name: 'x', startedAt: 0, finishedAt: 931 * 60000, exercises: [{ key: 'k', name: 'k', sets: [S(50, 12), S(50, 12), S(50, 12)] }] }
  assert.equal(workoutMinutes(w), 12); assert.equal(workoutMinutes({ ...w, finishedAt: 62 * 60000 }), 62)
})
test('a rest day is not a missed session in adherence', async () => {
  const { adherence } = await import('../src/lib/science'), { restDatesOf } = await import('../src/lib/derived')
  const dow = new Date('2026-03-08T12:00:00').getDay() // a day inside the last 4 weeks
  const r: any = [{ days: [{ name: 'A', weekdays: [dow], exercises: [] }] }]
  const base = adherence(r, [], TODAY)!, rested = adherence(r, [], TODAY, 4, new Set(['2026-03-08']))!
  assert.equal(rested.planned, base.planned - 1)
  assert.equal(adherence(r, [wk('2026-03-08', 9, [S(50, 12)]) as any], TODAY, 4, new Set(['2026-03-08']))!.completed, 1, 'a day you trained still counts even if marked rest')
  assert.deepEqual([...restDatesOf([{ key: 'rest:2026-03-08', value: true }, { key: 'rest:2026-03-09', value: false }, { key: 'x', value: true }])], ['2026-03-08'])
})
test('an empty day has no rows with numbers and does not crash', () => {
  const e = compareDay('2026-03-20', d, idx, s); assert.ok(e.rows.every((r) => r.value === null))
})

const plan = { id: 1, name: 'Plan', days: [{ name: 'Pull B', weekdays: [], exercises: [{ key: 'cable-crunch', sets: 2, repMin: 8, repMax: 15, rir: '2–3', rest: 60 }] }, { name: 'Push B', weekdays: [], exercises: [{ key: 'chest-supported-row', sets: 3, repMin: 8, repMax: 12, rir: '1–2', rest: 90 }, { key: 'cable-crunch', sets: 2, repMin: 8, repMax: 15, rir: '2–3', rest: 60 }] }] }
const t = tomorrowPlan({ date: TODAY, d, idx, s, routines: [plan as any] })
test('tomorrow: same targets, notes for fat over, protein short, water and steps low; never "eat less to make up"', () => {
  assert.equal(t.date, '2026-03-11'); assert.equal(t.sessionName, 'Push B'); assert.equal(t.after, 'Pull B'); assert.equal(t.food.f, 65)
  const txt = t.food.notes.join(' | '); assert.match(txt, /Fat was 15 g over/); assert.match(txt, /Protein was 20 g short/); assert.match(txt, /Do not skip meals/); assert.match(txt, /Water/); assert.match(txt, /Steps/)
})
test('tomorrow lifts: row goes up by your usual 5 kg; a lift with no history says to start light; stalled lifts get an extra set note', () => {
  const row0 = t.lifts[0]; assert.equal(row0.kind, 'add_load'); assert.match(row0.next, /55 · 60 · 65 kg/)
  assert.match(t.lifts[1].next, /No history yet/)
})
test('stalled: three sessions with no gain over the first of them', () => {
  const sess = (e: number) => ({ bestE1rm: e }) as any
  assert.equal(stalled([sess(100), sess(100), sess(100.5)]), true); assert.equal(stalled([sess(100), sess(102), sess(104)]), false); assert.equal(stalled([sess(100), sess(100)]), false)
})
console.log(failed ? `\n${failed} FAILED` : '\nALL PASSED'); process.exit(failed ? 1 : 0)
