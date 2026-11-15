// Ported logic: e1RM (Epley, RIR-adjusted), per-session performance, 8 PR types, direct/indirect muscle sets,
// balance ratios, stall detection and strength standards.
import { LIBRARY, findByName, FALLBACK, type Exercise, type Muscle, MUSCLES } from '../data/exerciseDb'
import type { CustomExercise, Workout, WSet, WEx } from './db'
import { daysBetween, parseDate, shiftDate } from './util'
import variations from '../data/db/variations.json'

const customToEx = (c: CustomExercise): Exercise => ({ ...c, key: `custom:${c.id}`, custom: true })

export function buildExerciseIndex(customs: CustomExercise[]) {
  const map = new Map<string, Exercise>()
  for (const e of LIBRARY) map.set(e.key, e)
  for (const c of customs) map.set(`custom:${c.id}`, customToEx(c))
  return {
    all: [...map.values()],
    get(key: string, name?: string): Exercise {
      return map.get(key) ?? (name ? findByName(name) : undefined) ?? FALLBACK(key, name ?? key)
    },
  }
}
export type ExIndex = ReturnType<typeof buildExerciseIndex>

export const isDone = (s: WSet) => s.done
export const isWork = (s: WSet) => s.done && s.setType !== 'warmup'

/** Epley e1RM; reps in reserve count towards the effective rep count. Valid for 1–10 reps. */
export function e1rm(w: number | null, reps: number | null, rir: number | null = null): number | null {
  if (w === null || reps === null || !(w > 0) || !Number.isInteger(reps) || reps < 1 || reps > 10) return null
  const eff = reps + (rir !== null && rir > 0 && reps + rir <= 10 ? rir : 0)
  return eff === 1 ? w : w * (1 + eff / 30)
}

const e1rmApplies = (x: Exercise) => x.tracking === 'weight_reps'
const isLoaded = (s: WSet, x: Exercise) => x.tracking === 'weight_reps' && isWork(s) && (s.weightKg ?? 0) > 0 && (s.reps ?? 0) > 0

export const unilateral = (s: WSet) => s.repsLeft != null || s.repsRight != null
export const totalReps = (s: WSet) => (unilateral(s) ? (s.repsLeft ?? 0) + (s.repsRight ?? 0) : s.reps ?? 0)

/** Volume (kg) of one set. Per-hand lifts count both hands. */
export function setVolume(s: WSet, x: Exercise): number {
  if (!isLoaded(s, x)) return 0
  if (unilateral(s)) return (s.weightKg ?? 0) * totalReps(s)
  return (s.weightKg ?? 0) * (s.reps ?? 0) * (x.loadMode === 'per_hand' ? 2 : 1)
}
export const workoutVolume = (w: Workout, idx: ExIndex) =>
  w.exercises.reduce((a, e) => a + e.sets.reduce((b, s) => b + setVolume(s, idx.get(e.key, e.name)), 0), 0)

export type Session = {
  workoutId: number
  date: string
  exerciseKey: string
  bestE1rm: number | null
  bestE1rmSet: WSet | null
  chartE1rm: number | null
  heaviestLoad: number | null
  mostReps: number | null
  longestDuration: number | null
  longestDistance: number | null
  bestSetVolume: number | null
  sessionVolume: number | null
  sessionReps: number | null
}

