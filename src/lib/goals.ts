// Goals, weekly check-in, milestones and rest-time analysis, ported from the Macrotrophy bundle
// (goals / milestones / rest / standards chunks). Thresholds and wording are theirs.
import type { BodyWeight, GoalRec, Workout } from './db'
import { balance, detectPRs, detectStalls, e1rmSlope, isWork, sessionsByExercise, setVolume, type ExIndex, type Session } from './perf'
import { weightRate, weightTrend } from './body'
import { daysBetween, parseDate, shiftDate } from './util'
import { mondayOfDate } from './adaptive'

const r1 = (n: number) => Math.round(n * 10) / 10
export class GoalError extends Error {}

// ───────── goal validation (their goals CRUD `s`) ─────────
export function validateGoal(g: { kind: GoalRec['kind']; exerciseKey?: string; startValue?: number | null; targetValue: number; targetDate?: string | null }, today: string) {
  if (g.kind === 'body_weight' ? !!g.exerciseKey : !g.exerciseKey) throw new GoalError('Pick an exercise.')
  if (!Number.isFinite(g.targetValue) || g.targetValue < 1 || g.targetValue > 1000) throw new GoalError('Enter a target.')
  if (g.targetDate) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(g.targetDate)) throw new GoalError('Pick a date.')
    if (g.targetDate < today) throw new GoalError('Pick a date in the future.')
  }
  if (g.kind !== 'body_weight' && g.startValue != null && g.targetValue <= g.startValue) throw new GoalError('Set a target above what you lift now.')
  return { ...g, targetValue: r1(g.targetValue), startValue: g.startValue == null ? null : r1(g.startValue) }
}

// ───────── goal progress and projection (their `F`) ─────────
export type GoalProgress = {
  goal: GoalRec; current: number | null; start: number | null; fraction: number | null; reached: boolean
  ratePerWeek: number | null; projected: string | null; pace: 'ahead' | 'on_track' | 'behind' | null
}
function loadSlope(pts: { date: string; v: number }[]): number | null {
  if (pts.length < 4 || daysBetween(pts[0].date, pts[pts.length - 1].date) < 21) return null
  const xs = pts.map((p) => parseDate(p.date).getTime() / 6048e5), ys = pts.map((p) => p.v)
  const mx = xs.reduce((a, b) => a + b, 0) / xs.length, my = ys.reduce((a, b) => a + b, 0) / ys.length
  let num = 0, den = 0
  xs.forEach((x, i) => { num += (x - mx) * (ys[i] - my); den += (x - mx) ** 2 })
  return den === 0 ? null : num / den
}
export function goalProgress(g: GoalRec, map: Map<string, Session[]>, weights: BodyWeight[], today: string): GoalProgress {
  let current: number | null = null, rate: number | null = null
  if (g.kind === 'body_weight') {
    const t = weightTrend(weights)
    current = t.length ? t[t.length - 1].trendKg : null
    rate = weightRate(t, today)
  } else if (g.exerciseKey) {
    const from = shiftDate(today, -56)
    const all = (map.get(g.exerciseKey) ?? []).filter((s) => s.date <= today), recent = all.filter((s) => s.date >= from)
    if (g.kind === 'exercise_e1rm') {
      const v = recent.map((s) => s.bestE1rm ?? 0).filter((x) => x > 0)
      current = v.length ? Math.max(...v) : null
      rate = e1rmSlope(all, today, 8)
    } else {
      const pts = recent.filter((s) => (s.heaviestLoad ?? 0) > 0).map((s) => ({ date: s.date, v: s.heaviestLoad as number }))
      current = pts.length ? Math.max(...pts.map((p) => p.v)) : null
      rate = loadSlope(pts)
    }
  }
  const start = g.startValue ?? current
  const up = g.kind !== 'body_weight' || (start !== null && g.targetValue >= start)
  const reached = !!g.achievedAt || (current !== null && (up ? current >= g.targetValue - 1e-9 : current <= g.targetValue + 1e-9))
  const fraction = current !== null && start !== null && g.targetValue !== start ? Math.min(1, Math.max(0, (current - start) / (g.targetValue - start))) : reached ? 1 : null
  const d = rate === null ? null : up ? rate : -rate
  let projected: string | null = null
  if (!reached && current !== null && d !== null && d > 0.01) {
    const weeks = Math.abs(g.targetValue - current) / d
    if (weeks <= 156) projected = shiftDate(today, Math.ceil(weeks * 7))
  }
  let pace: GoalProgress['pace'] = null
  if (!reached && g.targetDate) {
    if (!projected) pace = 'behind'
    else { const diff = daysBetween(projected, g.targetDate); pace = diff > 14 ? 'ahead' : diff >= -7 ? 'on_track' : 'behind' }
  }
  return { goal: g, current, start, fraction, reached, ratePerWeek: d, projected, pace }
}

