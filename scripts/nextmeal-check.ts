// Run: npx tsx scripts/nextmeal-check.ts  — checks nextMeal() on the real food data with a made-up eating history.
import assert from 'node:assert/strict'
import base from '../src/data/db/base.json'
import regional from '../src/data/db/regional.json'
import { closeGap, eatNext, eggRoom, habits, nextMeal, repeatBlocker, mealShare, withPairs, type Meal } from '../src/lib/mealplan'
import { portion } from '../src/lib/mealplan'
import { customToItem, type FoodItem } from '../src/data/foodDb'
import type { FoodEntry } from '../src/lib/db'

const foods = new Map([...(base as FoodItem[]), ...(regional as FoodItem[])].map((f) => [f.id, f]))
for (const c of [
  { id: 901, name: 'Yogabar protein oats (100 g)', kcal: 364, p: 26, c: 57, f: 6 }, { id: 902, name: 'White Rice Cooked', kcal: 130, p: 2.7, c: 28, f: 0.3 },
  { id: 903, name: 'Whey protein scoop (~33 g, estimate)', kcal: 130, p: 26, c: 2, f: 2 },
]) foods.set(`custom-${c.id}`, customToItem(c))
const today = '2026-03-20'
const day = (n: number) => { const d = new Date(`${today}T12:00:00`); d.setDate(d.getDate() - n); return d.toISOString().slice(0, 10) }
const entry = (date: string, meal: Meal, id: string, qty: number, unit?: string): FoodEntry => {
  const f = foods.get(id)!, p = portion(f, qty, (unit ?? f.units[0]) as any)!
  return { date, meal: (meal[0].toUpperCase() + meal.slice(1)) as FoodEntry['meal'], name: f.name, qty, serving: '', foodId: id, unit: p.unit, kcal: p.n.kcal, p: p.n.p, c: p.n.c, f: p.n.f }
}
// a typical week: oats + eggs, chicken + rice + dal at lunch, chicken + roti at dinner, curd or banana as a snack
const logs: FoodEntry[] = []
for (let i = 1; i <= 10; i++) {
  const d = day(i)
  logs.push(entry(d, 'breakfast', 'quaker-oats', 50), entry(d, 'breakfast', 'boiled-egg', 2))
  logs.push(entry(d, 'lunch', 'chicken-breast', 150), entry(d, 'lunch', 'rice', 1.5, 'katori'), entry(d, 'lunch', 'dal-tadka', 1, 'katori'))
  logs.push(entry(d, 'snacks', 'banana', 1))
  logs.push(entry(d, 'dinner', 'chicken-curry', 1, 'katori'), entry(d, 'dinner', 'roti', 2))
}
const SHOW_ONLY = true
void SHOW_ONLY
const show = (r: ReturnType<typeof nextMeal>) => {
  if (!r) return console.log('  (nothing)')
  console.log(`  ${r.meal}: aim ${Math.round(r.target.kcal)} kcal, P${Math.round(r.target.p)} (you usually ${Math.round(r.usual)} kcal${r.pattern ? '' : ', standard split'}); skipped: ${r.skipped.join(', ') || '-'}`)
  for (const i of r.items) console.log(`   - ${i.p.food.name} ${i.p.amount} ${i.p.unit} [${i.kind}${i.was ? ` from ${i.was.amount}` : ''}] ${Math.round(i.p.n.kcal)} kcal P${Math.round(i.p.n.p)}`)
  console.log(`   = ${Math.round(r.total.kcal)} kcal, P${Math.round(r.total.p)} C${Math.round(r.total.c)} F${Math.round(r.total.f)}`)
}
const goal = { kcal: 2400, p: 160, c: 260, f: 70 }
const run = (eaten: FoodEntry[], meal: Meal) => {
  const all = [...logs, ...eaten]
  const t = eaten.reduce((a, e) => ({ kcal: a.kcal + e.kcal, p: a.p + e.p, c: a.c + e.c, f: a.f + e.f }), { kcal: 0, p: 0, c: 0, f: 0 })
  return nextMeal({ remaining: { kcal: goal.kcal - t.kcal, p: goal.p - t.p, c: goal.c - t.c, f: goal.f - t.f }, meal, foods, habits: habits(all, today), logs: all, today, diet: 'nonveg', dayKcal: goal.kcal })
}

