// Weekly report engine, ported from the Macrotrophy bundle (weekly chunk, function T and helpers).
// Constants and thresholds are theirs. Messages come in English and Hinglish.
import type { BodyWeight, FoodEntry, GoalRec, Measurement, Workout } from './db'
import { MUSCLES, type Muscle } from '../data/exerciseDb'
import { e1rm, isWork, muscleSets, setVolume, type ExIndex } from './perf'
import { shiftDate, parseDate } from './util'
import { workoutMinutes } from './derived'

const KCAL_PER_KG = 7700
const MIN_FOOD_KCAL = 1000
const KCAL_TOL = 0.1
const PROTEIN_OK = 0.9
const REAL_CHANGE = 0.05
const MEAL_G_PER_KG = 0.4
const FAT_LOSS_BAND = [0.5, 1]
const g1 = (e: number) => Math.round(e * 10) / 10
const mean = (e: number[]) => (e.length ? e.reduce((a, b) => a + b, 0) / e.length : null)
const plural = (n: number, s: string, p = `${s}s`) => (n === 1 ? s : p)
const MEALS = ['breakfast', 'lunch', 'snacks', 'dinner'] as const
export type MealKey = (typeof MEALS)[number]
const MUSCLE_LABEL: Record<string, string> = { chest: 'Chest', back: 'Back', shoulders: 'Shoulders', biceps: 'Biceps', triceps: 'Triceps', quads: 'Quads', hamstrings: 'Hamstrings', glutes: 'Glutes', calves: 'Calves', abs: 'Abs', adductors: 'Adductors', cardio: 'Cardio' }
export const muscleLabel = (m: string) => MUSCLE_LABEL[m] ?? `${m.charAt(0).toUpperCase()}${m.slice(1).replace(/_/g, ' ')}`

/** Two-sided Fisher exact test on [[a,b],[c,d]] (their `S`). */
export function fisherExact(a0: number, b0: number, c0: number, d0: number): number {
  const lf = (n: number) => { let t = 0; for (let k = 2; k <= n; k++) t += Math.log(k); return t }
  const a = a0 + b0, o = c0 + d0, s = a0 + c0, c = a + o
  const lp = (x: number) => lf(a) + lf(o) + lf(s) + lf(c - s) - lf(c) - lf(x) - lf(a - x) - lf(s - x) - lf(o - s + x)
  const base = lp(a0)
  let sum = 0
  for (let x = Math.max(0, s - o); x <= Math.min(a, s); x++) { const v = lp(x); if (v <= base + 1e-7) sum += Math.exp(v) }
  return Math.min(1, sum)
}

export type Status = 'good' | 'close' | 'off' | 'none'
export type Pillar = { status: Status; label: string; detail: string }
export type ActionCheck =
  | { kind: 'sessions'; min: number }
  | { kind: 'muscleSessions'; muscle: string; min: number }
  | { kind: 'mealProtein'; meal: MealKey; minG: number; days: number }
  | { kind: 'proteinDays'; min: number }
  | { kind: 'calorieDays'; min: number }
  | { kind: 'trainingCarbs'; minGPerKg: number }
export type Action = { id: string; title: string; titleHi: string; detail: string; checkText: string; check: ActionCheck }
export type Finding = { id: string; label: 'established' | 'early'; title: string; saw: string; why: string; evidence: string[]; pattern?: { aDone: number; aN: number; bDone: number; bN: number; p: number } }
export type Graded = { title: string; done: boolean; result: string }
export type WeeklyReport = {
  version: 1; weekStart: string; weekEnd: string; madeAt: string
  enough: { training: boolean; food: boolean }
  counts: { sessions: number; planned: number | null; calorieDays: number | null; proteinDays: number | null; foodDays: number; weighIns: number; records: number }
  pillars: { training: Pillar; nutrition: Pillar; body: Pillar }
  verdict: { en: string; hi: string }
  win: { big: string; title: string; detail: string } | null
  tiles: { key: string; value: number; usual: number | null }[]
  days: { date: string; weekday: number; session: string | null; kcal: number | null; proteinG: number | null; weightKg: number | null; kcalOk: boolean | null; proteinOk: boolean | null }[]
  targets: { kcal: number | null; proteinG: number | null; maintenance: number | null }
  lifts: { exerciseKey: string; name: string; weeks: (number | null)[]; now: number; base: number; pct: number; real: boolean }[]
  muscles: { muscle: string; sets: number; usual: number | null; sessions: number }[]
  body: null | {
    points: { date: string; kg: number; trend: number | null }[]; weekMean: number | null; lastWeekMean: number | null; changeKg: number | null; ratePct: number | null; fatLoss: boolean
    band: { start: string; startKg: number } | null
    projection: { targetKg: number; weeksLo: number; weeksHi: number; goalDate: string | null | undefined } | null
  }
  energy: null | { meanIntake: number; changeKgPerWeek: number; maintenance: number; plannedDeficit: number | null; actualDeficit: number }
  nutrition: null | {
    proteinAvg: number; proteinTarget: number | null; proteinPerKg: number | null; loggedDays: number; calorieAvg: number; calorieDays: number | null; caloriePct: number | null
    meals: { meal: MealKey; avgG: number; days: number }[]; mealAim: number | null; fibreAvg: number; fibreAim: number; carbsTraining: number | null; carbsRest: number | null
  }
  findings: Finding[]
  actions: Action[]
  lastWeek: Graded[] | null
  inputs: { key: string; label: string; has: boolean; unlock: string }[]
}

