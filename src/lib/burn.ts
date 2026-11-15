// Ported calorie-burn estimators: ACSM walking/running/cycling equations, MET compendium values, steps → distance → kcal.
export const NET = 1 // active calories only: (MET − 1)
const kcalFromMet = (met: number, kg: number, min: number) => Math.max(0, (met - NET) * kg * (min / 60))

const acsmWalk = (kmh: number, incline: number) => { const m = (kmh * 1000) / 60; return 0.1 * m + 1.8 * m * (incline / 100) + 3.5 }
const acsmRun = (kmh: number, incline: number) => { const m = (kmh * 1000) / 60; return 0.2 * m + 0.9 * m * (incline / 100) + 3.5 }
const cycleWatts = (w: number, kg: number) => (1.8 * w * 6.12) / kg + 7
const cycleKmh = (v: number) => (v < 16.1 ? 4 : v < 19.3 ? 6.8 : v < 22.5 ? 8 : v < 25.7 ? 10 : 12)

export type Effort = 'light' | 'moderate' | 'hard'
export const ACTIVITIES = [
  { id: 'walk_outdoor', label: 'Walk outside', distance: true },
  { id: 'run_outdoor', label: 'Run outside', distance: true },
  { id: 'treadmill_walk', label: 'Treadmill walk', speed: true, incline: true },
  { id: 'treadmill_run', label: 'Treadmill run', speed: true, incline: true },
  { id: 'cycle_outdoor', label: 'Cycle outside', distance: true, effort: true },
  { id: 'cycle_indoor', label: 'Cycle (gym bike)', effort: true },
  { id: 'elliptical', label: 'Elliptical', effort: true },
  { id: 'rowing_machine', label: 'Rowing machine', effort: true },
  { id: 'stair_machine', label: 'Stair master' },
  { id: 'swimming', label: 'Swimming laps', effort: true },
  { id: 'hiit', label: 'HIIT or circuit', effort: true },
  { id: 'other', label: 'Something else', effort: true },
] as const
export type ActivityId = (typeof ACTIVITIES)[number]['id']

const MET: Record<string, Partial<Record<Effort | 'general', number>>> = {
  stair_machine: { general: 9.3 }, cycle_indoor: { light: 3.5, moderate: 6.8, hard: 8.8 }, elliptical: { moderate: 5, hard: 9 },
  rowing_machine: { moderate: 5, hard: 7.3 }, cycle_outdoor: { light: 4, moderate: 6.8, hard: 8 }, swimming: { moderate: 5.8, hard: 9.8 },
  hiit: { moderate: 7, hard: 11 }, other: { light: 2.5, moderate: 4.5, hard: 7 },
}

export type Estimate = { kcal: number; met: number; basis: string }
export function cardioKcal(a: { activity: ActivityId; minutes: number; weightKg: number; speedKmh?: number; distanceKm?: number; inclinePct?: number; effort?: Effort }): Estimate | null {
  const { activity, minutes, weightKg: kg } = a
  if (!(minutes > 0) || !(kg > 0)) return null
  const effort = a.effort ?? 'moderate'
  const speed = (def: number) => (a.speedKmh && a.speedKmh > 0 ? a.speedKmh : a.distanceKm && a.distanceKm > 0 ? a.distanceKm / (minutes / 60) : def)
  let met: number, basis: string
  switch (activity) {
    case 'treadmill_walk': case 'walk_outdoor': {
      const v = Math.min(speed(5), 9), inc = activity === 'treadmill_walk' ? a.inclinePct ?? 0 : 0
      met = acsmWalk(v, inc) / 3.5; basis = `Walking at ${v.toFixed(1)} km/h${inc ? ` on a ${inc}% incline` : ''}, ACSM walking equation`; break
    }
    case 'treadmill_run': case 'run_outdoor': {
      const v = Math.max(speed(9), 5), inc = activity === 'treadmill_run' ? a.inclinePct ?? 0 : 0
      met = acsmRun(v, inc) / 3.5; basis = `Running at ${v.toFixed(1)} km/h${inc ? ` on a ${inc}% incline` : ''}, ACSM running equation`; break
    }
    case 'cycle_outdoor': {
      const v = a.speedKmh ?? (a.distanceKm ? a.distanceKm / (minutes / 60) : null)
      if (v) { met = cycleKmh(v); basis = `Cycling at ${v.toFixed(1)} km/h (Compendium)` } else { met = MET.cycle_outdoor[effort] ?? 6.8; basis = `Cycling outside, ${effort} effort (Compendium)` }
      break
    }
    case 'stair_machine': met = 9.3; basis = 'Stair climbing machine (Compendium)'; break
    default: { const t = MET[activity]; met = t[effort] ?? t.moderate ?? 4.5; basis = `${ACTIVITIES.find((x) => x.id === activity)?.label}, ${effort} effort (Compendium)` }
  }
  return { kcal: Math.round(kcalFromMet(met, kg, minutes)), met: Math.round(met * 10) / 10, basis }
}
export { cycleWatts }

/** Steps → distance (stride = 0.414 × height, 0.7 m default) → kcal at 0.5 kcal/kg/km. */
export const strideM = (heightCm?: number) => (heightCm ? (heightCm * 0.414) / 100 : 0.7)
export function stepsKcal(steps: number, weightKg: number, heightCm?: number): Estimate | null {
  if (!(steps > 0) || !(weightKg > 0)) return null
  const km = (steps * strideM(heightCm)) / 1000
  return { kcal: Math.round(0.5 * weightKg * km), met: 0, basis: `${steps.toLocaleString('en-GB')} steps of ${Math.round(strideM(heightCm) * 100)} cm ≈ ${km.toFixed(1)} km` }
}

/** Weight training: MET 3.5–6 scaled by the share of sets taken within 2 RIR. */
export function liftingKcal(minutes: number, weightKg: number, hardShare: number | null): Estimate | null {
  if (!(minutes > 0) || !(weightKg > 0)) return null
  const t = hardShare ?? 0.5, met = 3.5 + (6 - 3.5) * t
  return { kcal: Math.round(kcalFromMet(met, weightKg, minutes)), met: Math.round(met * 10) / 10, basis: hardShare === null ? 'Weight training at a middle effort (Compendium)' : `Weight training, ${Math.round(t * 100)}% of sets near failure (Compendium)` }
}