console.log('A) nothing eaten yet, planning lunch'); const a = run([], 'lunch'); show(a)
console.log('B) ate oats + 2 eggs at breakfast, planning lunch'); const bEaten = [entry(today, 'breakfast', 'quaker-oats', 50), entry(today, 'breakfast', 'boiled-egg', 2)]; const b = run(bEaten, 'lunch'); show(b)
console.log('C) had a light breakfast + low protein lunch, planning dinner'); const cEaten = [...bEaten, entry(today, 'lunch', 'rice', 1.5, 'katori'), entry(today, 'lunch', 'dal-tadka', 1, 'katori')]; const c = run(cEaten, 'dinner'); show(c)
console.log('D) breakfast was Yogabar-style oats; planning a snack must not give oats again')
const eatenOats = [entry(today, 'breakfast', 'overnight-oats', 1)]; const d = run(eatenOats, 'snacks'); show(d)
console.log('E) ate chicken at lunch; dinner may still have chicken'); const eEaten = [...bEaten, entry(today, 'lunch', 'chicken-breast', 150), entry(today, 'lunch', 'rice', 1.5, 'katori')]; const e = run(eEaten, 'dinner'); show(e)
console.log('F) over the day\'s calories'); const f = run([entry(today, 'lunch', 'chicken-biryani', 12, 'katori'), entry(today, 'breakfast', 'egg-bhurji', 6)], 'dinner'); show(f)
console.log('G) no history at all'); const g = nextMeal({ remaining: goal, meal: 'breakfast', foods, habits: new Map(), logs: [], today, diet: 'veg', dayKcal: 2400 }); show(g)

// ── your day: oats breakfast, chicken + tomato rice lunch, whey for dinner because there was no chicken ──
console.log('H) your day: dinner already logged with whey; 188 kcal and 19 g protein left')
const hist: FoodEntry[] = []
for (let i = 1; i <= 10; i++) {
  const d = day(i)
  hist.push(entry(d, 'breakfast', 'custom-901', 1, 'serving'), entry(d, 'breakfast', 'boiled-egg', 1))
  hist.push(entry(d, 'lunch', 'chicken-plain', 150), entry(d, 'lunch', 'tomato-rice', 1, 'katori'), entry(d, 'lunch', 'curd', 0.75, 'katori'))
  hist.push(entry(d, 'snacks', 'banana', 1))
  hist.push(entry(d, 'dinner', 'chicken-plain', 150), entry(d, 'dinner', 'custom-902', 1.5, 'serving'), entry(d, 'dinner', 'curd', 0.75, 'katori'))
}
const todayLog = [
  entry(today, 'breakfast', 'custom-901', 1, 'serving'), entry(today, 'breakfast', 'egg-white', 3), entry(today, 'breakfast', 'boiled-egg', 1), entry(today, 'breakfast', 'banana', 1),
  entry(today, 'lunch', 'chicken-plain', 150), entry(today, 'lunch', 'tomato-rice', 1, 'katori'), entry(today, 'lunch', 'curd', 1, 'katori'),
  entry(today, 'snacks', 'banana', 1),
  entry(today, 'dinner', 'custom-903', 1, 'serving'), entry(today, 'dinner', 'egg-white', 3), entry(today, 'dinner', 'boiled-egg', 1),
]
const allH = [...hist, ...todayLog]
const tH = todayLog.reduce((a, e) => ({ kcal: a.kcal + e.kcal, p: a.p + e.p, c: a.c + e.c, f: a.f + e.f }), { kcal: 0, p: 0, c: 0, f: 0 })
const goalH = { kcal: tH.kcal + 188, p: tH.p + 19, c: tH.c + 43, f: tH.f + 0 }
console.log('  eggs left today:', JSON.stringify(eggRoom(todayLog)))
const hN = nextMeal({ remaining: { kcal: 188, p: 19, c: 43, f: 0 }, meal: 'dinner', foods, habits: habits(allH, today), logs: allH, today, diet: 'nonveg', dayKcal: goalH.kcal })
show(hN)
const blockedH = repeatBlocker({ eatenToday: todayLog, logs: allH, today })
const idsOf = (xs: { food: FoodItem }[]) => xs.map((x) => x.food.id)
const gapAllowed = new Map([...foods].filter(([, f]) => !blockedH(f) && !['chicken', 'fish', 'meat'].includes(f.category ?? '')))
const gap = closeGap({ left: { kcal: 188, p: 19, c: 43, f: 0 }, foods: gapAllowed, habits: habits(allH, today), diet: 'nonveg', eggsLeft: eggRoom(todayLog) })
console.log('  Left for your goal ->', gap.picks.map((p) => `${p.food.name} ${p.amount} ${p.unit} (${p.why})`).join(' | ') || '(nothing)')
const sug = eatNext({ remaining: { kcal: 188, proteinG: 19 }, meal: 'dinner', foods: gapAllowed, habits: habits(allH, today), diet: 'nonveg', eggsLeft: eggRoom(todayLog), fatLeft: 0 })
console.log('  Eat next ->', withPairs(sug).map((p) => `${p.food.name} ${p.amount} ${p.unit}`).join(' | ') || '(nothing)')

