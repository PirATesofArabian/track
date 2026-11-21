// Run: npx tsx scripts/weightwhy-check.ts  — "Why did my weight change?" and the weekly weigh-in message.
import assert from 'node:assert/strict'
import { weightWhy, recentIntervals, dailyWeights } from '../src/lib/weightwhy'
import { buildExerciseIndex } from '../src/lib/perf'
import { DEFAULT_PROFILE } from '../src/lib/db'
import { shiftDate } from '../src/lib/util'

const idx = buildExerciseIndex([]), T = '2026-03-10'
const food = (date: string, kcal: number, c = 200) => ({ date, meal: 'Lunch' as const, name: 'x', qty: 1, serving: '1', kcal, p: 150, c, f: 60 })
const logs: any[] = []
for (let i = 0; i <= 30; i++) logs.push(food(shiftDate(T, -i), 2200))
const base: any = { logs, workouts: [], activity: [], water: [], weights: [], profile: DEFAULT_PROFILE }
let failed = 0
const test = (n: string, f: () => void) => { try { f(); console.log('  ok  ' + n) } catch (e) { failed++; console.log('  FAIL ' + n + '\n       ' + String((e as Error).message).split('\n').slice(0, 3).join(' | ')) } }

test('a 0.75 kg rise in 2 days is not called fat, and calories explain almost none of it', () => {
  const d = { ...base, weights: [{ date: shiftDate(T, -2), kg: 81.1 }, { date: T, kg: 81.85 }] }
  const w = weightWhy(shiftDate(T, -2), T, d, idx, 2200)!
  assert.equal(w.change, 0.8); assert.equal(w.fatKg, 0); assert.match(w.headline, /Mostly not fat/)
})
test('a month of 500 kcal under maintenance explains a loss of about 2 kg', () => {
  const d = { ...base, weights: [{ date: shiftDate(T, -28), kg: 84 }, { date: T, kg: 82 }] }
  const w = weightWhy(shiftDate(T, -28), T, d, idx, 2700)!
  assert.equal(w.fatKg, -1.8); assert.match(w.headline, /Calories explain it/)
})
test('without logged food the calorie part is not guessed', () => {
  const d = { ...base, logs: [], weights: [{ date: shiftDate(T, -3), kg: 82 }, { date: T, kg: 81 }] }
  const w = weightWhy(shiftDate(T, -3), T, d, idx, 2200)!
  assert.equal(w.fatKg, null); assert.match(w.headline, /Not enough food logged/); assert.ok(w.reasons[0].includes('0 of 3'))
})
test('a flat result says nothing to explain; a missing weigh-in gives null', () => {
  const d = { ...base, weights: [{ date: shiftDate(T, -3), kg: 82 }, { date: T, kg: 82.1 }] }
  assert.match(weightWhy(shiftDate(T, -3), T, d, idx, 2200)!.headline, /flat/i)
  assert.equal(weightWhy(shiftDate(T, -5), T, d, idx, 2200), null)
})
test('higher carbs than usual and hard training are named as reasons', () => {
  const lg = logs.map((e) => (e.date >= shiftDate(T, -2) ? { ...e, c: 400 } : e))
  const S = { weightKg: 50, reps: 10, rir: 2, setType: 'working', done: true, durationSec: null, distanceM: null }
  const wk = (date: string, id: number) => ({ id, date, name: 'x', startedAt: 0, finishedAt: 3_600_000, exercises: [{ key: 'k', name: 'k', sets: [S, S, S, S] }] })
  const d = { ...base, logs: lg, workouts: [wk(shiftDate(T, -2), 1), wk(shiftDate(T, -1), 2), wk(T, 3)].slice(0, 3), weights: [{ date: shiftDate(T, -3), kg: 81 }, { date: shiftDate(T, 1), kg: 81.8 }] }
  const w = weightWhy(shiftDate(T, -3), shiftDate(T, 1), d, idx, 2200)!
  assert.ok(w.reasons.some((r) => r.startsWith('Carbs were higher')), w.reasons.join(' / ')); assert.ok(w.reasons.some((r) => r.startsWith('Heavy training')), w.reasons.join(' / '))
})
test('several readings on one day count once; intervals skip gaps over 10 days', () => {
  const ws = [{ id: 1, date: '2026-03-01', kg: 82 }, { id: 2, date: '2026-03-01', kg: 81.5 }, { date: '2026-03-02', kg: 81 }, { date: '2026-03-20', kg: 80 }] as any
  assert.deepEqual(dailyWeights(ws).map((x) => x.kg), [81.5, 81, 80])
  assert.deepEqual(recentIntervals(ws), [{ from: '2026-03-01', to: '2026-03-02' }])
})
test('the weekly message says why: this week had enough, last week did not', async () => {
  const { buildWeeklyReport } = await import('../src/lib/weekly')
  const mon = '2026-03-09'
  const r = buildWeeklyReport({
    weekStart: mon, idx: buildExerciseIndex([]), workouts: [], logs: [], measurements: [], goals: [], routines: [], restDays: new Set(), planned: null, fatLoss: true,
    weights: [0, 1, 2, 3, 4, 5, 6].map((i) => ({ date: shiftDate(mon, i), kg: 81 })) as any, targets: { kcal: 2200, proteinG: 170, maintenance: null },
  } as any)
  assert.equal(r.pillars.body.label, 'No week to compare yet'); assert.ok(r.pillars.body.detail.includes('7 weigh-ins') && r.pillars.body.detail.includes('Last week had 0'), r.pillars.body.detail)
})
if (failed) { console.log(`\n${failed} failed`); process.exit(1) } else console.log('\nall passed')
