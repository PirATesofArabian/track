// Adaptive plan engine, ported from the Macrotrophy bundle (weekly review: aggregation, personal model, decision, apply).
// Constants, thresholds, ladders and the swap tables are theirs. Texts are English only.
import type { EventKind, FoodEntry, Goal, PainArea, PainRec, Routine, Workout, BodyWeight } from './db'
import { e1rm, isWork, type ExIndex } from './perf'
import { muscleLabel } from './weekly'
import { PROTEIN_PER_KG, targetRate } from './body'
import { MUSCLES } from '../data/exerciseDb'

// ───────── events ─────────
export const EVENT_KINDS: EventKind[] = ['exams', 'travel', 'wedding', 'festival', 'vrat', 'ramadan', 'sick']
export const EVENT_RULES: Record<EventKind, { maintenance: boolean; sessionMinutes: number | null; easy: boolean }> = {
  exams: { maintenance: true, sessionMinutes: 40, easy: false }, travel: { maintenance: true, sessionMinutes: 40, easy: false },
  wedding: { maintenance: true, sessionMinutes: null, easy: false }, festival: { maintenance: true, sessionMinutes: null, easy: false },
  vrat: { maintenance: true, sessionMinutes: null, easy: true }, ramadan: { maintenance: true, sessionMinutes: null, easy: true }, sick: { maintenance: true, sessionMinutes: null, easy: true },
}
export const EVENT_NAME: Record<EventKind, string> = { exams: 'Exams', travel: 'Travel', wedding: 'Wedding', festival: 'Festival', vrat: 'Vrat or fast', ramadan: 'Ramadan', sick: 'Unwell' }
const dayNum = (d: string) => Math.floor(Date.parse(`${d}T00:00:00Z`) / 864e5)
export const addDays = (d: string, n: number) => new Date((dayNum(d) + n) * 864e5).toISOString().slice(0, 10)
const overlapDays = (e: { start: string; end: string }, weekStart: string) => Math.max(0, Math.min(dayNum(e.end), dayNum(weekStart) + 6) - Math.max(dayNum(e.start), dayNum(weekStart)) + 1)
/** First Monday after the event ends. */
const afterEvent = (e: { end: string }, next: string) => addDays(next, (Math.floor((dayNum(e.end) - dayNum(next)) / 7) + 1) * 7)
export const MAX_EVENT_DAYS = 45

// ───────── pain ─────────
export const PAIN_AREAS: PainArea[] = ['shoulder', 'elbow', 'wrist', 'lower_back', 'knee', 'hip', 'ankle', 'neck']
export const PAIN_NAME: Record<PainArea, string> = { shoulder: 'Shoulder', elbow: 'Elbow', wrist: 'Wrist', lower_back: 'Lower back', knee: 'Knee', hip: 'Hip', ankle: 'Ankle', neck: 'Neck' }
export const RED_FLAGS = [{ v: 'sharp', label: 'Sharp or sudden pain' }, { v: 'numb', label: 'Numbness or tingling' }, { v: 'swelling', label: 'Swelling' }, { v: 'lasting', label: 'Has lasted more than a week' }]
const PAIN_WEEKS = { mild: 2, moderate: 3 } as const
const PAIN_MUSCLES: Record<PainArea, string[]> = { shoulder: ['shoulders', 'chest'], elbow: ['triceps', 'biceps'], wrist: ['biceps', 'triceps'], lower_back: ['hamstrings', 'back'], knee: ['quads'], hip: ['glutes', 'adductors'], ankle: ['calves'], neck: ['shoulders'] }
const PAIN_SWAP: Record<PainArea, Record<string, string>> = {
  shoulder: { 'overhead-press': 'machine-shoulder-press', 'behind-the-neck-press': 'seated-dumbbell-press', 'arnold-press': 'machine-shoulder-press', 'barbell-bench-press': 'machine-chest-press', 'incline-barbell-bench-press': 'incline-dumbbell-press', 'smith-machine-bench-press': 'machine-chest-press', dips: 'triceps-rope-pushdown', 'weighted-dips': 'triceps-rope-pushdown', 'bench-dip': 'triceps-rope-pushdown', 'upright-row': 'cable-lateral-raise', 'dumbbell-fly': 'pec-deck', 'pike-push-up': 'machine-shoulder-press' },
  elbow: { 'skull-crusher': 'triceps-rope-pushdown', 'overhead-triceps-extension': 'triceps-rope-pushdown', 'dumbbell-overhead-extension': 'triceps-rope-pushdown', 'close-grip-bench-press': 'triceps-rope-pushdown', dips: 'triceps-rope-pushdown', 'weighted-dips': 'triceps-rope-pushdown', 'barbell-curl': 'hammer-curl', 'preacher-curl': 'hammer-curl', 'chin-up': 'lat-pulldown', 'weighted-pull-up': 'lat-pulldown' },
  wrist: { 'barbell-curl': 'hammer-curl', 'ez-bar-curl': 'hammer-curl', 'barbell-bench-press': 'dumbbell-bench-press', 'push-up': 'machine-chest-press', 'front-squat': 'hack-squat', 'skull-crusher': 'triceps-rope-pushdown', 'overhead-press': 'machine-shoulder-press' },
  lower_back: { deadlift: 'hip-thrust', 'sumo-deadlift': 'hip-thrust', 'barbell-row': 'chest-supported-row', 'pendlay-row': 'chest-supported-row', 't-bar-row': 'chest-supported-row', 'back-squat': 'leg-press', 'front-squat': 'leg-press', 'good-morning': 'seated-leg-curl', 'romanian-deadlift': 'seated-leg-curl', 'stiff-leg-deadlift': 'lying-leg-curl', 'dumbbell-romanian-deadlift': 'seated-leg-curl', 'dumbbell-stiff-leg-deadlift': 'lying-leg-curl', 'kettlebell-swing': 'hip-thrust', 'back-extension': 'glute-bridge', 'overhead-press': 'machine-shoulder-press' },
  knee: { 'back-squat': 'box-squat', 'front-squat': 'box-squat', 'hack-squat': 'leg-press', 'walking-lunge': 'step-up', 'bulgarian-split-squat': 'leg-press', 'leg-extension': 'leg-press', 'single-leg-extension': 'leg-press', 'goblet-squat': 'box-squat' },
  hip: { 'back-squat': 'leg-press', 'sumo-deadlift': 'romanian-deadlift', 'walking-lunge': 'leg-extension', 'bulgarian-split-squat': 'leg-extension', 'hip-abduction': 'glute-bridge', 'hip-adduction': 'glute-bridge' },
  ankle: { 'standing-calf-raise': 'seated-calf-raise', 'single-leg-calf-raise': 'seated-calf-raise', 'back-squat': 'leg-press', 'walking-lunge': 'leg-extension', 'jump-rope': 'stationary-bike' },
  neck: { 'barbell-shrug': 'face-pull', 'kelso-shrug': 'face-pull', 'upright-row': 'cable-lateral-raise', 'behind-the-neck-press': 'machine-shoulder-press', 'overhead-press': 'machine-shoulder-press' },
}
export const hasRedFlag = (p: { severity: string; redFlags: string[] }) => p.severity === 'severe' || p.redFlags.length > 0