export type WeeklyInput = {
  weekStart: string // Monday, YYYY-MM-DD
  idx: ExIndex
  workouts: Workout[]
  logs: FoodEntry[]
  weights: BodyWeight[]
  measurements: Measurement[]
  goals: GoalRec[]
  targets: { kcal: number | null; proteinG: number | null }
  ownTargets: boolean
  fatLoss: boolean
  planned: number | null
  previousActions?: Action[] | null
  now?: Date
}

/** Monday on or before `date`. */
export function mondayOf(date: string): string {
  const d = parseDate(date)
  const back = (d.getDay() + 6) % 7
  return shiftDate(date, -back)
}

type DayTot = { kcal: number; p: number; c: number; fib: number }
const dayTotals = (logs: FoodEntry[]) => {
  const m = new Map<string, DayTot>()
  for (const n of logs) {
    const e = m.get(n.date) ?? { kcal: 0, p: 0, c: 0, fib: 0 }
    e.kcal += n.kcal; e.p += n.p; e.c += n.c; e.fib += n.fib ?? 0
    m.set(n.date, e)
  }
  return m
}
const mealOf = (n: FoodEntry) => n.meal.toLowerCase() as MealKey

function bestE1rmIn(w: Workout, key: string, idx: ExIndex): number | null {
  let best: number | null = null
  for (const ex of w.exercises) {
    if (ex.key !== key || idx.get(ex.key, ex.name).tracking !== 'weight_reps') continue
    for (const s of ex.sets) {
      if (!isWork(s) || !s.weightKg || !s.reps || s.reps > 10) continue
      const v = e1rm(s.weightKg, s.reps, null)
      if (v !== null && (best === null || v > best)) best = v
    }
  }
  return best
}

