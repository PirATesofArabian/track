// Ported from Macrotrophy's meal-plan generator (sf), grocery builder (cf), eat-next scorer (Yd), menu verdict (Xd)
// and habit tracker (Kd). Template data in db/mealTemplates.json is theirs; recipes.json holds their ingredient lists.
import tpl from '../data/db/mealTemplates.json'
import recipes from '../data/db/recipes.json'
import { gramsPerUnit, nutrients, type FoodItem, type Unit } from '../data/foodDb'
import type { FoodEntry } from './db'
import { shiftDate } from './util'

export type Diet = 'veg' | 'egg' | 'nonveg' | 'jain' | null
export type Setting = 'home' | 'hostel' | 'mess' | 'pg'
export type Budget = 'tight' | 'medium' | 'open'
export type Meal = 'breakfast' | 'lunch' | 'snacks' | 'dinner'
export type N = { kcal: number; p: number; c: number; f: number; fib: number }
export type Portion = { food: FoodItem; amount: number; unit: Unit; size: 'medium' | null; grams: number; n: N }
type Line = { id: string; amount?: number; scale?: string }
type Tpl = { key: string; meal: Meal; diet: 'veg' | 'egg' | 'nonveg'; cost: number; lines: Line[]; kitchen: boolean }
const HOME = tpl.wl as Tpl[], MESS = tpl.Tl as Tpl[], PROTEIN_ADDS = tpl.ml as string[], POOLS = tpl.hl as Record<Meal, string[]>
const HOME_SNACKS = HOME.filter((t) => t.meal === 'snacks' && t.key !== 'sprouts')

export const MEAL_PREFS_KEY = 'overload.mealPrefs'
export const SETTING_LABEL: Record<Setting, string> = { home: 'Home', hostel: 'Hostel', mess: 'Mess', pg: 'PG' }
export const BUDGET_LABEL: Record<Budget, string> = { tight: 'Tight', medium: 'Medium', open: 'No limit' }
export const BUDGET_HELP: Record<Budget, string> = { tight: 'Staples only: dal, chana, soya, eggs, milk, curd, peanuts.', medium: 'Adds paneer, chicken, fruit and makhana.', open: 'Adds whey, fish, Greek yogurt and nuts.' }
export const SETTING_HELP: Record<Setting, string> = {
  home: 'Meals cooked at home, with a grocery list of ingredients.', hostel: 'Mess meals as served, plus food you can keep in your room.',
  mess: 'Mess meals as served, plus add-ons like eggs, curd and chana.', pg: 'PG meals as served, plus food you can keep in your room.',
}
export function loadPrefs(): { setting: Setting; budget: Budget } {
  try {
    const e = JSON.parse(localStorage.getItem(MEAL_PREFS_KEY) ?? 'null')
    return { setting: ['home', 'hostel', 'mess', 'pg'].includes(e?.setting) ? e.setting : 'home', budget: ['tight', 'medium', 'open'].includes(e?.budget) ? e.budget : 'medium' }
  } catch { return { setting: 'home', budget: 'medium' } }
}
export const savePrefs = (p: { setting: Setting; budget: Budget }) => { try { localStorage.setItem(MEAL_PREFS_KEY, JSON.stringify(p)) } catch { /* private mode */ } }

// ── cost / diet ──
const CAT_COST: Record<string, number> = { bread: 1, rice: 1, dal: 1, sabzi: 1, egg: 1, basic: 1, breakfast: 1, south: 1, dairy: 1, fruit: 2, side: 1, snack: 2, paneer: 2, chicken: 2, drink: 2, meat: 3, fish: 3, sweet: 2 }
const ID_COST: Record<string, number> = { 'protein-shake': 3, 'greek-yogurt': 3, almonds: 3, paneer: 2, tofu: 2, banana: 1, peanuts: 1, 'roasted-chana': 1, 'soya-chunks-boiled': 1, 'sattu-drink': 1, chaas: 1, 'sprouts-chaat': 1, 'roasted-makhana': 2, apple: 2 }
export const foodCost = (f: FoodItem) => ID_COST[f.id] ?? CAT_COST[f.category ?? ''] ?? 2
const BUDGET_N: Record<Budget, number> = { tight: 1, medium: 2, open: 3 }
const DIET_ORD = { veg: 0, egg: 1, nonveg: 2 }
export function dietOk(f: FoodItem, diet: Diet): boolean {
  return !diet || diet === 'nonveg' ? true : diet === 'jain' ? !!f.jain : diet === 'egg' ? f.diet !== 'nonveg' : f.diet === 'veg'
}

