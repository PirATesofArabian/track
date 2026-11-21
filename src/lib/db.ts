import Dexie, { type EntityTable } from 'dexie'
import type { Exercise } from '../data/exerciseDb'
import { findByName } from '../data/exerciseDb'

export type SetType = 'working' | 'warmup' | 'backoff' | 'drop'
export type WSet = {
  weightKg: number | null // load; added weight (weighted BW) or counterweight (assisted)
  reps: number | null // for one-sided exercises this is min(left, right)
  repsLeft?: number | null
  repsRight?: number | null
  rir: number | null
  setType: SetType
  done: boolean
  doneAt?: number // epoch ms when ticked; feeds the rest-time analysis
  durationSec: number | null
  distanceM: number | null
}
export type Target = { sets: number; repMin: number; repMax: number; rir?: string; rest?: number; cue?: string }
export type WEx = { key: string; name: string; sets: WSet[]; note?: string; target?: Target; supersetGroup?: number | null }
export type Workout = {
  id?: number
  date: string // YYYY-MM-DD
  name: string
  startedAt: number
  finishedAt?: number
  routineId?: number
  dayName?: string
  exercises: WEx[]
  notes?: string
  sessionRpe?: number | null
  kcalBurned?: number | null
  minutes?: number // set when the length is known or typed (past sessions); beats finishedAt − startedAt
}

export type FoodEntry = {
  id?: number
  date: string
  meal: 'Breakfast' | 'Lunch' | 'Snacks' | 'Dinner'
  name: string
  qty: number
  serving: string
  foodId?: string
  unit?: string
  size?: string
  rich?: string
  kcal: number
  p: number
  c: number
  f: number
  fib?: number
}
export type CustomFood = { id?: number; name: string; serving: string; kcal: number; p: number; c: number; f: number; fib?: number }
export type CustomExercise = Omit<Exercise, 'key' | 'custom'> & { id?: number }

export type PlanExercise = { key: string; sets: number; repMin: number; repMax: number; rir?: string; rest: number; cue?: string }
export type PlanDay = { name: string; focus?: string; weekdays: number[]; exercises: PlanExercise[] }
export type Routine = { id?: number; name: string; description?: string; days: PlanDay[] }

export type BodyWeight = { id?: number; date: string; kg: number; note?: string }
export type Measurement = {
  id?: number
  date: string
  waistCm?: number | null
  neckCm?: number | null
  hipCm?: number | null
  chestCm?: number | null
  armCm?: number | null
  thighCm?: number | null
  calfCm?: number | null
  bodyFatPct?: number | null
  note?: string
}
export type ActivityLog = {
  id?: number
  date: string
  kind: 'steps' | 'cardio'
  steps?: number
  time?: string // HH:MM, for timed step segments
  label?: string
  activity?: string
  minutes?: number
  distanceKm?: number
  speedKmh?: number
  inclinePct?: number
  effort?: string
  kcal: number
  kcalSource: 'typed' | 'estimated'
  basis?: string
}

export type Goal = 'hypertrophy' | 'strength_hypertrophy' | 'strength' | 'fat_loss' | 'recomposition' | 'general_fitness'
export type DailyActivity = 'sitting' | 'mixed' | 'on_feet' | 'physical'
export type Profile = {
  id: 1
  sex: 'male' | 'female' | 'unspecified'
  birthDate?: string
  heightCm?: number
  goal: Goal
  goalChosen?: boolean
  dailyActivity: DailyActivity
  trainingDays?: number
  sessionMinutes?: number
  experience: 'beginner' | 'intermediate' | 'advanced'
}
export type Settings = { id: 1; kcal: number; p: number; c: number; f: number; waterGoal: number; stepGoal: number; seededPlan?: boolean }
export type Water = { date: string; ml: number }

