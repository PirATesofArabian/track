// Storage + apply layer for the adaptive plan (their `Iu`, `Lu`, event/pain/memory CRUD). Backed by IndexedDB tables.
import { useMemo } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, DEFAULT_SETTINGS, type EventKind, type PainArea, type PainRec, type Routine, type Settings } from './db'
import { useExerciseIndex, useProfile, useSettings } from './hooks'
import { bodySnapshot } from './body'
import { detectStalls, type ExIndex } from './perf'
import { deficitNow } from './science'
import { todayStr } from './util'
import {
  addDays, aggregateWeeks, buildModel, decide, EVENT_KINDS, MAX_EVENT_DAYS, PAIN_AREAS, planMuscleSets, planSessionMinutes, recoveryGaps, reportWindow, simulateChanges, slotsOf,
  type Change, type Decision, type DecisionInput, type Patch, type Temporary,
} from './adaptive'

export type DecisionRec = { weekStart: string; outcome: 'applied' | 'kept'; at: string; changes: { id: string; kind: string; title: string; reason: string; applied: boolean }[]; targets: { kcal: number; p: number } | null }

const getKV = async <T,>(key: string, d: T): Promise<T> => ((await db.kv.get(key))?.value as T | undefined) ?? d
const setKV = (key: string, value: unknown) => db.kv.put({ key, value })

export class PlanError extends Error {}
const isDate = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s)