// ───────── constants ─────────
const KCAL_PER_KG = 7700, KCAL_FLOOR = 1200, LOSE_BAND = [0.005, 0.01], HOLD_BAND = 0.0025, PROTEIN_ALLOW = [1.6, 2.2]
const DOWN_PCT = -0.03, UP_PCT = 0.02, DELOAD_SHARE = 0.6, GAIN_CEIL = 0.2, LEARN_K = 3, LEARN_WEEKS = 6
const SET_BANDS = { low: [0, 10], mid: [10, 16], high: [16, Infinity] } as const
type Band = keyof typeof SET_BANDS
const round = (e: number, t: number) => Math.round(e / t) * t
export const kcalFloor = (bmr: number | null) => Math.max(KCAL_FLOOR, bmr ? Math.ceil(bmr / 50) * 50 : 0)
const mean = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length
const variance = (a: number[]) => { const m = mean(a); return a.reduce((s, x) => s + (x - m) ** 2, 0) / (a.length - 1) }
const median = (a: number[]) => { if (!a.length) return null; const t = [...a].sort((x, y) => x - y), n = Math.floor(t.length / 2); return t.length % 2 ? t[n] : (t[n - 1] + t[n]) / 2 }
const nf = (n: number) => n.toLocaleString('en-IN')
const pctTxt = (n: number) => `${Math.abs(n * 100).toFixed(1)}%`

// ───────── weekly aggregation (their `yd`) ─────────
export type LiftWeek = { muscle: string; e1rm: number; topReps: number; sessions: number }
export type WeekAgg = {
  weekStart: string; sessions: number; foodDays: number; meanKcal: number | null; meanProteinG: number | null; weighIns: number; meanWeightKg: number | null
  muscles: Record<string, number>; lifts: Record<string, LiftWeek>; medianRir: number | null
}
const mondayStr = (d: string) => { const n = dayNum(d); return addDays(d, -(((n + 3) % 7))) } // 1970-01-01 was a Thursday: (n+3)%7 = days since Monday
export const mondayOfDate = mondayStr

export function aggregateWeeks(a: { workouts: Workout[]; food: FoodEntry[]; weights: BodyWeight[]; idx: ExIndex; from: string; to: string }): WeekAgg[] {
  const start = mondayStr(a.from), end = mondayStr(a.to)
  const weeks = new Map<string, WeekAgg>(), rirs = new Map<string, number[]>()
  for (let d = start; d <= end; d = addDays(d, 7)) {
    weeks.set(d, { weekStart: d, sessions: 0, foodDays: 0, meanKcal: null, meanProteinG: null, weighIns: 0, meanWeightKg: null, muscles: Object.fromEntries(MUSCLES.map((m) => [m, 0])), lifts: {}, medianRir: null })
    rirs.set(d, [])
  }
  for (const w of a.workouts) {
    if (!w.finishedAt) continue
    const wk = weeks.get(mondayStr(w.date)); if (!wk) continue
    wk.sessions++
    for (const e of w.exercises) {
      const x = a.idx.get(e.key, e.name)
      const work = e.sets.filter(isWork)
      const hard = work.filter((s) => s.rir === null || s.rir <= 4).length
      if (hard > 0 && x.primary !== 'cardio') {
        wk.muscles[x.primary] = (wk.muscles[x.primary] ?? 0) + hard
        for (const sec of x.secondary) if (sec !== x.primary && sec !== 'cardio') wk.muscles[sec] = (wk.muscles[sec] ?? 0) + hard * 0.5
      }
      for (const s of work) if (s.rir !== null) rirs.get(wk.weekStart)!.push(s.rir)
      if (x.tracking !== 'weight_reps') continue
      let best: { v: number; reps: number } | null = null
      for (const s of work) {
        if (s.setType === 'drop' || !s.weightKg || !s.reps) continue
        const v = e1rm(s.weightKg, s.reps, null)
        if (v !== null && (!best || v > best.v)) best = { v, reps: s.reps }
      }
      if (!best) continue
      const cur = wk.lifts[e.key]
      if (cur) { cur.sessions++; if (best.v > cur.e1rm) { cur.e1rm = best.v; cur.topReps = best.reps } }
      else wk.lifts[e.key] = { muscle: x.primary, e1rm: best.v, topReps: best.reps, sessions: 1 }
    }
  }
  for (const [k, v] of rirs) weeks.get(k)!.medianRir = median(v)
  const days = new Map<string, { kcal: number; p: number }>()
  for (const f of a.food) { const e = days.get(f.date) ?? { kcal: 0, p: 0 }; e.kcal += f.kcal; e.p += f.p; days.set(f.date, e) }
  const byWeek = new Map<string, { kcal: number; p: number }[]>()
  for (const [d, t] of days) { if (t.kcal < 1000) continue; const k = mondayStr(d); if (weeks.has(k)) byWeek.set(k, [...(byWeek.get(k) ?? []), t]) }
  for (const [k, l] of byWeek) { const w = weeks.get(k)!; w.foodDays = l.length; w.meanKcal = mean(l.map((x) => x.kcal)); w.meanProteinG = mean(l.map((x) => x.p)) }
  const lastPerDay = new Map<string, BodyWeight>()
  for (const b of a.weights) { const c = lastPerDay.get(b.date); if (!c || (b.id ?? 0) >= (c.id ?? 0)) lastPerDay.set(b.date, b) }
  const wByWeek = new Map<string, number[]>()
  for (const b of lastPerDay.values()) { const k = mondayStr(b.date); if (weeks.has(k)) wByWeek.set(k, [...(wByWeek.get(k) ?? []), b.kg]) }
  for (const [k, l] of wByWeek) { const w = weeks.get(k)!; w.weighIns = l.length; w.meanWeightKg = mean(l) }
  return [...weeks.values()]
}