// ── portions (Wd / Gd) ──
const r1 = (n: number) => Math.round(n * 10) / 10
export function portion(food: FoodItem, amount: number, unit: Unit = food.units[0]): Portion | null {
  if (!food.units.includes(unit)) return null
  const size = unit === 'katori' || unit === 'cup' ? ('medium' as const) : null
  const g = gramsPerUnit(food, unit, size ?? 'medium')
  if (!g || !(amount > 0)) return null
  const grams = r1(g * amount)
  return { food, amount, unit, size, grams, n: nutrients(food, grams) }
}
export const defaultPortion = (f: FoodItem) => portion(f, f.defaultAmount ?? 1, f.units[0])
const ZERO: N = { kcal: 0, p: 0, c: 0, f: 0, fib: 0 }
const add = (a: N, b: N): N => ({ kcal: a.kcal + b.kcal, p: a.p + b.p, c: a.c + b.c, f: a.f + b.f, fib: a.fib + b.fib })
export const sumN = (ps: { n: N }[]) => ps.reduce((a, p) => add(a, p.n), ZERO)
const roundN = (n: N): N => ({ kcal: Math.round(n.kcal), p: r1(n.p), c: r1(n.c), f: r1(n.f), fib: r1(n.fib) })
function step(f: FoodItem) {
  const u = f.units[0]
  return u === 'piece' ? { step: 1, min: 1, max: 4 } : u === 'g' || u === 'ml' ? { step: 25, min: 25, max: 300 } : { step: 0.5, min: 0.5, max: 2 }
}
const PROTEIN_CATS = new Set(['dal', 'paneer', 'chicken', 'egg', 'fish', 'meat'])
const ADD_MEAL: Record<string, Meal> = { milk: 'breakfast', 'boiled-egg': 'breakfast', 'peanut-butter-toast': 'breakfast', curd: 'lunch', chaas: 'lunch', paneer: 'dinner', 'soya-chunks-boiled': 'dinner', 'greek-yogurt': 'snacks', 'protein-shake': 'snacks', 'roasted-chana': 'snacks', peanuts: 'snacks', 'sprouts-chaat': 'snacks', 'sattu-drink': 'snacks', banana: 'snacks' }
const ADD_CAP: Record<Meal, number> = { breakfast: 1, lunch: 1, snacks: 2, dinner: 1 }

// ── plan generator (sf) ──
export type PlanMeal = { meal: Meal; kitchen: boolean; items: { id: string; amount: number; unit: Unit }[] }
export type PlanDay = { meals: PlanMeal[] }
export type StoredPlan = { setting: Setting; budget: Budget; seed: number; targets: { kcal: number; proteinG: number }; proteinShort: boolean; days: PlanDay[] }
type WorkMeal = { meal: Meal; kitchen: boolean; items: Portion[]; scalable: { i: number; food: FoodItem }[] }

