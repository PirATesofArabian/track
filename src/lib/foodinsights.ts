// Ported from Macrotrophy's targets / dayAnalysis chunks: usual meals, real maintenance, protein trend,
// calculated targets, target critique, day analysis.
import type { FoodEntry, Goal, Profile } from './db'
import { PROTEIN_PER_KG, splitMacros, targetRate } from './body'
import { daysBetween, parseDate, roundTo, shiftDate } from './util'

const KCAL_PER_KG = 7700
export const MIN_LOGGED_KCAL = 1000
const MEALS = ['Breakfast', 'Lunch', 'Snacks', 'Dinner'] as const

type Tot = { kcal: number; p: number; c: number; f: number; fib: number }
export function dayTotals(entries: FoodEntry[]): Map<string, Tot> {
  const m = new Map<string, Tot>()
  for (const e of entries) {
    const t = m.get(e.date) ?? { kcal: 0, p: 0, c: 0, f: 0, fib: 0 }
    t.kcal += e.kcal; t.p += e.p; t.c += e.c; t.f += e.f; t.fib += e.fib ?? 0
    m.set(e.date, t)
  }
  return m
}

// ── Usual meals (C) / recent + frequent foods (w, T) ──
const itemKey = (e: FoodEntry) => `${e.foodId ?? e.name}:${e.qty}:${e.unit ?? ''}:${e.size ?? ''}:${e.rich ?? ''}`
const setKey = (es: FoodEntry[]) => es.map(itemKey).sort().join('|')

export type MealSuggestion = { kind: 'usual' | 'previous'; date: string; items: FoodEntry[]; times: number }
/** The same item set logged on >=3 of the last 28 days for this meal is "usual"; plus the most recent different one. */
export function mealSuggestions(entries: FoodEntry[], meal: FoodEntry['meal'], date: string): MealSuggestion[] {
  const from = shiftDate(date, -28)
  const byDate = new Map<string, FoodEntry[]>()
  for (const e of entries) {
    if (e.meal !== meal || e.date >= date || e.date < from) continue
    const a = byDate.get(e.date) ?? []
    a.push(e)
    byDate.set(e.date, a)
  }
  const dates = [...byDate.keys()].sort().reverse()
  const sets = new Map<string, { n: number; date: string }>()
  for (const d of dates) {
    const k = setKey(byDate.get(d)!)
    const cur = sets.get(k)
    sets.set(k, { n: (cur?.n ?? 0) + 1, date: cur?.date ?? d })
  }
  const out: MealSuggestion[] = []
  const top = [...sets.entries()].sort((a, b) => b[1].n - a[1].n)[0]
  if (top && top[1].n >= 3) out.push({ kind: 'usual', date: top[1].date, items: byDate.get(top[1].date)!, times: top[1].n })
  const last = dates[0]
  if (last && (!out[0] || setKey(byDate.get(last)!) !== setKey(out[0].items))) out.push({ kind: 'previous', date: last, items: byDate.get(last)!, times: 1 })
  return out
}

function recentFoods(es: FoodEntry[], limit: number): FoodEntry[] {
  const seen = new Set<string>(), out: FoodEntry[] = []
  for (const e of [...es].sort((a, b) => (b.id ?? 0) - (a.id ?? 0))) {
    const k = e.foodId ?? e.name
    if (seen.has(k)) continue
    seen.add(k); out.push(e)
    if (out.length >= limit) break
  }
  return out
}
/** Last 5 foods for the meal, plus foods eaten on >=2 days in the last 28 (top 6). */
export function quickFoods(entries: FoodEntry[], meal: FoodEntry['meal'], date: string) {
  const forMeal = entries.filter((e) => e.meal === meal)
  const recent = recentFoods(forMeal.length ? forMeal : entries, 5)
  const skip = new Set(recent.map((e) => e.foodId ?? e.name))
  const from = shiftDate(date, -28)
  const m = new Map<string, { days: Set<string>; latest: FoodEntry }>()
  for (const e of forMeal) {
    const k = e.foodId ?? e.name
    if (e.date < from || e.date > date || skip.has(k)) continue
    const c = m.get(k)
    if (c) { c.days.add(e.date); if ((e.id ?? 0) > (c.latest.id ?? 0)) c.latest = e } else m.set(k, { days: new Set([e.date]), latest: e })
  }
  const usual = [...m.values()].filter((x) => x.days.size >= 2).sort((a, b) => b.days.size - a.days.size || (b.latest.id ?? 0) - (a.latest.id ?? 0)).slice(0, 6).map((x) => ({ log: x.latest, days: x.days.size }))
  return { recent, usual }
}

