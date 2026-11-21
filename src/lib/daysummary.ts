// "Day" summary: one day against your other days, and what tomorrow should look like.
// Every rule here is this app's own (Estimate). The numbers it compares against are your targets and your own logs.
import type { ActivityLog, BodyWeight, FoodEntry, Profile, Routine, Settings, Water, Workout } from './db'
import { stepsKcal } from './burn'
import { nextPlanDay, weightOn, workoutKcal, workoutMinutes } from './derived'
import { MIN_LOGGED_KCAL } from './foodinsights'
import { isWork, sessionPerf, setVolume, type ExIndex, type Session } from './perf'
import { realChange, suggestNext } from './science'
import { setText } from './format'
import { shiftDate } from './util'

export type Inputs = { logs: FoodEntry[]; workouts: Workout[]; activity: ActivityLog[]; water: Water[]; weights: BodyWeight[]; profile: Profile }

export type DayFacts = {
  date: string
  kcal: number; p: number; c: number; f: number; fib: number; foodLogged: boolean
  waterMl: number; steps: number
  sets: number; volume: number; minutes: number; trained: boolean
  burn: number // active calories: lifting + cardio + steps
}

export function dayFacts(date: string, d: Inputs, idx: ExIndex): DayFacts {
  const food = d.logs.filter((e) => e.date === date)
  const sum = (k: 'kcal' | 'p' | 'c' | 'f') => food.reduce((a, e) => a + e[k], 0)
  const kcal = sum('kcal')
  const ws = d.workouts.filter((w) => w.finishedAt && w.date === date)
  const act = d.activity.filter((a) => a.date === date)
  const steps = act.filter((a) => a.kind === 'steps').reduce((a, x) => a + (x.steps ?? 0), 0)
  const kg = weightOn(d.weights, date)
  const stepKcal = steps && kg ? stepsKcal(steps, kg, d.profile.heightCm)?.kcal ?? 0 : 0
  const cardio = act.filter((a) => a.kind === 'cardio').reduce((a, x) => a + (x.kcal ?? 0), 0)
  const lift = ws.reduce((a, w) => a + (workoutKcal(w, d.weights)?.kcal ?? 0), 0)
  let sets = 0, volume = 0
  for (const w of ws) for (const e of w.exercises) { const x = idx.get(e.key, e.name); for (const s of e.sets) if (isWork(s)) { sets++; volume += setVolume(s, x) } }
  return {
    date, kcal, p: sum('p'), c: sum('c'), f: sum('f'), fib: food.reduce((a, e) => a + (e.fib ?? 0), 0), foodLogged: kcal >= MIN_LOGGED_KCAL,
    waterMl: d.water.find((w) => w.date === date)?.ml ?? 0, steps,
    sets, volume, minutes: ws.reduce((a, w) => a + workoutMinutes(w), 0), trained: ws.length > 0,
    burn: Math.round(lift + cardio + stepKcal),
  }
}

// ───────── this day against your other days ─────────
export type Tone = 'good' | 'off' | 'plain'
export type Row = { id: string; label: string; unit: string; value: number | null; usual: number | null; diff: number | null; place: { n: number; of: number } | null; target: number | null; targetKind: 'cap' | 'goal' | 'aim' | null; tone: Tone }
const USUAL_DAYS = 14, RANK_DAYS = 30

type Def = { id: string; label: string; unit: string; pick: (f: DayFacts) => number; use: (f: DayFacts) => boolean; target?: number; kind?: 'cap' | 'goal' | 'aim' }
const mean = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null)