export function generatePlan(o: { foods: Map<string, FoodItem>; targets: { kcal: number; proteinG: number }; diet: Diet; setting: Setting; budget: Budget; seed?: number }): StoredPlan & { totals: N[] } {
  const { foods, targets: T, diet } = o
  const eff = diet === 'jain' ? 'veg' : diet ?? 'nonveg'
  const maxCost = BUDGET_N[o.budget], away = o.setting !== 'home', seed = o.seed ?? 0
  const usable = (t: Tpl) => DIET_ORD[t.diet] <= DIET_ORD[eff] && t.cost <= maxCost && t.lines.every((l) => { const f = foods.get(l.id); return !!f && dietOk(f, diet) })
  const pool = (away ? MESS : HOME).filter(usable)
  const snackPool = (away ? HOME_SNACKS : HOME).filter((t) => t.meal === 'snacks').filter(usable)
  const adds = PROTEIN_ADDS.map((id) => foods.get(id)).filter((f): f is FoodItem => !!f && dietOk(f, diet) && foodCost(f) <= maxCost)
    .map(defaultPortion).filter((p): p is Portion => !!p && p.n.p >= 5).sort((a, b) => b.n.p / b.n.kcal - a.n.p / a.n.kcal)
  let short = false
  const days: PlanDay[] = [], totals: N[] = []
  for (let i = 0; i < 7; i++) {
    const pick = (meal: Meal, list: Tpl[], slot: number) => {
      const a = list.filter((t) => t.meal === meal), same = a.filter((t) => t.diet === eff)
      const s = same.length >= 3 && (i + seed) % 2 === 0 ? same : a
      return s.length ? s[(i * (slot + 1) + seed + slot) % s.length] : null
    }
    const chosen: [Meal, Tpl | null][] = [['breakfast', pick('breakfast', pool, 0)], ['lunch', pick('lunch', pool, 1)], ['snacks', pick('snacks', snackPool, 2)], ['dinner', pick('dinner', pool, 3)]]
    const meals: WorkMeal[] = chosen.map(([meal, t]) => {
      const items: Portion[] = [], scalable: WorkMeal['scalable'] = []
      for (const l of t?.lines ?? []) {
        const f = foods.get(l.id)!, p = portion(f, l.amount ?? f.defaultAmount ?? 1, f.units[0])
        if (p) { if (l.scale === 'carb') scalable.push({ i: items.length, food: f }); items.push(p) }
      }
      return { meal, kitchen: !!t?.kitchen, items, scalable }
    })
    const tot = () => sumN(meals.flatMap((m) => m.items))
    const set = (m: WorkMeal, idx: number, f: FoodItem, amt: number) => { const p = portion(f, amt, f.units[0]); if (p) m.items[idx] = p }
    const lowProtein = () => tot().p < T.proteinG * 0.97

    for (let k = 0; k < 2 && lowProtein(); k++) for (const m of meals) {
      if (!lowProtein()) break
      const idx = m.items.findIndex((x) => PROTEIN_CATS.has(x.food.category ?? ''))
      if (idx < 0) continue
      const it = m.items[idx], s = step(it.food)
      if (it.amount + s.step <= s.max) set(m, idx, it.food, it.amount + s.step)
    }
    const used = new Map<Meal, number>()
    for (const k of [0, 1]) for (const a of adds) {
      if (!lowProtein()) break
      const m = meals.find((x) => x.meal === (ADD_MEAL[a.food.id] ?? 'snacks'))!
      if ((used.get(m.meal) ?? 0) >= ADD_CAP[m.meal] + k || meals.some((x) => x.items.some((y) => y.food.id === a.food.id)) || tot().kcal + a.n.kcal > T.kcal * 1.05 + 200) continue
      m.items.push(a); used.set(m.meal, (used.get(m.meal) ?? 0) + 1)
    }
    for (let k = 0; k < 40; k++) {
      const gap = T.kcal - tot().kcal
      if (Math.abs(gap) <= T.kcal * 0.03) break
      const up = gap > 0
      let done = false
      for (const m of [...meals].sort((a, b) => (up ? 1 : -1) * (sumN(a.items).kcal - sumN(b.items).kcal))) {
        for (const sc of m.scalable) {
          const s = step(sc.food), l = m.items[sc.i].amount + (up ? s.step : -s.step)
          if (l < s.min || l > s.max) continue
          const u = portion(sc.food, l, sc.food.units[0])
          if (u && !(Math.abs(u.n.kcal - m.items[sc.i].n.kcal) > Math.abs(gap) * 1.6)) { set(m, sc.i, sc.food, l); done = true; break }
        }
        if (done) break
      }
      if (!done) break
    }
    for (let k = 0; k < 12 && tot().kcal > T.kcal * 1.04; k++) {
      let done = false
      for (const m of [...meals].sort((a, b) => sumN(b.items).kcal - sumN(a.items).kcal)) {
        const idx = m.items.findIndex((x, n) => !m.scalable.some((s) => s.i === n) && x.amount - step(x.food).step >= step(x.food).min && x.n.kcal > 60 && !PROTEIN_CATS.has(x.food.category ?? ''))
        if (idx < 0) continue
        const it = m.items[idx]
        set(m, idx, it.food, it.amount - step(it.food).step); done = true; break
      }
      if (!done) break
    }
    for (let k = 0; k < 4 && tot().kcal > T.kcal * 1.05; k++) {
      const c = meals.flatMap((m) => m.items.map((p, idx) => ({ m, idx, p })).filter(({ m, idx, p }) => m.items.length > 1 && !m.scalable.some((s) => s.i === idx) && !PROTEIN_CATS.has(p.food.category ?? '')))
        .sort((a, b) => a.p.n.p / a.p.n.kcal - b.p.n.p / b.p.n.kcal)[0]
      if (!c) break
      c.m.items.splice(c.idx, 1)
      c.m.scalable = c.m.scalable.map((s) => (s.i > c.idx ? { ...s, i: s.i - 1 } : s))
    }
    for (const id of ['banana', 'peanuts', 'milk', 'curd', 'roasted-chana']) {
      if (T.kcal - tot().kcal <= T.kcal * 0.04) break
      const f = foods.get(id), a = f && dietOk(f, diet) ? defaultPortion(f) : null, m = meals.find((x) => x.meal === (ADD_MEAL[id] ?? 'snacks'))!
      if (a && !meals.some((x) => x.items.some((y) => y.food.id === id)) && tot().kcal + a.n.kcal <= T.kcal * 1.04) m.items.push(a)
    }
    for (let k = 0; k < 16 && T.kcal - tot().kcal > T.kcal * 0.04; k++) {
      let done = false
      for (const m of [...meals].sort((a, b) => sumN(a.items).kcal - sumN(b.items).kcal)) {
        const idx = m.items.findIndex((x, n) => {
          const s = step(x.food), nx = portion(x.food, x.amount + s.step, x.unit)
          return !m.scalable.some((sc) => sc.i === n) && x.amount + s.step <= s.max && !!nx && tot().kcal + (nx.n.kcal - x.n.kcal) <= T.kcal * 1.04
        })
        if (idx < 0) continue
        const it = m.items[idx]
        set(m, idx, it.food, it.amount + step(it.food).step); done = true; break
      }
      if (!done) break
    }
    const t = tot()
    if (t.p < T.proteinG * 0.9) short = true
    totals.push(roundN(t))
    days.push({ meals: meals.map((m) => ({ meal: m.meal, kitchen: m.kitchen, items: m.items.map((x) => ({ id: x.food.id, amount: x.amount, unit: x.unit })) })) })
  }
  return { setting: o.setting, budget: o.budget, seed, targets: T, proteinShort: short, days, totals }
}

/** Rehydrate a stored plan into portions with nutrients. */
export function hydrate(plan: StoredPlan, foods: Map<string, FoodItem>) {
  return plan.days.map((d, index) => {
    const meals = d.meals.map((m) => ({ meal: m.meal, kitchen: m.kitchen, items: m.items.map((x) => { const f = foods.get(x.id); return f ? portion(f, x.amount, x.unit) : null }).filter((p): p is Portion => !!p) }))
    return { index, meals, totals: sumN(meals.flatMap((m) => m.items)) }
  })
}