// ── Real maintenance (D) ──
export type TrendPt = { date: string; trendKg: number }
export function realMaintenance(logs: FoodEntry[], trend: TrendPt[], today: string) {
  const end = shiftDate(today, -1), start = shiftDate(end, -27)
  const days = [...dayTotals(logs.filter((e) => e.date >= start && e.date <= end)).values()].filter((d) => d.kcal >= MIN_LOGGED_KCAL)
  if (days.length < 14) return null
  const near = (d: string) => {
    let best: TrendPt | null = null
    for (const t of trend) {
      const gap = Math.abs(parseDate(t.date).getTime() - parseDate(d).getTime())
      if (gap <= 4 * 864e5 && (!best || gap < Math.abs(parseDate(best.date).getTime() - parseDate(d).getTime()))) best = t
    }
    return best
  }
  const a = near(start), b = near(end)
  if (!a || !b || a === b) return null
  const span = daysBetween(a.date, b.date)
  if (span < 14) return null
  const mean = days.reduce((s, d) => s + d.kcal, 0) / days.length
  const change = b.trendKg - a.trendKg
  return { kcal: Math.round((mean - (KCAL_PER_KG * change) / span) / 10) * 10, meanIntake: Math.round(mean), loggedDays: days.length, days: span, changeKg: change }
}

/** Provisional maintenance for the first weeks: the same formula over whatever window you have (>= 7 logged days and >= 7 days between trend points).
 *  Shown on its own, never fed into targets or verdicts: a few days of weight is mostly water, so treat it as rough. */
export function provisionalMaintenance(logs: FoodEntry[], trend: TrendPt[], today: string) {
  if (!trend.length) return null
  const end = shiftDate(today, -1)
  const first = trend.reduce((m, t) => (t.date < m ? t.date : m), trend[0].date)
  const days = [...dayTotals(logs.filter((e) => e.date >= first && e.date <= end)).values()].filter((d) => d.kcal >= MIN_LOGGED_KCAL)
  if (days.length < 7) return null
  const a = trend.find((t) => t.date === first)
  let b: TrendPt | null = null
  for (const t of trend) if (t.date <= end && (!b || t.date > b.date)) b = t
  if (!a || !b) return null
  const span = daysBetween(a.date, b.date)
  if (span < 7) return null
  const mean = days.reduce((s, d) => s + d.kcal, 0) / days.length
  const change = b.trendKg - a.trendKg
  return { kcal: Math.round((mean - (KCAL_PER_KG * change) / span) / 10) * 10, meanIntake: Math.round(mean), loggedDays: days.length, days: span, changeKg: change, wobbleKcal: Math.round((0.5 * KCAL_PER_KG) / span / 10) * 10 }
}

// ── Protein trend (O) ──
export function proteinTrend(a: { logs: FoodEntry[]; today: string; days: number; proteinTargetG: number | null; trainingDates: Set<string> }) {
  const from = shiftDate(a.today, -(a.days - 1))
  const logs = a.logs.filter((e) => e.date >= from && e.date <= a.today)
  const tot = dayTotals(logs)
  const series: { date: string; kcal: number; proteinG: number }[] = []
  for (let i = a.days - 1; i >= 0; i--) {
    const d = shiftDate(a.today, -i), t = tot.get(d)
    if (t) series.push({ date: d, kcal: t.kcal, proteinG: t.p })
  }
  const full = series.filter((s) => s.date !== a.today && s.kcal >= MIN_LOGGED_KCAL)
  const avg = full.length ? full.reduce((s, d) => s + d.proteinG, 0) / full.length : null
  const mean = (xs: number[]) => (xs.length >= 3 ? Math.round(xs.reduce((s, x) => s + x, 0) / xs.length) : null)
  const byFood = new Map<string, number>()
  for (const e of logs) byFood.set(e.name, (byFood.get(e.name) ?? 0) + e.p)
  return {
    days: a.days, loggedDays: full.length, avg,
    proteinHitDays: a.proteinTargetG === null ? 0 : full.filter((d) => d.proteinG >= a.proteinTargetG!).length,
    proteinTraining: mean(full.filter((d) => a.trainingDates.has(d.date)).map((d) => d.proteinG)),
    proteinRest: mean(full.filter((d) => !a.trainingDates.has(d.date)).map((d) => d.proteinG)),
    series,
    topProtein: [...byFood.entries()].sort((x, y) => y[1] - x[1]).slice(0, 5).map(([foodName, p]) => ({ foodName, proteinG: Math.round(p) })),
  }
}

