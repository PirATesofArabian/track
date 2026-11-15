// Ported from Macrotrophy: badge definitions (ShareSheet chunk), weekly streak helpers (week chunk),
// Wrapped stats and card (index chunk `_d`, `vd`, `yd`) and the Home "Now" card priority list (`Dd`, `Od`).
import type { Workout } from './db'
import type { Muscle } from '../data/exerciseDb'
import { detectPRs, finished, isWork, sessionsByExercise, setVolume, workoutVolume, type ExIndex } from './perf'
import { mondayOfDate } from './adaptive'
import { daysBetween, parseDate, shiftDate } from './util'
import type { BodyWeight } from './db'

const TIERS = (i: number, n: number) => (i === n - 1 && n >= 4 ? 'legend' : i >= n * 0.6 ? 'gold' : i >= n * 0.3 ? 'silver' : 'bronze') as Badge['tier']
export type Badge = {
  id: string; group: 'workouts' | 'streaks' | 'medals' | 'tonnage' | 'plates' | 'habits'; title: string; goal: string
  tier: 'bronze' | 'silver' | 'gold' | 'legend'; target: number; current: number; earnedAt: string | null; workoutId: number | null
}
export const GROUP_LABEL: Record<Badge['group'], string> = { workouts: 'Workouts', streaks: 'Streaks', medals: 'Medals', tonnage: 'Total lifted', plates: 'Plate club', habits: 'Habits' }
export const TIER_LABEL = { bronze: 'Bronze', silver: 'Silver', gold: 'Gold', legend: 'Legend' }

const WORKOUTS: [number, string][] = [[1, 'Day one'], [10, 'Locked in'], [25, 'Habit unlocked'], [50, 'Gym rat'], [100, 'Century club'], [250, 'No days off'], [500, 'Built different'], [1000, 'Living legend']]
const STREAKS: [number, string][] = [[2, 'Back to back'], [4, 'Month strong'], [8, 'Two months deep'], [12, 'Quarter grind'], [26, 'Half-year hero'], [52, 'Year of gains']]
const MEDALS: [number, string][] = [[1, 'First medal'], [10, 'Medal collector'], [50, 'PR machine'], [100, 'Record breaker'], [250, 'Hall of fame']]
const TONNES: [number, string, string][] = [[10, '10 tonne club', 'about seven cars'], [100, '100 tonne club', 'a blue whale'], [500, '500 tonne club', 'a jumbo jet, loaded'], [1000, 'Kilotonne', 'about 160 elephants']]
const PLATES = [
  { key: 'barbell-bench-press', lift: 'bench press', kg: 60, title: 'One plate bench' }, { key: 'barbell-bench-press', lift: 'bench press', kg: 100, title: 'Two plate bench' },
  { key: 'back-squat', lift: 'squat', kg: 100, title: 'Two plate squat' }, { key: 'back-squat', lift: 'squat', kg: 140, title: 'Three plate squat' },
  { key: 'deadlift', lift: 'deadlift', kg: 140, title: 'Three plate deadlift' }, { key: 'deadlift', lift: 'deadlift', kg: 180, title: 'Four plate deadlift' },
  { key: 'overhead-press', lift: 'overhead press', kg: 60, title: 'One plate press' },
]
const BW = [{ key: 'barbell-bench-press', lift: 'bench press', times: 1, title: 'Bodyweight bench' }, { key: 'back-squat', lift: 'squat', times: 1.5, title: '1.5× bodyweight squat' }, { key: 'deadlift', lift: 'deadlift', times: 2, title: 'Double bodyweight deadlift' }]