export function sessionPerf(x: Exercise, e: WEx, workoutId: number, date: string): Session {
  const d: Session = {
    workoutId, date, exerciseKey: e.key, bestE1rm: null, bestE1rmSet: null, chartE1rm: null, heaviestLoad: null, mostReps: null,
    longestDuration: null, longestDistance: null, bestSetVolume: null, sessionVolume: null, sessionReps: null,
  }
  let low: number | null = null
  for (const s of e.sets) {
    if (isLoaded(s, x)) {
      const v = e1rmApplies(x) ? e1rm(s.weightKg, s.reps, s.rir) : null
      if (v !== null && (d.bestE1rm === null || v > d.bestE1rm)) { d.bestE1rm = v; d.bestE1rmSet = s }
      if (v !== null && (s.reps ?? 0) <= 6 && (low === null || v > low)) low = v
      const w = s.weightKg ?? 0
      if (d.heaviestLoad === null || w > d.heaviestLoad) d.heaviestLoad = w
      const sv = setVolume(s, x)
      d.sessionVolume = (d.sessionVolume ?? 0) + sv
      if (d.bestSetVolume === null || sv > d.bestSetVolume) d.bestSetVolume = sv
    }
    if (x.tracking === 'weighted_bodyweight' && isWork(s) && (s.weightKg ?? 0) > 0 && (s.reps ?? 0) > 0) {
      const w = s.weightKg ?? 0
      if (d.heaviestLoad === null || w > d.heaviestLoad) d.heaviestLoad = w
    }
    if ((x.tracking === 'duration' || x.tracking === 'cardio') && isWork(s) && (s.durationSec ?? 0) > 0) {
      const t = s.durationSec ?? 0
      if (d.longestDuration === null || t > d.longestDuration) d.longestDuration = t
    }
    if ((x.tracking === 'distance' || x.tracking === 'cardio') && isWork(s) && (s.distanceM ?? 0) > 0) {
      const t = s.distanceM ?? 0
      if (d.longestDistance === null || t > d.longestDistance) d.longestDistance = t
    }
    if ((x.tracking === 'bodyweight_reps' || x.tracking === 'assisted_bodyweight' || x.tracking === 'weighted_bodyweight') && isWork(s) && (s.reps ?? 0) > 0) {
      const r = s.reps ?? 0
      d.sessionReps = (d.sessionReps ?? 0) + totalReps(s)
      if (d.mostReps === null || r > d.mostReps) d.mostReps = r
    }
  }
  d.chartE1rm = low ?? d.bestE1rm
  return d
}

export type FinishedWorkout = Workout & { id: number }
export const finished = (ws: Workout[]) => ws.filter((w): w is FinishedWorkout => !!w.finishedAt && w.id !== undefined).sort((a, b) => a.date.localeCompare(b.date) || a.startedAt - b.startedAt)

export function sessionsByExercise(ws: Workout[], idx: ExIndex): Map<string, Session[]> {
  const m = new Map<string, Session[]>()
  for (const w of finished(ws)) for (const e of w.exercises) {
    const arr = m.get(e.key) ?? []
    arr.push(sessionPerf(idx.get(e.key, e.name), e, w.id, w.date))
    m.set(e.key, arr)
  }
  return m
}

export type PrType = 'e1rm' | 'load' | 'set_volume' | 'session_volume' | 'reps' | 'session_reps' | 'duration' | 'distance'
export const PR_LABEL: Record<PrType, string> = {
  e1rm: 'Estimated 1RM', load: 'Heaviest load', set_volume: 'Best set volume', session_volume: 'Best session volume',
  reps: 'Most reps', session_reps: 'Most session reps', duration: 'Longest time', distance: 'Longest distance',
}
export type PR = { id: string; type: PrType; exerciseKey: string; workoutId: number; date: string; value: number; previousBest: number; weightKg: number | null; reps: number | null }

const EPS = 0.01
export function detectPRs(map: Map<string, Session[]>): PR[] {
  const out: PR[] = []
  for (const [key, list] of map) {
    const best: Partial<Record<PrType, number>> = {}
    for (const r of list) {
      const push = (type: PrType, value: number, prev: number, w: number | null, reps: number | null) =>
        out.push({ id: `${r.workoutId}:${key}:${type}`, type, exerciseKey: key, workoutId: r.workoutId, date: r.date, value, previousBest: prev, weightKg: w, reps })
      const check = (type: PrType, v: number | null, eps: number, w: number | null, reps: number | null) => {
        if (v === null) return
        const prev = best[type]
        if (prev !== undefined && v > prev + eps) push(type, v, prev, w, reps)
        best[type] = Math.max(prev ?? 0, v)
      }
      check('e1rm', r.bestE1rm, EPS, r.bestE1rmSet?.weightKg ?? null, r.bestE1rmSet?.reps ?? null)
      check('load', r.heaviestLoad, EPS, r.heaviestLoad, null)
      check('reps', r.mostReps, 0, null, r.mostReps)
      check('set_volume', r.bestSetVolume !== null && r.bestSetVolume > 0 ? r.bestSetVolume : null, EPS, null, null)
      check('session_volume', r.sessionVolume !== null && r.sessionVolume > 0 ? r.sessionVolume : null, EPS, null, null)
      check('session_reps', r.sessionReps, 0, null, null)
      check('duration', r.longestDuration, 0, null, null)
      check('distance', r.longestDistance, EPS, null, null)
    }
  }
  return out.sort((a, b) => b.date.localeCompare(a.date))
}

