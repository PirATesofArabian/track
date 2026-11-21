import { db, type BodyWeight, type PlanDay, type Routine, type Workout, type WSet } from './db'
import { liftingKcal } from './burn'

/** Body weight on or before `date` (falls back to the earliest entry). */
export function weightOn(ws: BodyWeight[], date: string): number | null {
  if (!ws.length) return null
  const s = [...ws].sort((a, b) => a.date.localeCompare(b.date) || (a.id ?? 0) - (b.id ?? 0))
  const before = s.filter((w) => w.date <= date)
  return (before.length ? before[before.length - 1] : s[0]).kg
}

export const LONGEST_SESSION_MIN = 180
/** Start to finish. A workout left open (more than 3 hours) is not trusted: it is estimated at 4 minutes per working set instead. */
export function workoutMinutes(w: Workout): number {
  if (!w.finishedAt) return 0
  if (w.minutes && w.minutes > 0) return w.minutes
  const raw = Math.max(1, Math.round((w.finishedAt - w.startedAt) / 60000))
  if (raw <= LONGEST_SESSION_MIN) return raw
  const sets = w.exercises.reduce((n, e) => n + e.sets.filter((s) => s.done && s.setType !== 'warmup').length, 0)
  return Math.max(1, sets * 4)
}

/** Share of rated working sets within 2 reps of failure. */
export function hardShare(w: Workout): number | null {
  const sets: WSet[] = w.exercises.flatMap((e) => e.sets).filter((s) => s.done && s.setType !== 'warmup' && s.rir !== null)
  return sets.length ? sets.filter((s) => (s.rir as number) <= 2).length / sets.length : null
}

export function workoutKcal(w: Workout, weights: BodyWeight[]) {
  if (w.kcalBurned != null) return { kcal: w.kcalBurned, estimated: false, basis: 'Typed by you' }
  const kg = weightOn(weights, w.date)
  if (!kg) return null
  const e = liftingKcal(workoutMinutes(w), kg, hardShare(w))
  return e ? { kcal: e.kcal, estimated: true, basis: e.basis } : null
}

/**
 * The plan day that comes after the one you did last, in the order they are listed in the plan (wraps round). No weekday is involved,
 * so a missed or swapped day does not leave you "owing" the wrong session. With no matching history it is the first day.
 */
export function nextPlanDay(routines: Routine[], workouts: Workout[], upTo: string): { r: Routine; d: PlanDay; after: string | null } | null {
  const days = routines.flatMap((r) => r.days.map((d) => ({ r, d })))
  if (!days.length) return null
  const last = workouts.filter((w) => w.finishedAt && w.date <= upTo && w.dayName && days.some((x) => x.d.name === w.dayName))
    .sort((a, b) => b.date.localeCompare(a.date) || b.startedAt - a.startedAt)[0]
  if (!last) return { ...days[0], after: null }
  const at = days.findIndex((x) => x.d.name === last.dayName)
  return { ...days[(at + 1) % days.length], after: last.dayName ?? null }
}

// ───────── rest days ─────────
/** A rest day is a kv record "rest:YYYY-MM-DD", so it syncs with everything else. */
export const REST_PREFIX = 'rest:'
export const restDatesOf = (kv: { key: string; value: unknown }[]) => new Set(kv.filter((r) => r.key.startsWith(REST_PREFIX) && r.value).map((r) => r.key.slice(REST_PREFIX.length)))
export const setRestDay = (date: string, on: boolean) => (on ? db.kv.put({ key: REST_PREFIX + date, value: true }).then(() => undefined) : db.kv.delete(REST_PREFIX + date))