export function buildWeeklyReport(r: WeeklyInput): WeeklyReport {
  const { idx } = r
  const a = r.weekStart, s = shiftDate(a, 7)
  const all = r.workouts.filter((w) => w.finishedAt && w.date < s).sort((x, y) => x.date.localeCompare(y.date) || x.startedAt - y.startedAt)
  const inRange = (d: string, from: string, to: string) => d >= from && d < to
  const week = all.filter((w) => inRange(w.date, a, s))
  const first = all[0]?.date ?? null
  const hasHistory = !!first && first <= shiftDate(a, -28)
  const prior = [1, 2, 3, 4].map((i) => all.filter((w) => inRange(w.date, shiftDate(a, -7 * i), shiftDate(a, -7 * (i - 1)))))
  const D = dayTotals(r.logs.filter((n) => n.date < s))
  const days7 = Array.from({ length: 7 }, (_, i) => shiftDate(a, i))
  const logged = days7.filter((d) => (D.get(d)?.kcal ?? 0) >= MIN_FOOD_KCAL)
  const kT = r.targets.kcal || null, pT = r.targets.proteinG || null
  const kcalOk = (d: string) => (kT ? Math.abs(D.get(d)!.kcal / kT - 1) <= KCAL_TOL : null)
  const protOk = (d: string) => (pT ? D.get(d)!.p >= pT * PROTEIN_OK : null)
  const calorieDays = kT ? logged.filter((d) => kcalOk(d)).length : null
  const proteinDays = pT ? logged.filter((d) => protOk(d)).length : null

  // weights: last reading per day
  const wByDay = new Map<string, number>()
  const wSorted = [...r.weights].filter((x) => x.date < s).sort((x, y) => x.date.localeCompare(y.date) || (x.id ?? 0) - (y.id ?? 0))
  for (const x of wSorted) wByDay.set(x.date, x.kg)
  const weighIns = days7.filter((d) => wByDay.has(d))
  const L = (from: string) => { const v = Array.from({ length: 7 }, (_, i) => shiftDate(from, i)).filter((d) => wByDay.has(d)); return v.length >= 3 ? mean(v.map((d) => wByDay.get(d)!)) : null }
  const cnt = (from: string) => Array.from({ length: 7 }, (_, i) => shiftDate(from, i)).filter((d) => wByDay.has(d)).length
  const R = L(a) ?? (wSorted.length ? wSorted[wSorted.length - 1].kg : null)

  const enough = { training: week.length >= 2, food: logged.length >= 3 }
  const records = countRecords(all, idx, a, s)

  const stats = (ws: Workout[]) => {
    let hard = 0, volume = 0, sets = 0
    const rirs: number[] = []
    for (const w of ws) for (const e of w.exercises) {
      const x = idx.get(e.key, e.name)
      for (const st of e.sets) { if (!isWork(st)) continue; sets++; if (st.rir === null || st.rir <= 4) hard++; volume += setVolume(st, x); if (st.rir !== null) rirs.push(st.rir) }
    }
    return { hard, volume, minutes: ws.reduce((t, w) => t + workoutMinutes(w), 0), rirs, sets }
  }
  const usualOf = (vals: number[]) => (hasHistory && vals.length === 4 ? mean(vals) : null)
  const V = stats(week), H = prior.map(stats)
  const tiles: WeeklyReport['tiles'] = []
  if (enough.training) {
    tiles.push({ key: 'hardSets', value: V.hard, usual: usualOf(H.map((h) => h.hard)) })
    tiles.push({ key: 'volume', value: V.volume, usual: usualOf(H.map((h) => h.volume)) })
    tiles.push({ key: 'minutes', value: V.minutes, usual: usualOf(H.map((h) => h.minutes)) })
    if (V.rirs.length) tiles.push({ key: 'effort', value: g1(mean(V.rirs)!), usual: null })
  }
  if (enough.food) {
    tiles.push({ key: 'kcal', value: Math.round(mean(logged.map((d) => D.get(d)!.kcal))!), usual: null })
    tiles.push({ key: 'protein', value: Math.round(mean(logged.map((d) => D.get(d)!.p))!), usual: null })
  }

  const days = days7.map((d, i) => {
    const sess = week.find((w) => w.date === d)
    const o = D.get(d), ok = (o?.kcal ?? 0) >= MIN_FOOD_KCAL
    return { date: d, weekday: (parseDate(a).getDay() + i) % 7, session: sess ? sess.name : null, kcal: ok ? Math.round(o!.kcal) : null, proteinG: ok ? Math.round(o!.p) : null, weightKg: wByDay.get(d) ?? null, kcalOk: ok ? kcalOk(d) : null, proteinOk: ok ? protOk(d) : null }
  })

  // lift e1RM trend over 8 weeks
  const lifts: WeeklyReport['lifts'] = []
  const from49 = shiftDate(a, -49)
  const recent = all.filter((w) => w.date >= from49 && w.date < s)
  const counts = new Map<string, number>()
  for (const w of recent) for (const e of w.exercises) if (idx.get(e.key, e.name).tracking === 'weight_reps' && e.sets.some(isWork)) counts.set(e.key, (counts.get(e.key) ?? 0) + 1)
  for (const [key] of [...counts.entries()].filter(([, n]) => n >= 3).sort((x, y) => y[1] - x[1])) {
    if (lifts.length >= 3) break
    const weeks = Array.from({ length: 8 }, (_, i) => {
      const st = shiftDate(a, -7 * (7 - i)), en = shiftDate(st, 7)
      const v = recent.filter((w) => inRange(w.date, st, en)).map((w) => bestE1rmIn(w, key, idx)).filter((x): x is number => x !== null)
      return v.length ? g1(Math.max(...v)) : null
    })
    const now = weeks[7] ?? weeks[6], base = weeks[3] ?? weeks[2] ?? weeks[4]
    if (now == null || base == null) continue
    const pct = (now / base - 1) * 100
    lifts.push({ exerciseKey: key, name: idx.get(key).name, weeks, now, base, pct: g1(pct), real: Math.abs(pct) >= REAL_CHANGE * 100 })
  }

  // muscles
  const mWeek = muscleSets(all, idx, a, shiftDate(a, 6))
  const mPrior = prior.map((_, i) => { const st = shiftDate(a, -7 * (i + 1)); return new Map(muscleSets(all, idx, st, shiftDate(st, 6)).map((m) => [m.muscle, m.weighted])) })
  const sessionsFor = (m: Muscle) => week.filter((w) => w.exercises.some((e) => idx.get(e.key, e.name).primary === m && e.sets.some((st) => isWork(st) && (st.rir === null || st.rir <= 4)))).length
  const muscles: WeeklyReport['muscles'] = enough.training
    ? (MUSCLES as readonly Muscle[]).map((m) => {
        const w = mWeek.find((x) => x.muscle === m)!.weighted
        return { muscle: m, sets: g1(w), usual: hasHistory ? g1(mean(mPrior.map((p) => p.get(m) ?? 0))!) : null, sessions: sessionsFor(m) }
      }).filter((m) => m.sets > 0 || (m.usual ?? 0) >= 2).sort((x, y) => y.sets - x.sets)
    : []

  // body
  let K: WeeklyReport['body'] = null
  if (wSorted.length >= 3) {
    const e0 = shiftDate(a, -21)
    const n = [...wByDay.entries()].filter(([d]) => d >= e0 && d < s).sort(([x], [y]) => x.localeCompare(y))
    const points = n.map(([d, kg]) => {
      const v = n.filter(([x]) => x <= d && x >= shiftDate(d, -6)).map(([, k]) => k)
      return { date: d, kg, trend: v.length >= 3 ? g1(mean(v)!) : null }
    })
    const o = L(a), c = L(shiftDate(a, -7))
    const l = o !== null && c !== null ? g1(o - c) : null
    const u = l !== null && c ? g1((l / c) * 100) : null
    const d4 = [0, 1, 2, 3].map((i) => L(shiftDate(a, -7 * i)))
    const f = d4[3]
    const goal = r.goals.find((x) => x.kind === 'body_weight' && !x.achievedAt) ?? null
    let proj: NonNullable<WeeklyReport['body']>['projection'] = null
    if (goal && d4.every((x) => x !== null) && o !== null) {
      const ch = [0, 1, 2].map((i) => d4[i]! - d4[i + 1]!)
      const t = goal.targetValue - o
      const nn = ch.filter((x) => Math.sign(x) === Math.sign(t) && Math.abs(x) > 0.02)
      if (nn.length === 3 && Math.abs(t) > 0.2) {
        const fast = Math.max(...nn.map(Math.abs)) * 1.2, slow = Math.min(...nn.map(Math.abs)) * 0.8
        proj = { targetKg: goal.targetValue, weeksLo: Math.max(1, Math.round(Math.abs(t) / fast)), weeksHi: Math.max(1, Math.round(Math.abs(t) / slow)), goalDate: goal.targetDate }
      }
    }
    K = { points, weekMean: o === null ? null : g1(o), lastWeekMean: c === null ? null : g1(c), changeKg: l, ratePct: u, fatLoss: r.fatLoss, band: r.fatLoss && f != null ? { start: shiftDate(a, -21), startKg: g1(f) } : null, projection: proj }
  }

  // real maintenance
  let energy: WeeklyReport['energy'] = null
  {
    const win = Array.from({ length: 28 }, (_, i) => shiftDate(a, i - 21)).filter((d) => (D.get(d)?.kcal ?? 0) >= MIN_FOOD_KCAL)
    const n = L(shiftDate(a, -21)), rr = L(a)
    if (win.length >= 14 && n !== null && rr !== null) {
      const intake = Math.round(mean(win.map((d) => D.get(d)!.kcal))!)
      const slope = (rr - n) / 3
      const maint = Math.round((intake - (slope * KCAL_PER_KG) / 7) / 10) * 10
      energy = { meanIntake: intake, changeKgPerWeek: g1(slope), maintenance: maint, plannedDeficit: kT ? maint - kT : null, actualDeficit: Math.round((-slope * KCAL_PER_KG) / 7 / 10) * 10 }
    }
  }

  // nutrition
  let q: WeeklyReport['nutrition'] = null
  if (enough.food) {
    const weekLogs = r.logs.filter((n) => logged.includes(n.date))
    const meals = MEALS.map((m) => {
      const v = logged.map((d) => weekLogs.filter((n) => n.date === d && mealOf(n) === m).reduce((t, n) => t + n.p, 0)).filter((x) => x > 0)
      return { meal: m, avgG: Math.round(mean(v) ?? 0), days: v.length }
    }).filter((m) => m.days >= 2)
    const trainDays = new Set(week.map((w) => w.date))
    const carbsPerKg = (ds: string[]) => (R && ds.length >= 2 ? g1(mean(ds.map((d) => D.get(d)!.c))! / R) : null)
    const kAvg = mean(logged.map((d) => D.get(d)!.kcal))!
    q = {
      proteinAvg: Math.round(mean(logged.map((d) => D.get(d)!.p))!), proteinTarget: pT, proteinPerKg: R ? g1(mean(logged.map((d) => D.get(d)!.p))! / R) : null,
      loggedDays: logged.length, calorieAvg: Math.round(kAvg), calorieDays, caloriePct: kT ? Math.round((kAvg / kT - 1) * 100) : null,
      meals, mealAim: R ? Math.round(R * MEAL_G_PER_KG) : null, fibreAvg: Math.round(mean(logged.map((d) => D.get(d)!.fib))!), fibreAim: Math.round((kAvg / 1000) * 14),
      carbsTraining: carbsPerKg(logged.filter((d) => trainDays.has(d))), carbsRest: carbsPerKg(logged.filter((d) => !trainDays.has(d))),
    }
  }

  // findings
  const findings: Finding[] = []
  const up = lifts.filter((l) => l.real && l.pct > 0)
  if (up.length && K?.changeKg != null && K.changeKg < 0 && r.fatLoss)
    findings.push({ id: 'strength-in-deficit', label: 'established', title: 'Strength went up while your weight came down', saw: `${up.map((l) => l.name).join(' and ')} ${up.length > 1 ? 'are' : 'is'} up 5% or more in 4 weeks, while your weight fell ${Math.abs(K.changeKg)} kg this week.`, why: 'Getting stronger while weight comes down says the deficit is not costing you strength.', evidence: ['Helms 2014', 'Grgic 2020'] })
  else if (up.length)
    findings.push({ id: 'strength-gain', label: 'established', title: `${up[0].name} is up ${up[0].pct}% in 4 weeks`, saw: `From ${up[0].base} to ${up[0].now} kg estimated 1RM. Changes under 5% are noise; this is past it.`, why: 'A gain this size is real progress, not a good day.', evidence: ['Grgic 2020'] })
  if (q?.carbsTraining != null && q.carbsTraining < 4 && enough.training)
    findings.push({ id: 'training-carbs', label: 'established', title: 'Your carbs are low on the days you lift', saw: `Training days averaged ${q.carbsTraining} g of carbs per kg${q.carbsRest == null ? '' : ` and rest days ${q.carbsRest}`}. The usual training day range starts at 4.`, why: 'Moving carbs onto lifting days gives sessions more fuel at the same total calories.', evidence: ['Science: day analysis'] })
  const lightMeals = q?.meals.filter((m) => q!.mealAim && m.avgG < q!.mealAim * 0.75) ?? []
  if (lightMeals.length && q?.mealAim) {
    const m = [...lightMeals].sort((x, y) => x.avgG - y.avgG)[0]
    findings.push({ id: 'meal-protein', label: 'established', title: `Protein is light at ${m.meal}`, saw: `${m.meal.charAt(0).toUpperCase()}${m.meal.slice(1)} averaged ${m.avgG} g of protein. About ${q.mealAim} g a meal (0.4 g per kg) is the aim.`, why: 'Spreading protein over the day helps it build muscle.', evidence: ['Science: day analysis'] })
  }
  const fuel = fuelPattern(all, D, kT, a, s, idx)
  if (fuel) findings.push(fuel)

  // actions (max 3)
  const actions: Action[] = []
  const add = (x: Action) => { if (actions.length < 3) actions.push(x) }
  if (r.planned && week.length < r.planned)
    add({ id: 'sessions', title: `Get all ${r.planned} planned sessions in`, titleHi: `Saare ${r.planned} planned sessions karo`, detail: `You did ${week.length} of ${r.planned}. Showing up is the biggest lever there is.`, checkText: `${r.planned} sessions next week.`, check: { kind: 'sessions', min: r.planned } })
  const dropped = muscles.filter((m) => m.usual !== null && m.usual >= 6 && m.sets <= m.usual - 3).sort((x, y) => y.usual! - y.sets - (x.usual! - x.sets))
  if (dropped.length) {
    const m = dropped[0]
    add({ id: `muscle-${m.muscle}`, title: `Bring ${muscleLabel(m.muscle).toLowerCase()} back to your usual`, titleHi: `${muscleLabel(m.muscle)} ke sets wapas normal karo`, detail: `${muscleLabel(m.muscle)} got ${m.sets} hard sets against your usual ${m.usual}. Add about ${Math.round(m.usual! - m.sets)} sets, ideally over 2 sessions.`, checkText: `${muscleLabel(m.muscle)} in 2 sessions next week.`, check: { kind: 'muscleSessions', muscle: m.muscle, min: 2 } })
  }
  if (lightMeals.length && q?.mealAim) {
    const m = lightMeals[0], t = Math.max(5, Math.round((q.mealAim - m.avgG) / 5) * 5)
    const cap = m.meal.charAt(0).toUpperCase() + m.meal.slice(1)
    add({ id: `meal-${m.meal}`, title: `Add ${t} g of protein at ${m.meal}`, titleHi: `${m.meal} mein ${t} g protein badhao`, detail: `${cap} averaged ${m.avgG} g of protein against about ${q.mealAim} g. Two eggs, curd or a scoop of whey closes it.`, checkText: `${cap} at ${q.mealAim - 5} g or more on 5 days.`, check: { kind: 'mealProtein', meal: m.meal, minG: q.mealAim - 5, days: 5 } })
  }
  if (pT && proteinDays !== null && logged.length >= 3 && proteinDays < 5)
    add({ id: 'protein-days', title: 'Reach your protein target on 5 days', titleHi: '5 din protein target poora karo', detail: `You reached 90% of ${pT} g on ${proteinDays} ${plural(proteinDays, 'day')}.`, checkText: 'Protein at 90% of target on 5 days.', check: { kind: 'proteinDays', min: 5 } })
  if (kT && calorieDays !== null && logged.length >= 3 && calorieDays < 4)
    add({ id: 'calorie-days', title: 'Land within 10% of your calories on 5 days', titleHi: '5 din calories target ke 10% ke andar rakho', detail: `${calorieDays} of ${logged.length} logged days were within 10% of ${kT.toLocaleString('en-IN')} kcal.`, checkText: 'Calories within 10% on 5 days.', check: { kind: 'calorieDays', min: 5 } })
  if (q?.carbsTraining != null && q.carbsTraining < 4 && enough.training)
    add({ id: 'training-carbs', title: 'Move some carbs to your training days', titleHi: 'Training wale din carbs thode badhao', detail: `Training days were at ${q.carbsTraining} g per kg. Shift carbs from rest days so the total calories stay the same.`, checkText: 'Training day carbs at 4 g per kg or more.', check: { kind: 'trainingCarbs', minGPerKg: 4 } })

  const lastWeek = r.previousActions?.length ? r.previousActions.map((x) => gradeAction(x, { week, D, logged, pT, kT, weightNow: R, logs: r.logs, idx })) : null
  const pillars = { training: pillarTraining(week.length, r.planned), nutrition: pillarNutrition(enough.food, pT, q?.proteinAvg ?? null, calorieDays, logged.length), body: pillarBody(K, r.fatLoss, cnt(a), cnt(shiftDate(a, -7))) }
  const verdict = verdictOf(pillars, actions)

  let win: WeeklyReport['win'] = null
  if (up.length) { const e = [...up].sort((x, y) => y.pct - x.pct)[0]; win = { big: `+${e.pct}%`, title: `${e.name} strength in 4 weeks`, detail: `From ${e.base} to ${e.now} kg estimated. Past the 5% line where a change stops being noise.` } }
  else if (records.count) win = { big: String(records.count), title: `${plural(records.count, 'personal record')} this week`, detail: `Across ${records.exercises} ${plural(records.exercises, 'exercise')}.` }
  else if (r.planned && week.length >= r.planned) win = { big: `${week.length}/${r.planned}`, title: 'Every planned session done', detail: 'Consistency is what moves everything else.' }

  const effortShare = V.sets ? V.rirs.length / V.sets : 0
  const waistRecent = r.measurements.some((m) => m.waistCm != null && m.date >= shiftDate(a, -14))
  const inputs = [
    { key: 'goal', label: 'Goal weight and date', has: r.goals.some((x) => x.kind === 'body_weight'), unlock: 'A projected range for reaching your goal weight.' },
    { key: 'targets', label: 'Your own calorie and protein targets', has: r.ownTargets, unlock: 'Calorie and protein days checked against your own numbers.' },
    { key: 'meals', label: 'Meals logged by meal', has: enough.food, unlock: 'Protein at each meal, not just the day.' },
    { key: 'plan', label: 'Training plan with planned days', has: r.planned !== null, unlock: 'Sessions done against sessions planned.' },
    { key: 'effort', label: 'Effort logged on 80% of sets', has: effortShare >= 0.8, unlock: `You logged effort on ${Math.round(effortShare * 100)}% of sets. At 80% your strength estimates and hard sets get much tighter.` },
    { key: 'waist', label: 'Waist measurement every 2 weeks', has: waistRecent, unlock: 'On a cut, weight alone cannot separate fat loss from water.' },
  ]

  return {
    version: 1, weekStart: a, weekEnd: shiftDate(a, 6), madeAt: (r.now ?? new Date()).toISOString(), enough,
    counts: { sessions: week.length, planned: r.planned, calorieDays, proteinDays, foodDays: logged.length, weighIns: weighIns.length, records: records.count },
    pillars, verdict, win, tiles, days, targets: { kcal: kT, proteinG: pT, maintenance: energy?.maintenance ?? null }, lifts, muscles, body: K, energy, nutrition: q, findings, actions, lastWeek, inputs,
  }
}