// ───────── Monday check-in (their `j`) ─────────
export type Checkin = {
  weekStart: string; sessions: number; target: number | null; workingSets: number; improved: { key: string; name: string; gainKg: number }[]; records: number
  stalled: { key: string; name: string; weeks: number }[]; focus: { kind: string; text: string }
}
export function weeklyCheckin(a: { workouts: Workout[]; idx: ExIndex; target: number | null; experience: string; today: string }): Checkin | null {
  const done = a.workouts.filter((w) => w.finishedAt).sort((x, y) => x.date.localeCompare(y.date))
  const thisWeek = mondayOfDate(a.today), lastWeek = shiftDate(thisWeek, -7)
  if (!done[0] || done[0].date >= thisWeek) return null
  const week = done.filter((w) => w.date >= lastWeek && w.date < thisWeek), before = done.filter((w) => w.date < lastWeek), upTo = done.filter((w) => w.date < thisWeek)
  const prior = new Map<string, number>()
  for (const [k, l] of sessionsByExercise(before, a.idx)) for (const s of l) if (s.bestE1rm !== null) prior.set(k, Math.max(prior.get(k) ?? 0, s.bestE1rm))
  const improved: Checkin['improved'] = []
  for (const [k, l] of sessionsByExercise(week, a.idx)) {
    const best = Math.max(0, ...l.map((s) => s.bestE1rm ?? 0)), p = prior.get(k)
    if (best > 0 && p !== undefined && best > p + 1e-9) improved.push({ key: k, name: a.idx.get(k).name, gainKg: best - p })
  }
  improved.sort((x, y) => y.gainKg - x.gainKg)
  const records = detectPRs(sessionsByExercise(upTo, a.idx)).filter((p) => p.date >= lastWeek && p.date < thisWeek).length
  const sunday = shiftDate(thisWeek, -1)
  const stalled = detectStalls(upTo, a.idx, sunday, a.experience).map((s) => ({ key: s.key, name: a.idx.get(s.key).name, weeks: s.weeks }))
  const sets = (from: string, to: string) => upTo.filter((w) => w.date >= from && w.date < to).reduce((n, w) => n + w.exercises.reduce((m, e) => m + e.sets.filter(isWork).length, 0), 0)
  let spike: { chronic: number; ratio: number } | null = null
  if (done[0].date <= shiftDate(sunday, -35)) {
    const chronic = sets(shiftDate(lastWeek, -28), lastWeek) / 4, acute = sets(lastWeek, thisWeek)
    if (chronic >= 10 && acute / chronic > 1.5) spike = { chronic, ratio: acute / chronic }
  }
  const bal = balance(upTo, a.idx, sunday).find((b) => b.verdict === 'a_heavy' || b.verdict === 'b_heavy')
  let focus: Checkin['focus']
  if (week.length === 0) focus = { kind: 'start', text: 'No workouts last week. Plan two short sessions this week to get going again.' }
  else if (spike) focus = { kind: 'ease_off', text: `You did ${spike.ratio.toFixed(1)} times your usual sets. Keep this week closer to ${Math.round(spike.chronic)} sets.` }
  else if (a.target && week.length < a.target) focus = { kind: 'consistency', text: `${week.length} of ${a.target} sessions. Put your training days in your calendar to hit ${a.target} this week.` }
  else if (stalled[0]) focus = { kind: 'stalled', text: `${stalled[0].name} has not improved for ${stalled[0].weeks} weeks. Try a different rep range for it this week.` }
  else if (bal) {
    const [x, y] = bal.verdict === 'a_heavy' ? [bal.aL, bal.bL] : [bal.bL, bal.aL]
    focus = { kind: 'balance', text: `More ${x.toLowerCase()} than ${y.toLowerCase()} lately. Add a few sets of ${y.toLowerCase()} work.` }
  } else focus = { kind: 'keep_going', text: 'A solid week. Add load where the logger suggests it and keep the same rhythm.' }
  return { weekStart: lastWeek, sessions: week.length, target: a.target, workingSets: week.reduce((n, w) => n + w.exercises.reduce((m, e) => m + e.sets.filter(isWork).length, 0), 0), improved, records, stalled, focus }
}