// ───────── events ─────────
export async function addEvent(e: { kind: EventKind; start: string; end: string }) {
  if (!EVENT_KINDS.includes(e.kind)) throw new PlanError('Choose what is coming up.')
  if (!isDate(e.start) || !isDate(e.end)) throw new PlanError('Choose both dates.')
  if (e.end < e.start) throw new PlanError('The last day is before the first day.')
  if ((Date.parse(e.end) - Date.parse(e.start)) / 864e5 + 1 > MAX_EVENT_DAYS) throw new PlanError(`Choose ${MAX_EVENT_DAYS} days or fewer.`)
  return db.events.add(e)
}
// ───────── pain ─────────
export async function addPain(p: { area: PainArea; severity: PainRec['severity']; redFlags: string[]; exerciseKey?: string }) {
  if (!PAIN_AREAS.includes(p.area)) throw new PlanError('Choose where it hurts.')
  return db.pain.add({ area: p.area, severity: p.severity, redFlags: p.redFlags, start: todayStr(), until: null, exerciseKey: p.exerciseKey })
}
// ───────── memory ─────────
const clean = (t: string) => t.replace(/\s+/g, ' ').trim()
/** Whether a sentence reads like a durable fact about you (their `l`): 12–160 chars, not a question, starts with I / my / main / mera…. */
export function looksLikeMemory(text: string): boolean {
  const t = text.trim()
  if (t.length < 12 || t.length > 160 || /\?/.test(t) || /^(what|why|how|when|which|should|can|could|is|are|do|does|kya|kyu|kyun|kaise|kab|kitna)\b/i.test(t)) return false
  return /^(i|i'm|im|i am|my|mera|meri|mere|main|mai|mujhe)\b/i.test(t)
}
export async function addMemory(text: string) {
  const t = clean(text)
  if (!t) throw new PlanError('Write what it should remember.')
  if (t.length > 160) throw new PlanError('Keep it to 160 characters.')
  if ((await db.memories.count()) >= 40) throw new PlanError('It can hold 40 things. Delete one first.')
  return db.memories.add({ text: t, createdAt: new Date().toISOString() })
}
export async function editMemory(id: number, text: string) {
  const t = clean(text)
  if (!t) throw new PlanError('Write what it should remember.')
  if (t.length > 160) throw new PlanError('Keep it to 160 characters.')
  await db.memories.update(id, { text: t })
}

// ───────── apply (their `Iu`) ─────────
const activeRoutine = (rs: Routine[]) => rs[0]
function patchRoutine(r: Routine, patches: Patch[]) {
  for (const p of patches) {
    const [di, ei] = p.slotId.split(':').map(Number)
    const ex = r.days[di]?.exercises[ei]
    if (!ex) continue
    if (p.sets !== undefined) ex.sets = p.sets
    if (p.key !== undefined) ex.key = p.key
  }
}
type SlotChange = Extract<Change, { kind: 'sets' | 'swap' | 'deload' | 'session' }>

export async function applyDecision(d: Decision, idx: ExIndex, opts: { accept?: string[]; record?: boolean } = {}) {
  const accept = new Set(opts.accept ?? d.changes.map((c) => c.id))
  const chosen = d.changes.filter((c) => accept.has(c.id))
  const applied: string[] = [], skipped: string[] = []
  await db.transaction('rw', [db.routines, db.settings, db.pain, db.kv], async () => {
    const routines = await db.routines.toArray()
    const routine = activeRoutine(routines)
    let settings: Settings = (await db.settings.get(1)) ?? DEFAULT_SETTINGS
    const before0 = { kcal: settings.kcal, p: settings.p }
    let temps = await getKV<Temporary[]>('temporaries', [])
    let { slots, days } = slotsOf(routine, idx)
    // restores first
    for (const c of chosen) {
      if (c.kind !== 'restore') continue
      const t = temps.find((x) => x.id === c.temporaryId)
      if (!t || !routine) { skipped.push(c.id); continue }
      const live = new Map(slots.map((s) => [s.id, s]))
      const ok = t.undo.patches.filter((p) => { const s = live.get(p.slotId); return !!s && !(p.expectSets !== undefined && s.sets !== p.expectSets) && !(p.expectKey !== undefined && s.key !== p.expectKey) })
      patchRoutine(routine, ok)
      if (t.undo.targets && settings.kcal === t.undo.targets.setTo) settings = { ...settings, kcal: t.undo.targets.was.kcal, p: t.undo.targets.was.p }
      temps = temps.map((x) => (x.id === t.id ? { ...x, done: true } : x))
      ;({ slots, days } = slotsOf(routine, idx))
      applied.push(c.id)
    }
    // group the rest by temporary window
    const groups = new Map<string, Change[]>()
    for (const c of chosen) {
      if (c.kind === 'restore') continue
      const cause = c.cause === 'pain' ? 'pain' : c.kind === 'deload' ? 'deload' : 'event'
      const k = c.until !== null ? `${cause}:${c.until}` : 'keep'
      groups.set(k, [...(groups.get(k) ?? []), c])
    }
    const order = [...groups.keys()].sort((a, b) => Number(a === 'keep') - Number(b === 'keep'))
    for (const k of order) {
      const list = groups.get(k)!, temporary = k !== 'keep'
      const before = slots
      const slotChanges = list.filter((c): c is SlotChange => c.kind === 'sets' || c.kind === 'swap' || c.kind === 'deload' || c.kind === 'session')
      const sim = simulateChanges(slots, days, slotChanges)
      if (!routine) skipped.push(...slotChanges.map((c) => c.id))
      else patchRoutine(routine, sim.patches)
      ;({ slots, days } = slotsOf(routine, idx))
      let undoTargets: Temporary['undo']['targets'] = null
      for (const c of list) {
        if (c.kind !== 'calories' && c.kind !== 'protein') continue
        const was = { kcal: settings.kcal, p: settings.p }
        settings = c.kind === 'calories' ? { ...settings, kcal: c.to } : { ...settings, p: c.to }
        if (temporary && c.kind === 'calories') undoTargets = { was, setTo: c.to }
        applied.push(c.id)
      }
      for (const c of slotChanges) (sim.unapplied.includes(c.id) ? skipped : applied).push(c.id)
      if (temporary) {
        const first = list[0]
        const cause: Temporary['cause'] = k.startsWith('pain') ? 'pain' : k.startsWith('deload') ? 'deload' : 'event'
        const undo = {
          patches: sim.undo.map((u): Patch => {
            const now = slots.find((s) => s.id === u.slotId)!, was = before.find((s) => s.id === u.slotId)!
            return { ...u, ...(u.sets === undefined ? {} : { expectSets: now.sets }), ...(u.key !== undefined && was.key !== now.key ? { expectKey: now.key } : {}) }
          }),
          targets: undoTargets,
        }
        if (undo.patches.length || undo.targets) {
          const label = cause === 'pain' ? 'Going easy on what hurt' : cause === 'deload' ? 'A lighter week' : 'What is coming up'
          temps = [...temps, { id: crypto.randomUUID(), cause, start: d.weekStart, until: first.until!, muscles: list.flatMap((c) => (c.kind === 'sets' ? [c.muscle] : [])), calories: !!undoTargets, label, undo }]
        }
      }
    }
    // calories/protein changed: carbs absorb the difference so the macro targets still add up
    if (applied.some((id) => id === 'calories' || id === 'protein') || settings.kcal !== before0.kcal || settings.p !== before0.p)
      settings = { ...settings, c: Math.max(0, Math.round((settings.kcal - 4 * settings.p - 9 * settings.f) / 4 / 5) * 5) }
    if (routine) await db.routines.put(routine)
    await db.settings.put(settings)
    await setKV('temporaries', temps)
    for (const p of await db.pain.toArray()) if (!p.done) await db.pain.update(p.id!, { done: true })
    if (opts.record === false) return
    const decisions = await getKV<DecisionRec[]>('decisions', [])
    decisions.push({ weekStart: d.weekStart, outcome: 'applied', at: new Date().toISOString(), changes: d.changes.map((c) => ({ id: c.id, kind: c.kind, title: c.title, reason: c.reason, applied: applied.includes(c.id) })), targets: { kcal: settings.kcal, p: settings.p } })
    await setKV('decisions', decisions)
  })
  return { applied, skipped }
}
export async function keepDecision(d: Decision) {
  await db.transaction('rw', [db.pain, db.kv], async () => {
    for (const p of await db.pain.toArray()) if (!p.done) await db.pain.update(p.id!, { done: true })
    const decisions = await getKV<DecisionRec[]>('decisions', [])
    decisions.push({ weekStart: d.weekStart, outcome: 'kept', at: new Date().toISOString(), changes: d.changes.map((c) => ({ id: c.id, kind: c.kind, title: c.title, reason: c.reason, applied: false })), targets: null })
    await setKV('decisions', decisions)
  })
}

// ───────── hook: everything the review screen needs ─────────
export function useAdaptive() {
  const idx = useExerciseIndex(), profile = useProfile(), settings = useSettings()
  const day = todayStr()
  const data = useLiveQuery(async () => ({
    workouts: await db.workouts.toArray(), food: await db.foodLog.toArray(), weights: await db.bodyWeight.toArray(), meas: await db.measurements.toArray(),
    routines: await db.routines.toArray(), events: await db.events.toArray(), pains: await db.pain.toArray(), goals: await db.goals.toArray(),
    temps: await getKV<Temporary[]>('temporaries', []), decisions: await getKV<DecisionRec[]>('decisions', []),
  }), [])
  return useMemo(() => {
    if (!data) return null
    const win = reportWindow(new Date()), next = win.next
    const finished = data.workouts.filter((w) => w.finishedAt)
    const firsts = [finished.map((w) => w.date).sort()[0], data.food.map((f) => f.date).sort()[0], data.weights.map((w) => w.date).sort()[0]].filter(Boolean) as string[]
    const earliest = firsts.length ? [...firsts].sort()[0] : win.open
    const floor = addDays(win.open, -175)
    const from = earliest > floor ? earliest : floor
    const upTo = addDays(win.open, 6)
    const ws = finished.filter((w) => w.date >= floor && w.date < next)
    const weeks = aggregateWeeks({ workouts: ws, food: data.food, weights: data.weights, idx, from, to: upTo })
    const snap = bodySnapshot({ profile, weights: data.weights, measurements: data.meas, today: day, loggedDaysPerWeek: null })
    const model = buildModel(weeks, recoveryGaps(ws, idx), snap.energy?.tdee ?? null)
    const routine = activeRoutine(data.routines)
    const plan = slotsOf(routine, idx)
    const goal = data.goals.filter((g) => g.kind === 'body_weight' && !g.achievedAt).sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0]
    const lastApplied = [...data.decisions].reverse().find((d) => d.outcome === 'applied' && d.targets)
    const ownProtein = lastApplied ? lastApplied.targets!.p !== settings.p : false
    const temps = data.temps.filter((t) => !t.done)
    const deloads = data.temps.filter((t) => t.cause === 'deload').map((t) => t.start).sort()
    const input: DecisionInput = {
      nextWeekStart: next, weeks, model,
      person: { goal: profile.goal, experience: profile.experience, weightKg: snap.kg, bmrKcal: snap.energy?.bmr ?? null, targetKg: goal?.targetValue ?? null, ownProtein, age: snap.age, heightCm: profile.heightCm ?? null },
      plan: { kcal: settings.kcal ?? null, proteinG: settings.p ?? null, muscleSets: planMuscleSets(plan.slots, plan.days), keys: [...new Set(plan.slots.map((s) => s.key))], sessionMinutes: planSessionMinutes(plan.slots) },
      events: data.events.filter((e) => e.end >= day).sort((a, b) => a.start.localeCompare(b.start)),
      pains: data.pains.filter((p) => !p.done), temporaries: temps, lastDeload: deloads.length ? deloads[deloads.length - 1] : null,
      stalls: detectStalls(ws, idx, day, profile.experience, deficitNow({ profile, weights: data.weights, measurements: data.meas, logs: data.food, today: day })).filter((s) => !s.holding).map((s) => ({ key: s.key, cause: s.cause, variationKey: s.variationKey })),
      exName: (k) => idx.get(k).name, exists: (k) => idx.all.some((e) => e.key === k),
    }
    const decision = routine ? decide(input) : null
    return { win, nextWeekStart: next, weeks, model, input, decision, record: data.decisions.find((d) => d.weekStart === next) ?? null, events: input.events, temps, hasRoutine: !!routine, decisions: data.decisions }
  }, [data, idx, profile, settings, day])
}