/** PRs set during [from, to): e1RM beats the earlier best by more than 0.01 (their `prs` module, e1RM type). */
function countRecords(all: Workout[], idx: ExIndex, from: string, to: string) {
  const best = new Map<string, number>()
  const hit = new Set<string>()
  let count = 0
  for (const w of all) for (const e of w.exercises) {
    const v = bestE1rmIn(w, e.key, idx)
    if (v === null) continue
    const prev = best.get(e.key)
    if (prev !== undefined && v > prev + 0.01 && w.date >= from && w.date < to) { count++; hit.add(e.key) }
    best.set(e.key, Math.max(prev ?? 0, v))
  }
  return { count, exercises: hit.size }
}

function fuelPattern(all: Workout[], D: Map<string, DayTot>, kT: number | null, a: string, o: string, idx: ExIndex): Finding | null {
  if (!kT) return null
  const from = shiftDate(a, -49)
  const last = new Map<string, number>()
  const A = { done: 0, n: 0 }, B = { done: 0, n: 0 }
  for (const w of all) {
    let matched = false, compared = false
    for (const ex of w.exercises) {
      const v = bestE1rmIn(w, ex.key, idx)
      if (v === null) continue
      const prev = last.get(ex.key)
      if (prev !== undefined) { compared = true; if (v >= prev) matched = true }
      last.set(ex.key, v)
    }
    if (w.date < from || w.date >= o || !compared) continue
    const f = D.get(shiftDate(w.date, -1))?.kcal ?? 0
    if (f < MIN_FOOD_KCAL) continue
    const bucket = f >= kT * 0.95 ? A : B
    bucket.n++
    if (matched) bucket.done++
  }
  if (A.n < 8 || B.n < 8 || A.done / A.n - B.done / B.n < 0.2) return null
  const p = fisherExact(A.done, A.n - A.done, B.done, B.n - B.done)
  const est = A.n >= 10 && B.n >= 10 && p < 0.1
  return {
    id: 'fuel-pattern', label: est ? 'established' : 'early', title: 'Your lifts and your eating went together',
    saw: `After days at 95% of your calories or more, ${A.done} of ${A.n} sessions matched or beat last time. After lower days, ${B.done} of ${B.n}.`,
    why: est ? 'This has held over enough sessions to take seriously. It still does not prove cause: sleep and stress move with both.' : `This is ${A.n + B.n} sessions over 8 weeks. Sleep, stress and exercise choice also move with eating and lifting, so it does not prove cause. We keep watching and do not change your advice because of it.`,
    evidence: [], pattern: { aDone: A.done, aN: A.n, bDone: B.done, bN: B.n, p },
  }
}

