// Ported body maths: BMI (+ Asian band), Navy body-fat, lean mass, FFMI, Mifflin/Katch BMR, TDEE, targets, weight trend & rate.
import type { BodyWeight, DailyActivity, Goal, Measurement, Profile } from './db'
import { parseDate, roundTo } from './util'

export const bmi = (kg: number, cm: number) => kg / (cm / 100) ** 2
export function bmiBand(v: number, asian = false): 'under' | 'healthy' | 'over' | 'obese' {
  return v < 18.5 ? 'under' : v < (asian ? 23 : 25) ? 'healthy' : v < (asian ? 27.5 : 30) ? 'over' : 'obese'
}
export const BAND_LABEL = { under: 'Underweight', healthy: 'Healthy range', over: 'Overweight', obese: 'Obese' }

/** US Navy tape method. Male: waist & neck. Female: waist + hip & neck. */
export function navyBodyFat(sex: string, heightCm: number | undefined, waist: number | null, neck: number | null, hip: number | null): number | null {
  if (!heightCm || !waist || !neck) return null
  let v: number
  if (sex === 'male') {
    if (waist - neck <= 0) return null
    v = 495 / (1.0324 - 0.19077 * Math.log10(waist - neck) + 0.15456 * Math.log10(heightCm)) - 450
  } else if (sex === 'female') {
    if (!hip || waist + hip - neck <= 0) return null
    v = 495 / (1.29579 - 0.35004 * Math.log10(waist + hip - neck) + 0.221 * Math.log10(heightCm)) - 450
  } else return null
  return Number.isFinite(v) && v >= 2 && v <= 70 ? v : null
}

export const leanMass = (kg: number, bf: number) => kg * (1 - bf / 100)
export const ffmi = (lean: number, cm: number) => lean / (cm / 100) ** 2
export const ffmiNormalized = (lean: number, cm: number) => ffmi(lean, cm) + 6.1 * (1.8 - cm / 100)
export const waistToHeight = (waist: number, cm: number) => waist / cm

export const mifflin = (sex: string, kg: number, cm: number, age: number) => (sex === 'unspecified' ? null : 10 * kg + 6.25 * cm - 5 * age + (sex === 'male' ? 5 : -161))
export const katch = (leanKg: number) => 370 + 21.6 * leanKg

export const PAL: Record<DailyActivity, number> = { sitting: 1.4, mixed: 1.5, on_feet: 1.6, physical: 1.8 }
export const PAL_LABEL: Record<DailyActivity, string> = { sitting: 'Mostly sitting', mixed: 'Mixed', on_feet: 'On my feet', physical: 'Physical job' }
const GOAL_ADJ: Record<Goal, number> = { hypertrophy: 0.1, strength_hypertrophy: 0.1, strength: 0.05, fat_loss: -0.2, recomposition: -0.1, general_fitness: 0 }
// g of protein per kg of body weight (the science page): 1.6 to 2.2 to build, 2.0 to 2.4 when losing fat or recomposing, 1.2 to 1.6 for general fitness.
export const PROTEIN_PER_KG: Record<Goal, [number, number]> = { hypertrophy: [1.6, 2.2], strength_hypertrophy: [1.6, 2.2], strength: [1.6, 2.2], fat_loss: [2, 2.4], recomposition: [2, 2.4], general_fitness: [1.2, 1.6] }
export const GOAL_LABEL: Record<Goal, string> = {
  fat_loss: 'Lose fat, show abs', hypertrophy: 'Build muscle', recomposition: 'Aesthetic recomp', strength_hypertrophy: 'Strength + size', strength: 'Strength', general_fitness: 'General fitness',
}
export const GOAL_HELP: Record<Goal, string> = {
  fat_loss: 'Get lean enough for visible abs and keep your muscle. Calories about 20% under maintenance.',
  hypertrophy: 'Gain muscle with as little fat as possible (lean bulk). Calories about 10% over maintenance.',
  recomposition: 'Lose fat and build muscle together, slowly. Calories about 10% under maintenance.',
  strength_hypertrophy: 'Get stronger and bigger. Calories about 10% over maintenance.',
  strength: 'Lift heavier. Calories about 5% over maintenance.',
  general_fitness: 'Stay fit and hold your weight. Calories at maintenance.',
}
export const GOAL_ORDER: Goal[] = ['fat_loss', 'hypertrophy', 'recomposition', 'strength_hypertrophy', 'strength', 'general_fitness']
/** Fat is the larger of 0.8 g per kg and 25% of energy; carbohydrate is what is left at 4 kcal per g. */
export const FAT_SHARE_OF_ENERGY = 0.25
export function splitMacros(kcal: number, kg: number, proteinG: number) {
  const fat = Math.max(roundTo(0.8 * kg, 5), roundTo((kcal * FAT_SHARE_OF_ENERGY) / 9, 5))
  return { fat, carbs: Math.max(0, roundTo((kcal - proteinG * 4 - fat * 9) / 4, 5)) }
}
/**
 * Expected weekly body-weight change for an intake against maintenance. 7,700 kcal per kg of body mass is the
 * classic rule of thumb (Wishnofsky 1958). It overstates change over many weeks because metabolism adapts (Hall 2011),
 * so treat it as the first-weeks pace and let your own weight trend overrule it.
 */