// ── grocery list (cf) ──
export type Grocery = { name: string; grams: number | null; count: number | null; countName: string | null }
type Recipe = { lines: { name: string; grams: number }[]; cookedG: number }
const RECIPES = recipes as unknown as Record<string, Recipe>
export function groceryList(days: ReturnType<typeof hydrate>, setting: Setting): Grocery[] {
  const g = new Map<string, { name: string; g: number }>(), c = new Map<string, { name: string; count: number; unit: string }>()
  const key = (s: string) => s.toLowerCase().replace(/\s*\(.*?\)/g, '').replace(/,.*$/, '').replace(/^boiled /, '').trim()
  const count = (name: string, n: number, unit: string) => { const x = c.get(name) ?? { name, count: 0, unit }; x.count += n; c.set(name, x) }
  const grams = (name: string, n: number) => {
    const k = key(name)
    if (k === 'egg') { count('Eggs', n / 50, 'eggs'); return }
    const x = g.get(k) ?? { name: name.replace(/\s*\(.*?\)/g, '').replace(/,.*$/, '').trim(), g: 0 }
    x.g += n; g.set(k, x)
  }
  for (const d of days) for (const m of d.meals) {
    if (m.kitchen && setting !== 'home') continue
    for (const it of m.items) {
      const r = RECIPES[it.food.id]
      if (r && r.cookedG > 0 && r.lines.length) for (const l of r.lines) grams(l.name, (l.grams * it.grams) / r.cookedG)
      else if (key(it.food.name) === 'egg') count('Eggs', it.unit === 'piece' ? it.amount : it.grams / 50, 'eggs')
      else if (it.food.pieceG && it.food.pieceName && it.unit === 'piece') count(it.food.name, it.amount, it.food.pieceName[1])
      else grams(it.food.name, it.grams)
    }
  }
  const out: Grocery[] = []
  for (const { name, g: n } of g.values()) if (!/^(water|salt)$/i.test(name) && n >= 15) out.push({ name, grams: Math.ceil(n / 50) * 50, count: null, countName: null })
  for (const x of c.values()) out.push({ name: x.name, grams: null, count: Math.ceil(x.count), countName: x.unit })
  return out.sort((a, b) => (b.grams ?? (b.count ?? 0) * 50) - (a.grams ?? (a.count ?? 0) * 50))
}
export const groceryText = (x: Grocery) =>
  x.count === null ? ((x.grams ?? 0) >= 1000 ? `${((x.grams ?? 0) / 1000).toFixed(1)} kg` : `${x.grams} g`) : `${x.count} ${x.count === 1 ? (x.countName ?? '').replace(/s$/, '') : x.countName ?? ''}`.trim()

// ── habits over the last 28 days (Kd) ──
export type Habit = { days: number; meals: Set<Meal>; amount: number; unit: Unit; kcal: number }
export function habits(logs: FoodEntry[], today: string): Map<string, Habit> {
  const from = shiftDate(today, -28), dates = new Map<string, Set<string>>(), out = new Map<string, Habit>()
  for (const e of [...logs].sort((a, b) => (a.id ?? 0) - (b.id ?? 0))) {
    if (!e.foodId || e.date < from || e.date > today) continue
    const s = dates.get(e.foodId) ?? new Set<string>()
    s.add(e.date); dates.set(e.foodId, s)
    const h = out.get(e.foodId) ?? { days: 0, meals: new Set<Meal>(), amount: e.qty, unit: (e.unit ?? 'g') as Unit, kcal: e.kcal }
    h.meals.add(e.meal.toLowerCase() as Meal); h.amount = e.qty; h.unit = (e.unit ?? h.unit) as Unit; h.kcal = e.kcal; h.days = s.size
    out.set(e.foodId, h)
  }
  return out
}

// ── eat-next (Yd) ──
export const MEAL_NOW = (hour: number): Meal => (hour < 11 ? 'breakfast' : hour < 16 ? 'lunch' : hour < 19 ? 'snacks' : 'dinner')
const SHARE: Record<Meal, number> = { breakfast: 0.25, lunch: 0.35, snacks: 0.1, dinner: 0.3 }
const REST: Record<Meal, Meal[]> = { breakfast: ['breakfast', 'lunch', 'snacks', 'dinner'], lunch: ['lunch', 'snacks', 'dinner'], snacks: ['snacks', 'dinner'], dinner: ['dinner'] }
export type Suggestion = Portion & { why: 'usual' | 'similar' | 'protein' | 'fits'; like?: string; pair?: Portion }

// ── foods that are eaten together: Yogabar protein oats always comes with milk ──
const needsMilk = (f: FoodItem) => /yogabar/i.test(f.name) && /oats/i.test(f.name)
/** The milk that goes with a food, using the amount you usually log for milk (150 ml if you never have). */
function milkFor(food: FoodItem, foods: Map<string, FoodItem>, habits: Map<string, Habit>): Portion | undefined {
  if (!needsMilk(food)) return undefined
  const milk = foods.get('milk-toned'), h = habits.get('milk-toned')
  if (!milk) return undefined
  return (h ? portion(milk, h.amount, h.unit) : null) ?? portion(milk, 150, 'ml') ?? undefined
}
/** Calories and macros of a suggestion including what goes with it. */
export const totalOf = (s: Suggestion): N => (s.pair ? add(s.n, s.pair.n) : s.n)
/** The rows to log for a list of suggestions: each food, followed by its pairing. */
export const withPairs = (ps: Suggestion[]): Portion[] => ps.flatMap((p) => (p.pair ? [p, p.pair] : [p]))