export function currentBests(list: Session[]) {
  const max = (f: (s: Session) => number | null) => list.reduce<number | null>((a, s) => { const v = f(s); return v === null ? a : a === null ? v : Math.max(a, v) }, null)
  return {
    e1rm: max((s) => s.bestE1rm), load: max((s) => s.heaviestLoad), reps: max((s) => s.mostReps),
    setVolume: max((s) => s.bestSetVolume), sessionVolume: max((s) => s.sessionVolume), duration: max((s) => s.longestDuration), distance: max((s) => s.longestDistance),
  }
}

/** PRs achieved by one workout (used for the summary screen). */
export function prsForWorkout(allWorkouts: Workout[], workoutId: number, idx: ExIndex): PR[] {
  return detectPRs(sessionsByExercise(allWorkouts, idx)).filter((p) => p.workoutId === workoutId)
}

// ───────── muscle volume ─────────
const INDIRECT = 0.5
const nearFailure = (s: WSet) => s.rir === null || s.rir <= 4

export function muscleSets(ws: Workout[], idx: ExIndex, from: string, to: string) {
  const m = new Map<Muscle, { direct: number; indirect: number }>(MUSCLES.map((k) => [k, { direct: 0, indirect: 0 }]))
  for (const w of ws) {
    if (!w.finishedAt || w.date < from || w.date > to) continue
    for (const e of w.exercises) {
      const x = idx.get(e.key, e.name)
      const n = e.sets.filter((s) => isWork(s) && nearFailure(s)).length
      if (!n) continue
      m.get(x.primary)!.direct += n
      for (const sec of x.secondary) if (sec !== x.primary) m.get(sec)!.indirect += n
    }
  }
  return MUSCLES.map((k) => ({ muscle: k, direct: m.get(k)!.direct, indirect: m.get(k)!.indirect, weighted: m.get(k)!.direct + m.get(k)!.indirect * INDIRECT }))
}

export function balance(ws: Workout[], idx: ExIndex, today: string) {
  const from = shiftDate(today, -27)
  const sets = new Map<Muscle, number>()
  let shoulderCompound = 0
  for (const w of ws) {
    if (!w.finishedAt || w.date < from || w.date > today) continue
    for (const e of w.exercises) {
      const x = idx.get(e.key, e.name)
      const n = e.sets.filter(isWork).length
      sets.set(x.primary, (sets.get(x.primary) ?? 0) + n)
      if (x.primary === 'shoulders' && x.category === 'compound') shoulderCompound += n
    }
  }
  const sum = (ks: Muscle[]) => ks.reduce((a, k) => a + (sets.get(k) ?? 0), 0)
  const row = (label: string, aL: string, a: number, bL: string, b: number, range: [number, number]) => {
    const ratio = b > 0 ? a / b : null
    const verdict = a + b < 20 ? 'too_little' : ratio === null || ratio > range[1] ? 'a_heavy' : ratio < range[0] ? 'b_heavy' : 'balanced'
    return { label, aL, a, bL, b, ratio, range, verdict }
  }
  const push = (sets.get('chest') ?? 0) + (sets.get('triceps') ?? 0) + shoulderCompound
  return [
    row('Push vs pull', 'Push', push, 'Pull', sum(['back', 'biceps']), [0.67, 1.5]),
    row('Quads vs hamstrings', 'Quads', sets.get('quads') ?? 0, 'Hamstrings', sets.get('hamstrings') ?? 0, [0.67, 2]),
    row('Upper vs lower', 'Upper', sum(['chest', 'back', 'shoulders', 'biceps', 'triceps']), 'Lower', sum(['quads', 'hamstrings', 'glutes', 'adductors', 'calves']), [0.67, 2]),
  ]
}

