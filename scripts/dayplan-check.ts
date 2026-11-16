// Run: npx tsx scripts/dayplan-check.ts  — checks planDay() on the real food data with the foods a user says they have.
import assert from 'node:assert/strict'
import base from '../src/data/db/base.json'
import regional from '../src/data/db/regional.json'
import { daySplit, eggRoom, habits, planDay, portion, repeatBlocker, type Meal } from '../src/lib/mealplan'
import { customToItem, type FoodItem } from '../src/data/foodDb'
import type { FoodEntry } from '../src/lib/db'

const foods = new Map([...(base as FoodItem[]), ...(regional as FoodItem[])].map((f) => [f.id, f]))
for (const c of [{ id: 901, name: 'Yogabar protein oats (100 g)', kcal: 364, p: 26, c: 57, f: 6 }, { id: 903, name: 'Whey protein scoop (~33 g, estimate)', kcal: 130, p: 26, c: 2, f: 2 }]) foods.set(`custom-${c.id}`, customToItem(c))
const today = '2026-03-20'
const day = (n: number) => { const d = new Date(`${today}T12:00:00`); d.setDate(d.getDate() - n); return d.toISOString().slice(0, 10) }
const entry = (date: string, meal: Meal, id: string, qty: number, unit?: string): FoodEntry => {
  const f = foods.get(id)!, p = portion(f, qty, (unit ?? f.units[0]) as any)!
  return { date, meal: (meal[0].toUpperCase() + meal.slice(1)) as FoodEntry['meal'], name: f.name, qty, serving: '', foodId: id, unit: p.unit, kcal: p.n.kcal, p: p.n.p, c: p.n.c, f: p.n.f }
}
const logs: FoodEntry[] = []
for (let i = 1; i <= 10; i++) {
  const d = day(i)
  logs.push(entry(d, 'breakfast', 'custom-901', 1, 'serving'), entry(d, 'breakfast', 'milk-toned', 100, 'ml'), entry(d, 'breakfast', 'banana', 1))
  logs.push(entry(d, 'lunch', 'chicken-plain', 150), entry(d, 'lunch', 'rice', 1, 'katori'), entry(d, 'lunch', 'mix-veg', 1, 'katori'), entry(d, 'lunch', 'curd', 1, 'katori'))
  logs.push(entry(d, 'snacks', 'banana', 1), entry(d, 'snacks', 'boiled-egg', 1))
  logs.push(entry(d, 'dinner', 'chicken-plain', 150), entry(d, 'dinner', 'roti', 2), entry(d, 'dinner', 'mix-veg', 1, 'katori'))
}
const goal = { kcal: 2300, p: 170, c: 268, f: 65, fib: 32 }
const MEALS: Meal[] = ['breakfast', 'lunch', 'snacks', 'dinner']
const run = (ids: string[], eaten: FoodEntry[] = [], meals = MEALS) => {
  const all = [...logs, ...eaten], t = eaten.reduce((a, e) => ({ kcal: a.kcal + e.kcal, p: a.p + e.p, c: a.c + e.c, f: a.f + e.f }), { kcal: 0, p: 0, c: 0, f: 0 })
  const target = { kcal: goal.kcal - t.kcal, p: goal.p - t.p, c: goal.c - t.c, f: goal.f - t.f, fib: goal.fib }
  const plan = planDay({ foods: ids.map((i) => foods.get(i)!), target, meals, split: daySplit(all, today, goal.kcal, meals), habits: habits(all, today), blocked: repeatBlocker({ eatenToday: eaten, logs: all, today }), eggsLeft: eggRoom(eaten), diet: 'nonveg' })
  console.log(`  total ${Math.round(plan.total.kcal)} kcal P${Math.round(plan.total.p)} C${Math.round(plan.total.c)} F${Math.round(plan.total.f)} fibre ${Math.round(plan.total.fib)}; target F<=${Math.round(target.f)}`)
  for (const m of plan.meals) console.log(`   ${m.meal} (aim ${Math.round(m.aim)}): ` + m.items.map((p) => `${p.food.name} ${p.amount} ${p.unit}`).join(' + ') + ` = ${Math.round(m.total.kcal)}`)
  if (plan.notes.length) console.log('   notes:', plan.notes.join(' | '))
  if (plan.unused.length) console.log('   unused:', plan.unused.join(', '))
  assert.ok(plan.total.f <= target.f + 1e-6, 'fat over the limit')
  for (const m of plan.meals) for (const p of m.items) assert.ok(ids.includes(p.food.id), `used a food not offered: ${p.food.name}`)
  return plan
}
const MINE = ['custom-901', 'milk-toned', 'banana', 'apple', 'boiled-egg', 'egg-white', 'chicken-plain', 'rice', 'roti', 'mix-veg', 'curd']
console.log('A) your foods, full day'); const a = run(MINE)
assert.ok(Math.abs(a.total.kcal - goal.kcal) < 150, 'calories near target'); assert.ok(a.total.p >= goal.p - 15, 'protein near target')
assert.ok(a.meals.reduce((n, m) => n + m.items.filter((p) => p.food.id === 'custom-901').length, 0) <= 1, 'oats once')
const eggs = a.meals.flatMap((m) => m.items).filter((p) => p.food.id === 'boiled-egg').reduce((n, p) => n + p.amount, 0); assert.ok(eggs <= 3, 'whole eggs <= 3')
console.log('B) breakfast already eaten (oats + milk + banana), plan the rest')
const eaten = [entry(today, 'breakfast', 'custom-901', 1, 'serving'), entry(today, 'breakfast', 'milk-toned', 100, 'ml'), entry(today, 'breakfast', 'banana', 1)]
const b = run(MINE, eaten, ['lunch', 'snacks', 'dinner']); assert.ok(!b.meals.some((m) => m.items.some((p) => p.food.id === 'custom-901')), 'no second oats')
console.log('C) no chicken today, whey instead'); run(['custom-901', 'milk-toned', 'banana', 'boiled-egg', 'egg-white', 'custom-903', 'rice', 'roti', 'mix-veg', 'curd'])
console.log('D) very few foods'); run(['rice', 'chicken-plain'])
console.log('E) fat limit very low'); const lowF = { ...goal }; goal.f = 30; run(MINE); goal.f = lowF.f
console.log('ok')