// ── Pro-feature tables ──
export type GoalRec = {
  id?: number
  kind: 'body_weight' | 'exercise_e1rm' | 'exercise_load'
  exerciseKey?: string // for lift goals
  startValue?: number | null
  targetValue: number
  targetDate?: string | null
  createdAt: string // YYYY-MM-DD
  achievedAt?: string | null
}
export type EventKind = 'exams' | 'travel' | 'wedding' | 'festival' | 'vrat' | 'ramadan' | 'sick'
export type EventRec = { id?: number; kind: EventKind; start: string; end: string; note?: string }
export type PainArea = 'shoulder' | 'elbow' | 'wrist' | 'lower_back' | 'knee' | 'hip' | 'ankle' | 'neck'
export type PainRec = { id?: number; area: PainArea; severity: 'mild' | 'moderate' | 'severe'; redFlags: string[]; start: string; until?: string | null; note?: string; exerciseKey?: string; done?: boolean }
export type MemoryRec = { id?: number; text: string; createdAt: string }
export type ReportRec = { weekStart: string; madeAt: string; report: unknown }
export type PhotoRec = { id?: number; date: string; pose: 'front' | 'side' | 'back'; blob: Blob }
export type SupplementLog = { id?: number; date: string; name: string; qty: number; unit: string }
/** One row per morning you woke up; hours is worked out from bed and wake times. */
export type SleepLog = { date: string; bed: string; wake: string; hours: number; quality?: 1 | 2 | 3 | 4 | 5; note?: string }
export type KV = { key: string; value: unknown }

// ── Sync support (see sync.ts). Every synced row carries a global `uid` and an `updatedAt` edit time, stamped by the hooks below. ──
export const SYNC_TABLES = ['workouts', 'foodLog', 'customFoods', 'customExercises', 'routines', 'bodyWeight', 'measurements', 'activity', 'goals', 'events', 'pain', 'memories', 'supplements',
  'water', 'settings', 'profile', 'reports', 'kv', 'sleep', 'photos'] as const
/** Tables keyed by their own field: their uid is "table:key", so two devices agree on it without talking. */
export const NATURAL_KEY: Record<string, string> = { water: 'date', settings: 'id', profile: 'id', reports: 'weekStart', kv: 'key', sleep: 'date' }
/** Custom exercises and foods are referenced as custom:<id> / custom-<id>, so their ids must be unique across devices. */
export const KEEP_ID = new Set(['customExercises', 'customFoods'])
export const syncSignal: { fn: (() => void) | null } = { fn: null }
export type Tombstone = { uid: string; tbl: string; updatedAt: number }
const rid = () => Array.from(crypto.getRandomValues(new Uint8Array(12)), (b) => b.toString(16).padStart(2, '0')).join('') // randomUUID needs https
export const bigId = () => Math.floor(1e9 + Math.random() * 9e12)

class AppDB extends Dexie {
  workouts!: EntityTable<Workout, 'id'>
  foodLog!: EntityTable<FoodEntry, 'id'>
  customFoods!: EntityTable<CustomFood, 'id'>
  customExercises!: EntityTable<CustomExercise, 'id'>
  routines!: EntityTable<Routine, 'id'>
  bodyWeight!: EntityTable<BodyWeight, 'id'>
  measurements!: EntityTable<Measurement, 'id'>
  activity!: EntityTable<ActivityLog, 'id'>
  water!: EntityTable<Water, 'date'>
  settings!: EntityTable<Settings, 'id'>
  profile!: EntityTable<Profile, 'id'>
  goals!: EntityTable<GoalRec, 'id'>
  events!: EntityTable<EventRec, 'id'>
  pain!: EntityTable<PainRec, 'id'>
  memories!: EntityTable<MemoryRec, 'id'>
  reports!: EntityTable<ReportRec, 'weekStart'>
  photos!: EntityTable<PhotoRec, 'id'>
  kv!: EntityTable<KV, 'key'>
  supplements!: EntityTable<SupplementLog, 'id'>
  sleep!: EntityTable<SleepLog, 'date'>
  syncTombstones!: EntityTable<Tombstone, 'uid'>