// ── "like what you eat": neighbours of foods you have logged ──
const STOP = new Set(['with', 'and', 'the', 'in', 'of', 'a', 'plain', 'cooked', 'style', 'fresh'])
const words = (n: string) => new Set(n.toLowerCase().split(/[^a-z]+/).filter((w) => w.length > 2 && !STOP.has(w)))
const DIET_RANK = { veg: 0, egg: 1, nonveg: 2 } as const
const rank = (f: FoodItem) => DIET_RANK[(f.diet as keyof typeof DIET_RANK) ?? 'veg'] ?? 0
/** 0..1: how alike two foods are by macros per 100 g, name words and category. */
export function likeness(a: FoodItem, b: FoodItem): number {
  const d = Math.abs(a.per100.kcal - b.per100.kcal) / 300 + Math.abs(a.per100.p - b.per100.p) / 20 + Math.abs(a.per100.c - b.per100.c) / 40 + Math.abs(a.per100.f - b.per100.f) / 20
  const macro = Math.max(0, 1 - d / 3)
  const wa = words(a.name), wb = words(b.name)
  const shared = [...wa].filter((w) => wb.has(w)).length, tok = shared / Math.max(1, Math.min(wa.size, wb.size))
  const cat = a.category && a.category === b.category ? 1 : 0
  if (!cat && !shared) return 0
  return 0.5 * macro + 0.3 * Math.min(1, tok) + 0.2 * cat
}
const SIMILAR_MIN = 0.62

/** Scale a food so it lands near `kcal`, in steps people actually use. */
function around(food: FoodItem, kcal: number, fallback: Portion | null): Portion | null {
  const base = fallback ?? defaultPortion(food)
  if (!base || base.n.kcal <= 0) return base
  const s = step(food), per = base.n.kcal / base.amount
  const amt = Math.min(s.max, Math.max(s.min, Math.round(kcal / per / s.step) * s.step))
  return portion(food, amt, base.unit) ?? base
}

export function eatNext(o: {
  remaining: { kcal: number; proteinG: number }; meal: Meal; foods: Map<string, FoodItem>; habits: Map<string, Habit>
  setting?: Setting; budget?: Budget; diet: Diet; eatenNow?: Set<string>; limit?: number
}): Suggestion[] {
  const { remaining: rem, meal, foods } = o
  if (rem.kcal < 120) return []
  const away = !!o.setting && o.setting !== 'home'
  const mine = [...o.habits].filter(([id]) => foods.has(id))
  const fromLogs = mine.length >= 3 // enough history to work from what the person really eats; otherwise generic pools
  const maxCost = BUDGET_N[o.budget ?? 'open']
  const frac = SHARE[meal] / REST[meal].reduce((s, m) => s + SHARE[m], 0)
  const l = { kcal: rem.kcal * frac, proteinG: Math.max(0, rem.proteinG) * frac }
  const u = Math.min(1, l.proteinG / Math.max(1, l.kcal / 10))

  // candidate id -> where it came from
  const src = new Map<string, { like?: Habit & { name: string }; sim: number }>()
  if (fromLogs) {
    const here = mine.filter(([, h]) => h.meals.has(meal))
    const ateAtMeal = here.length ? here : mine.filter(([id, h]) => h.days >= 3 && !!foods.get(id)!.meals?.includes(meal))
    for (const [id] of ateAtMeal) src.set(id, { sim: 1 })
    const maxRank = Math.max(...mine.map(([id]) => rank(foods.get(id)!)), o.diet === 'nonveg' || !o.diet ? 2 : o.diet === 'egg' ? 1 : 0)
    const pool = [...foods.values()].filter((f) => !f.id.startsWith('usda-') && !o.habits.has(f.id) && rank(f) <= maxRank && (o.diet !== 'jain' || f.jain))
    for (const [id, h] of ateAtMeal) {
      const base = foods.get(id)!
      const near = pool.map((f) => ({ f, s: likeness(base, f) })).filter((x) => x.s >= SIMILAR_MIN && (!x.f.meals || x.f.meals.includes(meal) || h.meals.has(meal))).sort((a, b) => b.s - a.s).slice(0, 3)
      for (const { f, s } of near) { const cur = src.get(f.id); if (!cur || cur.sim < s) src.set(f.id, { like: { ...h, name: base.name }, sim: s }) }
    }
  } else {
    for (const id of away ? PROTEIN_ADDS : POOLS[meal]) src.set(id, { sim: 0 })
    for (const [id, h] of o.habits) if (h.meals.has(meal) || h.days >= 3) src.set(id, { sim: 1 })
  }

  const cands: (Suggestion & { score: number })[] = []
  for (const [id, from] of src) {
    const food = foods.get(id)
    if (!food || o.eatenNow?.has(id)) continue
    const h = o.habits.get(id)
    if (!h && !dietOk(food, o.diet) && !fromLogs) continue
    const e = h ? (portion(food, h.amount, h.unit) ?? defaultPortion(food)) : from.like ? around(food, from.like.kcal, null) : defaultPortion(food)
    if (!e) continue
    const pair = milkFor(food, foods, o.habits)
    const en = pair ? add(e.n, pair.n) : e.n
    if (en.kcal < 30 || en.kcal > Math.min(rem.kcal * 1.05, Math.max(l.kcal * 1.6, 200))) continue
    const r = (en.p * 4) / Math.max(1, en.kcal)
    if (en.kcal < l.kcal * 0.15 && r < 0.25) continue
    const i = l.proteinG > 0 ? Math.min(en.p, l.proteinG) / l.proteinG : 0
    const a = en.kcal / Math.max(150, l.kcal)
    let score = 100 * i * u + 30 * r - 35 * Math.max(0, a - Math.max(i, 0.35))
    if (h) score += 12 + Math.min(8, h.days)
    if (h?.meals.has(meal)) score += 10
    if (!h && from.like) score += 14 * from.sim + (from.like.meals.has(meal) ? 8 : 0)
    if (food.meals?.includes(meal)) score += 6
    if (foodCost(food) > maxCost && !h && !fromLogs) continue
    cands.push({ ...e, pair, why: h ? 'usual' : from.like ? 'similar' : i >= 0.3 && r >= 0.2 ? 'protein' : 'fits', like: from.like?.name, score })
  }
  const sorted = cands.sort((a, b) => b.score - a.score || a.food.id.localeCompare(b.food.id))
  const limit = o.limit ?? 3, out: Suggestion[] = [], seen = new Set<string>(), cats = new Set<string | undefined>()
  const take = (c: Suggestion & { score: number }) => { const { score: _s, ...x } = c; seen.add(c.food.id); if (c.pair) seen.add(c.pair.food.id); cats.add(c.food.category); out.push(x) }
  // Foods you really eat come first (the best one is always shown), then similar foods fill the rest.
  // One food per category, except that a similar food never pushes out the exact food it is similar to.
  const usual = sorted.filter((c) => c.why === 'usual'), others = sorted.filter((c) => c.why !== 'usual')
  const hasSimilar = others.some((c) => c.why === 'similar')
  const maxUsual = hasSimilar ? Math.max(1, limit - 1) : limit
  for (const c of usual) { if (out.length >= maxUsual) break; if (!seen.has(c.food.id) && !cats.has(c.food.category)) take(c) }
  const milkTaken = () => out.some((x) => x.pair)
  for (const c of others) { if (out.length >= limit) break; if (!seen.has(c.food.id) && !cats.has(c.food.category) && !(milkTaken() && (/\bmilk\b/i.test(c.food.name) && !/shake|powder|cake|sweet|rice/i.test(c.food.name)))) take(c) }
  for (const c of usual) { if (out.length >= limit) break; if (!seen.has(c.food.id)) take(c) }
  return out
}