// ── Calculated targets (F, H, P) ──
const r5 = (n: number) => roundTo(n, 5)
export const waterFor = (kg: number | null) => (!kg || kg <= 0 ? null : Math.min(4500, Math.max(1500, roundTo(35 * kg, 250))))
export type Targets = { kcal: number; p: number; c: number; f: number; fib: number; waterMl: number | null }
export function calcTargets(e: { targetKcal: number; protein: [number, number] } | null, weightKg: number | null): Targets | null {
  if (!e) return null
  const kcal = e.targetKcal, p = Math.round((e.protein[0] + e.protein[1]) / 2)
  const { fat, carbs } = splitMacros(kcal, weightKg ?? 0, p)
  return { kcal, p, c: carbs, f: fat, fib: Math.round((14 * kcal) / 1000), waterMl: waterFor(weightKg) }
}
/** H: macros for a chosen kcal. Pass fixed values to keep them. */
export function macrosForKcal(a: { kcal: number; weightKg: number | null; goal: Goal; fixed?: { p?: number; c?: number; f?: number } }) {
  const { kcal, weightKg, goal } = a, fx = a.fixed ?? {}
  const kg = weightKg && weightKg > 0 ? weightKg : null
  const [lo, hi] = PROTEIN_PER_KG[goal]
  const proteinFrac: Record<Goal, number> = { hypertrophy: 0.25, strength_hypertrophy: 0.25, strength: 0.25, fat_loss: 0.3, recomposition: 0.3, general_fitness: 0.2 }
  const p = fx.p ?? Math.round(kg ? ((lo + hi) / 2) * kg : (proteinFrac[goal] * kcal) / 4)
  const left = (x: { p: number; c?: number; f?: number }) => kcal - x.p * 4 - (x.c ?? 0) * 4 - (x.f ?? 0) * 9
  let f: number, c: number
  if (fx.f != null) { f = fx.f; c = fx.c ?? Math.max(0, r5(left({ p, f }) / 4)) }
  else if (fx.c != null) { c = fx.c; f = Math.max(0, r5(left({ p, c }) / 9)) }
  else {
    const sp = splitMacros(kcal, kg ?? 0, p)
    if (left({ p, f: sp.fat }) >= 0) { f = sp.fat; c = sp.carbs }
    else { c = 0; f = Math.max(0, r5(left({ p }) / 9)) }
  }
  return { p, c, f, fib: Math.round((14 * kcal) / 1000) }
}

// ── Target critique (u in the targets chunk) ──
export type Critique = { id: string; tone: 'good' | 'warn' | 'info'; title: string; body: string; suggestKcal?: number; suggestProteinG?: number }
const sgn = (v: number) => `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v).toFixed(2)} kg`
const pct = (v: number) => `${(Math.abs(v) * 100).toFixed(1)}%`
const n0 = (v: number) => Math.round(v).toLocaleString('en-GB')
const kcalFor = (tdee: number, kgPerWeek: number) => roundTo(tdee + (kgPerWeek * KCAL_PER_KG) / 7, 50)

