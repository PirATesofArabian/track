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
export type CustomFood = { id?: number; name: string; serving: string; kcal: number; p: number; c: number; f: number }
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
  }
}

export const db = new AppDB()

export const DEFAULT_SETTINGS: Settings = { id: 1, kcal: 2400, p: 150, c: 280, f: 70, waterGoal: 3000, stepGoal: 8000 }
export const DEFAULT_PROFILE: Profile = { id: 1, sex: 'male', goal: 'fat_loss', dailyActivity: 'mixed', experience: 'intermediate', trainingDays: 6, sessionMinutes: 75 }