export function compareDay(date: string, d: Inputs, idx: ExIndex, s: Settings): { rows: Row[]; foodDays: number; trainDays: number } {
  const facts = (n: number) => dayFacts(shiftDate(date, -n), d, idx)
  const today = facts(0)
  const past = Array.from({ length: RANK_DAYS }, (_, i) => facts(i + 1))
  const defs: Def[] = [
    { id: 'kcal', label: 'Calories eaten', unit: 'kcal', pick: (f) => f.kcal, use: (f) => f.foodLogged, target: s.kcal, kind: 'aim' },
    { id: 'p', label: 'Protein', unit: 'g', pick: (f) => f.p, use: (f) => f.foodLogged, target: s.p, kind: 'goal' },
    { id: 'c', label: 'Carbs', unit: 'g', pick: (f) => f.c, use: (f) => f.foodLogged, target: s.c, kind: 'aim' },
    { id: 'f', label: 'Fat', unit: 'g', pick: (f) => f.f, use: (f) => f.foodLogged, target: s.f, kind: 'cap' },
    { id: 'fib', label: 'Fibre', unit: 'g', pick: (f) => f.fib, use: (f) => f.foodLogged && f.fib > 0 },
    { id: 'water', label: 'Water', unit: 'ml', pick: (f) => f.waterMl, use: (f) => f.waterMl > 0, target: s.waterGoal, kind: 'goal' },
    { id: 'steps', label: 'Steps', unit: '', pick: (f) => f.steps, use: (f) => f.steps > 0, target: s.stepGoal, kind: 'goal' },
    { id: 'burn', label: 'Calories burned (active)', unit: 'kcal', pick: (f) => f.burn, use: (f) => f.burn > 0 },
    { id: 'sets', label: 'Working sets', unit: '', pick: (f) => f.sets, use: (f) => f.trained },
    { id: 'volume', label: 'Lifting volume', unit: 'kg', pick: (f) => f.volume, use: (f) => f.trained && f.volume > 0 },
    { id: 'minutes', label: 'Training time', unit: 'min', pick: (f) => f.minutes, use: (f) => f.trained },
  ]
  const rows: Row[] = defs.map((df) => {
    const value = df.use(today) ? df.pick(today) : null
    const usual = mean(past.slice(0, USUAL_DAYS).filter(df.use).map(df.pick))
    const pool = [...(value === null ? [] : [value]), ...past.filter(df.use).map(df.pick)]
    const place = value !== null && pool.length >= 5 ? { n: 1 + pool.filter((v) => v > value).length, of: pool.length } : null
    const t = df.target ?? null
    let tone: Tone = 'plain'
    if (value !== null && t) tone = df.kind === 'cap' ? (value > t ? 'off' : 'good') : df.kind === 'goal' ? (value >= t * 0.9 ? 'good' : 'off') : Math.abs(value - t) <= t * 0.1 ? 'good' : 'off'
    return { id: df.id, label: df.label, unit: df.unit, value, usual, diff: value !== null && usual !== null ? value - usual : null, place, target: t, targetKind: df.kind ?? null, tone }
  })
  return { rows, foodDays: past.slice(0, USUAL_DAYS).filter((f) => f.foodLogged).length, trainDays: past.slice(0, USUAL_DAYS).filter((f) => f.trained).length }
}

// ───────── tomorrow ─────────
export type LiftPlan = { key: string; name: string; last: string; next: string; kind: string; stalled: boolean; trend: string | null; target: string }
export type Tomorrow = {
  date: string; sessionName: string | null; after: string | null
  food: { kcal: number; p: number; c: number; f: number; waterMl: number; steps: number; perMealP: number; notes: string[] }
  lifts: LiftPlan[]
}

/** Does the lift show no gain over its last 3 sessions? The last two must not beat the one before them by 1%. */
export function stalled(sessions: Session[]): boolean {
  const e = sessions.slice(-3).map((s) => s.bestE1rm)
  if (e.length < 3 || e.some((v) => v === null)) return false
  return Math.max(e[1] as number, e[2] as number) < (e[0] as number) * 1.01
}

