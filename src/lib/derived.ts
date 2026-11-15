import type { BodyWeight, Workout, WSet } from './db'
import { liftingKcal } from './burn'

/** Body weight on or before `date` (falls back to the earliest entry). */
export function weightOn(ws: BodyWeight[], date: string): number | null {
  if (!ws.length) return null
  const s = [...ws].sort((a, b) => a.date.localeCompare(b.date) || (a.id ?? 0) - (b.id ?? 0))
  const before = s.filter((w) => w.date <= date)
  return (before.length ? before[before.length - 1] : s[0]).kg
}

export const workoutMinutes = (w: Workout) => (w.finishedAt ? Math.max(1, Math.round((w.finishedAt - w.startedAt) / 60000)) : 0)

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
