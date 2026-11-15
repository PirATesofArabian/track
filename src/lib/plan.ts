// Your "V-Taper • Athletic Physique" six-day plan (from the PDF), mapped to library exercises.
import type { PlanDay, Routine } from './db'

const x = (key: string, sets: number, repMin: number, repMax: number, rir: string, rest: number, cue?: string) => ({ key, sets, repMin, repMax, rir, rest, cue })
const C = 150, I = 90 // rest seconds: compound / isolation

export const V_TAPER: Routine = {
  name: 'V-Taper Athletic Physique (6-day PPL)',
  description: 'Double progression: reach the top of the rep range at target RIR on every set, then add the smallest load. Compounds 1–3 RIR, isolation 0–2 RIR. Rest 2–3 min compounds, 1–2 min isolation. Keep only variations that are pain-free.',
  days: [
    { name: 'Push A', focus: 'Upper chest, side delts, triceps', weekdays: [1], exercises: [
      x('incline-dumbbell-press', 3, 6, 10, '1–2', C, 'Incline 15–30°. Ref ~30 kg/hand.'),
      x('machine-chest-press', 2, 8, 12, '1–2', C, 'Flat machine; ref 60–80 kg on your machine.'),
      x('pec-deck', 2, 10, 15, '0–2', I, 'Controlled stretch; don’t force shoulder extension.'),
      x('cable-lateral-raise', 4, 12, 20, '0–2', I, 'Lean-away. Side-delt priority, strict, no torso swing.'),
      x('overhead-triceps-extension', 3, 10, 15, '0–2', I, 'Long-head emphasis, lengthened position.'),
      x('triceps-rope-pushdown', 2, 10, 15, '0–2', I, 'Controlled lockout, no snapping the elbow.'),
    ] },
    { name: 'Pull A', focus: 'Lat width, upper back, rear delts, biceps', weekdays: [2], exercises: [
      x('weighted-pull-up', 3, 6, 10, '1–3', C, '+25–30 kg ref. Clean reps, no kipping.'),
      x('chest-supported-row', 3, 8, 12, '1–2', C, 'Controlled scapular movement.'),
      x('straight-arm-pulldown', 2, 10, 15, '0–2', I, 'Lat-focused, not a triceps pressdown.'),
      x('reverse-pec-deck', 3, 12, 20, '0–2', I, 'Rear delts; pause in shortened position.'),
      x('incline-dumbbell-curl', 3, 8, 12, '0–2', I, '12.5–15 kg/hand ref.'),
      x('hammer-curl', 2, 10, 15, '0–2', I, 'Brachialis / brachioradialis.'),
      x('cable-crunch', 2, 8, 15, '2–3', I, 'Only a range that doesn’t aggravate your back.'),
    ] },
    { name: 'Legs A + core', focus: 'Quads, hamstrings, calves, trunk', weekdays: [3], exercises: [
      x('leg-press', 3, 6, 10, '1–3', C, 'Or squat / belt squat — choose the symptom-free, stable version.'),
      x('bulgarian-split-squat', 2, 8, 12, '1–2', C, '10–12.5 kg/hand ref. Support for balance if useful.'),
      x('leg-extension', 2, 10, 15, '0–2', I, 'Ref 70–80 kg (machine-specific).'),
      x('seated-leg-curl', 3, 10, 15, '0–2', I, 'Ref 40–50 kg. Controlled stretch.'),
      x('standing-calf-raise', 3, 8, 15, '0–2', I, 'Full ROM, pause in the stretch.'),
      x('cable-crunch', 2, 8, 15, '2–3', I, 'Or hollow hold. Symptom-free variation only.'),
    ] },
    { name: 'Push B', focus: 'Chest angles, side delts, triceps', weekdays: [4], exercises: [
      x('weighted-dips', 3, 6, 10, '1–3', C, '+35–40 kg ref. Chest-leaning; keep if shoulders/elbows tolerate.'),
      x('machine-chest-press', 2, 8, 12, '1–2', C, 'Incline machine press if available; stable upper-chest work.'),
      x('cable-fly', 2, 10, 15, '0–2', I, 'High-to-low, lower-pec bias, controlled arc.'),
      x('dumbbell-lateral-raise', 3, 10, 15, '0–2', I, '8–10 kg/hand ref. Strict; avoid shrugging.'),
      x('overhead-triceps-extension', 2, 10, 15, '0–2', I, 'Long-head work.'),
      x('triceps-rope-pushdown', 2, 12, 15, '0–2', I, 'Or cross-body cable extension.'),
    ] },
    { name: 'Pull B', focus: 'Back thickness, traps, biceps, forearms', weekdays: [5], exercises: [
      x('close-grip-lat-pulldown', 2, 8, 12, '1–2', C, 'Neutral grip. 80–90 kg v2 trial range.'),
      x('chest-supported-row', 3, 8, 12, '1–2', C, 'Seal row / chest-supported high row. Stable torso.'),
      x('one-arm-cable-row', 2, 10, 15, '0–2', C, '45 kg previously; keep torso still.'),
      x('rear-delt-fly', 2, 12, 20, '0–2', I, 'Cable rear-delt fly; don’t turn it into a row.'),
      x('barbell-shrug', 3, 10, 15, '0–2', I, 'DB or machine shrug. Pause at top, no rolling.'),
      x('preacher-curl', 3, 8, 12, '0–2', I, '10 kg/hand ref.'),
      x('brachioradialis-curl', 2, 12, 20, '0–2', I, 'Reverse curl — direct forearm-extensor work, strict light load.'),
      x('farmers-carry', 2, 30, 40, '', I, '30–40 m. Heavy but posture-stable.'),
    ] },
    { name: 'Legs B + core', focus: 'Hamstrings, glutes, quads, calves', weekdays: [6], exercises: [
      x('dumbbell-romanian-deadlift', 2, 8, 12, '1–2', C, '20 kg/hand ref. Only if the back tolerates the hinge.'),
      x('leg-press', 3, 10, 15, '1–2', C, 'Or hack squat. Back-tolerant machine, comfortable depth.'),
      x('hip-thrust', 3, 8, 12, '1–2', C, '40 kg ref. Pause at lockout, no lumbar overextension.'),
      x('seated-leg-curl', 2, 10, 15, '0–2', I, 'Low spinal demand.'),
      x('seated-calf-raise', 3, 10, 20, '0–2', I, 'Soleus emphasis, full ROM.'),
      x('cable-crunch', 2, 8, 15, '2–3', I, 'Or hollow hold. No hanging raises or loaded twisting.'),
    ] },
  ] as PlanDay[],
}

export const PLAN_NOTES = [
  'Weeks 1–2: calibrate — if full volume is a jump, start with 2 work sets on most exercises at 2–3 RIR.',
  'Weeks 3–5: progress — add reps before load; don’t add exercises while lifts progress.',
  'Weeks 6–7: assess — if several lifts regress, cut sets 30–50% for a week.',
  'Weeks 8–9: consolidate — compare strength, waist and photos. No need to test 1RMs.',
  'Back-aware rule: only keep movements and ranges that do not worsen symptoms. Persistent pain → get assessed.',
  'Running: 1–2 easy conversational runs a week (20–30 min / 4–5 km), away from the hardest leg day. Sunday is rest or an easy run.',
  'Targets from the plan: protein 150–170 g, steps built gradually from 3–4k toward 7–9k (+~1k/day every few days), sleep 7–9 h.',
]