/** Recovery gaps (their `xd`): days between sessions of the same muscle vs the change in that lift's e1RM. */
export type RecoveryGap = { muscle: string; gapDays: number; change: number; date?: string }
export function recoveryGaps(workouts: Workout[], idx: ExIndex): RecoveryGap[] {
  const out: RecoveryGap[] = [], lastMuscle = new Map<string, string>(), lastE1 = new Map<string, number>()
  const done = workouts.filter((w) => w.finishedAt).sort((a, b) => a.date.localeCompare(b.date) || a.startedAt - b.startedAt)
  for (const w of done) {
    const seen = new Set<string>()
    for (const e of w.exercises) {
      const x = idx.get(e.key, e.name)
      const work = e.sets.filter(isWork)
      if (!work.length) continue
      let best: number | null = null
      if (x.tracking === 'weight_reps') for (const s of work) { if (s.setType === 'drop' || !s.weightKg || !s.reps) continue; const v = e1rm(s.weightKg, s.reps, null); if (v !== null && (best === null || v > best)) best = v }
      const prev = lastE1.get(e.key), lastM = lastMuscle.get(x.primary)
      if (best !== null && prev && lastM && !seen.has(x.primary)) {
        const gap = dayNum(w.date) - dayNum(lastM)
        if (gap >= 1 && gap <= 10) out.push({ muscle: x.primary, gapDays: gap, change: best / prev - 1, date: w.date })
      }
      if (best !== null) lastE1.set(e.key, best)
      seen.add(x.primary)
    }
    for (const m of seen) lastMuscle.set(m, w.date)
  }
  return out
}

// ───────── personal model (their `U`) ─────────
const okWeek = (w: WeekAgg) => w.foodDays >= 5 && w.weighIns >= 4 && w.meanKcal !== null && w.meanWeightKg !== null
function slope(pts: { x: number; y: number }[]) {
  const mx = mean(pts.map((p) => p.x)), my = mean(pts.map((p) => p.y))
  const den = pts.reduce((s, p) => s + (p.x - mx) ** 2, 0)
  return den === 0 ? 0 : pts.reduce((s, p) => s + (p.x - mx) * (p.y - my), 0) / den
}
export type Maintenance = { value: number; research: number | null; own: number | null; n: number; confidence: 'research' | 'learning' | 'personal' }
function blendMaintenance(weeks: WeekAgg[], research: number | null): Maintenance | null {
  const last4 = weeks.slice(-4), off = weeks.length - last4.length
  const good = last4.map((w, i) => ({ w, x: off + i })).filter(({ w }) => okWeek(w))
  const n = Math.min(12, weeks.filter(okWeek).length)
  let own: number | null = null
  if (good.length >= 3) {
    const v = mean(good.map(({ w }) => w.meanKcal!)) - slope(good.map(({ w, x }) => ({ x, y: w.meanWeightKg! }))) * KCAL_PER_KG / 7
    if (v >= 1000 && v <= 5500) own = v
  }
  if (own === null && research === null) return null
  if (own === null) return { value: research!, research, own: null, n, confidence: 'research' }
  if (research === null) return { value: own, research: null, own, n, confidence: n >= 4 ? 'personal' : 'learning' }
  return { value: (n / (n + LEARN_K)) * own + (LEARN_K / (n + LEARN_K)) * research, research, own, n, confidence: n >= 4 ? 'personal' : 'learning' }
}
type Finding = { kind: 'sets' | 'reps' | 'recovery' | 'energy'; subject: string; best: string | null; confidence: 'learning' | 'personal'; groups: { cond: string; n: number; mean: number }[] }
function compare(rows: { cond: string; value: number }[]): Omit<Finding, 'kind' | 'subject'> {
  const g = new Map<string, number[]>()
  for (const r of rows) g.set(r.cond, [...(g.get(r.cond) ?? []), r.value])
  const groups = [...g.entries()].map(([cond, v]) => ({ cond, n: v.length, mean: mean(v) }))
  const big = groups.filter((x) => x.n >= 5).sort((a, b) => b.mean - a.mean)
  if (big.length < 2) return { best: null, confidence: 'learning', groups }
  const [a, b] = big, va = g.get(a.cond)!, vb = g.get(b.cond)!
  const se = Math.sqrt(variance(va) / va.length + variance(vb) / vb.length)
  return se > 0 && (a.mean - b.mean) / se >= 3.4 ? { best: a.cond, confidence: 'personal', groups } : { best: null, confidence: 'learning', groups }
}
const setBand = (n: number): Band => (n < 10 ? 'low' : n < 16 ? 'mid' : 'high')
const repBand = (r: number) => (r <= 5 ? 'heavy' : 'moderate')
const gapBand = (d: number) => (d <= 2 ? 'short' : 'long')
export type LiftTrend = { weekly: number; spread: number; weeks: number; latest: number }
export type Model = { weeksLogged: number; stage: { learning: boolean; week: number; of: number }; maintenance: Maintenance | null; findings: Finding[]; lifts: Record<string, LiftTrend> }