export function daysSinceMuscle(ws: Workout[], idx: ExIndex, today: string) {
  const last = new Map<Muscle, string>()
  for (const w of ws) {
    if (!w.finishedAt) continue
    for (const e of w.exercises) {
      if (!e.sets.some(isWork)) continue
      const p = idx.get(e.key, e.name).primary
      if (!last.get(p) || w.date > last.get(p)!) last.set(p, w.date)
    }
  }
  return MUSCLES.map((m) => ({ muscle: m, lastDate: last.get(m) ?? null, daysSince: last.has(m) ? daysBetween(last.get(m)!, today) : null }))
}

// ───────── progression helpers ─────────
/** Slope of best e1RM over the last N weeks (kg / week), needs ≥4 sessions over ≥3 weeks. */
export function e1rmSlope(list: Session[], today: string, weeks = 8): number | null {
  const from = shiftDate(today, -weeks * 7)
  const pts = list.filter((s) => s.bestE1rm !== null && s.date >= from && s.date <= today)
  if (pts.length < 4 || daysBetween(pts[0].date, pts[pts.length - 1].date) < 21) return null
  const xs = pts.map((p) => parseDate(p.date).getTime() / 6048e5), ys = pts.map((p) => p.bestE1rm as number)
  const mx = xs.reduce((a, b) => a + b, 0) / xs.length, my = ys.reduce((a, b) => a + b, 0) / ys.length
  let num = 0, den = 0
  xs.forEach((x, i) => { num += (x - mx) * (ys[i] - my); den += (x - mx) ** 2 })
  return den === 0 ? null : num / den
}

const median = (a: number[]) => { const t = [...a].sort((x, y) => x - y), n = t.length >> 1; return t.length % 2 ? t[n] : (t[n - 1] + t[n]) / 2 }

