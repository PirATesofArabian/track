// Calculations from the Macrotrophy "science" page that are not part of the older ports:
// relative strength, real-change test, progression suggestion, frequency, adherence, load ratio, session load,
// set records, weekly rings, deficit "holding" and the per-exercise muscle-region shares.
import type { Exercise } from '../data/exerciseDb'
import regionsJson from '../data/db/regions.json'
import regionSourcesJson from '../data/db/regionSources.json'
import type { BodyWeight, FoodEntry, Measurement, Profile, Routine, Workout, WSet } from './db'
import { bodySnapshot } from './body'
import { MIN_LOGGED_KCAL, dayTotals, realMaintenance } from './foodinsights'
import { mondayOfDate } from './adaptive'
import { isWork, type Session } from './perf'
import { daysBetween, shiftDate } from './util'

// ───────── effort ─────────
/** RPE equals 10 minus reps in reserve. */
export const rpeFromRir = (rir: number) => 10 - rir

// ───────── relative strength ─────────
export const SIZE_EXPONENT = 0.67
/** Body weight on or before the day, else the first weigh-in within 8 days after it. Not shown when older than 90 days. */
export function bodyMassOn(ws: BodyWeight[], date: string): number | null {
  let before: BodyWeight | null = null, after: BodyWeight | null = null
  for (const w of ws) {
    if (w.date <= date) { if (!before || w.date > before.date || (w.date === before.date && (w.id ?? 0) > (before.id ?? 0))) before = w }
    else if (daysBetween(date, w.date) <= 8 && (!after || w.date < after.date)) after = w
  }
  if (before) return daysBetween(before.date, date) > 90 ? null : before.kg
  return after ? after.kg : null
}
/** R = e1RM / m (shown) and Sₙ = e1RM / m^0.67 (size-adjusted index). */
export function relativeStrength(e: number, kg: number | null) {
  if (!kg || kg <= 0) return null
  return { ratio: e / kg, sized: e / kg ** SIZE_EXPONENT, kg }
}

// ───────── what counts as real progress ─────────
export const REAL_CHANGE = 0.05
export const MIN_SESSIONS = 3
export type RealChange = { change: number; sizedChange: number | null; sessions: number; verdict: 'up' | 'down' | 'flat'; forSize: boolean }
/** Best e1RM of the last 4 weeks against the 4 weeks before; needs ≥3 sessions. A change counts only at 5% or more. */
export function realChange(list: Session[], weights: BodyWeight[], today: string): RealChange | null {
  const cut = shiftDate(today, -28), start = shiftDate(today, -56)
  const pts = list.filter((s) => s.bestE1rm !== null && s.date > start && s.date <= today)
  const best = (a: Session[]) => a.reduce<Session | null>((m, s) => (!m || (s.bestE1rm as number) > (m.bestE1rm as number) ? s : m), null)
  const now = best(pts.filter((s) => s.date > cut)), then = best(pts.filter((s) => s.date <= cut))
  if (pts.length < MIN_SESSIONS || !now || !then) return null
  const change = (now.bestE1rm as number) / (then.bestE1rm as number) - 1
  const a = relativeStrength(now.bestE1rm as number, bodyMassOn(weights, now.date)), b = relativeStrength(then.bestE1rm as number, bodyMassOn(weights, then.date))
  const sizedChange = a && b ? a.sized / b.sized - 1 : null
  const verdict = change >= REAL_CHANGE ? 'up' : change <= -REAL_CHANGE ? 'down' : 'flat'
  return { change, sizedChange, sessions: pts.length, verdict, forSize: verdict === 'flat' && sizedChange !== null && sizedChange >= REAL_CHANGE }
}

// ───────── progression suggestion (double progression) ─────────
const LOWER = new Set(['quads', 'hamstrings', 'glutes', 'adductors', 'calves'])
const firstNumber = (s?: string) => { const m = s?.match(/\d+(\.\d+)?/); return m ? +m[0] : null }
export type Suggestion = { kind: 'add_load'; kg: number; reps: number; text: string } | { kind: 'add_rep'; text: string }
/**
 * Fill the rep range, then add load. Every working set must reach the top of the range (the bottom for a beginner), with logged
 * RIR at or above the target less half a rep. Next load = heaviest working set + 2.5 kg, or 5 kg for beginners on lower-body barbell lifts.
 */