// Their `Uf`/`Wf`: a lift's own diminishing-returns curve (log e1RM against sqrt(weeks)), removed before comparing conditions.
function liftCurves(weeks: WeekAgg[]) {
  const m = new Map<string, { first: number; k: number }>()
  for (const key of new Set(weeks.flatMap((w) => Object.keys(w.lifts)))) {
    const first = weeks.findIndex((w) => w.lifts[key])
    const pts = weeks.map((w, t) => (w.lifts[key] ? { x: Math.sqrt(t - first), y: Math.log(w.lifts[key].e1rm) } : null)).filter((x): x is { x: number; y: number } => x !== null)
    m.set(key, { first, k: pts.length >= 4 ? slope(pts) : 0 })
  }
  return m
}
function detrend(c: Map<string, { first: number; k: number }>, key: string, from: number, to: number, ratio: number) {
  const a = c.get(key)
  return a ? ratio / Math.exp(a.k * (Math.sqrt(to - a.first) - Math.sqrt(from - a.first))) - 1 : ratio - 1
}
function pairsOf(weeks: WeekAgg[]) {
  const curves = liftCurves(weeks), out: { week: WeekAgg; byMuscle: Map<string, number[]>; reps: { muscle: string; cond: string; value: number }[]; all: number[] }[] = []
  for (let r = 0; r < weeks.length - 1; r++) {
    const w = weeks[r], by = new Map<string, number[]>(), reps: { muscle: string; cond: string; value: number }[] = [], all: number[] = []
    for (const [k, l] of Object.entries(w.lifts)) {
      const to = weeks[r + 1].lifts[k] ? r + 1 : weeks[r + 2]?.lifts[k] ? r + 2 : -1
      if (to < 0) continue
      const v = detrend(curves, k, r, to, weeks[to].lifts[k].e1rm / l.e1rm)
      by.set(l.muscle, [...(by.get(l.muscle) ?? []), v]); reps.push({ muscle: l.muscle, cond: repBand(l.topReps), value: v }); all.push(v)
    }
    out.push({ week: w, byMuscle: by, reps, all })
  }
  return out
}
function findingsFor(weeks: WeekAgg[], recovery: RecoveryGap[], maintenance: Maintenance | null): Finding[] {
  const pairs = pairsOf(weeks), out: Finding[] = []
  for (const m of new Set(pairs.flatMap((p) => [...p.byMuscle.keys()]))) {
    out.push({ kind: 'sets', subject: m, ...compare(pairs.filter((p) => p.byMuscle.has(m)).map((p) => ({ cond: setBand(p.week.muscles[m] ?? 0), value: mean(p.byMuscle.get(m)!) }))) })
    out.push({ kind: 'reps', subject: m, ...compare(pairs.flatMap((p) => p.reps.filter((r) => r.muscle === m))) })
    out.push({ kind: 'recovery', subject: m, ...compare(recovery.filter((r) => r.muscle === m).map((r) => ({ cond: gapBand(r.gapDays), value: r.change }))) })
  }
  if (maintenance) out.push({ kind: 'energy', subject: 'all', ...compare(pairs.filter((p) => p.week.foodDays >= 5 && p.week.meanKcal !== null && p.all.length).map((p) => ({ cond: p.week.meanKcal! <= maintenance.value - 250 ? 'deficit' : 'fed', value: mean(p.all) }))) })
  return out
}
// Their `J`: where each lift is heading over the last 8 weeks.
function liftTrends(weeks: WeekAgg[]): Record<string, LiftTrend> {
  const t = weeks.slice(-8), out: Record<string, LiftTrend> = {}
  for (const key of new Set(t.flatMap((w) => Object.keys(w.lifts)))) {
    const pts = t.map((w, x) => ({ x, y: w.lifts[key] ? Math.log(w.lifts[key].e1rm) : null })).filter((p): p is { x: number; y: number } => p.y !== null)
    if (pts.length < 4) continue
    const sl = slope(pts), my = mean(pts.map((p) => p.y)), mx = mean(pts.map((p) => p.x))
    const res = pts.map((p) => p.y - (my + sl * (p.x - mx)))
    const spread = Math.sqrt(res.reduce((a, b) => a + b * b, 0) / Math.max(1, pts.length - 2))
    const latest = [...t].reverse().find((w) => w.lifts[key])!.lifts[key].e1rm
    out[key] = { weekly: Math.exp(sl) - 1, spread, weeks: pts.length, latest }
  }
  return out
}
export function buildModel(weeks: WeekAgg[], recovery: RecoveryGap[], research: number | null): Model {
  const logged = weeks.filter((w) => w.sessions > 0 || w.foodDays >= 3).length
  const maintenance = blendMaintenance(weeks, research)
  const lastStart = weeks.length ? weeks[weeks.length - 1].weekStart : null
  const earlier = findingsFor(weeks.slice(0, -1), recovery.filter((r) => !r.date || !lastStart || r.date < lastStart), maintenance)
  // A "personal" finding only stands if it survives dropping the latest week.
  const findings = findingsFor(weeks, recovery, maintenance).map((f) =>
    f.confidence === 'personal' ? (earlier.find((e) => e.kind === f.kind && e.subject === f.subject)?.best === f.best ? f : { ...f, best: null, confidence: 'learning' as const }) : f)
  return { weeksLogged: logged, stage: { learning: logged < LEARN_WEEKS, week: Math.min(logged, LEARN_WEEKS), of: LEARN_WEEKS }, maintenance, findings, lifts: liftTrends(weeks) }
}
const finding = (m: Model, kind: Finding['kind'], subject: string) => m.findings.find((f) => f.kind === kind && f.subject === subject) ?? null

// ───────── plan slots (their `Pu`, `hu`, `gu`, `_u`) ─────────
export type Slot = { id: string; dayId: string; key: string; order: number; sets: number; rest: number; primary: string; secondary: string[]; category: string }
export type PlanDays = { id: string; perWeek: number }[]
export function slotsOf(r: Routine | undefined, idx: ExIndex): { days: PlanDays; slots: Slot[] } {
  if (!r) return { days: [], slots: [] }
  const days: PlanDays = [], slots: Slot[] = []
  r.days.forEach((d, di) => {
    days.push({ id: `${di}`, perWeek: Math.max(1, d.weekdays.length) })
    d.exercises.forEach((e, ei) => { const x = idx.get(e.key); slots.push({ id: `${di}:${ei}`, dayId: `${di}`, key: e.key, order: ei, sets: e.sets, rest: e.rest, primary: x.primary, secondary: x.secondary, category: x.category }) })
  })
  return { days, slots }
}
const perWeekMap = (d: PlanDays) => new Map(d.map((x) => [x.id, Math.max(1, x.perWeek)]))
export function planMuscleSets(slots: Slot[], days: PlanDays): Record<string, number> {
  const pw = perWeekMap(days), out: Record<string, number> = {}
  for (const s of slots) {
    const n = s.sets * (pw.get(s.dayId) ?? 1)
    if (s.primary !== 'cardio') out[s.primary] = (out[s.primary] ?? 0) + n
    for (const m of s.secondary) if (m !== s.primary && m !== 'cardio') out[m] = (out[m] ?? 0) + n * 0.5
  }
  return out
}
const dayMinutes = (s: Slot[]) => s.reduce((a, x) => a + x.sets * (40 + x.rest) / 60, 0)
export function planSessionMinutes(slots: Slot[]): number | null {
  const m = new Map<string, Slot[]>()
  for (const s of slots) m.set(s.dayId, [...(m.get(s.dayId) ?? []), s])
  return m.size === 0 ? null : Math.round(Math.max(...[...m.values()].map(dayMinutes)))
}

// ───────── changes ─────────
export type ChangeBase = { id: string; title: string; reason: string; until: string | null }
export type Change = ChangeBase & (
  | { kind: 'calories'; from: number; to: number; cause: 'floor' | 'event' | 'pace' }
  | { kind: 'protein'; from: number; to: number; cause: 'protein' }
  | { kind: 'sets'; muscle: string; from: number; to: number; cause: 'recovery' | 'personal' | 'progress' | 'pain' }
  | { kind: 'swap'; fromKey: string; toKey: string; cause: 'pain' | 'stall' }
  | { kind: 'deload'; share: number; cause: 'deload' }
  | { kind: 'session'; minutes: number; cause: 'event' }
  | { kind: 'restore'; temporaryId: string; cause: 'restore' }
)
export type Patch = { slotId: string; sets?: number; key?: string; expectSets?: number; expectKey?: string }
type SlotChange = Extract<Change, { kind: 'sets' | 'swap' | 'deload' | 'session' }>