export function critiqueTargets(a: {
  targets: { kcal: number | null; p: number | null }
  tdee: number | null; weightKg: number | null; rateKgPerWeek: number | null
  goal: Goal; experience: Profile['experience']; liftRates: number[]
}): Critique[] {
  const out: Critique[] = [], { targets: t, tdee, weightKg: kg, goal, rateKgPerWeek: rate } = a
  const [v, y] = targetRate(goal, a.experience)
  if (t.kcal !== null && tdee && kg) {
    const diff = t.kcal - tdee, pred = ((t.kcal - tdee) * 7) / KCAL_PER_KG, frac = pred / kg, mid = (v + y) / 2
    const aim = kcalFor(tdee, mid * kg), tol = 5e-4
    out.push({
      id: 'energy_rate', tone: 'info',
      title: Math.abs(diff) < 100 ? 'Your target is about maintenance' : `${n0(Math.abs(diff))} kcal ${diff < 0 ? 'below' : 'above'} maintenance`,
      body: Math.abs(diff) < 100
        ? `Your target of ${n0(t.kcal)} kcal is within 100 of your estimated maintenance (${n0(tdee)}), so your weight should hold steady.`
        : `Your target of ${n0(t.kcal)} kcal against an estimated maintenance of ${n0(tdee)} predicts about ${sgn(pred)} a week (${pct(frac)} of your body weight), from about 7,700 kcal per kg.`,
    })
    if (frac >= v - tol && frac <= y + tol) out.push({ id: 'energy_goal', tone: 'good', title: 'The right size for your goal', body: `That rate is inside the ${pct(v)} to ${pct(y)} of body weight a week that the evidence supports for your goal.` })
    else if (goal === 'fat_loss' && frac < v) out.push({ id: 'energy_goal', tone: 'warn', title: 'A deficit this big costs muscle', body: `Losing more than 1% of body weight a week loses more muscle and strength in lifters. About ${n0(aim)} kcal would aim for ${pct(mid)} a week instead.`, suggestKcal: aim })
    else if ((goal === 'fat_loss' || goal === 'recomposition') && frac > y) out.push({ id: 'energy_goal', tone: 'warn', title: diff >= 0 ? 'No deficit for fat loss' : 'A very small deficit', body: `Your goal needs your weight to come down, but this target ${diff >= 0 ? 'is at or above maintenance' : 'predicts very little loss'}. About ${n0(aim)} kcal would aim for ${pct(mid)} a week.`, suggestKcal: aim })
    else if (frac > y) out.push({ id: 'energy_goal', tone: 'warn', title: 'More surplus than you can build', body: `Gaining faster than about ${pct(y)} of body weight a week at your training age adds mostly fat, not more muscle. About ${n0(aim)} kcal would aim for ${pct(mid)} a week.`, suggestKcal: aim })
    else out.push({ id: 'energy_goal', tone: 'warn', title: frac < 0 ? 'A deficit while trying to build' : 'Less than your goal needs', body: `For your goal, about ${pct(v)} to ${pct(y)} of body weight a week is the aim. This target predicts ${frac < 0 ? 'losing weight' : 'slower gains'}. About ${n0(aim)} kcal would aim for ${pct(mid)} a week.`, suggestKcal: aim })

    if (rate !== null) {
      const real = t.kcal - (rate * KCAL_PER_KG) / 7
      if (Math.abs(rate - pred) > 0.2) {
        const k = kcalFor(real, mid * kg)
        out.push({ id: 'maintenance', tone: 'info', title: 'Your weight says your maintenance is different', body: `Your 7-day average is changing ${sgn(rate)} a week, where your target predicts ${sgn(pred)}. If you have been eating close to ${n0(t.kcal)} kcal, your real maintenance is about ${n0(roundTo(real, 50))}, not ${n0(tdee)}. For your goal that means about ${n0(k)} kcal.`, suggestKcal: k })
      } else out.push({ id: 'maintenance', tone: 'good', title: 'Your weight matches your target', body: `Your 7-day average is changing ${sgn(rate)} a week, close to the ${sgn(pred)} your target predicts. The maintenance estimate fits you.` })
    }
    if (diff <= -100 && a.liftRates.length >= 2) {
      const down = a.liftRates.filter((x) => x < 0).length
      if (down > a.liftRates.length / 2) out.push({ id: 'strength', tone: 'warn', title: 'Your lifts are dropping in this deficit', body: `Estimated 1RM is falling on ${down} of ${a.liftRates.length} lifts over the last 8 weeks. A smaller deficit (about ${n0(roundTo(t.kcal + 250, 50))} kcal) or a week at maintenance usually stops the slide; keep protein high.`, suggestKcal: roundTo(t.kcal + 250, 50) })
      else out.push({ id: 'strength', tone: 'good', title: 'Strength is holding in the deficit', body: `Estimated 1RM is steady or rising on ${a.liftRates.length - down} of ${a.liftRates.length} lifts over the last 8 weeks, so the deficit is not costing you strength.` })
    }
  }
  if (t.p !== null && kg) {
    const per = t.p / kg, [lo, hi] = PROTEIN_PER_KG[goal]
    const txt = `${per.toFixed(1)} g per kg (${roundTo(t.p, 1)} g a day)`
    if (per < lo - 0.05) {
      const g = r5(lo * kg)
      out.push({ id: 'protein', tone: 'warn', title: 'Protein below the useful range', body: `Your target is ${txt}. For your goal the evidence points to ${lo} to ${hi} g per kg; below ${lo} you build less muscle${goal === 'fat_loss' ? ' and keep less of it in a deficit' : ''}. Aim for at least ${g} g.`, suggestProteinG: g })
    } else if (per > 3) out.push({ id: 'protein', tone: 'info', title: 'More protein than you need', body: `Your target is ${txt}. No study found extra benefit above about ${hi} g per kg. It does no harm in healthy people, but those calories could be carbohydrate for training.` })
    else out.push({ id: 'protein', tone: 'good', title: 'Protein in range', body: `Your target is ${txt}, inside or near the ${lo} to ${hi} g per kg the evidence supports for your goal.` })
  }
  return out
}

