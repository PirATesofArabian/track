import type { Exercise } from '../data/exerciseDb'
import type { WSet } from './db'
import { fmtDuration, fmtKg } from './util'

export type FieldDef = { id: string; label: string; step?: string; get: (s: WSet) => number | null; set: (s: WSet, v: number | null) => Partial<WSet> }

const kg = (label: string): FieldDef => ({ id: 'w', label, step: '0.25', get: (s) => s.weightKg, set: (_s, v) => ({ weightKg: v }) })
const reps: FieldDef = { id: 'r', label: 'reps', get: (s) => s.reps, set: (_s, v) => ({ reps: v }) }
const rir: FieldDef = { id: 'rir', label: 'RIR', get: (s) => s.rir, set: (_s, v) => ({ rir: v }) }
const left: FieldDef = { id: 'l', label: 'L reps', get: (s) => s.repsLeft ?? null, set: (s, v) => ({ repsLeft: v, reps: v === null || s.repsRight == null ? null : Math.min(v, s.repsRight) }) }
const right: FieldDef = { id: 'rt', label: 'R reps', get: (s) => s.repsRight ?? null, set: (s, v) => ({ repsRight: v, reps: v === null || s.repsLeft == null ? null : Math.min(v, s.repsLeft) }) }
const seconds: FieldDef = { id: 'sec', label: 'sec', get: (s) => s.durationSec, set: (_s, v) => ({ durationSec: v }) }
const metres: FieldDef = { id: 'm', label: 'metres', get: (s) => s.distanceM, set: (_s, v) => ({ distanceM: v }) }
const minutes: FieldDef = { id: 'min', label: 'min', step: '0.5', get: (s) => (s.durationSec == null ? null : Math.round((s.durationSec / 60) * 100) / 100), set: (_s, v) => ({ durationSec: v === null ? null : Math.round(v * 60) }) }
const km: FieldDef = { id: 'km', label: 'km', step: '0.01', get: (s) => (s.distanceM == null ? null : Math.round(s.distanceM) / 1000), set: (_s, v) => ({ distanceM: v === null ? null : Math.round(v * 1000) }) }

/** The input columns for a set, according to how the exercise is tracked. */
export function fieldsFor(x: Exercise): FieldDef[] {
  const rep = x.eachSide ? [left, right] : [reps]
  switch (x.tracking) {
    case 'weight_reps': return [kg(x.loadMode === 'per_hand' ? 'kg/hand' : 'kg'), ...rep, rir]
    case 'bodyweight_reps': return [...rep, rir]
    case 'weighted_bodyweight': return [kg('+kg'), ...rep, rir]
    case 'assisted_bodyweight': return [kg('assist kg'), ...rep]
    case 'duration': return [seconds]
    case 'distance': return [kg('kg'), metres]
    case 'cardio': return [minutes, km]
  }
}

export function setText(s: WSet, x: Exercise): string {
  const r = x.eachSide ? `${s.repsLeft ?? 0}/${s.repsRight ?? 0}` : `${s.reps ?? 0}`
  const t = s.setType === 'warmup' ? 'W ' : ''
  switch (x.tracking) {
    case 'weight_reps': return `${t}${fmtKg(s.weightKg ?? 0)}${x.loadMode === 'per_hand' ? '/hand' : ''}×${r}`
    case 'bodyweight_reps': return `${t}${r} reps`
    case 'weighted_bodyweight': return `${t}${(s.weightKg ?? 0) > 0 ? `+${fmtKg(s.weightKg ?? 0)}` : 'BW'}×${r}`
    case 'assisted_bodyweight': return `${t}−${fmtKg(s.weightKg ?? 0)}×${r}`
    case 'duration': return fmtDuration(s.durationSec ?? 0)
    case 'distance': return `${(s.weightKg ?? 0) > 0 ? `${fmtKg(s.weightKg ?? 0)} kg · ` : ''}${Math.round(s.distanceM ?? 0)} m`
    case 'cardio': return `${Math.round(((s.durationSec ?? 0) / 60) * 10) / 10} min${(s.distanceM ?? 0) > 0 ? ` · ${((s.distanceM ?? 0) / 1000).toFixed(2)} km` : ''}`
  }
}

export const blankSet = (): WSet => ({ weightKg: null, reps: null, rir: null, setType: 'working', done: false, durationSec: null, distanceM: null })