// ───────── milestones (their milestones chunk) ─────────
export type Milestone = { id: string; kind: string; title: string; detail: string; achievedAt: string; workoutId: number | null }
const COUNTS = [1, 10, 25, 50, 100, 250, 500, 1000], SET_COUNTS = [500, 1000, 2500, 5000, 10000], TONNES = [10, 100, 500, 1000], STREAKS = [4, 12, 26, 52]
const PLATES = [
  { key: 'barbell-bench-press', name: 'Bench press', kg: 60, plates: 'a plate each side' }, { key: 'barbell-bench-press', name: 'Bench press', kg: 100, plates: 'two plates each side' },
  { key: 'back-squat', name: 'Squat', kg: 100, plates: 'two plates each side' }, { key: 'back-squat', name: 'Squat', kg: 140, plates: 'three plates each side' },
  { key: 'deadlift', name: 'Deadlift', kg: 140, plates: 'three plates each side' }, { key: 'deadlift', name: 'Deadlift', kg: 180, plates: 'four plates each side' },
  { key: 'overhead-press', name: 'Overhead press', kg: 60, plates: 'a plate each side' },
]
const BW = [{ key: 'barbell-bench-press', name: 'Bench press', times: 1 }, { key: 'back-squat', name: 'Squat', times: 1.5 }, { key: 'deadlift', name: 'Deadlift', times: 2 }]
const bodyOn = (ws: BodyWeight[], date: string) => {
  let best: BodyWeight | null = null
  for (const w of ws) if (w.date <= shiftDate(date, 1) && (!best || w.date > best.date)) best = w
  return best && daysBetween(best.date, date) <= 30 ? best.kg : null
}
export function milestones(workouts: Workout[], weights: BodyWeight[], idx: ExIndex, today: string, perWeek: number | null): Milestone[] {
  const out: Milestone[] = [], seen = new Set<string>()
  const add = (m: Milestone) => { if (!seen.has(m.id)) { seen.add(m.id); out.push(m) } }
  const ws = workouts.filter((w) => w.finishedAt && w.id !== undefined).sort((a, b) => a.date.localeCompare(b.date) || a.startedAt - b.startedAt)
  let n = 0, sets = 0, tonnes = 0
  const bestLoad = new Map<string, number>()
  for (const w of ws) {
    if (w.date > today) break
    n++
    if (COUNTS.includes(n)) add({ id: `workouts-${n}`, kind: 'count', title: n === 1 ? 'Baseline set' : `${n} workouts`, detail: n === 1 ? 'Every number from here is measured against today.' : `${n} workouts logged.`, achievedAt: w.date, workoutId: w.id! })
    const ps = sets
    sets += w.exercises.reduce((a, e) => a + e.sets.filter(isWork).length, 0)
    for (const c of SET_COUNTS) if (ps < c && sets >= c) add({ id: `sets-${c}`, kind: 'count', title: `${c.toLocaleString('en-GB')} working sets`, detail: 'Every one of them logged.', achievedAt: w.date, workoutId: w.id! })
    const pt = tonnes
    tonnes += w.exercises.reduce((a, e) => a + e.sets.reduce((b, s) => b + setVolume(s, idx.get(e.key, e.name)), 0), 0) / 1000
    for (const c of TONNES) if (pt < c && tonnes >= c) add({ id: `tonnes-${c}`, kind: 'volume', title: `${c.toLocaleString('en-GB')} tonnes lifted`, detail: 'Load × reps over every working set you have logged.', achievedAt: w.date, workoutId: w.id! })
    const bw = bodyOn(weights, w.date)
    for (const e of w.exercises) {
      const x = idx.get(e.key, e.name)
      const top = Math.max(0, ...e.sets.filter((s) => isWork(s) && x.tracking === 'weight_reps' && (s.reps ?? 0) >= 1).map((s) => s.weightKg ?? 0))
      if (top <= 0) continue
      bestLoad.set(e.key, Math.max(bestLoad.get(e.key) ?? 0, top))
      for (const p of PLATES) if (e.key === p.key && top >= p.kg) add({ id: `plates-${p.key}-${p.kg}`, kind: 'lift', title: `${p.kg} kg ${p.name.toLowerCase()}`, detail: `${p.name} with ${p.plates}.`, achievedAt: w.date, workoutId: w.id! })
      if (bw) for (const b of BW) if (e.key === b.key && top >= bw * b.times) add({ id: `bw-${b.key}-${b.times}`, kind: 'bodyweight', title: b.times === 1 ? `Body-weight ${b.name.toLowerCase()}` : `${b.times}× body-weight ${b.name.toLowerCase()}`, detail: b.times === 1 ? `A ${b.name.toLowerCase()} set with your own body weight on the bar.` : `A ${b.name.toLowerCase()} set with ${b.times} times your body weight.`, achievedAt: w.date, workoutId: w.id! })
    }
  }
  const first = ws[0]
  if (first) {
    const T = Math.max(1, perWeek ?? 1)
    let run = 0
    for (let i = mondayOfDate(first.date); shiftDate(i, 7) <= shiftDate(today, 1); i = shiftDate(i, 7)) {
      const end = shiftDate(i, 7)
      run = ws.filter((w) => w.date >= i && w.date < end).length >= T ? run + 1 : 0
      if (STREAKS.includes(run)) add({ id: `streak-${run}`, kind: 'streak', title: `${run} weeks in a row`, detail: perWeek && perWeek > 1 ? `${run} weeks with at least ${perWeek} sessions.` : `Training every week for ${run} weeks.`, achievedAt: shiftDate(end, -1), workoutId: null })
    }
    const ann = new Date(parseDate(first.date)); ann.setFullYear(ann.getFullYear() + 1)
    const annStr = `${ann.getFullYear()}-${String(ann.getMonth() + 1).padStart(2, '0')}-${String(ann.getDate()).padStart(2, '0')}`
    if (annStr <= today) add({ id: 'anniversary-1', kind: 'anniversary', title: 'One year of training', detail: 'Your first workout here was a year ago.', achievedAt: annStr, workoutId: null })
  }
  return out.sort((a, b) => a.achievedAt.localeCompare(b.achievedAt))
}

