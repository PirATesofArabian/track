// Exercise library extracted from the Macrotrophy app bundle (120 exercises).
import lib from './db/exercises.json'

export const MUSCLES = ['chest', 'back', 'shoulders', 'biceps', 'triceps', 'quads', 'hamstrings', 'glutes', 'adductors', 'calves', 'abs', 'cardio'] as const
export type Muscle = (typeof MUSCLES)[number]
export type Tracking = 'weight_reps' | 'bodyweight_reps' | 'weighted_bodyweight' | 'assisted_bodyweight' | 'duration' | 'distance' | 'cardio'
export const TRACKING_LABEL: Record<Tracking, string> = {
  weight_reps: 'Weight × reps',
  bodyweight_reps: 'Bodyweight reps',
  weighted_bodyweight: 'Added weight × reps',
  assisted_bodyweight: 'Assisted (counterweight) × reps',
  duration: 'Time',
  distance: 'Distance (+ weight)',
  cardio: 'Time + distance',
}
export const EQUIPMENT = ['barbell', 'dumbbell', 'cable', 'machine', 'bodyweight', 'kettlebell', 'band', 'other'] as const

export type Exercise = {
  key: string
  name: string
  primary: Muscle
  secondary: Muscle[]
  equipment: string
  category: 'compound' | 'isolation'
  tracking: Tracking
  loadMode: 'total' | 'per_hand'
  eachSide: boolean
  instructions: string
  custom?: boolean
}

export const LIBRARY = lib as unknown as Exercise[]

const byLowerName = new Map(LIBRARY.map((e) => [e.name.toLowerCase(), e]))
export const findByName = (name: string) => byLowerName.get(name.trim().toLowerCase())

export const FALLBACK = (key: string, name: string): Exercise => ({
  key, name, primary: 'chest', secondary: [], equipment: 'other', category: 'isolation',
  tracking: 'weight_reps', loadMode: 'total', eachSide: false, instructions: '', custom: true,
})

export const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)