/** Apply set/swap/deload/session changes to slots; returns patches, their undo, and changes that could not be applied (their `vu`). */
export function simulateChanges(slots: Slot[], days: PlanDays, changes: SlotChange[]) {
  const pw = perWeekMap(days), cur = slots.map((s) => ({ ...s })), orig = new Map(slots.map((s) => [s.id, s]))
  const touched = new Set<string>(), unapplied: string[] = []
  for (const c of changes) {
    if (c.kind === 'sets') {
      let left = Math.abs(c.to - c.from); const up = c.to > c.from
      const pool = cur.filter((s) => s.primary === c.muscle)
      while (left > 0) {
        const l = left
        const cand = pool.filter((s) => (pw.get(s.dayId) ?? 1) <= l).filter((s) => (up ? s.sets < 6 : s.sets > 1))
          .sort((a, b) => up ? a.sets - b.sets || Number(b.category === 'compound') - Number(a.category === 'compound') || a.order - b.order
            : b.sets - a.sets || Number(b.category === 'isolation') - Number(a.category === 'isolation') || b.order - a.order)[0]
        if (!cand) break
        cand.sets += up ? 1 : -1; left -= pw.get(cand.dayId) ?? 1; touched.add(cand.id)
      }
      if (left === Math.abs(c.to - c.from)) unapplied.push(c.id)
    } else if (c.kind === 'swap') {
      const m = cur.filter((s) => s.key === c.fromKey)
      if (!m.length) unapplied.push(c.id)
      for (const s of m) { s.key = c.toKey; touched.add(s.id) }
    } else if (c.kind === 'deload') {
      for (const s of cur) { const n = Math.max(1, Math.round(s.sets * c.share)); if (n !== s.sets) { s.sets = n; touched.add(s.id) } }
    } else {
      const byDay = new Map<string, typeof cur>()
      for (const s of cur) byDay.set(s.dayId, [...(byDay.get(s.dayId) ?? []), s])
      for (const d of byDay.values()) {
        const pick = (cat: string, min: number) => d.filter((s) => s.category === cat && s.sets > min).sort((a, b) => b.sets - a.sets || b.order - a.order)[0]
        while (dayMinutes(d) > c.minutes) { const s = pick('isolation', 1) ?? pick('compound', 2); if (!s) break; s.sets--; touched.add(s.id) }
      }
    }
  }
  const patches: Patch[] = [], undo: Patch[] = []
  for (const s of cur) {
    if (!touched.has(s.id)) continue
    const o = orig.get(s.id)!, p: Patch = { slotId: s.id }, u: Patch = { slotId: s.id }
    if (s.sets !== o.sets) { p.sets = s.sets; u.sets = o.sets }
    if (s.key !== o.key) { p.key = s.key; u.key = o.key }
    if (p.sets !== undefined || p.key !== undefined) { patches.push(p); undo.push(u) }
  }
  return { patches, undo, unapplied, after: cur }
}

// ───────── decision (their `hd`, `sd`, `ld`, `ud`, `dd`, `fd`) ─────────
export type Person = { goal: Goal; experience: string; weightKg: number | null; bmrKcal: number | null; targetKg: number | null; ownProtein: boolean; age: number | null; heightCm: number | null }
export type Temporary = { id: string; cause: 'event' | 'pain' | 'deload'; start: string; until: string; muscles: string[]; calories: boolean; label: string; done?: boolean; undo: { patches: Patch[]; targets: { was: { kcal: number; p: number }; setTo: number } | null } }
export type DecisionInput = {
  nextWeekStart: string; weeks: WeekAgg[]; model: Model; person: Person
  plan: { kcal: number | null; proteinG: number | null; muscleSets: Record<string, number>; keys: string[]; sessionMinutes: number | null }
  events: { id?: number; kind: EventKind; start: string; end: string }[]; pains: PainRec[]
  stalls: { key: string; cause: string; variationKey?: string }[]; temporaries: Temporary[]; lastDeload: string | null
  exName: (key: string) => string; exists: (key: string) => boolean
}
export type Decision = { weekStart: string; stage: Model['stage']; maintenance: Maintenance | null; changes: Change[]; holds: { kind: string; reason: string }[]; warnings: { area: PainArea; text: string }[]; notes: string[] }

function paceBand(p: { goal: Goal; experience: string; weightKg: number | null; targetKg: number | null }) {
  let dir: 'lose' | 'gain' | 'hold'
  if (p.targetKg !== null && p.weightKg !== null) { const d = p.targetKg - p.weightKg; dir = Math.abs(d) < 0.5 ? 'hold' : d < 0 ? 'lose' : 'gain' }
  else dir = p.goal === 'fat_loss' ? 'lose' : p.goal === 'hypertrophy' || p.goal === 'strength_hypertrophy' ? 'gain' : 'hold'
  if (dir === 'lose') return { dir, lo: -LOSE_BAND[1], hi: -LOSE_BAND[0] }
  if (dir === 'gain') { const [lo, hi] = targetRate(p.goal === 'hypertrophy' || p.goal === 'strength_hypertrophy' ? p.goal : 'hypertrophy', p.experience as 'beginner'); return { dir, lo, hi } }
  return p.goal === 'recomposition' && p.targetKg === null ? { dir, lo: -0.005, hi: 0 } : { dir, lo: -HOLD_BAND, hi: HOLD_BAND }
}
const okWeigh = (w?: WeekAgg) => !!w && w.weighIns >= 4 && w.meanWeightKg !== null
function pace(weeks: WeekAgg[]): number | null {
  const [t, n, r] = [weeks.at(-1), weeks.at(-2), weeks.at(-3)]
  if (!okWeigh(t) || !okWeigh(n)) return null
  return okWeigh(r) ? (t!.meanWeightKg! - r!.meanWeightKg!) / 2 : t!.meanWeightKg! - n!.meanWeightKg!
}
function nextEvent(i: DecisionInput) { return i.events.filter((e) => overlapDays(e, i.nextWeekStart) >= 4).sort((a, b) => a.start.localeCompare(b.start))[0] ?? null }