// ───────── rest-time analysis (their rest chunk) ─────────
const BANDS: [number, number][] = [[0, 90], [90, 150], [150, 240], [240, Infinity]]
const med = (v: number[]) => { if (!v.length) return null; const t = [...v].sort((a, b) => a - b), n = t.length >> 1; return t.length % 2 ? t[n] : (t[n - 1] + t[n]) / 2 }
export const fmtRest = (s: number) => { const t = Math.round(s); return t < 60 ? `${t} s` : `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}` }
export type RestAnalysis = {
  intervals: number; compound: { median: number | null; count: number; underFloor: number }; isolation: { median: number | null; count: number; underFloor: number }
  betweenExercises: { median: number | null; count: number }; bands: { from: number; to: number; pairs: number; kept: number | null }[]
  personal: { band: { from: number; to: number; kept: number | null }; best: { from: number; to: number; kept: number | null }; shortest: { from: number; to: number; kept: number | null } } | null
  verdicts: ('compound_short' | 'isolation_short' | 'on_target')[]; timedSets: number
}
export function restAnalysis(workouts: Workout[], idx: ExIndex, from: string, to: string): RestAnalysis {
  const comp: number[] = [], iso: number[] = [], ex: number[] = [], pairs: { seconds: number; kept: number }[] = []
  let timed = 0
  for (const w of workouts) {
    if (!w.finishedAt || w.date < from || w.date >= to) continue
    const flat = w.exercises.flatMap((e) => e.sets.map((s) => ({ s, e, x: idx.get(e.key, e.name) }))).filter((q) => q.s.done && q.s.doneAt).sort((a, b) => a.s.doneAt! - b.s.doneAt!)
    timed += flat.length
    for (let i = 1; i < flat.length; i++) {
      const p = flat[i - 1], c = flat[i]
      const dur = c.s.durationSec && c.s.durationSec > 0 ? c.s.durationSec : (c.s.reps ?? 0) * 3
      const sec = Math.round((c.s.doneAt! - p.s.doneAt!) / 1000 - dur)
      if (sec < 10 || sec > 900) continue
      if (c.s.setType === 'warmup') continue
      if (p.e !== c.e) { ex.push(sec); continue }
      if (p.s.setType === 'warmup') continue
      ;(c.x.category === 'compound' ? comp : iso).push(sec)
      if (c.x.tracking === 'weight_reps' && c.s.setType === 'working' && p.s.setType === 'working' && (p.s.reps ?? 0) >= 3 && (c.s.reps ?? 0) > 0 && (p.s.weightKg ?? 0) > 0 && Math.abs((c.s.weightKg ?? 0) - p.s.weightKg!) <= p.s.weightKg! * 0.005)
        pairs.push({ seconds: sec, kept: Math.min(1.5, c.s.reps! / p.s.reps!) })
    }
  }
  const bands = BANDS.map(([f, t]) => { const l = pairs.filter((p) => p.seconds >= f && p.seconds < t); return { from: f, to: t, pairs: l.length, kept: l.length ? l.reduce((a, p) => a + p.kept, 0) / l.length : null } })
  const ok = bands.filter((b) => b.pairs >= 8 && b.kept !== null)
  let personal: RestAnalysis['personal'] = null
  if (ok.length >= 2) {
    const best = ok.reduce((a, b) => (b.kept! > a.kept! ? b : a))
    personal = { band: ok.find((b) => b.kept! >= best.kept! - 0.05)!, best, shortest: ok[0] }
  }
  const cm = med(comp), im = med(iso), verdicts: RestAnalysis['verdicts'] = []
  if (cm !== null && comp.length >= 5 && cm < 90) verdicts.push('compound_short')
  if (im !== null && iso.length >= 5 && im < 60) verdicts.push('isolation_short')
  if (!verdicts.length && (cm !== null || im !== null)) verdicts.push('on_target')
  return {
    intervals: comp.length + iso.length + ex.length, compound: { median: cm, count: comp.length, underFloor: comp.filter((v) => v < 90).length }, isolation: { median: im, count: iso.length, underFloor: iso.filter((v) => v < 60).length },
    betweenExercises: { median: med(ex), count: ex.length }, bands, personal, verdicts, timedSets: timed,
  }
}