assert.ok(!hN || hN.total.f <= 1e-6, 'H: fat is at the goal, so nothing with fat is added')
assert.ok(!hN || hN.topUp, 'H: dinner is already logged, so it is a top-up')
assert.ok(!(hN?.items ?? []).some((i) => i.p.food.category === 'chicken'), 'H: no chicken after the dinner was logged (it was not available)')
assert.ok(!(hN?.items ?? []).some((i) => i.p.food.id === 'egg-white'), 'H: 6 whites already eaten, no more')
const wholeAdded = (hN?.items ?? []).filter((i) => i.p.food.id === 'boiled-egg').reduce((a, i) => a + i.p.amount, 0)
assert.ok(wholeAdded <= eggRoom(todayLog)['boiled-egg'], 'H: whole eggs stay within 3 a day')
assert.ok(!(hN?.items ?? []).some((i) => i.p.food.id === 'jackfruit'), 'H: no food you never log')
assert.ok(!(hN?.items ?? []).some((i) => /oats/i.test(i.p.food.name)), 'H: no second oats')
assert.ok(!idsOf(gap.picks).includes('egg-white') && !idsOf(gap.picks).includes('jackfruit'), 'H: gap card has no egg whites and no jackfruit')
assert.ok(!idsOf(sug).includes('jackfruit'), 'H: eat next has no jackfruit')
assert.ok(gap.picks.every((p) => p.why !== 'similar'), 'H: nothing "like your banana"')
// "white rice" is a different dish from "tomato rice" and must not be blocked by it
assert.equal(repeatBlocker({ eatenToday: [entry(today, 'lunch', 'tomato-rice', 1, 'katori')], logs: hist, today })(foods.get('custom-902')!), false, 'white rice is allowed after tomato rice')
// egg limits
assert.deepEqual(eggRoom([]), { 'boiled-egg': 3, 'egg-white': 6 })
assert.equal(eggRoom([entry(today, 'breakfast', 'boiled-egg', 3)])['boiled-egg'], 0)
assert.equal(repeatBlocker({ eatenToday: [entry(today, 'breakfast', 'boiled-egg', 3)], logs: [], today })(foods.get('boiled-egg')!), true, 'a 4th whole egg is blocked')

// ── I: the exact screen from the phone: 188 kcal, 19 g protein, 43 g carbs left, fat already over (69/65) ──
console.log('I) fat over the goal, dosa in the log')
const histI = hist.concat(Array.from({ length: 6 }, (_, i) => entry(day(i + 1), 'dinner', 'dosa', 1)))
const nI = nextMeal({ remaining: { kcal: 188, p: 19, c: 43, f: -4 }, meal: 'dinner', foods, habits: habits([...histI, ...todayLog], today), logs: [...histI, ...todayLog], today, diet: 'nonveg', dayKcal: 2300 })
show(nI)
assert.ok(!nI || nI.total.kcal <= 188 * 1.2 + 30 + 1, 'I: stays near the 188 kcal aim')
assert.ok(!nI || nI.total.f <= 1e-6, 'I: fat is already over the goal, so the meal adds none')
assert.ok(!(nI?.items ?? []).some((i) => ['south', 'sabzi', 'dal', 'rice', 'chicken', 'breakfast', 'paneer'].includes(i.p.food.category ?? '')), 'I: no full dish after dinner is logged')
const gapI = closeGap({ left: { kcal: 188, p: 19, c: 43, f: -4 }, foods: new Map([...foods].filter(([, f]) => !repeatBlocker({ eatenToday: todayLog, logs: [...histI, ...todayLog], today })(f) && !['chicken', 'fish', 'meat', 'south', 'sabzi', 'dal', 'rice', 'paneer', 'breakfast'].includes(f.category ?? ''))), habits: habits([...histI, ...todayLog], today), diet: 'nonveg', eggsLeft: eggRoom(todayLog) })
console.log('  Left for your goal ->', gapI.picks.map((p) => `${p.food.name} ${p.amount} ${p.unit}`).join(' | ') || '(nothing)')
assert.ok(!gapI.picks.some((p) => p.food.id === 'dosa' || p.food.category === 'south'), 'I: gap card does not offer a dosa')

