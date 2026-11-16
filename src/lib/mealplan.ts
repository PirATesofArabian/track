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
  setting?: Setting; budget?: Budget; diet: Diet; eatenNow?: Set<string>; limit?: number; eggsLeft?: Record<string, number>; fatLeft?: number
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
    if (!e || overEggs(food, e.amount, e.unit, o.eggsLeft)) continue
    const pair = milkFor(food, foods, o.habits)
    const en = pair ? add(e.n, pair.n) : e.n
    if (o.fatLeft !== undefined && en.f > Math.max(0, o.fatLeft) + 1e-6) continue // never past the day's fat
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
/** True when `amt` of an egg food would go past what is left of today's egg limit. */
const overEggs = (f: FoodItem, amt: number, unit: Unit, left?: Record<string, number>) =>
  !!left && f.id in left && (unit === 'g' ? amt / (f.id === 'egg-white' ? 33 : 50) : amt) > left[f.id] + 1e-9
const GAP_W = { p: 6, c: 4, f: 5 } // how much covering a gram of each macro is worth in the score; protein counts most
const gapGrid = (f: FoodItem) => { const s = step(f), out: number[] = []; for (let a = s.min; a <= s.max + 1e-9; a += s.step) out.push(Math.round(a * 100) / 100); return out }

/**
 * Picks up to `limit` foods and amounts that fill what is still missing. Foods you really eat are tried first, then
 * foods like them, then the generic protein pools when you have little history. Scores reward the missing grams a
 * portion covers and charge for calories that fill nothing missing, and for going past the calories left (plus 100).
 */