/** Consecutive weeks (Mon-start) with >= minSessions. Map streak-length -> first week that reached it. (week chunk `h`) */
function weekStreaks(done: Workout[], minSessions: number) {
  const out = new Map<number, { weekEnd: string; first: Workout }>()
  if (!done.length) return { out, max: 0 }
  const last = done[done.length - 1].date
  let run = 0, max = 0
  for (let mon = mondayOfDate(done[0].date); mon <= last; mon = shiftDate(mon, 7)) {
    const end = shiftDate(mon, 7), inWeek = done.filter((w) => w.date >= mon && w.date < end)
    if (inWeek.length >= minSessions) { run++; max = Math.max(max, run); if (!out.has(run)) out.set(run, { weekEnd: end, first: inWeek[0] }) }
    else if (end <= last) run = 0
  }
  return { out, max }
}
/** Sessions per week the user is aiming for (their `i`: profile training days, else routine days, min 1). */
export const weeklyTarget = (trainingDays: number | undefined, routineDays: number) => Math.max(1, trainingDays ?? (routineDays || 1))

export function computeBadges(a: { workouts: Workout[]; idx: ExIndex; weights: BodyWeight[]; minSessions: number; today: string }): Badge[] {
  const done = finished(a.workouts).filter((w) => w.date <= a.today)
  const out: Badge[] = []
  const hour = (w: Workout) => new Date(w.startedAt).getHours()
  WORKOUTS.forEach(([n, title], i) => { const w = done[n - 1]; out.push({ id: `workouts-${n}`, group: 'workouts', title, goal: n === 1 ? 'Log your first workout' : `Log ${n} workouts`, tier: TIERS(i, WORKOUTS.length), target: n, current: Math.min(n, done.length), earnedAt: w?.date ?? null, workoutId: w?.id ?? null }) })
  const st = weekStreaks(done, a.minSessions)
  STREAKS.forEach(([n, title], i) => { const h = st.out.get(n); out.push({ id: `streak-${n}`, group: 'streaks', title, goal: `Train ${n} weeks in a row`, tier: TIERS(i, STREAKS.length), target: n, current: Math.min(n, st.max), earnedAt: h?.first.date ?? null, workoutId: h?.first.id ?? null }) })
  const map = sessionsByExercise(a.workouts, a.idx)
  const prs = detectPRs(map).sort((x, y) => x.date.localeCompare(y.date) || x.workoutId - y.workoutId)
  MEDALS.forEach(([n, title], i) => { const p = prs[n - 1]; out.push({ id: `medals-${n}`, group: 'medals', title, goal: n === 1 ? 'Win your first medal' : `Win ${n} medals`, tier: TIERS(i, MEDALS.length), target: n, current: Math.min(n, prs.length), earnedAt: p?.date ?? null, workoutId: p?.workoutId ?? null }) })
  let total = 0
  const crossed = new Map<number, Workout>()
  for (const w of done) { const before = total; total += workoutVolume(w, a.idx); for (const [n] of TONNES) if (before < n * 1000 && total >= n * 1000) crossed.set(n, w) }
  TONNES.forEach(([n, title, note], i) => { const w = crossed.get(n); out.push({ id: `tonnes-${n}`, group: 'tonnage', title, goal: `Lift ${n.toLocaleString('en-GB')} tonnes in total, ${note}`, tier: TIERS(i, TONNES.length), target: n, current: Math.min(n, Math.floor(total / 1000)), earnedAt: w?.date ?? null, workoutId: w?.id ?? null }) })
  const best = new Map<string, number>(), plateHit = new Map<string, Workout>(), bwHit = new Map<string, Workout>()
  for (const w of done) {
    const prior = a.weights.filter((x) => x.date <= w.date).sort((p, q) => q.date.localeCompare(p.date) || (q.id ?? 0) - (p.id ?? 0))[0]
    const fresh = prior && daysBetween(prior.date, w.date) <= 30 ? prior.kg : null
    for (const e of w.exercises) {
      const x = a.idx.get(e.key, e.name)
      const top = Math.max(0, ...e.sets.filter((s) => isWork(s) && x.tracking === 'weight_reps' && (s.reps ?? 0) >= 1).map((s) => s.weightKg ?? 0))
      if (top <= 0) continue
      best.set(e.key, Math.max(best.get(e.key) ?? 0, top))
      for (const p of PLATES) { const k = `${p.key}-${p.kg}`; if (e.key === p.key && top >= p.kg && !plateHit.has(k)) plateHit.set(k, w) }
      if (fresh) for (const b of BW) { const k = `${b.key}-${b.times}`; if (e.key === b.key && top >= fresh * b.times && !bwHit.has(k)) bwHit.set(k, w) }
    }
  }
  for (const p of PLATES) { const w = plateHit.get(`${p.key}-${p.kg}`); out.push({ id: `plates-${p.key}-${p.kg}`, group: 'plates', title: p.title, goal: `${p.kg} kg on the ${p.lift} for a rep`, tier: p.kg >= 140 || (p.key === 'barbell-bench-press' && p.kg >= 100) ? 'gold' : 'silver', target: p.kg, current: Math.min(p.kg, best.get(p.key) ?? 0), earnedAt: w?.date ?? null, workoutId: w?.id ?? null }) }
  for (const b of BW) { const w = bwHit.get(`${b.key}-${b.times}`); out.push({ id: `bw-${b.key}-${b.times}`, group: 'plates', title: b.title, goal: `A ${b.lift} with ${b.times === 1 ? 'your' : `${b.times}×`} body weight on the bar`, tier: 'gold', target: 1, current: w ? 1 : 0, earnedAt: w?.date ?? null, workoutId: w?.id ?? null }) }
  const habit = (id: string, title: string, goal: string, n: number, test: (w: Workout) => boolean, key?: (w: Workout) => string) => {
    const seen = new Set<string>(), list = done.filter((w) => { if (!test(w)) return false; if (!key) return true; const k = key(w); if (seen.has(k)) return false; seen.add(k); return true })
    const hit = list[n - 1]
    out.push({ id, group: 'habits', title, goal, tier: 'silver', target: n, current: hit ? n : Math.min(n, list.length), earnedAt: hit?.date ?? null, workoutId: hit?.id ?? null })
  }
  habit('early-bird', 'Early bird', 'Start 10 workouts between 4 am and 7 am', 10, (w) => hour(w) >= 4 && hour(w) < 7)
  habit('night-owl', 'Night owl', 'Start 10 workouts after 9 pm', 10, (w) => hour(w) >= 21)
  habit('weekend-warrior', 'Weekend warrior', 'Train on 10 weekends', 10, (w) => { const d = parseDate(w.date).getDay(); return d === 0 || d === 6 }, (w) => { const d = parseDate(w.date).getDay(); return shiftDate(w.date, d === 0 ? -1 : 0) })
  habit('heavy-day', 'Heavy day', 'Lift 10,000 kg in one workout', 1, (w) => workoutVolume(w, a.idx) >= 1e4)
  return out
}