// ── J: fat is a hard limit, in every card ──
console.log('J) fat limit')
const allJ = [...histI, ...todayLog]
for (const fatLeft of [-4, 0, 2, 5, 12]) {
  const n = nextMeal({ remaining: { kcal: 300, p: 25, c: 40, f: fatLeft }, meal: 'dinner', foods, habits: habits(allJ, today), logs: allJ, today, diet: 'nonveg', dayKcal: 2300 })
  const g = closeGap({ left: { kcal: 300, p: 25, c: 40, f: fatLeft }, foods, habits: habits(allJ, today), diet: 'nonveg', eggsLeft: eggRoom(todayLog) })
  const e = eatNext({ remaining: { kcal: 300, proteinG: 25 }, meal: 'dinner', foods, habits: habits(allJ, today), diet: 'nonveg', fatLeft })
  const fn = n ? n.total.f : 0, fg = g.picks.reduce((a, p) => a + (p.n.f + (p.pair?.n.f ?? 0)), 0), fe = e.reduce((a, p) => a + p.n.f + (p.pair?.n.f ?? 0), 0)
  console.log(`  fat left ${String(fatLeft).padStart(3)} g -> next meal ${fn.toFixed(1)} g, gap card ${fg.toFixed(1)} g, eat next ${e.map((x) => x.n.f).reduce((a, b) => Math.max(a, b), 0).toFixed(1)} g max single (${n ? n.items.map((i) => i.p.food.name).join(', ') : 'nothing'})`)
  assert.ok(fn <= Math.max(0, fatLeft) + 1e-6, `next meal crosses fat at ${fatLeft}`)
  assert.ok(g.picks.every((p) => p.n.f + (p.pair?.n.f ?? 0) <= Math.max(0, fatLeft) + 1e-6), `gap card crosses fat at ${fatLeft}`)
  assert.ok(e.every((p) => p.n.f + (p.pair?.n.f ?? 0) <= Math.max(0, fatLeft) + 1e-6), `eat next crosses fat at ${fatLeft}`)
  void fe
}
// a usual meal that has more fat than is left gets cut down
const fatty = [...Array.from({ length: 6 }, (_, i) => entry(day(i + 1), 'dinner', 'paneer-butter-masala', 1.5, 'katori'))]
const nf = nextMeal({ remaining: { kcal: 600, p: 30, c: 60, f: 10 }, meal: 'dinner', foods, habits: habits(fatty, today), logs: fatty, today, diet: 'veg', dayKcal: 2300 })
console.log('  fatty usual dinner, 10 g fat left ->', nf ? `${nf.total.f.toFixed(1)} g (${nf.items.map((i) => `${i.p.food.name} ${i.p.amount}`).join(', ')})` : 'nothing')
assert.ok(!nf || nf.total.f <= 10 + 1e-6, 'a fatty usual meal is cut to the fat that is left')

// rules
assert.ok(a && a.items.length >= 1 && Math.abs(a.total.kcal - a.target.kcal) < a.target.kcal * 0.3, 'A: lands near its target')
assert.ok(a!.items.some((i) => i.p.food.id === 'chicken-breast' || i.p.food.id === 'rice'), 'A: built from your usual lunch')
assert.ok(b && !b.items.some((i) => /oats/i.test(i.p.food.name)), 'B: no oats twice')
assert.ok(d === null || !d.items.some((i) => /oats/i.test(i.p.food.name)), 'D: no second oats')
const block = repeatBlocker({ eatenToday: [entry(today, 'breakfast', 'quaker-oats', 50)], logs, today })
assert.equal(block(foods.get('overnight-oats')!), true, 'another oats dish is blocked')
assert.equal(block(foods.get('oats-milk')!), true)
assert.equal(block(foods.get('chicken-breast')!), false, 'chicken can repeat')
assert.equal(repeatBlocker({ eatenToday: [entry(today, 'lunch', 'rice', 1, 'katori')], logs, today })(foods.get('rice')!), false, 'rice can repeat')
assert.equal(f, null, 'F: nothing planned when the day is already over')
assert.ok(g && g.items.length > 0, 'G: still suggests something with no history')
const s1 = mealShare(logs, today, 'lunch', 2400), s2 = mealShare([], today, 'lunch', 2400)
assert.ok(s1.pattern && !s2.pattern && s2.frac > 0 && s2.frac < 1, 'share comes from your pattern, else a standard split')
// determinism
assert.deepEqual(JSON.stringify(run([], 'lunch')), JSON.stringify(a))
console.log('\nALL PASSED')
