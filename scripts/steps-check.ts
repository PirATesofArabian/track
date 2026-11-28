// Run: npx tsx scripts/steps-check.ts — walks and runs count as steps; a whole-day total is never added to twice.
import assert from 'node:assert/strict'
import { cardioSteps, daySteps } from '../src/lib/burn'

let failed = 0
const test = (n: string, f: () => void) => { try { f(); console.log('  ok  ' + n) } catch (e) { failed++; console.log('  FAIL ' + n + '\n       ' + String((e as Error).message).split('\n').slice(0, 3).join(' | ')) } }
const run = { kind: 'cardio' as const, activity: 'run_outdoor', minutes: 65, distanceKm: 8.7 }
const H = 175 // stride = 175 * 0.414 / 100 = 0.7245 m

test('your run: 8.7 km at 175 cm = 8700 / 0.7245 = 12008 steps', () => assert.equal(cardioSteps(run, H), 12008))
test('no height known: default 0.7 m stride = 12429 steps', () => assert.equal(cardioSteps(run), 12429))
test('steps typed from a watch win over the estimate', () => assert.equal(cardioSteps({ ...run, steps: 10500 }, H), 10500))
test('treadmill run with speed and minutes: 9 km/h x 30 min = 4.5 km = 6211 steps', () => assert.equal(cardioSteps({ kind: 'cardio', activity: 'treadmill_run', minutes: 30, speedKmh: 9 }, H), 6211))
test('cycling is not steps', () => assert.equal(cardioSteps({ kind: 'cardio', activity: 'cycle_outdoor', minutes: 60, distanceKm: 20 }, H), 0))
test('a run with no distance or speed gives 0, not a guess', () => assert.equal(cardioSteps({ kind: 'cardio', activity: 'run_outdoor', minutes: 30 }, H), 0))
test('run only: the day shows 12008 steps', () => assert.equal(daySteps([run], H).total, 12008))
test('day total from a watch (14000) already contains the run: not added again', () => {
  const r = daySteps([{ kind: 'steps', steps: 14000 }, run], H)
  assert.equal(r.total, 14000); assert.equal(r.cardioIncluded, true)
})
test('timed step entries add to the run', () => assert.equal(daySteps([{ kind: 'steps', steps: 1800, time: '06:30' }, run], H).total, 1800 + 12008))
test('steps only: unchanged', () => assert.equal(daySteps([{ kind: 'steps', steps: 6500 }], H).total, 6500))
test('nothing logged: 0', () => assert.equal(daySteps([], H).total, 0))
test('entries (what step calories use) exclude run steps', () => assert.equal(daySteps([{ kind: 'steps', steps: 1800, time: '06:30' }, run], H).entries, 1800))

console.log(failed ? `\n${failed} FAILED` : '\nall passed')
process.exit(failed ? 1 : 0)