// ── Wrapped (monthly / yearly) ──
export const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
export type WrappedStats = {
  label: string; period: 'month' | 'year'; key: string; workouts: number; daysTrained: number; daysInPeriod: number; weeksTrained: number; weeksInPeriod: number
  hours: number; tonnage: number; hardSets: number; records: number; topExercise: { name: string; sets: number } | null; muscles: { muscle: Muscle; sets: number }[]
}
const hardSet = (rir: number | null) => rir === null || rir <= 4
export function wrappedStats(workouts: Workout[], idx: ExIndex, p: { year: number; month: number | null }): WrappedStats | null {
  const from = p.month === null ? `${p.year}-01-01` : `${p.year}-${String(p.month + 1).padStart(2, '0')}-01`
  const to = p.month === null ? `${p.year + 1}-01-01` : p.month === 11 ? `${p.year + 1}-01-01` : `${p.year}-${String(p.month + 2).padStart(2, '0')}-01`
  const ws = finished(workouts).filter((w) => w.date >= from && w.date < to)
  if (ws.length < 3) return null
  const days = new Set(ws.map((w) => w.date)), weeks = new Set(ws.map((w) => Math.floor(daysBetween(from, w.date) / 7)))
  let minutes = 0, hard = 0, tonnage = 0
  const top = new Map<string, { name: string; sets: number }>(), mus = new Map<Muscle, number>()
  for (const w of ws) {
    minutes += Math.max(0, Math.min(300, Math.round((w.finishedAt! - w.startedAt) / 60000)))
    for (const e of w.exercises) {
      const sets = e.sets.filter(isWork)
      if (!sets.length) continue
      const x = idx.get(e.key, e.name), t = top.get(e.key) ?? { name: x.name, sets: 0 }
      t.sets += sets.length; top.set(e.key, t)
      const h = sets.filter((s) => hardSet(s.rir)).length
      hard += h
      if (x.primary !== 'cardio') mus.set(x.primary, (mus.get(x.primary) ?? 0) + h)
      for (const s of sets) tonnage += setVolume(s, x)
    }
  }
  const ids = new Set(ws.map((w) => w.id))
  const records = detectPRs(sessionsByExercise(workouts, idx)).filter((r) => ids.has(r.workoutId)).length
  const dip = daysBetween(from, to)
  return {
    label: p.month === null ? String(p.year) : MONTHS[p.month], period: p.month === null ? 'year' : 'month', key: p.month === null ? String(p.year) : `${p.year}-${String(p.month + 1).padStart(2, '0')}`,
    workouts: ws.length, daysTrained: days.size, daysInPeriod: dip, weeksTrained: weeks.size, weeksInPeriod: Math.ceil(dip / 7), hours: Math.round(minutes / 6) / 10, tonnage: Math.round(tonnage), hardSets: hard, records,
    topExercise: [...top.values()].sort((a, b) => b.sets - a.sets)[0] ?? null,
    muscles: [...mus.entries()].map(([muscle, sets]) => ({ muscle, sets })).filter((m) => m.sets > 0).sort((a, b) => b.sets - a.sets),
  }
}
/** Which recap to offer today: last month, and the year in the last 12 days of Dec / first week of Jan. (`vd`) */
export function wrappedOffer(now: Date) {
  const prev = new Date(now.getFullYear(), now.getMonth() - 1, 1), m = now.getMonth(), d = now.getDate()
  return { month: { year: prev.getFullYear(), month: prev.getMonth() }, year: m === 11 && d >= 20 ? now.getFullYear() : m === 0 && d <= 7 ? now.getFullYear() - 1 : null }
}
const nf = (n: number) => Math.round(n).toLocaleString('en-GB')
export function wrappedCard(s: WrappedStats, now: Date) {
  const frac = (a: number, b: number) => (b > 0 ? Math.min(1, Math.max(0, a / b)) : 0)
  const bars = s.muscles.slice(0, 4), max = Math.max(1, ...bars.map((b) => b.sets))
  const short = `${String(now.getDate()).padStart(2, '0')}.${String(now.getMonth() + 1).padStart(2, '0')}.${String(now.getFullYear()).slice(2)}`
  const lifted = nf(s.tonnage)
  return {
    title: `${s.label}, wrapped`, sub: s.period === 'year' ? 'Your year in the gym' : 'Your month in the gym', date: s.label, short,
    big: { v: String(s.workouts), u: 'workouts', l: `In ${s.label}` }, note: `${lifted} kg lifted over ${s.daysTrained} days`,
    stats: [{ v: lifted, u: 'kg', l: 'Lifted' }, { v: String(s.hours), u: 'h', l: 'Trained' }, { v: String(s.records), u: '', l: 'Records' }],
    more: s.topExercise ? { v: String(s.topExercise.sets), u: 'sets', l: s.topExercise.name } : null,
    chips: [`${s.workouts} workouts`, `${lifted} kg lifted`, `${s.records} ${s.records === 1 ? 'record' : 'records'}`],
    rings: [
      { frac: frac(s.daysTrained, s.daysInPeriod), v: String(s.daysTrained), u: `/${s.daysInPeriod}`, l: 'Days trained' },
      { frac: frac(s.weeksTrained, s.weeksInPeriod), v: String(s.weeksTrained), u: `/${s.weeksInPeriod}`, l: 'Weeks trained' },
      { frac: frac(s.records, s.workouts), v: String(s.records), u: '', l: s.records === 1 ? 'Record' : 'Records' },
    ],
    ringsNote: `Out of the days and weeks of ${s.label}`,
    bars: bars.map((b) => ({ l: b.muscle[0].toUpperCase() + b.muscle.slice(1), v: b.sets / max, label: `${b.sets} sets` })),
  }
}