// ── close the day's gap (built here, not ported): what to eat so protein, carbs and fat reach the goals ──
export type Gap = { kcal: number; p: number; c: number; f: number }
const GAP_W = { p: 6, c: 4, f: 5 } // how much covering a gram of each macro is worth in the score; protein counts most
const gapGrid = (f: FoodItem) => { const s = step(f), out: number[] = []; for (let a = s.min; a <= s.max + 1e-9; a += s.step) out.push(Math.round(a * 100) / 100); return out }

/**
 * Picks up to `limit` foods and amounts that fill what is still missing. Foods you really eat are tried first, then
 * foods like them, then the generic protein pools when you have little history. Scores reward the missing grams a
 * portion covers and charge for calories that fill nothing missing, and for going past the calories left (plus 100).
 */
export function closeGap(o: { left: Gap; foods: Map<string, FoodItem>; habits: Map<string, Habit>; diet: Diet; limit?: number }): { picks: Suggestion[]; after: Gap } {
  const { foods, habits: hab } = o
  const need = { p: Math.max(0, o.left.p), c: Math.max(0, o.left.c), f: Math.max(0, o.left.f) }
  let budget = Math.max(0, o.left.kcal) + 100
  const after: Gap = { ...o.left }
  const mine = [...hab].filter(([id]) => foods.has(id))
  const cand = new Map<string, { why: Suggestion['why']; like?: string; bonus: number }>()
  for (const [id, h] of mine) if (h.days >= 2 || mine.length < 6) cand.set(id, { why: 'usual', bonus: 1.15 })
  const maxRank = Math.max(0, ...mine.map(([id]) => rank(foods.get(id)!)), o.diet === 'nonveg' || !o.diet ? 2 : o.diet === 'egg' ? 1 : 0)
  const pool = [...foods.values()].filter((f) => !f.id.startsWith('usda-') && !hab.has(f.id) && rank(f) <= maxRank && (o.diet !== 'jain' || f.jain))
  for (const [id, h] of mine) {
    if (h.days < 3) continue
    const base = foods.get(id)!
    for (const { f } of pool.map((f) => ({ f, s: likeness(base, f) })).filter((x) => x.s >= SIMILAR_MIN && x.f.category === base.category).sort((a, b) => b.s - a.s).slice(0, 2)) if (!cand.has(f.id)) cand.set(f.id, { why: 'similar', like: base.name, bonus: 1.05 })
  }
  if (mine.length < 3) for (const id of [...PROTEIN_ADDS, ...Object.values(POOLS).flat()]) if (foods.has(id) && !cand.has(id)) cand.set(id, { why: 'protein', bonus: 1 })

  const picks: Suggestion[] = [], used = new Set<string>(), cats = new Set<string | undefined>()
  for (let k = 0; k < (o.limit ?? 3); k++) {
    if (need.p <= 3 && need.c <= 10 && need.f <= 3) break
    let best: { s: Suggestion; score: number } | null = null
    for (const [id, c] of cand) {
      const food = foods.get(id)!
      if (used.has(id) || (cats.has(food.category) && c.why !== 'usual')) continue
      const unit = hab.get(id)?.unit ?? food.units[0]
      for (const amt of gapGrid(food)) {
        const e = portion(food, amt, unit)
        if (!e) continue
        const pair = milkFor(food, foods, hab), en = pair ? add(e.n, pair.n) : e.n
        if (en.kcal < 30) continue
        const eat = { p: Math.min(en.p, need.p), c: Math.min(en.c, need.c), f: Math.min(en.f, need.f) }
        const covered = GAP_W.p * eat.p + GAP_W.c * eat.c + GAP_W.f * eat.f
        const waste = Math.max(0, en.kcal - (4 * eat.p + 4 * eat.c + 9 * eat.f))
        const score = (covered - 1.2 * waste - 2 * Math.max(0, en.kcal - budget)) * (covered > 0 ? c.bonus : 1)
        if (!best || score > best.score) best = { s: { ...e, pair, why: c.why, like: c.like }, score }
      }
    }
    if (!best || best.score < 40) break
    const n = totalOf(best.s)
    picks.push(best.s); used.add(best.s.food.id); if (best.s.pair) used.add(best.s.pair.food.id); cats.add(best.s.food.category)
    need.p = Math.max(0, need.p - n.p); need.c = Math.max(0, need.c - n.c); need.f = Math.max(0, need.f - n.f)
    budget -= n.kcal; after.kcal -= n.kcal; after.p -= n.p; after.c -= n.c; after.f -= n.f
  }
  return { picks, after }
}