export function closeGap(o: { left: Gap; foods: Map<string, FoodItem>; habits: Map<string, Habit>; diet: Diet; limit?: number; eggsLeft?: Record<string, number> }): { picks: Suggestion[]; after: Gap } {
  const { foods, habits: hab } = o
  const need = { p: Math.max(0, o.left.p), c: Math.max(0, o.left.c), f: Math.max(0, o.left.f) }
  let budget = Math.max(0, o.left.kcal) + 100
  const after: Gap = { ...o.left }
  const mine = [...hab].filter(([id]) => foods.has(id))
  const cand = new Map<string, { why: Suggestion['why']; like?: string; bonus: number }>()
  for (const [id, h] of mine) if (h.days >= 2 || mine.length < 6) cand.set(id, { why: 'usual', bonus: 1.15 })
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
        if (overEggs(food, amt, unit, o.eggsLeft)) continue
        const e = portion(food, amt, unit)
        if (!e) continue
        const pair = milkFor(food, foods, hab), en = pair ? add(e.n, pair.n) : e.n
        if (en.kcal < 30 || en.f > Math.max(0, after.f) + 1e-6) continue // never past the day's fat
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

// ── next meal (built here, not ported): a target for this meal, your usual foods adjusted to hit it ──
/** Foods people eat in more than one meal a day without thinking about it. Anything else (oats, poha, a packaged snack) is a "once a day" food. */
const REPEATABLE = new Set(['rice', 'bread', 'dal', 'chicken', 'egg', 'fish', 'meat', 'paneer', 'sabzi', 'dairy', 'fruit', 'basic', 'side', 'drink'])
/** Full dishes. After a meal is logged these are not offered again; only small additions are. */
export const MAIN_DISH = new Set(['chicken', 'fish', 'meat', 'south', 'sabzi', 'dal', 'rice', 'paneer', 'breakfast'])
/** Breakfast-type families where a second bowl in one day is not wanted, whatever the brand or recipe. */
const ONCE_WORDS = new Set(['oats', 'oat', 'muesli', 'granola', 'poha', 'upma', 'cornflakes', 'porridge', 'cereal'])
const onceWords = (name: string) => [...words(name)].filter((w) => ONCE_WORDS.has(w))
const mealOf = (e: FoodEntry) => e.meal.toLowerCase() as Meal
/** Whole eggs and egg whites to stop at in a day (3 whole, 6 whites). Suggestions only use what is left of these. Dishes made with eggs (bhurji, omelette) are not counted. */
export const EGG_DAY: Record<string, number> = { 'boiled-egg': 3, 'egg-white': 6 }
export function eggRoom(eatenToday: FoodEntry[]): Record<string, number> {
  const out = { ...EGG_DAY }
  for (const e of eatenToday) if (e.foodId && e.foodId in out) out[e.foodId] -= e.unit === 'g' ? e.qty / (e.foodId === 'egg-white' ? 33 : 50) : e.qty
  for (const k of Object.keys(out)) out[k] = Math.max(0, Math.floor(out[k] + 1e-6))
  return out
}

/**
 * Says whether a food should be left out because you already had it today. Chicken, rice, eggs, dal, roti and the like can repeat.
 * Everything else is once a day, and so is any dish of the same family (oats, muesli, poha...), unless your own log shows you
 * eat that food in two meals on at least two days. Eggs stop when today's limit is used up.
 */
export function repeatBlocker(o: { eatenToday: FoodEntry[]; logs: FoodEntry[]; today: string }): (f: FoodItem) => boolean {
  const from = shiftDate(o.today, -28), seen = new Map<string, Set<Meal>>()
  for (const e of o.logs) {
    if (!e.foodId || e.date < from || e.date >= o.today) continue
    const k = `${e.date}|${e.foodId}`, m = seen.get(k) ?? new Set<Meal>()
    m.add(mealOf(e)); seen.set(k, m)
  }
  const twice = new Map<string, number>()
  for (const [k, m] of seen) if (m.size >= 2) { const id = k.slice(11); twice.set(id, (twice.get(id) ?? 0) + 1) }
  const ids = new Set(o.eatenToday.map((e) => e.foodId).filter((x): x is string => !!x)), ws = new Set(o.eatenToday.flatMap((e) => onceWords(e.name)))
  const room = eggRoom(o.eatenToday)
  return (f) => {
    if (f.id in room && room[f.id] < 1) return true
    if ((twice.get(f.id) ?? 0) >= 2 || REPEATABLE.has(f.category ?? '')) return false
    return ids.has(f.id) || onceWords(f.name).some((w) => ws.has(w))
  }
}

/** Share of what is left that this meal should take, from how you really split your day (28 days), else a standard split. `eaten` is what this meal already holds today. */
export function mealShare(logs: FoodEntry[], today: string, meal: Meal, dayKcal: number, eaten = 0): { frac: number; usual: number; pattern: boolean } {
  const from = shiftDate(today, -28), per = new Map<Meal, Map<string, number>>(), day = new Map<string, number>()
  for (const e of logs) {
    if (e.date < from || e.date >= today) continue
    const m = mealOf(e), d = per.get(m) ?? new Map<string, number>()
    d.set(e.date, (d.get(e.date) ?? 0) + e.kcal); per.set(m, d); day.set(e.date, (day.get(e.date) ?? 0) + e.kcal)
  }
  const mean = (m: Map<string, number> | undefined) => (m && m.size >= 3 ? [...m.values()].reduce((a, b) => a + b, 0) / m.size : null)
  const dayAvg = mean(day) ?? dayKcal
  const full = (m: Meal) => mean(per.get(m)) ?? SHARE[m] * dayAvg
  const a = (m: Meal) => Math.max(0, full(m) - (m === meal ? eaten : 0))
  const total = REST[meal].reduce((t, m) => t + a(m), 0)
  return { frac: REST[meal].length === 1 ? 1 : Math.min(1, Math.max(0.15, a(meal) / Math.max(1, total))), usual: full(meal), pattern: mean(per.get(meal)) !== null }
}

export type MealItem = { p: Portion; was?: Portion; kind: 'usual' | 'more' | 'less' | 'added'; delta: N }
export type NextMeal = { meal: Meal; topUp: boolean; target: Gap; later: Meal[]; usual: number; pattern: boolean; from?: string; items: MealItem[]; total: N; skipped: string[] }

const stepOf = (u: Unit) => (u === 'piece' ? 1 : u === 'g' || u === 'ml' ? 25 : 0.5)
/** Amounts from half to double of what you had, in steps people use. */
function gridAround(unit: Unit, orig: number): number[] {
  const s = stepOf(unit), lo = Math.max(s, Math.ceil(orig * 0.5 / s - 1e-9) * s), hi = Math.max(lo, Math.floor(orig * 2 / s + 1e-9) * s), out: number[] = []
  for (let x = lo; x <= hi + 1e-9; x += s) out.push(Math.round(x * 100) / 100)
  return out
}
const ADDONS = ['boiled-egg', 'egg-white', 'chicken-breast', 'paneer', 'greek-yogurt', 'curd', 'soya-chunks-boiled', 'tofu', 'protein-shake']

export function nextMeal(o: {
  remaining: Gap; meal: Meal; foods: Map<string, FoodItem>; habits: Map<string, Habit>; logs: FoodEntry[]; today: string; diet: Diet; dayKcal: number
}): NextMeal | null {
  const { remaining: rem, meal, foods } = o
  if (rem.kcal < 100) return null
  const todays = o.logs.filter((e) => e.date === o.today)
  const here = todays.filter((e) => mealOf(e) === meal)
  const topUp = here.length > 0 // this meal is already logged: fill the gap with small things, do not rebuild the meal
  const blocked = repeatBlocker({ eatenToday: todays, logs: o.logs, today: o.today })
  const room = eggRoom(todays)
  const capEgg = (f: FoodItem, qty: number, unit: Unit) => {
    if (!(f.id in room)) return qty
    return Math.min(qty, unit === 'g' ? room[f.id] * (f.id === 'egg-white' ? 33 : 50) : room[f.id])
  }
  const eatenHere = here.reduce((a, e) => a + e.kcal, 0)
  const sh = mealShare(o.logs, o.today, meal, o.dayKcal, eatenHere)
  const raw = rem.kcal * sh.frac
  const room1 = Math.max(0, 1.5 * sh.usual - eatenHere) // never plan a meal far bigger than you normally eat
  const k = sh.frac * Math.min(1, room1 / Math.max(1, raw))
  const target: Gap = { kcal: rem.kcal * k, p: Math.max(0, rem.p) * k, c: Math.max(0, rem.c) * k, f: Math.max(0, rem.f) * k }
  if (target.kcal < 80) return null

  // 1. start from the meal you usually have: of your last few, the one closest to the target, without foods you already had today.
  //    A meal that is already logged starts empty and is only topped up.
  const byDay = new Map<string, FoodEntry[]>(), from = shiftDate(o.today, -28)
  for (const e of o.logs) if (mealOf(e) === meal && e.date < o.today && e.date >= from) byDay.set(e.date, [...(byDay.get(e.date) ?? []), e])
  let base: { date: string; ps: Portion[]; skipped: string[] } | null = null, bestDist = Infinity
  if (!topUp) for (const [date, es] of [...byDay].sort((a, b) => b[0].localeCompare(a[0])).slice(0, 6)) {
    const ps: Portion[] = [], skipped: string[] = []
    for (const e of es) {
      const food = e.foodId ? foods.get(e.foodId) : undefined
      if (!food) continue
      if (blocked(food)) { skipped.push(food.name); continue }
      const unit = (e.unit ?? food.units[0]) as Unit, q = capEgg(food, e.qty, unit)
      const p = q > 0 ? portion(food, q, unit) : null
      if (p) ps.push(p)
    }
    const dist = Math.abs(sumN(ps).kcal - target.kcal)
    if (ps.length && dist < bestDist) { bestDist = dist; base = { date, ps, skipped } }
  }
  let start: Portion[] = []
  if (base) start = base.ps
  else if (!topUp) { // no usable history for this meal: begin with the usual suggestions
    const allowed = new Map([...foods].filter(([, f]) => !blocked(f)))
    start = withPairs(eatNext({ remaining: { kcal: rem.kcal, proteinG: rem.p }, meal, foods: allowed, habits: o.habits, diet: o.diet, limit: 2, fatLeft: rem.f, eggsLeft: room }))
  }
  if (!start.length && !topUp) return null

  // 2. nudge it toward the target: change a portion, or add eggs / chicken / paneer etc., whichever helps most (at most 4 changes)
  const T = { k: Math.max(150, target.kcal), p: Math.max(10, target.p), f: Math.max(10, target.f) }
  // Over the calorie aim costs 3x as much as under it; fat past what is left costs too (more so when fat is already over the day's goal).
  const cost = (n: N) => Math.max(0, target.kcal - n.kcal) / T.k + 3 * Math.max(0, n.kcal - target.kcal) / T.k + 2.5 * Math.max(0, target.p - n.p) / T.p +
    1.0 * Math.max(0, n.p - 1.15 * target.p) / T.p + (target.f > 0 ? 0.5 : 1.5) * Math.max(0, n.f - 1.25 * target.f - 3) / T.f
  const cap = 1.2 * target.kcal + 30 // a change that pushes the meal past this is not offered
  const fatCap = Math.max(0, rem.f) // hard limit: the meal never adds more fat than the day has left
  const within = (before: N, after: N) => (after.kcal <= cap || after.kcal <= before.kcal) && (after.f <= fatCap + 1e-6 || after.f < before.f - 1e-9)
  const items: { p: Portion; was?: Portion }[] = start.map((p) => ({ p, was: p }))
  const mine = [...o.habits].filter(([id]) => foods.has(id))
  const maxRank = Math.max(0, ...mine.map(([id]) => rank(foods.get(id)!)), o.diet === 'nonveg' || !o.diet ? 2 : o.diet === 'egg' ? 1 : 0)
  const MEATS = new Set(['chicken', 'fish', 'meat']) // not added to breakfast or a snack either
  const usable = (f: FoodItem | undefined): f is FoodItem => !!f && !blocked(f) && rank(f) <= maxRank && (o.diet !== 'jain' || !!f.jain) &&
    !(topUp && MAIN_DISH.has(f.category ?? '')) && !((meal === 'breakfast' || meal === 'snacks') && MEATS.has(f.category ?? ''))
  // Only foods you have logged: a food you never eat may not be something you can get. With almost no history, the common protein foods.
  const ids = new Set(mine.length >= 3 ? [...mine].filter(([, h]) => h.days >= 2).map(([id]) => id).concat(ADDONS.filter((id) => o.habits.has(id))) : ADDONS)
  // Added foods must be real protein foods (at least 20% of their calories from protein), so nobody gets "3 bananas" to hit a protein aim.
  const addons = [...ids].map((id) => foods.get(id)).filter(usable).filter((f) => (f.per100.p * 4) / Math.max(1, f.per100.kcal) >= 0.2 && !(f.units[0] === 'g' && f.per100.kcal > 380)) // not powders
  const maxAdd = topUp ? 3 : 2
  let added = 0
  for (let round = 0; round < 4; round++) {
    const total = sumN(items.map((i) => i.p)), here0 = cost(total)
    let best: { gain: number; apply: () => void } | null = null
    items.forEach((it, idx) => {
      if (!it.was || it.p.food.category === 'sweet') return
      for (const amt of gridAround(it.p.unit, it.was.amount)) {
        if (Math.abs(amt - it.p.amount) < 1e-9) continue
        const p2 = portion(it.p.food, amt, it.p.unit)
        if (!p2) continue
        if (!within(total, add(total, { kcal: p2.n.kcal - it.p.n.kcal, p: 0, c: 0, f: p2.n.f - it.p.n.f, fib: 0 }))) continue
        const gain = here0 - cost(add(add(ZERO, total), { kcal: p2.n.kcal - it.p.n.kcal, p: p2.n.p - it.p.n.p, c: p2.n.c - it.p.n.c, f: p2.n.f - it.p.n.f, fib: 0 })) - 0.01
        if (!best || gain > best.gain) best = { gain, apply: () => { items[idx] = { ...it, p: p2 } } }
      }
    })
    if (added < maxAdd) for (const f of addons) {
      if (items.some((i) => i.p.food.id === f.id)) continue
      const h = o.habits.get(f.id), unit = h && f.units.includes(h.unit) ? h.unit : f.units[0], s = stepOf(unit)
      const hi = capEgg(f, unit === 'piece' ? 4 : unit === 'g' || unit === 'ml' ? 200 : 1.5, unit)
      for (let amt = s; amt <= hi + 1e-9; amt += s) {
        const p2 = portion(f, Math.round(amt * 100) / 100, unit)
        if (!p2 || !within(total, add(total, p2.n))) continue
        const gain = here0 - cost(add(total, p2.n)) - 0.03 + (h ? 0.02 : 0)
        if (!best || gain > best.gain) best = { gain, apply: () => { items.push({ p: p2 }); added++ } }
      }
    }
    if (!best || best.gain < 0.04) break
    best.apply()
  }
  // The limit is absolute: if what we started from still has too much fat, cut the fattiest item down (or out) until it fits.
  for (;;) {
    const t = sumN(items.map((i) => i.p))
    if (t.f <= fatCap + 1e-6 || !items.length) break
    let k = 0
    items.forEach((it, i) => { if (it.p.n.f > items[k].p.n.f) k = i })
    const it = items[k], step1 = stepOf(it.p.unit), perUnit = it.p.n.f / it.p.amount
    const amt = Math.floor((it.p.amount - (t.f - fatCap) / perUnit) / step1 + 1e-9) * step1
    const p2 = amt >= step1 ? portion(it.p.food, Math.round(amt * 100) / 100, it.p.unit) : null
    if (p2) items[k] = { ...it, p: p2 }
    else items.splice(k, 1)
  }
  const out: MealItem[] = items.map((i) => {
    const kind = !i.was ? 'added' : i.p.amount > i.was.amount + 1e-9 ? 'more' : i.p.amount < i.was.amount - 1e-9 ? 'less' : 'usual'
    const d = i.was ? { kcal: i.p.n.kcal - i.was.n.kcal, p: i.p.n.p - i.was.n.p, c: i.p.n.c - i.was.n.c, f: i.p.n.f - i.was.n.f, fib: 0 } : i.p.n
    return { p: i.p, was: i.was, kind, delta: d }
  })
  if (!items.length) return null
  return { meal, topUp, target, later: REST[meal].slice(1), usual: sh.usual, pattern: sh.pattern, from: base?.date, items: out, total: sumN(out.map((i) => ({ n: i.p.n }))), skipped: [...new Set(base?.skipped ?? [])] }
}
// ── plan a day from the foods you have (built here, not ported): which food, at which meal, how much ──
export const MEAL_TIME: Record<Meal, string> = { breakfast: '8:00 am', lunch: '1:00 pm', snacks: '5:00 pm', dinner: '8:30 pm' }
const MEAT_CATS = new Set(['chicken', 'fish', 'meat'])
/** Share of the day's calories each of `meals` should hold: your own split over 28 days if you have one, else 25/35/10/30. Adds up to 1. */
export function daySplit(logs: FoodEntry[], today: string, dayKcal: number, meals: Meal[]): Record<Meal, number> {
  let left = 1
  const raw = {} as Record<Meal, number>
  for (const m of MEAL_ORDER) { raw[m] = left * mealShare(logs, today, m, dayKcal).frac; left -= raw[m] }
  const sum = meals.reduce((t, m) => t + raw[m], 0) || 1
  return Object.fromEntries(meals.map((m) => [m, raw[m] / sum])) as Record<Meal, number>
}
export type DayPlanMeal = { meal: Meal; aim: number; items: Portion[]; total: N }
export type DayPlan = { meals: DayPlanMeal[]; total: N; unused: string[]; notes: string[] }

/**
 * Spreads `foods` over `meals` so the day lands near the calorie, protein and carb targets and never past the fat limit.
 * Each food only goes in meals it suits (its own meal tags, or where you log it for your own foods). Oats-type foods and
 * other once-a-day foods appear once; eggs stop at the day's limit. Found by trying one change at a time and keeping the best,
 * so it is a good fit by my own scoring, not an optimum and not a rule from a paper.
 */
export function planDay(o: {
  foods: FoodItem[]; target: Gap & { fib: number }; meals: Meal[]; split: Record<Meal, number>; habits: Map<string, Habit>
  blocked: (f: FoodItem) => boolean; eggsLeft: Record<string, number>; diet: Diet
}): DayPlan {
  const T = o.target, fatCap = Math.max(0, T.f), fs = o.foods.filter((f) => !o.blocked(f) && dietOk(f, o.diet))
  type Cell = { m: number; f: FoodItem; lv: (Portion | null)[]; group: string | null }
  const cells: Cell[] = []
  o.meals.forEach((meal, m) => {
    for (const f of fs) {
      const h = o.habits.get(f.id)
      const suits = f.custom ? !(h && h.meals.size) || h.meals.has(meal) : !f.meals?.length || f.meals.includes(meal)
      if (!suits || ((meal === 'breakfast' || meal === 'snacks') && MEAT_CATS.has(f.category ?? ''))) continue
      const unit = h && f.units.includes(h.unit) ? h.unit : f.units[0], s = stepOf(unit)
      let hi = unit === 'piece' ? (f.category === 'fruit' ? 2 : 4) : unit === 'g' || unit === 'ml' ? 300 : 2
      if (h) hi = Math.min(hi, Math.max(s, Math.ceil((h.amount * 1.5) / s - 1e-9) * s)) // at most half as much again as you usually have
      if (MEAT_CATS.has(f.category ?? '')) hi = Math.min(hi, 200)
      if (f.id in o.eggsLeft) hi = Math.min(hi, unit === 'g' ? o.eggsLeft[f.id] * (f.id === 'egg-white' ? 33 : 50) : o.eggsLeft[f.id])
      const lv: (Portion | null)[] = [null]
      for (let a = s; a <= hi + 1e-9; a += s) { const p = portion(f, Math.round(a * 100) / 100, unit); if (p) lv.push(p) }
      const once = onceWords(f.name).length > 0 || f.category === 'fruit' || (!REPEATABLE.has(f.category ?? '') && !(h && h.meals.size >= 2))
      if (lv.length > 1) cells.push({ m, f, lv, group: once ? onceWords(f.name)[0] ?? f.id : null })
    }
  })
  const eggUnits = (p: Portion | null | undefined) => (!p ? 0 : p.unit === 'g' ? p.amount / (p.food.id === 'egg-white' ? 33 : 50) : p.amount)
  const aim = o.meals.map((m) => T.kcal * o.split[m])
  const cost = (tot: N[], cnt: number[]) => {
    const day = sumN(tot.map((n) => ({ n })))
    let c = 0
    tot.forEach((n, m) => {
      const pa = T.p * o.split[o.meals[m]]
      const ca = T.c * o.split[o.meals[m]]
      c += Math.abs(n.kcal - aim[m]) / Math.max(aim[m], 1) + Math.max(0, pa - n.p) / Math.max(pa, 1) + 2 * Math.max(0, n.p - 1.4 * pa) / Math.max(pa, 1) +
        0.7 * Math.abs(n.c - ca) / Math.max(ca, 1) + 0.05 * cnt[m]
    })
    return c + 6 * Math.abs(day.kcal - T.kcal) / Math.max(T.kcal, 1) +
      5 * Math.max(0, T.p - day.p) / Math.max(T.p, 1) + 3 * Math.max(0, day.p - 1.1 * T.p) / Math.max(T.p, 1) +
      4 * Math.max(0, day.c - T.c) / Math.max(T.c, 1) + 1.5 * Math.max(0, 0.9 * T.c - day.c) / Math.max(T.c, 1) +
      1.5 * Math.max(0, T.fib - day.fib) / Math.max(T.fib, 1)
  }
  const k = cells.map(() => 0)
  let tot = o.meals.map(() => ZERO), cnt = o.meals.map(() => 0), cur = cost(tot, cnt)
  for (let it = 0; it < 150; it++) {
    const fat = tot.reduce((a, n) => a + n.f, 0)
    let best: { i: number; j: number; tot: N[]; cnt: number[]; c: number } | null = null
    cells.forEach((cell, i) => {
      const was = cell.lv[k[i]]?.n ?? ZERO
      cell.lv.forEach((p, j) => {
        if (j === k[i]) return
        const now = p?.n ?? ZERO
        if (fat - was.f + now.f > fatCap + 1e-6 && now.f > was.f) return // fat is a hard limit
        if (cell.f.id in o.eggsLeft && p && eggUnits(p) + cells.reduce((n, x, xi) => n + (xi !== i && x.f.id === cell.f.id ? eggUnits(x.lv[k[xi]]) : 0), 0) > o.eggsLeft[cell.f.id] + 1e-9) return // eggs: a day limit, not per meal
        if (j > 0 && k[i] === 0 && (cnt[cell.m] >= 5 || (cell.group && cells.some((x, xi) => xi !== i && x.group === cell.group && k[xi] > 0)))) return
        const t2 = tot.slice(), c2 = cnt.slice()
        t2[cell.m] = { kcal: tot[cell.m].kcal - was.kcal + now.kcal, p: tot[cell.m].p - was.p + now.p, c: tot[cell.m].c - was.c + now.c, f: tot[cell.m].f - was.f + now.f, fib: tot[cell.m].fib - was.fib + now.fib }
        c2[cell.m] += (j > 0 ? 1 : 0) - (k[i] > 0 ? 1 : 0)
        const c = cost(t2, c2)
        if (!best || c < best.c) best = { i, j, tot: t2, cnt: c2, c }
      })
    })
    if (!best || (best as { c: number }).c > cur - 1e-4) break
    const b = best as { i: number; j: number; tot: N[]; cnt: number[]; c: number }
    k[b.i] = b.j; tot = b.tot; cnt = b.cnt; cur = b.c
  }
  const meals = o.meals.map((meal, m) => {
    const items = cells.flatMap((c, i) => (c.m === m && k[i] > 0 ? [c.lv[k[i]]!] : []))
    return { meal, aim: aim[m], items, total: sumN(items) }
  }).filter((m) => m.items.length)
  const total = sumN(meals.map((m) => ({ n: m.total })))
  const used = new Set(meals.flatMap((m) => m.items.map((p) => p.food.id)))
  const notes: string[] = []
  if (T.p - total.p > 8) notes.push(`Protein is ${Math.round(T.p - total.p)} g short with these foods. Add another protein food you eat.`)
  if (T.kcal - total.kcal > 100) notes.push(`Calories are ${Math.round(T.kcal - total.kcal)} short with these foods. Add more of a staple you eat, such as rice or roti.`)
  if (total.kcal - T.kcal > 100) notes.push(`Calories are ${Math.round(total.kcal - T.kcal)} over: these foods only fit in bigger portions than your target allows.`)
  if (T.fib - total.fib > 5) notes.push(`Fibre is ${Math.round(T.fib - total.fib)} g short. Foods you added yourself count as 0 g fibre, so the real figure is probably higher.`)
  return { meals, total, unused: o.foods.filter((f) => !used.has(f.id)).map((f) => f.name), notes }
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