// ── Home "Now" card (Dd, Od) ──
export type NowKind = 'review' | 'wrapped' | 'weigh' | 'train' | 'protein' | 'meal'
export type NowCard = { kind: NowKind; title: string; detail: string; action: string; to: string }
const MEAL_WINDOW: Record<string, [number, number]> = { breakfast: [6, 10], lunch: [12, 15], snacks: [16, 18], dinner: [19, 22] }
const MEAL_NAME: Record<string, string> = { breakfast: 'breakfast', lunch: 'lunch', snacks: 'a snack', dinner: 'dinner' }
/** Median hour of the timestamps, needs >= 3 (their `Od`). */
export const usualHour = (ts: number[]) => (ts.length < 3 ? null : ts.map((t) => new Date(t).getHours()).sort((a, b) => a - b)[Math.floor(ts.length / 2)])
export function nowCard(e: {
  hour: number; dayOfMonth: number; reviewChanges: number; wrappedMonth: string | null; weighedToday: boolean; weighIns14: number; usualWeighHour: number | null
  plannedDay: string | null; usualGymHour: number | null; workoutOpen: boolean; foodDays7: number; kcalLeft: number | null; proteinLeft: number | null
  mealNow: 'breakfast' | 'lunch' | 'snacks' | 'dinner'; mealLogged: boolean; fits: string[]
}): NowCard | null {
  const t = e.hour
  if (e.reviewChanges > 0) return { kind: 'review', title: 'Your week is ready', detail: `${e.reviewChanges} ${e.reviewChanges === 1 ? 'change' : 'changes'} proposed for this week. Nothing moves until you say yes.`, action: 'Review', to: '/progress#plan' }
  if (e.wrappedMonth && e.dayOfMonth <= 5) return { kind: 'wrapped', title: `Your ${e.wrappedMonth}, wrapped`, detail: 'Your month in numbers, ready to share.', action: 'Open', to: '/progress#wrapped' }
  if (e.workoutOpen) return null
  const wh = Math.min(12, (e.usualWeighHour ?? 8) + 3)
  if (!e.weighedToday && e.weighIns14 >= 3 && t >= 4 && t <= wh) return { kind: 'weigh', title: 'Weigh in', detail: 'Before food, like your other mornings. One number keeps the trend honest.', action: 'Log weight', to: '/body' }
  if (e.plannedDay && e.usualGymHour !== null && Math.abs(t - e.usualGymHour) <= 1) return { kind: 'train', title: `Start ${e.plannedDay}`, detail: 'It is about the time you usually train.', action: 'Start', to: '/workout' }
  const logs = e.foodDays7 >= 3
  if (logs && t >= 19 && (e.proteinLeft ?? 0) >= 20 && (e.kcalLeft ?? 0) >= 120 && e.fits.length > 0) return { kind: 'protein', title: `${Math.round(e.proteinLeft!)} g protein left`, detail: `These fit what is left today: ${e.fits.slice(0, 3).join(', ')}.`, action: 'Add', to: '/food' }
  const [a, b] = MEAL_WINDOW[e.mealNow]
  return logs && !e.mealLogged && t >= a && t <= b && e.kcalLeft !== null && e.kcalLeft > 0
    ? { kind: 'meal', title: `Log ${MEAL_NAME[e.mealNow]}`, detail: e.proteinLeft !== null && e.proteinLeft > 0 ? `${Math.round(e.kcalLeft).toLocaleString('en-IN')} kcal and ${Math.round(e.proteinLeft)} g protein left today.` : `${Math.round(e.kcalLeft).toLocaleString('en-IN')} kcal left today.`, action: 'Log', to: '/food' }
    : null
}