function gradeAction(x: Action, c: { week: Workout[]; D: Map<string, DayTot>; logged: string[]; pT: number | null; kT: number | null; weightNow: number | null; logs: FoodEntry[]; idx: ExIndex }): Graded {
  const n = x.check
  switch (n.kind) {
    case 'sessions': return { title: x.title, done: c.week.length >= n.min, result: `${c.week.length} of ${n.min} sessions` }
    case 'muscleSessions': {
      const k = c.week.filter((w) => w.exercises.some((e) => c.idx.get(e.key, e.name).primary === n.muscle && e.sets.some(isWork))).length
      return { title: x.title, done: k >= n.min, result: `${muscleLabel(n.muscle)} in ${k} ${plural(k, 'session')}` }
    }
    case 'mealProtein': {
      const k = c.logged.filter((d) => c.logs.filter((l) => l.date === d && mealOf(l) === n.meal).reduce((t, l) => t + l.p, 0) >= n.minG).length
      return { title: x.title, done: k >= n.days, result: `${k} of ${n.days} days` }
    }
    case 'proteinDays': {
      const k = c.pT ? c.logged.filter((d) => c.D.get(d)!.p >= c.pT! * PROTEIN_OK).length : 0
      return { title: x.title, done: k >= n.min, result: `Reached on ${k} ${plural(k, 'day')}` }
    }
    case 'calorieDays': {
      const k = c.kT ? c.logged.filter((d) => Math.abs(c.D.get(d)!.kcal / c.kT! - 1) <= KCAL_TOL).length : 0
      return { title: x.title, done: k >= n.min, result: `${k} of ${n.min} days` }
    }
    case 'trainingCarbs': {
      const tr = new Set(c.week.map((w) => w.date)), ds = c.logged.filter((d) => tr.has(d))
      const v = c.weightNow && ds.length ? g1(mean(ds.map((d) => c.D.get(d)!.c))! / c.weightNow) : null
      return { title: x.title, done: v !== null && v >= n.minGPerKg, result: v === null ? 'Not enough logged' : `${v} g per kg` }
    }
  }
}