  constructor() {
    super('gym-food-tracker')
    const v1 = {
      workouts: '++id, date',
      foodLog: '++id, date',
      customFoods: '++id, name',
      routines: '++id, name',
      bodyWeight: '++id, date',
      water: 'date',
      settings: 'id',
    }
    this.version(1).stores(v1)
    // A brand-new local database has nothing yet, whatever sync last said: forget the position so the next sync pulls everything back.
    // (If the browser empties IndexedDB but keeps localStorage, the old position would otherwise skip every record already on the server.)
    this.on('populate', () => { try { localStorage.removeItem('tracker-sync') } catch { /* no storage */ } })
    this.version(2)
      .stores({ ...v1, customExercises: '++id', measurements: '++id, date', activity: '++id, date', profile: 'id' })
      .upgrade(async (tx) => {
        const keyFor = (name: string) => findByName(name)?.key ?? `legacy:${name}`
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await tx.table('workouts').toCollection().modify((w: any) => {
          w.exercises = (w.exercises ?? []).map((e: any) => {
            if (e.key) return e
            return {
              key: keyFor(e.name),
              name: e.name,
              sets: (e.sets ?? []).map((s: any) => ({
                weightKg: s.weight || null, reps: s.reps || null, rir: null, setType: 'working', done: !!s.done, durationSec: null, distanceM: null,
              })),
            }
          })
        })
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await tx.table('routines').toCollection().modify((r: any) => {
          if (r.days) return
          r.days = [{ name: r.name, weekdays: [], exercises: (r.exercises ?? []).map((n: string) => ({ key: keyFor(n), sets: 3, repMin: 8, repMax: 12, rest: 90 })) }]
          delete r.exercises
        })
      })
    this.version(3).stores({
      goals: '++id, kind', events: '++id, start', pain: '++id, start', memories: '++id', reports: 'weekStart', photos: '++id, date', kv: 'key',
    })
    this.version(4).stores({ supplements: '++id, date', sleep: 'date' })
    this.version(5)
      .stores({
        workouts: '++id, date, uid, updatedAt', foodLog: '++id, date, uid, updatedAt', customFoods: '++id, name, uid, updatedAt', customExercises: '++id, uid, updatedAt',
        routines: '++id, name, uid, updatedAt', bodyWeight: '++id, date, uid, updatedAt', measurements: '++id, date, uid, updatedAt', activity: '++id, date, uid, updatedAt',
        goals: '++id, kind, uid, updatedAt', events: '++id, start, uid, updatedAt', pain: '++id, start, uid, updatedAt', memories: '++id, uid, updatedAt', supplements: '++id, date, uid, updatedAt',
        water: 'date, updatedAt', settings: 'id, updatedAt', profile: 'id, updatedAt', reports: 'weekStart, updatedAt', kv: 'key, updatedAt', sleep: 'date, updatedAt',
        syncTombstones: 'uid',
      })
      .upgrade(async (tx) => {
        ;(tx as unknown as { remote: boolean }).remote = true // not an edit: do not stamp "now"
        for (const name of SYNC_TABLES.filter((n) => n !== 'photos')) { // photos join sync in version 6
          const kp = NATURAL_KEY[name]
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          await tx.table(name).toCollection().modify((r: any) => { if (r.uid) return; r.uid = kp ? `${name}:${r[kp]}` : rid(); r.updatedAt = 1 })
        }
        // Custom exercises and foods used small local ids (custom:1). Two devices would clash, so give them unique ids and rewrite every reference.
        const remap = new Map<string, string>()
        for (const [name, pre] of [['customExercises', 'custom:'], ['customFoods', 'custom-']] as const) {
          const t = tx.table(name)
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          for (const r of (await t.toArray()) as any[]) {
            if (r.id >= 1e9) continue
            const nid = bigId()
            await t.delete(r.id); await t.add({ ...r, id: nid })
            remap.set(pre + r.id, pre + nid)
          }
        }
        if (remap.size) {
          for (const name of ['workouts', 'routines', 'goals', 'pain', 'foodLog', 'kv']) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            await tx.table(name).toCollection().modify((r: any) => {
              const before = JSON.stringify(r)
              const after = before.replace(/"(custom[:-]\d+)"/g, (m, k: string) => (remap.has(k) ? `"${remap.get(k)}"` : m))
              if (after !== before) Object.assign(r, JSON.parse(after))
            })
          }
        }
      })
    // Photos: the record (date, pose) syncs like the rest; the image is uploaded as a file named after the uid (sync.ts).
    this.version(6)
      .stores({ photos: '++id, date, uid, updatedAt' })
      .upgrade(async (tx) => {
        ;(tx as unknown as { remote: boolean }).remote = true
        // Stamped "now", not 1: a device that has already synced would otherwise never send photos it took before this version.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await tx.table('photos').toCollection().modify((r: any) => { if (r.uid) return; r.uid = rid(); r.updatedAt = Date.now() })
      })
  }
}