export const KCAL_PER_KG = 7700
export const paceKgPerWeek = (kcal: number, tdee: number) => ((kcal - tdee) * 7) / KCAL_PER_KG
const WEIGHT_TRAINING_MET = 3.5

export function energy(p: { sex: string; age: number | null; heightCm?: number; weightKg: number | null; bodyFatPct: number | null; goal: Goal; dailyActivity: DailyActivity; trainingDays: number | null; sessionMinutes: number }) {
  const { weightKg: kg } = p
  if (!kg) return null
  let bmr: number | null = null, method: 'mifflin' | 'katch' = 'mifflin'
  if (p.sex !== 'unspecified' && p.heightCm && p.age !== null) bmr = mifflin(p.sex, kg, p.heightCm, p.age)
  else if (p.bodyFatPct !== null) { bmr = katch(leanMass(kg, p.bodyFatPct)); method = 'katch' }
  if (bmr === null || p.trainingDays === null) return null
  const daily = roundTo(bmr * PAL[p.dailyActivity], 10)
  const training = roundTo((p.sessionMinutes / 60) * p.trainingDays * (WEIGHT_TRAINING_MET - 1) * kg / 7, 10)
  const tdee = daily + training
  const adj = GOAL_ADJ[p.goal]
  const target = roundTo(tdee * (1 + adj), 50)
  const [lo, hi] = PROTEIN_PER_KG[p.goal]
  const protein: [number, number] = [Math.round(lo * kg * 10) / 10, Math.round(hi * kg * 10) / 10]
  const proteinG = Math.round((protein[0] + protein[1]) / 2)
  const { fat, carbs } = splitMacros(target, kg, proteinG)
  return { bmr: Math.round(bmr), method, dailyKcal: daily, trainingKcal: training, tdee, targetKcal: target, adjustment: adj, protein, proteinG, fat, carbs }
}

export function ageOn(birthDate: string | undefined, on: Date): number | null {
  if (!birthDate) return null
  const b = parseDate(birthDate)
  let a = on.getFullYear() - b.getFullYear()
  if (on.getMonth() < b.getMonth() || (on.getMonth() === b.getMonth() && on.getDate() < b.getDate())) a--
  return a >= 0 && a < 120 ? a : null
}

/** 7-day trailing average (the "trend" weight). */
export function weightTrend(ws: BodyWeight[]) {
  const s = [...ws].sort((a, b) => a.date.localeCompare(b.date))
  return s.map((w, i) => {
    const from = parseDate(w.date).getTime() - 6 * 864e5
    let sum = 0, n = 0
    for (let j = i; j >= 0 && parseDate(s[j].date).getTime() >= from; j--) { sum += s[j].kg; n++ }
    return { date: w.date, kg: w.kg, trendKg: sum / n }
  })
}

/** kg / week: least-squares slope of the trend over the last 4 weeks (needs ≥6 weigh-ins over ≥14 days). */
export function weightRate(trend: ReturnType<typeof weightTrend>, today: string): number | null {
  const from = parseDate(today).getTime() - 28 * 864e5
  const pts = trend.filter((t) => parseDate(t.date).getTime() >= from)
  if (pts.length < 6 || (parseDate(pts[pts.length - 1].date).getTime() - parseDate(pts[0].date).getTime()) / 864e5 < 14) return null
  const xs = pts.map((p) => parseDate(p.date).getTime() / 864e5), ys = pts.map((p) => p.trendKg)
  const mx = xs.reduce((a, b) => a + b, 0) / xs.length, my = ys.reduce((a, b) => a + b, 0) / ys.length
  let num = 0, den = 0
  xs.forEach((x, i) => { num += (x - mx) * (ys[i] - my); den += (x - mx) ** 2 })
  return den === 0 ? null : (num / den) * 7
}

