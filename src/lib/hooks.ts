import { useEffect, useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { DEFAULT_PROFILE, DEFAULT_SETTINGS, db, type Profile, type Routine, type Settings } from './db'
import { buildExerciseIndex } from './perf'
import { V_TAPER } from './plan'

export function useSettings(): Settings {
  return useLiveQuery(async () => (await db.settings.get(1)) ?? DEFAULT_SETTINGS, []) ?? DEFAULT_SETTINGS
}
export function useProfile(): Profile {
  return useLiveQuery(async () => (await db.profile.get(1)) ?? DEFAULT_PROFILE, []) ?? DEFAULT_PROFILE
}
export function useExerciseIndex() {
  const customs = useLiveQuery(() => db.customExercises.toArray(), [])
  return useMemo(() => buildExerciseIndex(customs ?? []), [customs])
}
/** Seed the V-Taper plan from the PDF once (never again, even if you delete it). */
export function useSeedPlan() {
  useEffect(() => {
    ;(async () => {
      const s = (await db.settings.get(1)) ?? DEFAULT_SETTINGS
      if (s.seededPlan) return
      await db.transaction('rw', db.routines, db.settings, async (tx) => {
        const cur = await db.settings.get(1)
        if (cur?.seededPlan) return
        // Not an edit: stamped as the oldest possible, so it can never overwrite your real plan or goals on another device.
        ;(tx as unknown as { remote: boolean }).remote = true
        await db.routines.put({ ...structuredClone(V_TAPER), uid: 'seed:v-taper', updatedAt: 1 } as Routine)
        await db.settings.put({ ...(cur ?? DEFAULT_SETTINGS), seededPlan: true, uid: 'settings:1', updatedAt: (cur as { updatedAt?: number } | undefined)?.updatedAt ?? 1 } as Settings)
      })
    })()
  }, [])
}
export function useNow(intervalMs = 1000) {
  const [n, setN] = useState(() => Date.now())
  useEffect(() => { const t = setInterval(() => setN(Date.now()), intervalMs); return () => clearInterval(t) }, [intervalMs])
  return n
}