export function tomorrowPlan(o: { date: string; d: Inputs; idx: ExIndex; s: Settings; routines: Routine[] }): Tomorrow {
  const { date, d, idx, s } = o
  const day = dayFacts(date, d, idx), next = shiftDate(date, 1)
  const up = nextPlanDay(o.routines, d.workouts, date)
  const planned = up?.d ?? null

  const notes: string[] = []
  if (day.foodLogged) {
    if (day.f > s.f) notes.push(`Fat was ${Math.round(day.f - s.f)} g over its limit. Keep tomorrow at ${s.f} g or less. There is nothing to make up.`)
    if (day.p < s.p * 0.9) notes.push(`Protein was ${Math.round(s.p - day.p)} g short. Put protein in every meal, about ${Math.round(s.p / 4)} g each.`)
    if (day.kcal > s.kcal * 1.07) notes.push(`You ate ${Math.round(day.kcal - s.kcal)} kcal over. Do not skip meals to pay it back. Hit the same target.`)
    else if (day.kcal < s.kcal * 0.85) notes.push(`You ate ${Math.round(s.kcal - day.kcal)} kcal under. Do not try to catch up. Hit the same target.`)
  }
  if (day.waterMl > 0 && day.waterMl < s.waterGoal * 0.8) notes.push(`Water was ${Math.round(day.waterMl)} ml. Aim for ${s.waterGoal} ml.`)
  if (day.steps > 0 && day.steps < s.stepGoal * 0.8) notes.push(`Steps were ${day.steps.toLocaleString('en-IN')}. Aim for ${s.stepGoal.toLocaleString('en-IN')}.`)
  if (!notes.length) notes.push(day.foodLogged ? 'Nothing needs fixing. Repeat the same targets.' : 'No full day of food logged, so the targets stay as they are.')

  const done = d.workouts.filter((w) => w.finishedAt && w.date <= date).sort((a, b) => b.date.localeCompare(a.date) || b.startedAt - a.startedAt)
  const lifts: LiftPlan[] = (planned?.exercises ?? []).map((p) => {
    const x = idx.get(p.key)
    const mine = done.map((w) => ({ w, e: w.exercises.find((e) => e.key === p.key) })).filter((r): r is { w: Workout; e: NonNullable<typeof r.e> } => !!r.e)
    const prev = mine.map((r) => r.e.sets.filter((q) => q.done && q.setType !== 'warmup')).find((q) => q.length) ?? []
    const seen = mine.flatMap((r) => r.e.sets.filter((q) => q.done && q.setType !== 'warmup' && (q.weightKg ?? 0) > 0).map((q) => q.weightKg as number))
    const sessions = [...mine].reverse().map((r) => sessionPerf(x, r.e, r.w.id ?? 0, r.w.date))
    const target = { repMin: p.repMin, repMax: p.repMax, rir: p.rir }
    const hint = suggestNext(prev, target, x, o.d.profile.experience, seen)
    const isStalled = stalled(sessions)
    const rc = realChange(sessions, d.weights, date)
    let nextText = hint?.text ?? ''
    if (!prev.length) nextText = `No history yet. Start with a weight you can lift for ${p.sets} sets of ${p.repMin}–${p.repMax}${p.rir ? ` with ${p.rir} reps left` : ''}.`
    else if (!hint) nextText = 'Add a little time or distance on last time.'
    if (isStalled) nextText += x.tracking === 'weight_reps' ? ' No gain in 3 sessions: before adding load, add one set at the same weight. If you are tired, take a lighter week.' : ' No gain in 3 sessions.'
    return {
      key: p.key, name: x.name, last: prev.map((q) => setText(q, x)).join(' · '), next: nextText, kind: hint?.kind ?? 'none', stalled: isStalled,
      trend: rc ? `${rc.change >= 0 ? '+' : ''}${(rc.change * 100).toFixed(1)}% in 4 weeks (${rc.verdict === 'flat' ? 'not a real change yet' : rc.verdict === 'up' ? 'up' : 'down'})` : null,
      target: `${p.sets}×${p.repMin}–${p.repMax}${p.rir ? ` @${p.rir} RIR` : ''}`,
    }
  })
  return { date: next, sessionName: planned ? planned.name : null, after: up?.after ?? null, food: { kcal: s.kcal, p: s.p, c: s.c, f: s.f, waterMl: s.waterGoal, steps: s.stepGoal, perMealP: Math.round(s.p / 4), notes }, lifts }
}