export type StallCause = 'break' | 'frequency' | 'effort' | 'volume' | 'variation' | 'same_load' | 'deload' | 'rep_range'
export type Stall = { key: string; bestKg: number; bestReps: number; bestDate: string; weeks: number; sessionsSince: number; cause: StallCause; text: string; variationKey?: string; targetKg?: number; reps?: [number, number] }
const VARIATIONS = variations as Record<string, string[]>
/** Weight-reps exercises (≥4 sessions, trained in last 14 days) whose best set hasn't moved for ≥3 weeks. Cause ladder is theirs. */
export function detectStalls(ws: Workout[], idx: ExIndex, today: string, experience: string = 'intermediate'): Stall[] {
  const per = new Map<string, { date: string; sets: { w: number; r: number; rir: number | null }[] }[]>()
  for (const w of finished(ws)) for (const e of w.exercises) {
    const x = idx.get(e.key, e.name)
    const sets = e.sets.filter((s) => isLoaded(s, x) && s.setType !== 'drop').map((s) => ({ w: s.weightKg as number, r: s.reps as number, rir: s.rir }))
    if (!sets.length) continue
    const arr = per.get(e.key) ?? []
    const last = arr[arr.length - 1]
    if (last && last.date === w.date) last.sets.push(...sets); else arr.push({ date: w.date, sets })
    per.set(e.key, arr)
  }
  const lastTrained = new Map<string, string>()
  for (const [k, l] of per) lastTrained.set(k, l[l.length - 1].date)
  const out: Stall[] = []
  for (const [key, list] of per) {
    if (list.length < 4 || daysBetween(list[list.length - 1].date, today) > 14) continue
    // best session: heaviest set that wasn't dominated by an earlier set, with an 80% floor of the running max
    const seen: { w: number; r: number }[] = []
    let runMax = 0
    let best = { index: 0, w: 0, r: 0 }
    list.forEach((s, i) => {
      const top = Math.max(...s.sets.map((q) => q.w))
      const floor = Math.max(runMax, top) * 0.8
      let cand: { w: number; r: number } | null = null
      for (const q of s.sets) {
        if (q.w + 1e-9 < floor) continue
        if (!seen.some((p) => p.w >= q.w - 1e-9 && p.r >= q.r) && (!cand || q.w > cand.w || (q.w === cand.w && q.r > cand.r))) cand = { w: q.w, r: q.r }
      }
      for (const q of s.sets) if (!seen.some((p) => p.w >= q.w - 1e-9 && p.r >= q.r)) seen.push(q)
      runMax = Math.max(runMax, top)
      if (cand) best = { index: i, ...cand }
    })
    const peak = list[best.index]
    const since = list.slice(best.index + 1)
    const weeks = Math.floor(daysBetween(peak.date, today) / 7)
    if (weeks < 3 || since.length < 3) continue
    const base = { key, bestKg: best.w, bestReps: best.r, bestDate: peak.date, weeks, sessionsSince: since.length }
    let gap = 0
    ;[peak, ...since].forEach((s, i, a) => { if (i) gap = Math.max(gap, daysBetween(a[i - 1].date, s.date)) })
    if (gap >= 21) { out.push({ ...base, cause: 'break', text: `A ${Math.floor(gap / 7)}-week gap in training explains this. Rebuild gradually.` }); continue }
    const span = Math.max(1, daysBetween(peak.date, list[list.length - 1].date) / 7)
    if (since.length / span < 0.75) { out.push({ ...base, cause: 'frequency', text: 'Trained less than once a week since your best. Train it more often before changing anything.' }); continue }
    const allSets = since.flatMap((s) => s.sets), rirs = allSets.map((s) => s.rir).filter((r): r is number => r !== null)
    if (rirs.length >= allSets.length / 2 && rirs.length && median(rirs) >= 3) { out.push({ ...base, cause: 'effort', text: `Median ${median(rirs)} reps in reserve. Push sets closer to failure (1–2 RIR).` }); continue }
    const before = list.filter((s, i) => i <= best.index && daysBetween(s.date, peak.date) <= 42)
    const setsBefore = before.reduce((a, s) => a + s.sets.length, 0) / before.length
    const setsNow = allSets.length / since.length
    if (before.length >= 2 && setsNow < setsBefore * 0.75) {
      out.push({ ...base, cause: 'volume', text: `You're doing ${Math.round(setsNow * 10) / 10} sets a session now, down from ${Math.round(setsBefore * 10) / 10} when you set your best. Bring the sets back up.` }); continue
    }
    const tops = since.map((s) => Math.max(...s.sets.map((q) => q.w)))
    if (tops.every((t) => Math.abs(t - tops[0]) < 1e-6)) { out.push({ ...base, cause: 'same_load', text: `Same top load (${tops[0]} kg) every session. Aim to add a rep each session, then add weight.` }); continue }
    const topReps = median(since.map((s) => s.sets.reduce((m, q) => (q.w > m.w ? q : m)).r))
    const x = idx.get(key)
    const peakE1 = x.tracking === 'weight_reps' ? Math.max(...since.flatMap((s) => s.sets.map((q) => e1rm(q.w, q.r, q.rir) ?? 0))) : 0
    if (weeks >= 6) {
      const recent = new Set([...lastTrained].filter(([, d]) => daysBetween(d, today) < 42).map(([k]) => k))
      const fromMap = (VARIATIONS[key] ?? []).filter((k) => k !== key)
      const similar = idx.all
        .filter((e) => !e.custom && e.key !== key && e.primary === x.primary && e.tracking === 'weight_reps')
        .sort((a, b) => Number(a.category !== x.category) - Number(b.category !== x.category) || Number(b.equipment === x.equipment) - Number(a.equipment === x.equipment))
        .map((e) => e.key)
      const pool = [...fromMap, ...similar]
      const pick = pool.find((k) => !recent.has(k)) ?? pool[0]
      out.push({ ...base, cause: 'variation', variationKey: pick, text: pick ? `Stuck for ${weeks} weeks. Swap in ${idx.get(pick).name} for 4–6 weeks, then come back.` : `Stuck for ${weeks} weeks. Swap in a close variation for 4–6 weeks, then come back.` }); continue
    }
    if (weeks >= 4 || experience === 'advanced') { const t = Math.max(...tops) * 0.9; out.push({ ...base, cause: 'deload', targetKg: t, text: `Try a short deload (about ${Math.round(t)} kg) then rebuild.` }); continue }
    const reps: [number, number] = topReps >= 8 ? [5, 7] : [8, 12]
    const tk = peakE1 > 0 ? peakE1 / (1 + (reps[0] === 5 ? 6 : 10) / 30) : undefined
    out.push({ ...base, cause: 'rep_range', reps, targetKg: tk, text: `Change the rep range to ${reps[0]}–${reps[1]} for a few weeks${tk ? ` (around ${Math.round(tk)} kg)` : ''} and rebuild.` })
  }
  return out.sort((a, b) => b.weeks - a.weeks)
}