// ── Day analysis (dayAnalysis chunk) ──
export type Verdict = 'low' | 'high' | 'in_range'
const verdict = (v: number, [lo, hi]: [number, number]): Verdict => (v < lo ? 'low' : v > hi ? 'high' : 'in_range')
const r1 = (v: number) => Math.round(v * 10) / 10
const RANGE = { protein: [10, 35], carbs: [45, 65], fat: [20, 35] } as const
export const PROTEIN_DOSE_PER_KG = 0.4

export function analyseDay(a: {
  logs: FoodEntry[]; date: string; today: string; weightKg: number | null; kcalTarget: number | null
  maintenanceKcal: number | null; proteinRangeGPerKg: [number, number] | null; trainingDay: boolean
}) {
  const es = a.logs.filter((e) => e.date === a.date)
  if (!es.length) return null
  const sum = (k: 'kcal' | 'p' | 'c' | 'f' | 'fib') => es.reduce((s, e) => s + (e[k] ?? 0), 0)
  const kcal = Math.round(sum('kcal')), p = sum('p'), c = sum('c'), f = sum('f'), fib = sum('fib')
  const kg = a.weightKg && a.weightKg > 0 ? a.weightKg : null
  const of = a.kcalTarget ? kcal / a.kcalTarget : null
  const energy = { target: a.kcalTarget, ofTarget: of === null ? null : Math.round(of * 100) / 100, verdict: of === null ? null : verdict(of, [0.9, 1.1]), vsMaintenance: a.maintenanceKcal ? kcal - Math.round(a.maintenanceKcal) : null }
  const total = p * 4 + c * 4 + f * 9
  const share = (x: number) => (total > 0 ? Math.round((x / total) * 100) : 0)
  const rng = (v: number, r: readonly [number, number]) => ({ value: v, range: r, verdict: verdict(v, [r[0], r[1]]) })
  const split = total > 0 ? { protein: rng(share(p * 4), RANGE.protein), carbs: rng(share(c * 4), RANGE.carbs), fat: rng(share(f * 9), RANGE.fat) } : null
  const perKg = kg && a.proteinRangeGPerKg ? { ...rng(r1(p / kg), a.proteinRangeGPerKg), range: a.proteinRangeGPerKg } : null
  let spread: { meals: string[]; reached: string[]; doseG: number } | null = null
  if (kg) {
    const dose = Math.round(PROTEIN_DOSE_PER_KG * kg)
    const meals = MEALS.filter((m) => es.some((e) => e.meal === m))
    spread = { meals: [...meals], reached: meals.filter((m) => es.filter((e) => e.meal === m).reduce((s, e) => s + e.p, 0) >= dose), doseG: dose }
  }
  const fibTarget = Math.round((14 * kcal) / 1000)
  const fibre = { value: r1(fib), target: fibTarget, verdict: (fib >= fibTarget ? 'in_range' : 'low') as Verdict }
  const trainingCarbs = a.trainingDay && kg ? rng(r1(c / kg), [4, 7]) : null
  return { kcal, energy, split, proteinPerKg: perKg, proteinSpread: spread, fibre, trainingCarbs, partial: a.date === a.today }
}