export function suggestNext(prev: WSet[], target: { repMin: number; repMax: number; rir?: string } | undefined, x: Exercise, experience: string): Suggestion | null {
  if (!target?.repMax || x.tracking !== 'weight_reps') return null
  const work = prev.filter((s) => isWork(s) && (s.weightKg ?? 0) > 0 && (s.reps ?? 0) > 0)
  if (!work.length) return null
  const need = experience === 'beginner' ? target.repMin : target.repMax
  const tr = firstNumber(target.rir)
  const effortOk = work.every((s) => s.rir === null || tr === null || s.rir >= tr - 0.5)
  if (!work.every((s) => (s.reps ?? 0) >= need) || !effortOk) return { kind: 'add_rep', text: `Aim to add a rep on each set (${target.repMin}–${target.repMax}) before adding load.` }
  const step = experience === 'beginner' && LOWER.has(x.primary) && x.equipment === 'barbell' ? 5 : 2.5
  const top = Math.max(...work.map((s) => s.weightKg as number)), kg = Math.round((top + step) * 100) / 100
  return { kind: 'add_load', kg, reps: target.repMin, text: `Every set reached ${need} reps. Next time try ${kg} kg for ${target.repMin} reps.` }
}

// ───────── deficit: "holding", not stalled ─────────
/** Eating in a deficit: the goal is fat loss and the trend is falling, or you log at least 250 kcal a day under maintenance. */
export function inDeficit(a: { goal: string; rateKgPerWeek: number | null; meanKcal: number | null; maintenance: number | null }): boolean {
  if (a.goal === 'fat_loss' && a.rateKgPerWeek !== null && a.rateKgPerWeek < 0) return true
  return a.meanKcal !== null && a.maintenance !== null && a.meanKcal <= a.maintenance - 250
}

/** inDeficit() worked out from the raw logs: the trend rate, and the mean of the last 14 days' logged intake against maintenance. */
export function deficitNow(a: { profile: Profile; weights: BodyWeight[]; measurements: Measurement[]; logs: FoodEntry[]; today: string }): boolean {
  const snap = bodySnapshot({ profile: a.profile, weights: a.weights, measurements: a.measurements, today: a.today, loggedDaysPerWeek: null })
  const maint = realMaintenance(a.logs, snap.trend, a.today)?.kcal ?? snap.energy?.tdee ?? null
  const days = [...dayTotals(a.logs.filter((e) => e.date >= shiftDate(a.today, -14) && e.date < a.today)).values()].filter((d) => d.kcal >= MIN_LOGGED_KCAL)
  const meanKcal = days.length >= 5 ? days.reduce((s, d) => s + d.kcal, 0) / days.length : null
  return inDeficit({ goal: a.profile.goal, rateKgPerWeek: snap.rate?.kgPerWeek ?? null, meanKcal, maintenance: maint })
}

// ───────── training frequency ─────────
export function frequency(ws: Workout[], today: string) {
  const done = ws.filter((w) => w.finishedAt && w.date <= today).sort((a, b) => a.date.localeCompare(b.date))
  if (!done.length) return null
  const days = daysBetween(done[0].date, today) + 1
  const month = today.slice(0, 7)
  return { total: done.length, days, perWeek: days >= 7 ? done.length / (days / 7) : null, thisMonth: done.filter((w) => w.date.startsWith(month)).length }
}

// ───────── adherence ─────────
export const plannedWeekdays = (routines: Routine[]) => routines.flatMap((r) => r.days.flatMap((d) => d.weekdays))
/** Completed planned sessions ÷ planned sessions × 100, over the last 4 weeks. Only days that have passed count. Null without planned days. */
export function adherence(routines: Routine[], ws: Workout[], today: string, weeks = 4) {
  const wd = plannedWeekdays(routines)
  if (!wd.length) return null
  const done = new Set(ws.filter((w) => w.finishedAt).map((w) => w.date))
  let planned = 0, completed = 0
  for (let i = 0; i < weeks * 7; i++) {
    const d = shiftDate(today, -i), dow = new Date(`${d}T12:00:00`).getDay()
    const n = wd.filter((x) => x === dow).length
    if (!n) continue
    if (i === 0 && !done.has(d)) continue // today counts once you log it
    planned += n
    if (done.has(d)) completed += 1
  }
  return planned ? { planned, completed, pct: Math.min(100, (completed / planned) * 100) } : null
}