export const db = new AppDB()

/** Rows to back up / restore: everything except the sync bookkeeping. */
export const dataTables = () => db.tables.filter((t) => t.name !== 'syncTombstones')

for (const name of SYNC_TABLES) {
  const t = db.table(name)
  const kp = NATURAL_KEY[name]
  /* eslint-disable @typescript-eslint/no-explicit-any */
  t.hook('creating', function (primKey: any, obj: any, trans: any) {
    if (trans?.remote) return
    obj.updatedAt = Date.now()
    if (!String(obj.uid ?? '').startsWith('seed:')) obj.uid = kp ? `${name}:${primKey}` : rid() // a copy, undo or import is a new record; the old uid stays tombstoned
    syncSignal.fn?.()
    if (primKey == null && KEEP_ID.has(name)) return bigId()
  })
  t.hook('updating', function (_mods: any, primKey: any, obj: any, trans: any) {
    if (trans?.remote) return
    syncSignal.fn?.()
    return { updatedAt: Date.now(), uid: obj.uid ?? (kp ? `${name}:${primKey}` : rid()) }
  })
  t.hook('deleting', function (this: any, _primKey: any, obj: any, trans: any) {
    if (trans?.remote || !obj?.uid) return
    const rec: Tombstone = { uid: obj.uid, tbl: name, updatedAt: Date.now() }
    this.onsuccess = () => { syncSignal.fn?.(); Dexie.ignoreTransaction(() => db.syncTombstones.put(rec).catch(() => undefined)) }
  })
  /* eslint-enable @typescript-eslint/no-explicit-any */
}

/**
 * A backup holds custom foods and exercises under small ids (custom-1, custom:2). Two devices restoring or creating those would
 * clash once synced, so give each a unique id and rewrite every reference to it. Changes `d` (the parsed backup) in place; returns how many were remapped.
 */
export function uniqueCustomIds(d: Record<string, unknown>): number {
  /* eslint-disable @typescript-eslint/no-explicit-any */
  const remap = new Map<string, string>()
  for (const [name, pre] of [['customExercises', 'custom:'], ['customFoods', 'custom-']] as const) {
    for (const r of (Array.isArray(d[name]) ? d[name] : []) as any[]) {
      if (typeof r.id !== 'number' || r.id >= 1e9) continue
      const nid = bigId()
      remap.set(pre + r.id, pre + nid); r.id = nid
    }
  }
  if (!remap.size) return 0
  for (const name of ['workouts', 'routines', 'goals', 'pain', 'foodLog', 'kv']) {
    const rows = d[name]
    if (!Array.isArray(rows)) continue
    rows.forEach((r, i) => {
      const before = JSON.stringify(r)
      const after = before.replace(/"(custom[:-]\d+)"/g, (m, k: string) => (remap.has(k) ? `"${remap.get(k)}"` : m))
      if (after !== before) rows[i] = JSON.parse(after)
    })
  }
  return remap.size
  /* eslint-enable @typescript-eslint/no-explicit-any */
}

export const DEFAULT_SETTINGS: Settings = { id: 1, kcal: 2400, p: 150, c: 280, f: 70, waterGoal: 3000, stepGoal: 8000 }
export const DEFAULT_PROFILE: Profile = { id: 1, sex: 'male', goal: 'fat_loss', dailyActivity: 'mixed', experience: 'intermediate', trainingDays: 6, sessionMinutes: 75 }