function decideCalories(i: DecisionInput, ev: ReturnType<typeof nextEvent>): { change: Change | null; hold: { kind: string; reason: string } | null } {
  const { plan, person, weeks, model } = i, last = weeks.at(-1), cur = plan.kcal
  if (cur === null || person.weightKg === null) return { change: null, hold: null }
  const hold = (reason: string) => ({ change: null, hold: { kind: 'calories', reason } })
  const temp = i.temporaries.find((t) => !t.done && t.calories && t.until > i.nextWeekStart)
  if (temp) return hold(`Calories stay at ${nf(cur)} for now: ${temp.label.toLowerCase()}.`)
  const floor = kcalFloor(person.bmrKcal), maint = model.maintenance ? round(model.maintenance.value, 50) : null
  if (cur < floor) return { change: { id: 'calories', kind: 'calories', from: cur, to: floor, cause: 'floor', until: null, title: `Calories ${nf(cur)} to ${nf(floor)}`, reason: `${nf(cur)} kcal is under the lowest target the plan allows for you (${nf(floor)}).` }, hold: null }
  if (ev && EVENT_RULES[ev.kind].maintenance) {
    const name = EVENT_NAME[ev.kind]
    if (maint !== null && cur <= maint - 50) return { change: { id: 'calories', kind: 'calories', from: cur, to: maint, cause: 'event', until: afterEvent(ev, i.nextWeekStart), title: `Calories ${nf(cur)} to ${nf(maint)}`, reason: `${name} this week: eat at maintenance, no deficit. The target goes back afterwards.` }, hold: null }
    return hold(`Calories stay at ${nf(cur)} through ${name.toLowerCase()}.`)
  }
  // Safety limits: no deficit for anyone under 18, and no cut toward a target under a BMI of 18.5. The plan holds maintenance and says why.
  const cutting = paceBand(person).dir === 'lose'
  const underage = person.age !== null && person.age < 18
  const lowTarget = person.targetKg !== null && !!person.heightCm && person.targetKg / (person.heightCm / 100) ** 2 < 18.5
  if (cutting && (underage || lowTarget)) {
    const why = underage ? 'nobody under 18 is given a deficit' : 'a target under a BMI of 18.5 is never planned for'
    if (maint !== null && cur <= maint - 50) return { change: { id: 'calories', kind: 'calories', from: cur, to: maint, cause: 'floor', until: null, title: `Calories ${nf(cur)} to ${nf(maint)}`, reason: `Your weight is held at maintenance: ${why}.` }, hold: null }
    return hold(`Calories stay at ${nf(cur)}: ${why}, so the plan holds your weight at maintenance.`)
  }
  if (!last || last.foodDays < 5 || last.weighIns < 4) return hold(`Calories stay at ${nf(cur)}. A change needs 5 logged food days and 4 weigh-ins in the week; this week had ${last?.foodDays ?? 0} and ${last?.weighIns ?? 0}.`)
  const rate = pace(weeks)
  if (rate === null) return hold(`Calories stay at ${nf(cur)}. The pace needs 4 weigh-ins in each of the last two weeks.`)
  const ate = Math.round(last.meanKcal!)
  if (Math.abs(ate / cur - 1) > 0.1) return hold(`Calories stay at ${nf(cur)}. You ate about ${nf(round(ate, 10))} a day, so the target has not been tested yet.`)
  const band = paceBand(person), r = rate / person.weightKg
  if (r >= band.lo && r <= band.hi) return hold(`Calories stay at ${nf(cur)}: your weight is moving at the planned pace.`)
  const raw = ((band.lo + band.hi) / 2 - r) * person.weightKg * KCAL_PER_KG / 7
  let step = Math.max(-150, Math.min(150, round(raw, 50)))
  if (step === 0) step = raw > 0 ? 50 : -50
  let to = cur + step
  if (step < 0) to = Math.max(to, floor)
  if (maint !== null) {
    if (band.dir === 'lose' && step > 0) to = Math.min(to, Math.max(cur, maint))
    if (band.dir === 'gain' && step > 0) to = Math.min(to, Math.max(cur, round(maint * (1 + GAIN_CEIL), 50)))
  }
  if (to === cur) return hold(step < 0 ? `Calories stay at ${nf(cur)}: that is the lowest target the plan allows for you.` : `Calories stay at ${nf(cur)}.`)
  const did = Math.abs(r) < 5e-4 ? 'held steady' : r < 0 ? `fell ${pctTxt(r)} a week` : `rose ${pctTxt(r)} a week`
  const aim = band.dir === 'lose' ? `the plan aims for ${pctTxt(band.hi)} to ${pctTxt(band.lo)} down` : band.dir === 'gain' ? `the plan aims for ${pctTxt(band.lo)} to ${pctTxt(band.hi)} up` : 'the plan is to hold it'
  return { change: { id: 'calories', kind: 'calories', from: cur, to, cause: 'pace', until: null, title: `Calories ${nf(cur)} to ${nf(to)}`, reason: `Your weight ${did}; ${aim}.` }, hold: null }
}
export function proteinRange(goal: Goal, kg: number): [number, number] {
  const [lo, hi] = PROTEIN_PER_KG[goal]
  return [Math.ceil(Math.min(PROTEIN_ALLOW[0], lo) * kg / 5) * 5, Math.floor(Math.max(PROTEIN_ALLOW[1], hi) * kg / 5) * 5]
}
function decideProtein(i: DecisionInput): Change | null {
  const { person: p, plan } = i
  if (p.ownProtein || p.weightKg === null || plan.proteinG === null) return null
  const [lo, hi] = proteinRange(p.goal, p.weightKg)
  const to = plan.proteinG < lo ? lo : plan.proteinG > hi ? hi : plan.proteinG
  if (to === plan.proteinG) return null
  return { id: 'protein', kind: 'protein', from: plan.proteinG, to, cause: 'protein', until: null, title: `Protein ${plan.proteinG} g to ${to} g`,
    reason: to > plan.proteinG ? `At ${p.weightKg.toFixed(1)} kg, ${plan.proteinG} g is under the range that supports muscle (${lo} to ${hi} g).` : `At ${p.weightKg.toFixed(1)} kg, more than ${hi} g adds nothing for muscle; the room goes back to carbs and fat.` }
}
export type LiftStatus = { muscle: string; change: number; sessions: number; status: 'up' | 'down' | 'flat' }
export function liftStatus(weeks: WeekAgg[]): Record<string, LiftStatus> {
  const t = weeks.slice(-2), n = weeks.slice(-4, -2), out: Record<string, LiftStatus> = {}
  const top = (w: WeekAgg[], k: string) => Math.max(0, ...w.map((x) => x.lifts[k]?.e1rm ?? 0))
  for (const k of new Set(t.flatMap((w) => Object.keys(w.lifts)))) {
    const a = top(t, k), o = top(n, k)
    if (!a || !o) continue
    const c = a / o - 1, sessions = t.reduce((s, w) => s + (w.lifts[k]?.sessions ?? 0), 0)
    out[k] = { muscle: t.find((w) => w.lifts[k])!.lifts[k].muscle, change: c, sessions, status: c >= UP_PCT ? 'up' : c <= DOWN_PCT && sessions >= 2 ? 'down' : 'flat' }
  }
  return out
}
function muscleStatus(l: Record<string, LiftStatus>, m: string): 'up' | 'down' | 'flat' | null {
  const v = Object.values(l).filter((x) => x.muscle === m)
  if (!v.length) return null
  const c = v.reduce((s, x) => s + x.change, 0) / v.length
  return c >= UP_PCT ? 'up' : c <= DOWN_PCT && v.some((x) => x.status === 'down') ? 'down' : 'flat'
}
const underMaintenance = (weeks: WeekAgg[], m: Maintenance | null) => !!m && weeks.slice(-2).filter((w) => w.foodDays >= 5 && w.meanKcal !== null).length > 0 && weeks.slice(-2).filter((w) => w.foodDays >= 5 && w.meanKcal !== null).every((w) => w.meanKcal! <= m.value - 250)
const totalSets = (w: WeekAgg) => Object.values(w.muscles).reduce((a, b) => a + b, 0)
const setsChange = (muscle: string, from: number, to: number, cause: 'recovery' | 'personal' | 'progress' | 'pain', reason: string, until: string | null = null): Change => {
  const d = to - from
  return { id: `sets:${muscle}`, kind: 'sets', muscle, from, to, cause, until, reason, title: `${muscleLabel(muscle)} ${d > 0 ? 'plus' : 'minus'} ${Math.abs(d)} ${Math.abs(d) === 1 ? 'set' : 'sets'} a week` }
}
const weeksBetween = (a: string, b: string) => Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / 6048e5)
const DISCLAIMER = 'This is training guidance, not medical advice. If the pain is sharp, lasts, or comes with swelling or numbness, stop and see a professional.'