// ───────── balance and load ─────────
const setsIn = (ws: Workout[], from: string, to: string) => ws.filter((w) => w.finishedAt && w.date >= from && w.date <= to).reduce((n, w) => n + w.exercises.reduce((m, e) => m + e.sets.filter(isWork).length, 0), 0)
/** Load ratio = sets in the last 7 days ÷ the weekly average of the 4 weeks before. Needs 5 weeks of history; flagged above 1.5. */
export function loadRatio(ws: Workout[], today: string) {
  const first = ws.filter((w) => w.finishedAt).map((w) => w.date).sort()[0]
  if (!first || daysBetween(first, today) < 35) return null
  const acute = setsIn(ws, shiftDate(today, -6), today), chronic = setsIn(ws, shiftDate(today, -34), shiftDate(today, -7)) / 4
  return chronic > 0 ? { acute, chronic, ratio: acute / chronic, spike: acute / chronic > 1.5 } : null
}
/** Foster's session load = session RPE × minutes. */
export const sessionLoad = (w: Workout) => (w.sessionRpe && w.finishedAt ? Math.round(w.sessionRpe * Math.max(1, (w.finishedAt - w.startedAt) / 60000)) : null)

// ───────── set records ─────────
/** Heaviest weight for each rep count (no medal). */
export function setRecords(ws: Workout[], x: Exercise, key: string): { reps: number; kg: number; date: string }[] {
  if (x.tracking !== 'weight_reps') return []
  const best = new Map<number, { kg: number; date: string }>()
  for (const w of ws) {
    if (!w.finishedAt) continue
    for (const e of w.exercises) {
      if (e.key !== key) continue
      for (const s of e.sets) {
        if (!isWork(s) || !(s.weightKg ?? 0) || !(s.reps ?? 0)) continue
        const cur = best.get(s.reps as number)
        if (!cur || (s.weightKg as number) > cur.kg || ((s.weightKg as number) === cur.kg && w.date < cur.date)) best.set(s.reps as number, { kg: s.weightKg as number, date: w.date })
      }
    }
  }
  return [...best].map(([reps, v]) => ({ reps, ...v })).sort((a, b) => a.reps - b.reps)
}

// ───────── weekly rings and streak ─────────
export function weeklyRings(a: { ws: Workout[]; routines: Routine[]; sessionMinutes: number | null; today: string }) {
  const start = mondayOfDate(a.today), end = shiftDate(start, 6)
  const week = a.ws.filter((w) => w.finishedAt && w.date >= start && w.date <= end)
  const planDays = a.routines.flatMap((r) => r.days).filter((d) => d.weekdays.length)
  const plannedSessions = plannedWeekdays(a.routines).length
  const plannedSets = planDays.reduce((n, d) => n + d.weekdays.length * d.exercises.reduce((m, e) => m + e.sets, 0), 0)
  const minutes = Math.round(week.reduce((n, w) => n + (w.finishedAt! - w.startedAt) / 60000, 0))
  const target = plannedSessions || 0
  // streak: consecutive weeks (ending this week if met, else last week) with at least the planned number of sessions
  let streak = 0
  if (target) {
    let i = start
    if (a.ws.filter((w) => w.finishedAt && w.date >= i && w.date <= end).length < target) i = shiftDate(i, -7)
    for (; ; i = shiftDate(i, -7)) {
      if (a.ws.filter((w) => w.finishedAt && w.date >= i && w.date <= shiftDate(i, 6)).length >= target) streak++
      else break
      if (streak > 520) break
    }
  }
  return {
    sessions: { done: week.length, planned: plannedSessions || null },
    sets: { done: week.reduce((n, w) => n + w.exercises.reduce((m, e) => m + e.sets.filter(isWork).length, 0), 0), planned: plannedSets || null },
    minutes: { done: minutes, planned: a.sessionMinutes && plannedSessions ? a.sessionMinutes * plannedSessions : null },
    streak,
  }
}

// ───────── muscle-region shares (EMG based, from the public Macrotrophy data) ─────────
export type RegionShare = { regions: { region: string; share: number }[]; confidence: 'moderate' | 'low' | string; sources: string[]; note: string }
export type RegionSource = { id: string; authors: string; year: number; title: string; journal?: string; doi?: string; url?: string; openAccess?: boolean }
const REGIONS = regionsJson as unknown as Record<string, RegionShare>
const SOURCES = regionSourcesJson as unknown as Record<string, RegionSource>
export const regionsFor = (key: string): RegionShare | null => REGIONS[key] ?? null
export const regionSource = (id: string): RegionSource | null => SOURCES[id] ?? null