/** Target weekly change as a fraction of body weight. */
export function targetRate(goal: Goal, exp: Profile['experience']): [number, number] {
  switch (goal) {
    case 'fat_loss': return [-0.01, -0.005]
    case 'recomposition': return [-0.005, 0]
    case 'hypertrophy': case 'strength_hypertrophy': return exp === 'beginner' ? [0.0025, 0.005] : exp === 'intermediate' ? [0.002, 0.004] : [0.001, 0.0025]
    case 'strength': return [0, 0.0025]
    case 'general_fitness': return [-0.0025, 0.0025]
  }
}
export function rateVerdict(kgPerWeek: number, kg: number, goal: Goal, exp: Profile['experience']): 'on_track' | 'too_fast' | 'too_slow' | 'wrong_way' {
  const [a, b] = targetRate(goal, exp), r = kgPerWeek / kg, tol = 5e-4
  if (r >= a - tol && r <= b + tol) return 'on_track'
  const mid = (a + b) / 2
  if (mid < 0) return r < a ? 'too_fast' : r > tol ? 'wrong_way' : 'too_slow'
  if (mid > 0) return r > b ? 'too_fast' : r < -5e-4 ? 'wrong_way' : 'too_slow'
  return 'too_fast'
}

export const MEASURE_KEYS = ['waistCm', 'neckCm', 'chestCm', 'armCm', 'thighCm', 'calfCm', 'hipCm'] as const
export type MeasureKey = (typeof MEASURE_KEYS)[number]
export const MEASURE_LABEL: Record<MeasureKey, string> = { waistCm: 'Waist', neckCm: 'Neck', chestCm: 'Chest', armCm: 'Arm (flexed)', thighCm: 'Thigh', calfCm: 'Calf', hipCm: 'Hips' }
export const MEASURE_HELP: Record<MeasureKey, string> = {
  waistCm: 'At the navel, relaxed, after breathing out', neckCm: 'Just below the Adam’s apple', hipCm: 'Widest point of the hips',
  chestCm: 'Across the nipples, arms down', armCm: 'Flexed, at the peak of the biceps', thighCm: 'Halfway between hip and knee', calfCm: 'Widest point',
}

/** Latest non-null value per measurement field. */
export function latestMeasures(ms: Measurement[]) {
  const s = [...ms].sort((a, b) => b.date.localeCompare(a.date) || (b.id ?? 0) - (a.id ?? 0))
  const pick = (k: keyof Measurement) => { const m = s.find((x) => x[k] != null); return m ? { value: m[k] as number, date: m.date } : null }
  return { waistCm: pick('waistCm'), neckCm: pick('neckCm'), hipCm: pick('hipCm'), chestCm: pick('chestCm'), armCm: pick('armCm'), thighCm: pick('thighCm'), calfCm: pick('calfCm'), bodyFatPct: pick('bodyFatPct') }
}

export function bodySnapshot(a: { profile: Profile; weights: BodyWeight[]; measurements: Measurement[]; today: string; loggedDaysPerWeek: number | null }) {
  const { profile: p } = a
  const now = parseDate(a.today)
  const trend = weightTrend(a.weights)
  const kg = trend.length ? trend[trend.length - 1].trendKg : null
  const m = latestMeasures(a.measurements)
  const navy = navyBodyFat(p.sex, p.heightCm, m.waistCm?.value ?? null, m.neckCm?.value ?? null, m.hipCm?.value ?? null)
  const measuredFresh = m.bodyFatPct && now.getTime() - parseDate(m.bodyFatPct.date).getTime() <= 60 * 864e5
  const bf = measuredFresh ? { pct: m.bodyFatPct!.value, source: 'measured' as const } : navy !== null ? { pct: navy, source: 'navy' as const } : m.bodyFatPct ? { pct: m.bodyFatPct.value, source: 'measured' as const } : null
  const lean = kg !== null && bf ? leanMass(kg, bf.pct) : null
  const age = ageOn(p.birthDate, now)
  const days = a.loggedDaysPerWeek ?? p.trainingDays ?? null
  return {
    trend, kg, age, bf, lean, measures: m,
    bmi: kg !== null && p.heightCm ? { value: bmi(kg, p.heightCm), band: bmiBand(bmi(kg, p.heightCm)), asian: bmiBand(bmi(kg, p.heightCm), true) } : null,
    ffmi: lean !== null && p.heightCm ? { value: ffmi(lean, p.heightCm), norm: ffmiNormalized(lean, p.heightCm) } : null,
    whtr: m.waistCm && p.heightCm ? waistToHeight(m.waistCm.value, p.heightCm) : null,
    energy: energy({ sex: p.sex, age, heightCm: p.heightCm, weightKg: kg, bodyFatPct: bf?.pct ?? null, goal: p.goal, dailyActivity: p.dailyActivity, trainingDays: days, sessionMinutes: p.sessionMinutes ?? 60 }),
    // A target and verdict exist only for the Fat Loss goal; other goals see the rate alone.
    rate: (() => { const r = weightRate(trend, a.today); return r !== null && kg !== null ? { kgPerWeek: r, verdict: p.goal === 'fat_loss' ? rateVerdict(r, kg, p.goal, p.experience) : null, target: p.goal === 'fat_loss' ? targetRate(p.goal, p.experience) : null } : null })(),
  }
}