export function decide(i: DecisionInput): Decision {
  const { weeks, model, plan } = i, last = weeks.at(-1)
  const changes: Change[] = [], holds: Decision['holds'] = [], warnings: Decision['warnings'] = [], notes: string[] = []
  const touched = new Set<string>(), ev = nextEvent(i), rule = ev ? EVENT_RULES[ev.kind] : null
  let restoringDeload = false
  for (const t of i.temporaries) {
    if (t.done) continue
    if (t.until <= i.nextWeekStart) {
      changes.push({ id: `restore:${t.id}`, kind: 'restore', temporaryId: t.id, cause: 'restore', until: null, title: `Back to normal: ${t.label}`, reason: 'The time for this change is up, so your plan goes back to what it was.' })
      if (t.cause === 'deload') restoringDeload = true
    }
    for (const m of t.muscles) touched.add(m)
  }
  const deloadOn = i.temporaries.some((t) => !t.done && t.cause === 'deload' && t.until > i.nextWeekStart)
  const used = new Set(plan.keys)
  for (const p of i.pains) {
    const nm = PAIN_NAME[p.area]
    if (hasRedFlag(p)) { warnings.push({ area: p.area, text: `${nm}: this needs a doctor or physiotherapist before you train it again. The plan is not changed around it. Skip anything that brings the pain on.` }); continue }
    const wk = PAIN_WEEKS[p.severity === 'moderate' ? 'moderate' : 'mild'], until = addDays(i.nextWeekStart, wk * 7), span = `${wk} weeks`
    for (const k of plan.keys) {
      const to = PAIN_SWAP[p.area][k]
      if (to && i.exists(to) && !used.has(to)) {
        used.add(to)
        changes.push({ id: `swap:${k}`, kind: 'swap', fromKey: k, toKey: to, cause: 'pain', until, title: `${i.exName(k)} to ${i.exName(to)}`, reason: `Your ${nm.toLowerCase()} hurt. This usually loads it less. It goes back after ${span}.` })
      }
    }
    for (const m of PAIN_MUSCLES[p.area]) {
      const n = Math.round(plan.muscleSets[m] ?? 0)
      if (touched.has(m)) continue
      touched.add(m)
      if (!(n - 2 < 4)) changes.push(setsChange(m, n, n - 2, 'pain', `Less work around your ${nm.toLowerCase()} for ${span}, then back up.`, until))
    }
    if (!notes.includes(DISCLAIMER)) notes.push(DISCLAIMER)
  }
  if (ev && rule) {
    const nm = EVENT_NAME[ev.kind]
    if (rule.sessionMinutes !== null && (plan.sessionMinutes ?? 0) > rule.sessionMinutes)
      changes.push({ id: 'session', kind: 'session', minutes: rule.sessionMinutes, cause: 'event', until: afterEvent(ev, i.nextWeekStart), title: `Sessions of about ${rule.sessionMinutes} minutes`, reason: `${nm} this week: the main lifts stay, the extras are trimmed. It goes back afterwards.` })
    if (ev.kind === 'ramadan') notes.push('Train after iftar, once you have eaten and had water. Keep a couple of reps in reserve on every set.')
    if (ev.kind === 'vrat') notes.push('On fast days keep training easy or rest. Sabudana, makhana, curd, milk, paneer, fruit and peanuts fit most vrats.')
    if (ev.kind === 'sick') notes.push('Rest until you feel well. Missed sessions this week are not counted against you.')
  } else for (const e of i.events) if (overlapDays(e, i.nextWeekStart) > 0) notes.push(`${EVENT_NAME[e.kind]} is in this week. The plan stays; do what you can.`)
  const cal = decideCalories(i, ev)
  if (cal.change) changes.push(cal.change)
  if (cal.hold) holds.push(cal.hold)
  const pr = decideProtein(i)
  if (pr) changes.push(pr)
  const lifts = liftStatus(weeks), under = underMaintenance(weeks, model.maintenance), busy = !!rule || deloadOn || restoringDeload
  const down = Object.values(lifts).filter((l) => l.status === 'down')
  const prior = weeks.slice(-5, -1).map(totalSets).filter((n) => n > 0), avg = prior.length ? prior.reduce((a, b) => a + b, 0) / prior.length : null
  const lowRir = last?.medianRir !== null && last?.medianRir !== undefined && last.medianRir <= 1
  const heavy = !!last && avg !== null && totalSets(last) >= avg * 1.2
  const since = i.lastDeload ? weeksBetween(i.lastDeload, i.nextWeekStart) : null
  if (!busy && !i.pains.some(hasRedFlag) && down.length >= 2 && (under || lowRir || heavy) && (since === null || since >= 4)) {
    const why = under ? 'while you are eating under maintenance' : lowRir ? 'with almost nothing left in reserve on your sets' : 'after a heavier stretch than usual'
    changes.push({ id: 'deload', kind: 'deload', share: DELOAD_SHARE, cause: 'deload', until: addDays(i.nextWeekStart, 7), title: 'A lighter week', reason: `${down.length} lifts dropped across two sessions ${why}. One week at about ${Math.round(DELOAD_SHARE * 100)}% of your sets, same weights, then back.` })
  } else if (busy) {
    if (rule?.easy) holds.push({ kind: 'volume', reason: 'Training stays as it is this week, with nothing added.' })
  } else {
    const cand: { score: number; change: Change }[] = []
    for (const [m, a] of Object.entries(plan.muscleSets)) {
      const r = Math.round(a)
      if (r <= 0 || touched.has(m)) continue
      const st = muscleStatus(lifts, m)
      if (st === null) continue
      const done = last?.muscles[m] ?? 0, f = finding(model, 'sets', m), band = f?.confidence === 'personal' ? (f.best as Band) : null, nm = muscleLabel(m)
      if (st === 'down' && (under || r >= SET_BANDS.high[0]) && r - 2 >= 4) {
        cand.push({ score: 3, change: setsChange(m, r, r - 2, 'recovery', under ? `${nm} lifts dropped while you are eating under maintenance. A little less work lets them recover.` : `${nm} lifts dropped at ${r} sets a week. A little less work lets them recover.`) })
        continue
      }
      if (st !== 'flat') continue
      if (band && SET_BANDS[band] && r >= SET_BANDS[band][1] && r - 2 >= 4) { cand.push({ score: 2, change: setsChange(m, r, r - 2, 'personal', `Your own logs show your ${nm.toLowerCase()} lifts move best at fewer weekly sets than this.`) }); continue }
      if (done < r * 0.8) continue
      const cap = band ? Math.min(20, SET_BANDS[band][1] === Infinity ? 20 : SET_BANDS[band][1]) : 20
      if (!(r + 2 > cap || under)) cand.push({ score: r < 10 ? 2 : 1, change: setsChange(m, r, r + 2, 'progress', r < 10 ? `${nm} lifts have not moved in 4 weeks at ${r} sets a week, under the range most people grow on.` : `${nm} lifts have not moved in 4 weeks, and you are doing the planned work.`) })
    }
    cand.sort((a, b) => b.score - a.score || a.change.id.localeCompare(b.change.id)).slice(0, 3).forEach((c) => changes.push(c.change))
    let n = 0
    for (const s of i.stalls) {
      if (n >= 2) break
      if (s.cause === 'variation' && s.variationKey && plan.keys.includes(s.key) && !used.has(s.variationKey) && !changes.some((c) => c.kind === 'swap' && c.fromKey === s.key)) {
        used.add(s.variationKey); n++
        changes.push({ id: `swap:${s.key}`, kind: 'swap', fromKey: s.key, toKey: s.variationKey, cause: 'stall', until: null, title: `${i.exName(s.key)} to ${i.exName(s.variationKey)}`, reason: 'This lift has stalled with frequency, effort and sets all in place. A close variation gives it a new stimulus.' })
      }
    }
  }
  if (model.stage.learning) notes.push(`Learning your patterns, week ${Math.max(1, model.stage.week)} of ${model.stage.of}. Until then the plan uses research defaults.`)
  return { weekStart: i.nextWeekStart, stage: model.stage, maintenance: model.maintenance, changes, holds, warnings, notes }
}