// ── transliteration-aware search (their `_`) used to read a typed menu ──
const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim()
const phon = (e: string) => e.replace(/([bcdgjkpst])h/g, '$1').replace(/ee/g, 'i').replace(/oo/g, 'u').replace(/aa/g, 'a').replace(/w/g, 'v').replace(/z/g, 'j').replace(/q/g, 'k').replace(/(.)\1+/g, '$1').replace(/y$/g, 'i')
const SYN: Record<string, string[]> = {
  rice: ['chawal', 'bhaat', 'chaval'], chawal: ['rice'], okra: ['bhindi'], ladyfinger: ['bhindi'], eggplant: ['baingan', 'brinjal'], brinjal: ['baingan'], cauliflower: ['gobhi'], potato: ['aloo'], potatoes: ['aloo'],
  spinach: ['palak'], peas: ['matar'], chickpea: ['chole', 'chana'], chickpeas: ['chole', 'chana'], lentil: ['dal'], lentils: ['dal'], yogurt: ['curd', 'dahi'], yoghurt: ['curd', 'dahi'], dahi: ['curd'],
  buttermilk: ['chaas'], tea: ['chai'], milk: ['doodh'], egg: ['anda', 'omelette', 'bhurji'], eggs: ['anda', 'egg'], chicken: ['murgh'], mutton: ['gosht'], fish: ['machli', 'meen'], flatbread: ['roti', 'paratha'],
  bread: ['roti', 'pav'], cheese: ['paneer'], cottage: ['paneer'], sweet: ['halwa', 'kheer', 'ladoo'], dessert: ['halwa', 'kheer', 'ladoo', 'rasgulla'], salad: ['kachumber'], soya: ['nutrela'], sabji: ['sabzi'], bhaji: ['sabzi', 'pakora'],
}
const tokCache = new WeakMap<FoodItem, { name: string[]; alias: string[] }>()
function toks(f: FoodItem) {
  let t = tokCache.get(f)
  if (!t) { t = { name: norm(f.name).split(' ').map(phon), alias: (f.aliases ?? []).flatMap((a) => norm(a).split(' ')).map(phon) }; tokCache.set(f, t) }
  return t
}
function tokScore(word: string, f: FoodItem) {
  const { name, alias } = toks(f)
  let best = 0
  for (const w of [word, ...(SYN[word] ?? [])].map(phon)) {
    name.forEach((t, i) => { if (t === w) best = Math.max(best, 10 - i * 0.1); else if (t.startsWith(w)) best = Math.max(best, 7 - i * 0.1) })
    for (const t of alias) { if (t === w) best = Math.max(best, 6); else if (t.startsWith(w)) best = Math.max(best, 4) }
  }
  return best
}
function foodScore(f: FoodItem, q: string) {
  const words = norm(q).split(' ').filter(Boolean)
  if (!words.length) return 1
  let sum = 0
  for (const w of words) { const s = tokScore(w, f); if (s === 0) return 0; sum += s }
  const nq = norm(q), head = norm(f.name.split(/[,(]/)[0] ?? f.name)
  const exact = ((f.aliases ?? []).some((a) => norm(a) === nq) ? 4 * words.length + 1 : 0) + (head === nq ? 4 * words.length + 3 : 0)
  const src = f.source ?? (f.id.startsWith('usda') ? 'usda' : f.id.startsWith('indb') ? 'indb' : '')
  return sum + exact - (src === 'usda' ? 4 : src === 'indb' ? 2 : 0) - norm(f.name).length * 0.01
}
export const smartSearch = (all: FoodItem[], q: string, limit = 30) =>
  all.map((f) => ({ f, s: foodScore(f, q) })).filter((x) => x.s > 0).sort((a, b) => b.s - a.s).slice(0, limit).map((x) => x.f)

// ── menu verdict (Xd) ──
export type MenuRow = { dish: string; portion: Portion | null; verdict: 'best' | 'fits' | 'over' | 'unknown' }
export function menuVerdict(o: { dishes: string[]; all: FoodItem[]; remaining: { kcal: number; proteinG: number }; diet: Diet }): MenuRow[] {
  const rows = o.dishes.map((dish) => {
    const f = smartSearch(o.all, dish, 1)[0], p = f ? defaultPortion(f) : null
    if (!f || !p) return { dish, portion: null, verdict: 'unknown' as const, score: -1e6 }
    const over = p.n.kcal > Math.max(o.remaining.kcal, 0) * 1.05
    const dens = (p.n.p * 4) / Math.max(1, p.n.kcal)
    const cov = o.remaining.proteinG > 0 ? Math.min(p.n.p, o.remaining.proteinG) / o.remaining.proteinG : 0
    return { dish, portion: p, verdict: (over ? 'over' : 'fits') as 'over' | 'fits', score: (dietOk(f, o.diet) ? 0 : -500) + (over ? -200 : 0) + 100 * cov + 60 * dens }
  }).sort((a, b) => b.score - a.score)
  let n = 0
  return rows.map(({ score: _s, ...r }) => (r.verdict === 'fits' && n < 3 && r.portion && dietOk(r.portion.food, o.diet) && r.portion.n.p >= 8 ? (n++, { ...r, verdict: 'best' as const }) : r))
}

// ── "From what I've eaten": a week built only from meals already in the food log ──
export type LoggedItem = Pick<FoodEntry, 'name' | 'qty' | 'serving' | 'foodId' | 'unit' | 'size' | 'rich' | 'kcal' | 'p' | 'c' | 'f' | 'fib'>
export type LoggedMeal = { meal: Meal; items: LoggedItem[]; fixedCount: number; times: number; options: number }
export type LoggedPlan = { seed: number; from: string; daysUsed: number; days: { meals: LoggedMeal[] }[] }
const MEAL_ORDER: Meal[] = ['breakfast', 'lunch', 'snacks', 'dinner']
const itemId = (e: LoggedItem) => e.foodId ?? e.name
const itemSig = (e: LoggedItem) => `${itemId(e)}:${e.qty}:${e.unit ?? ''}:${e.size ?? ''}:${e.rich ?? ''}`
const pickLogged = (e: FoodEntry): LoggedItem => ({ name: e.name, qty: e.qty, serving: e.serving, foodId: e.foodId, unit: e.unit, size: e.size, rich: e.rich, kcal: e.kcal, p: e.p, c: e.c, f: e.f, fib: e.fib })
export const MIN_LOGGED_DAYS = 3
const MAX_OPTIONS = 7

/**
 * Every meal is built only from foods logged in the last 28 days (today excluded).
 * Per meal slot: foods you eat on most of that slot's days stay in every day ("fixed"). Whatever else you
 * logged there (the changing non-veg, a fruit, a sweet) forms the varied part, and each day takes the next
 * version you have actually eaten, most common first. `seed` shifts that rotation.
 */
export function loggedPlan(logs: FoodEntry[], today: string, seed = 0): LoggedPlan | null {
  const from = shiftDate(today, -28), byDay = new Map<string, FoodEntry[]>()
  for (const e of logs) if (e.date >= from && e.date < today) byDay.set(e.date, [...(byDay.get(e.date) ?? []), e])
  const daysUsed = [...byDay.values()].filter((d) => d.reduce((a, e) => a + e.kcal, 0) >= 800).length
  if (daysUsed < MIN_LOGGED_DAYS) return null
  const slots = new Map<Meal, { core: LoggedItem[]; varied: { items: LoggedItem[]; n: number; last: string }[] }>()
  for (const m of MEAL_ORDER) {
    const perDay = [...byDay.entries()].sort().map(([date, es]) => ({ date, items: es.filter((e) => e.meal.toLowerCase() === m).map(pickLogged) })).filter((d) => d.items.length)
    if (!perDay.length) continue
    const need = Math.max(2, Math.ceil(perDay.length * 0.6)), count = new Map<string, number>(), latest = new Map<string, LoggedItem>()
    for (const d of perDay) for (const id of new Set(d.items.map(itemId))) count.set(id, (count.get(id) ?? 0) + 1)
    for (const d of perDay) for (const it of d.items) latest.set(itemId(it), it) // most recent portion wins
    const coreIds = new Set([...count.entries()].filter(([, n]) => n >= need).map(([id]) => id))
    const sets = new Map<string, { items: LoggedItem[]; n: number; last: string }>()
    for (const d of perDay) {
      const rest = d.items.filter((it) => !coreIds.has(itemId(it)))
      if (!rest.length) continue
      const sig = rest.map(itemSig).sort().join('|'), cur = sets.get(sig)
      sets.set(sig, { items: rest, n: (cur?.n ?? 0) + 1, last: d.date })
    }
    slots.set(m, { core: [...coreIds].map((id) => latest.get(id)!), varied: [...sets.values()].sort((a, b) => b.n - a.n || b.last.localeCompare(a.last)).slice(0, MAX_OPTIONS) })
  }
  const days = Array.from({ length: 7 }, (_, i) => ({
    meals: MEAL_ORDER.flatMap((m): LoggedMeal[] => {
      const s = slots.get(m)
      if (!s) return []
      const v = s.varied.length ? s.varied[(i + seed) % s.varied.length] : null
      return [{ meal: m, items: [...s.core, ...(v?.items ?? [])], fixedCount: s.core.length, times: v?.n ?? 0, options: s.varied.length }]
    }),
  }))
  return { seed, from, daysUsed, days }
}
export const loggedTotals = (meals: { items: LoggedItem[] }[]) => meals.flatMap((m) => m.items).reduce((a, e) => ({ kcal: a.kcal + e.kcal, p: a.p + e.p, c: a.c + e.c, f: a.f + e.f }), { kcal: 0, p: 0, c: 0, f: 0 })
