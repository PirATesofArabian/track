// Run: npx tsx scripts/progress-check.ts  — what does the logger tell you to do next time?
import assert from 'node:assert/strict'
import { suggestNext, observedStep } from '../src/lib/science'
import { findByName } from '../src/data/exerciseDb'

const set = (w: number | null, reps: number, rir: number | null = null, extra: object = {}) => ({ weightKg: w, reps, rir, setType: 'working', done: true, durationSec: null, distanceM: null, ...extra }) as any
const ex = (n: string) => { const x = findByName(n); assert.ok(x, n); return x! }
const row = ex('Chest-supported row'), crunch = ex('Cable crunch')
let failed = 0
const test = (name: string, f: () => void) => { try { f(); console.log('  ok  ' + name) } catch (e) { failed++; console.log('  FAIL ' + name + '\n       ' + String((e as Error).message).split('\n').slice(0, 4).join(' | ')) } }
const t812 = { repMin: 8, repMax: 12, rir: '1–2' }

test('your row example: 50/55/60 per hand all at 12 -> every set goes up by your usual 5 kg, back to 8 reps', () => {
  const s = suggestNext([set(50, 12), set(55, 12), set(60, 12)], t812, row, 'intermediate', [50, 55, 60])!
  assert.equal(s.kind, 'add_load'); assert.match(s.text, /55 · 60 · 65 kg\/hand for 8 or more/)
})
test('your cable crunch example: 50x20 twice at the top of 15 -> 52.5', () => {
  const s = suggestNext([set(50, 20), set(50, 20)], { repMin: 8, repMax: 15, rir: '2–3' }, crunch, 'intermediate', [50])!
  assert.equal(s.kind, 'add_load'); assert.match(s.text, /52\.5 kg for 8 or more/)
})
test('not at the top yet -> keep the weight, add a rep to each set, never above the top', () => {
  const s = suggestNext([set(60, 10), set(60, 9), set(60, 12)], t812, row, 'intermediate')!
  assert.equal(s.kind, 'add_rep'); assert.match(s.text, /Keep 60 kg\/hand/); assert.match(s.text, /11 · 10 · 12/)
})
test('top reps but you were nearer failure than planned (RIR 0, target 1-2) -> hold, do not add load', () => {
  const s = suggestNext([set(60, 12, 0), set(60, 12, 0)], t812, row, 'intermediate')!
  assert.equal(s.kind, 'hold'); assert.match(s.text, /RIR 0/)
})
test('half the sets under the bottom of the range -> a step lighter on those sets', () => {
  const s = suggestNext([set(60, 8), set(60, 6), set(60, 5)], t812, row, 'intermediate')!
  assert.equal(s.kind, 'lighter'); assert.match(s.text, /60 · 57\.5 kg\/hand/)
})
test('plenty left (RIR 4 vs target 1-2, all sets at the top) -> two steps, but only within 15% of the weight', () => {
  const a = suggestNext([set(40, 12, 4), set(40, 12, 4)], t812, row, 'intermediate')!
  assert.match(a.text, /45 kg\/hand/) // 2 x 2.5 = 5 <= 6
  const b = suggestNext([set(20, 12, 4), set(20, 12, 4)], t812, row, 'intermediate')!
  assert.match(b.text, /22\.5 kg/) // 5 > 3, so one step only
})
test('warm-up and drop sets are ignored', () => {
  const s = suggestNext([set(20, 15, null, { setType: 'warmup' }), set(60, 12), set(60, 12), set(40, 20, null, { setType: 'drop' })], t812, row, 'intermediate')!
  assert.equal(s.kind, 'add_load'); assert.match(s.text, /62\.5 kg/)
})
test('a beginner on a lower-body barbell lift moves 5 kg once every set hits the bottom of the range', () => {
  const squat = ex('Back squat')
  const s = suggestNext([set(60, 8), set(60, 8)], { repMin: 8, repMax: 12 }, squat, 'beginner')
  assert.equal(s?.kind, 'add_load'); assert.match(s!.text, /65 kg/)
})
test('the step is learned from your own weights, ignoring huge or tiny gaps', () => {
  assert.equal(observedStep([40, 42.5, 45, 50]), 2.5); assert.equal(observedStep([50, 55, 60]), 5)
  assert.equal(observedStep([20, 60]), null); assert.equal(observedStep([20, 20.5]), null); assert.equal(observedStep([]), null)
})
test('bodyweight reps: add reps first, then make it harder', () => {
  const pu = ex('Pull-up'), t = { repMin: 6, repMax: 10 }
  assert.equal(suggestNext([set(null, 8), set(null, 7)], t, pu, 'intermediate')?.kind, 'add_rep')
  assert.equal(suggestNext([set(null, 10), set(null, 10)], t, pu, 'intermediate')?.kind, 'harder')
})
test('added weight on dips/pull-ups steps up; assisted pull-ups get less help', () => {
  const t = { repMin: 6, repMax: 10 }
  assert.match(suggestNext([set(10, 10), set(10, 10)], t, ex('Weighted pull-up'), 'intermediate')!.text, /\+12\.5 kg/)
  assert.match(suggestNext([set(30, 10), set(30, 10)], t, ex('Assisted pull-up'), 'intermediate')!.text, /27\.5 kg of assistance/)
})
test('a lighter set after heavier ones (back-off logged as working) is not treated as a failed set', () => {
  const s = suggestNext([set(10, 12), set(15, 12), set(15, 6), set(10, 4)], { repMin: 12, repMax: 20, rir: '0–2' }, ex('Rear delt fly'), 'intermediate', [10, 15])!
  assert.ok(!/(^|\D)5 kg/.test(s.text), s.text); assert.notEqual(s.kind, 'lighter')
})
test('no target, no data, or cardio -> says nothing', () => {
  assert.equal(suggestNext([], t812, row, 'intermediate'), null)
  assert.equal(suggestNext([set(50, 12)], undefined, row, 'intermediate'), null)
  assert.equal(suggestNext([set(50, 12)], { repMin: 0, repMax: 0 }, row, 'intermediate'), null)
})
console.log(failed ? `\n${failed} FAILED` : '\nALL PASSED'); process.exit(failed ? 1 : 0)