/** The weekly report opens Sunday 18:00. Returns that week's Monday and the next Monday. */
export function reportWindow(now: Date): { open: string; next: string; started: boolean } {
  const pad = (n: number) => String(n).padStart(2, '0')
  const ds = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
  const today = ds(now), mon = mondayStr(today)
  const sunday1800 = new Date(`${addDays(mon, 6)}T18:00:00`)
  const open = now >= sunday1800 ? mon : addDays(mon, -7)
  const next = addDays(open, 7)
  return { open, next, started: today >= next }
}

// ───────── "Try a different plan" (their `Re`) ─────────
const WI_RANGE = { research: 0.12, learning: 0.08, personal: 0.05 } as const
export type WhatIf = {
  weeks: 8; allowed: boolean; floor: number
  weight: { mid: number; lo: number; hi: number; perWeek: number } | null
  lift: { now: number; mid: number; lo: number; hi: number; personal: boolean } | null
}
export function whatIf(i: { model: Model; weightKg: number; bmrKcal: number | null; kcal: number; lift: { exerciseId: string; muscle: string; sets: number } | null }): WhatIf {
  const { model, weightKg, kcal } = i, floor = kcalFloor(i.bmrKcal)
  let weight: WhatIf['weight'] = null
  if (model.maintenance) {
    const m = model.maintenance.value, k = WI_RANGE[model.maintenance.confidence]
    const at = (x: number) => weightKg + (kcal - x) * 7 / KCAL_PER_KG * 8
    weight = { mid: at(m), lo: at(m * (1 + k)), hi: at(m * (1 - k)), perWeek: (kcal - m) * 7 / KCAL_PER_KG }
  }
  let lift: WhatIf['lift'] = null
  const t = i.lift ? model.lifts[i.lift.exerciseId] : undefined
  if (i.lift && t) {
    let n = t.weekly, personal = false
    const sets = finding(model, 'sets', i.lift.muscle)
    if (sets?.confidence === 'personal') {
      const g = sets.groups.find((x) => x.cond === setBand(i.lift!.sets))
      if (g && g.n >= 5) { n = g.mean; personal = true }
    }
    const en = finding(model, 'energy', 'all')
    if (en?.confidence === 'personal' && model.maintenance) {
      const cond = kcal <= model.maintenance.value - 250 ? 'deficit' : 'fed'
      const fed = en.groups.find((x) => x.cond === 'fed'), cur = en.groups.find((x) => x.cond === cond)
      if (fed && cur) n += cur.mean - fed.mean
    }
    const spread = t.spread * Math.sqrt(8), mid = t.latest * (1 + n) ** 8
    lift = { now: t.latest, mid, lo: mid * (1 - spread), hi: mid * (1 + spread), personal }
  }
  return { weeks: 8, allowed: kcal >= floor, floor, weight, lift }
}
