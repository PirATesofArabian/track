import { db, type SleepLog, type SupplementLog, type ActivityLog, type BodyWeight, type CustomExercise, type CustomFood, type FoodEntry, type WEx, type Workout } from './db'
import { stepsKcal } from './burn'

/** Additive import: adds rows from a notes file and never clears or overwrites anything. */
type FileWorkout = Omit<Workout, 'startedAt' | 'exercises'> & { startHour: number; durationMin: number; exercises: WEx[] }
export type AddFile = {
  _app: string
  _kind: 'additive'
  _label?: string
  customFoods?: (CustomFood & { _ref: string })[]
  customExercises?: (Omit<CustomExercise, 'id'> & { _ref: string })[]
  foodLog?: FoodEntry[]
  workouts?: FileWorkout[]
  bodyWeight?: BodyWeight[]
  supplements?: SupplementLog[]
  sleep?: SleepLog[]
  steps?: { date: string; steps: number; weightKg: number; label?: string }[]
}
export type AddResult = { added: Record<string, number>; skipped: Record<string, number>; undo: () => Promise<void> }

export async function applyAdditive(d: AddFile): Promise<AddResult> {
  const added: Record<string, number> = {}, skipped: Record<string, number> = {}
  const bump = (m: Record<string, number>, k: string) => { m[k] = (m[k] ?? 0) + 1 }
  const made: { table: 'customFoods' | 'customExercises' | 'foodLog' | 'workouts' | 'bodyWeight' | 'activity' | 'supplements'; id: number }[] = []
  const sleepAdded: string[] = []
  const heightCm = (await db.profile.get(1))?.heightCm

  await db.transaction('rw', [db.customFoods, db.customExercises, db.foodLog, db.workouts, db.bodyWeight, db.activity, db.profile, db.supplements, db.sleep], async () => {
    const add = async (table: typeof made[number]['table'], row: object) => {
      const id = (await db.table(table).add(row)) as number
      made.push({ table, id }); bump(added, table); return id
    }
    // Custom foods / exercises are matched by name so a second run reuses them.
    const foodId = new Map<string, string>()
    for (const f of d.customFoods ?? []) {
      const { _ref, ...rec } = f
      const ex = (await db.customFoods.toArray()).find((x) => x.name === rec.name)
      const id = ex?.id ?? (await add('customFoods', rec))
      if (ex) bump(skipped, 'customFoods')
      foodId.set(`custom-@${_ref}`, `custom-${id}`)
    }
    const exKey = new Map<string, string>()
    for (const e of d.customExercises ?? []) {
      const { _ref, ...rec } = e
      const ex = (await db.customExercises.toArray()).find((x) => x.name === rec.name)
      const id = ex?.id ?? (await add('customExercises', rec))
      if (ex) bump(skipped, 'customExercises')
      exKey.set(`custom:@${_ref}`, `custom:${id}`)
    }

    // Food: skip a whole date+meal that already has entries.
    const have = new Set((await db.foodLog.toArray()).map((r) => `${r.date}|${r.meal}`))
    for (const r of d.foodLog ?? []) {
      if (have.has(`${r.date}|${r.meal}`)) { bump(skipped, 'foodLog'); continue }
      await add('foodLog', { ...r, foodId: r.foodId ? foodId.get(r.foodId) ?? r.foodId : undefined })
    }

    // Workouts: skip a date that already has a workout of the same name.
    const wHave = new Set((await db.workouts.toArray()).map((w) => `${w.date}|${w.name}`))
    for (const w of d.workouts ?? []) {
      if (wHave.has(`${w.date}|${w.name}`)) { bump(skipped, 'workouts'); continue }
      const { startHour, durationMin, ...rest } = w
      const startedAt = new Date(`${w.date}T${String(startHour).padStart(2, '0')}:00:00`).getTime()
      await add('workouts', { ...rest, startedAt, finishedAt: startedAt + durationMin * 60000, exercises: w.exercises.map((e) => ({ ...e, key: exKey.get(e.key) ?? e.key })) })
    }

    const bwHave = new Set((await db.bodyWeight.toArray()).map((b) => b.date))
    for (const b of d.bodyWeight ?? []) {
      if (bwHave.has(b.date)) { bump(skipped, 'bodyWeight'); continue }
      await add('bodyWeight', b)
    }

    const stHave = new Set((await db.activity.toArray()).filter((a) => a.kind === 'steps').map((a) => `${a.date}|${a.steps}`))
    for (const s of d.steps ?? []) {
      if (stHave.has(`${s.date}|${s.steps}`)) { bump(skipped, 'activity'); continue }
      const est = stepsKcal(s.steps, s.weightKg, heightCm)
      const row: ActivityLog = { date: s.date, kind: 'steps', steps: s.steps, label: s.label, kcal: est?.kcal ?? 0, kcalSource: 'estimated', basis: est?.basis }
      await add('activity', row)
    }

    const sHave = new Set((await db.supplements.toArray()).map((x) => `${x.date}|${x.name}`))
    for (const x of d.supplements ?? []) {
      if (sHave.has(`${x.date}|${x.name}`)) { bump(skipped, 'supplements'); continue }
      await add('supplements', x)
    }
    const slHave = new Set((await db.sleep.toArray()).map((x) => x.date))
    for (const x of d.sleep ?? []) {
      if (slHave.has(x.date)) { bump(skipped, 'sleep'); continue }
      await db.sleep.add(x); bump(added, 'sleep'); sleepAdded.push(x.date)
    }
  })

  const undo = async () => {
    await db.transaction('rw', [db.customFoods, db.customExercises, db.foodLog, db.workouts, db.bodyWeight, db.activity, db.supplements, db.sleep], async () => {
      for (const m of made) await db.table(m.table).delete(m.id)
      await db.sleep.bulkDelete(sleepAdded)
    })
  }
  return { added, skipped, undo }
}