function pillarTraining(done: number, planned: number | null): Pillar {
  if (done === 0) return { status: 'none', label: 'No sessions', detail: 'Nothing logged this week' }
  if (planned) {
    const d = `${done} of ${planned} sessions`
    return done >= planned ? { status: 'good', label: 'On plan', detail: d } : done >= planned - 1 ? { status: 'close', label: 'Close', detail: d } : { status: 'off', label: 'Behind', detail: d }
  }
  return { status: 'good', label: `${done} ${plural(done, 'session')}`, detail: 'No plan set to compare with' }
}
function pillarNutrition(enough: boolean, pT: number | null, pAvg: number | null, calDays: number | null, logged: number): Pillar {
  if (!enough) return { status: 'none', label: 'Not logged', detail: 'Log food on 3 days to see this' }
  if (!pT || pAvg === null) return { status: 'close', label: 'Logged', detail: `${logged} days logged, no protein target` }
  const pct = Math.round((pAvg / pT) * 100), d = `Protein ${pct}% of target`
  return pct >= 95 && (calDays === null || calDays >= Math.min(5, logged)) ? { status: 'good', label: 'On target', detail: d } : pct >= 85 ? { status: 'close', label: 'Close', detail: d } : { status: 'off', label: 'Off target', detail: d }
}
function pillarBody(k: WeeklyReport['body'], fatLoss: boolean, thisWeek: number, lastWeek: number): Pillar {
  if (!k || k.ratePct === null || k.changeKg === null) {
    // The change needs 3 weigh-ins in this week and 3 in the week before it.
    if (thisWeek >= 3 && lastWeek < 3) return { status: 'none', label: 'No week to compare yet', detail: `This week has ${thisWeek} weigh-ins${k?.weekMean != null ? ` (average ${k.weekMean} kg)` : ''}. Last week had ${lastWeek}, and it needs 3. The comparison starts next week.` }
    return { status: 'none', label: 'Not enough weigh-ins', detail: `This week has ${thisWeek} and last week had ${lastWeek}. Each week needs 3 to compare.` }
  }
  const down = k.ratePct < 0, r = Math.abs(k.ratePct)
  if (fatLoss) {
    const d = `Weight ${down ? 'down' : 'up'} ${r}% a week, goal 0.5 to 1%`
    return down && r >= FAT_LOSS_BAND[0] && r <= FAT_LOSS_BAND[1] ? { status: 'good', label: 'On pace', detail: d } : down && r > FAT_LOSS_BAND[1] ? { status: 'close', label: 'Faster than planned', detail: d } : down ? { status: 'close', label: 'Slower than planned', detail: d } : { status: 'off', label: 'Not dropping yet', detail: d }
  }
  return Math.abs(k.changeKg) < 0.2 ? { status: 'good', label: 'Steady', detail: 'Weight within 0.2 kg of last week' } : { status: 'close', label: `${down ? 'Down' : 'Up'} ${Math.abs(k.changeKg)} kg`, detail: "Against last week's 7 day average" }
}
function verdictOf(p: WeeklyReport['pillars'], actions: Action[]) {
  const n = [p.training, p.nutrition, p.body].filter((x) => x.status === 'good').length
  const head = n === 3 ? { en: 'A strong week on every front.', hi: 'Har taraf se ek strong hafta.' } : n === 2 ? { en: 'A solid week.', hi: 'Ek solid hafta.' } : n === 1 ? { en: 'A mixed week.', hi: 'Mila-jula hafta.' } : { en: 'A slow week, and that is fine.', hi: 'Thoda slow hafta, koi baat nahi.' }
  if (!actions.length) return { en: `${head.en} Keep doing what you did.`, hi: `${head.hi} Aise hi chalte raho.` }
  const t = actions.slice(0, 2), lc = (x: string) => x.charAt(0).toLowerCase() + x.slice(1)
  return { en: `${head.en} ${t.length === 1 ? 'One thing' : 'Two things'} to work on: ${t.map((x) => lc(x.title)).join(', and ')}.`, hi: `${head.hi} Agle hafte: ${t.map((x) => lc(x.titleHi)).join(', aur ')}.` }
}