// ───────── strength standards (×bodyweight, male / female) ─────────
export const LEVELS = ['Beginner', 'Novice', 'Intermediate', 'Advanced', 'Elite']
export const STANDARDS: Record<string, { name: string; male: number[]; female: number[] }> = {
  'back-squat': { name: 'Squat', male: [0.75, 1.25, 1.5, 2.25, 2.75], female: [0.5, 0.75, 1.25, 1.5, 1.75] },
  'barbell-bench-press': { name: 'Bench press', male: [0.5, 0.75, 1.25, 1.75, 2], female: [0.25, 0.5, 0.75, 1, 1.25] },
  deadlift: { name: 'Deadlift', male: [1, 1.5, 2, 2.5, 3], female: [0.5, 1, 1.25, 1.75, 2.25] },
  'overhead-press': { name: 'Overhead press', male: [0.35, 0.55, 0.8, 1.05, 1.35], female: [0.2, 0.35, 0.5, 0.75, 1] },
  'barbell-row': { name: 'Barbell row', male: [0.5, 0.75, 1, 1.5, 1.75], female: [0.25, 0.4, 0.65, 0.9, 1.2] },
}
export function strengthLevels(map: Map<string, Session[]>, today: string, bodyKg: number | null, sex: string) {
  if (!bodyKg || (sex !== 'male' && sex !== 'female')) return []
  const from = shiftDate(today, -84)
  const out: { key: string; name: string; e1rm: number; ratio: number; level: string | null; next: string | null; nextKg: number | null; progress: number }[] = []
  for (const [key, std] of Object.entries(STANDARDS)) {
    const list = (map.get(key) ?? []).filter((s) => s.bestE1rm !== null && s.date >= from)
    if (!list.length) continue
    const best = Math.max(...list.map((s) => s.bestE1rm as number))
    const th = std[sex], ratio = best / bodyKg
    let lv = -1
    th.forEach((t, i) => { if (ratio >= t) lv = i })
    const base = lv >= 0 ? th[lv] : 0, nxt = th[lv + 1] ?? null
    out.push({ key, name: std.name, e1rm: best, ratio, level: lv >= 0 ? LEVELS[lv] : null, next: lv + 1 < LEVELS.length ? LEVELS[lv + 1] : null, nextKg: nxt === null ? null : nxt * bodyKg, progress: nxt === null ? 1 : Math.min(1, Math.max(0, (ratio - base) / (nxt - base))) })
  }
  return out
}

// ───────── rest timing ─────────
export function bestWeek(ws: Workout[], from: string, to: string) {
  return ws.filter((w) => w.finishedAt && w.date >= from && w.date <= to)
}

// ───────── DOTS (ported from the bundle's `standards` module) ─────────
const DOTS_COEF = {
  male: [-307.75076, 24.0900756, -0.1918759221, 0.0007391293, -1.093e-6],
  female: [-57.96288, 13.6175032, -0.1126655495, 0.0005158568, -1.0706e-6],
}
export function dotsScore(totalKg: number, bodyKg: number, sex: 'male' | 'female'): number {
  const r = Math.min(Math.max(bodyKg, 40), sex === 'male' ? 210 : 150)
  const [a, b, c, d, e] = DOTS_COEF[sex]
  return (totalKg * 500) / (a + b * r + c * r ** 2 + d * r ** 3 + e * r ** 4)
}
/** Squat + bench + deadlift best e1RM over the last 12 weeks, scored with DOTS. null unless all three exist. */
export function dotsFromSessions(map: Map<string, Session[]>, today: string, bodyKg: number | null, sex: string) {
  if (!bodyKg || (sex !== 'male' && sex !== 'female')) return null
  const from = shiftDate(today, -84)
  const best = (k: string) => {
    const v = (map.get(k) ?? []).filter((s) => s.bestE1rm !== null && s.date >= from && s.date <= today).map((s) => s.bestE1rm as number)
    return v.length ? Math.max(...v) : null
  }
  const parts = ['back-squat', 'barbell-bench-press', 'deadlift'].map(best)
  if (parts.some((p) => p === null)) return null
  const totalKg = (parts as number[]).reduce((a, b) => a + b, 0)
  return { score: dotsScore(totalKg, bodyKg, sex), totalKg }
}
