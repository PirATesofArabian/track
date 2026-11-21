// "Why did my weight move?": two weigh-ins, and what your own logs say happened between them.
// Every rule here is this app's own (Estimate). It reads your logs; it does not know about salt, sleep debt or stress.
import type { BodyWeight } from './db'
import { dayFacts, type Inputs } from './daysummary'
import type { ExIndex } from './perf'
import { KCAL_PER_KG } from './body'
import { daysBetween, shiftDate } from './util'

export type Why = {
  from: string; to: string; days: number; kgFrom: number; kgTo: number; change: number
  foodDays: number; kcal: number | null; usualKcal: number | null; carbs: number | null; usualCarbs: number | null
  trainedDays: number; sets: number; usualSets: number | null; steps: number | null; usualSteps: number | null
  maintenance: number | null
  fatKg: number | null // what the calories alone explain
  restKg: number | null // what is left: water, food in the gut, glycogen
  headline: string
  reasons: string[]
}

const mean = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null)
const r1 = (n: number) => Math.round(n * 10) / 10
const sgn = (n: number) => (n > 0 ? '+' : n < 0 ? '−' : '') + Math.abs(r1(n))

/** One reading per day (the last one logged), oldest first. */
export function dailyWeights(ws: BodyWeight[]): { date: string; kg: number }[] {
  const m = new Map<string, number>()
  for (const w of [...ws].sort((a, b) => a.date.localeCompare(b.date) || (a.id ?? 0) - (b.id ?? 0))) m.set(w.date, w.kg)
  return [...m.entries()].map(([date, kg]) => ({ date, kg }))
}

/** The morning weigh-in on `to` reflects the food and training of the days from `from` up to the day before `to`. */
export function weightWhy(from: string, to: string, d: Inputs, idx: ExIndex, maintenance: number | null): Why | null {
  const w = dailyWeights(d.weights), a = w.find((x) => x.date === from), b = w.find((x) => x.date === to)
  const days = daysBetween(from, to)
  if (!a || !b || days < 1) return null
  const span = Array.from({ length: days }, (_, i) => dayFacts(shiftDate(from, i), d, idx))
  const before = Array.from({ length: 14 }, (_, i) => dayFacts(shiftDate(from, -1 - i), d, idx))
  const fed = span.filter((f) => f.foodLogged), fedBefore = before.filter((f) => f.foodLogged)
  const kcal = mean(fed.map((f) => f.kcal)), carbs = mean(fed.map((f) => f.c))
  const usualKcal = mean(fedBefore.map((f) => f.kcal)), usualCarbs = mean(fedBefore.map((f) => f.c))
  const trained = span.filter((f) => f.trained), trainedBefore = before.filter((f) => f.trained)
  const sets = span.reduce((s, f) => s + f.sets, 0)
  const usualSets = trainedBefore.length >= 3 ? (before.reduce((s, f) => s + f.sets, 0) / 14) * days : null // needs real history before the stretch
  const steps = mean(span.filter((f) => f.steps > 0).map((f) => f.steps)), usualSteps = mean(before.filter((f) => f.steps > 0).map((f) => f.steps))
  const change = r1(b.kg - a.kg)
  const enoughFood = kcal !== null && fed.length >= Math.ceil(days / 2)
  const fatKg = enoughFood && maintenance !== null ? r1(((kcal! - maintenance) * days) / KCAL_PER_KG) : null
  const restKg = fatKg === null ? null : r1(change - fatKg)

  const reasons: string[] = []
  if (!enoughFood) reasons.push(`Food was logged on ${fed.length} of ${days} ${days === 1 ? 'day' : 'days'}, so the calories can't be judged.`)
  else {
    if (usualKcal !== null && Math.abs(kcal! / usualKcal - 1) >= 0.1) reasons.push(`You ate ${Math.round(kcal!)} kcal a day, ${kcal! > usualKcal ? 'more' : 'less'} than your usual ${Math.round(usualKcal)}.`)
    if (carbs !== null && usualCarbs !== null && Math.abs(carbs / usualCarbs - 1) >= 0.15) reasons.push(`Carbs were ${carbs > usualCarbs ? 'higher' : 'lower'} than usual (${Math.round(carbs)} g against ${Math.round(usualCarbs)} g). The body holds more water when it stores more carbs, and less when it stores fewer.`)
    if (fed.length < days) reasons.push(`${days - fed.length} of the ${days} days had no food logged, so the real intake could be higher.`)
  }
  const sess = `${trained.length} ${trained.length === 1 ? 'session' : 'sessions'}, ${sets} working sets`
  if (trained.length >= 3 || (usualSets !== null && sets >= usualSets * 1.3 && sets >= 10)) reasons.push(`Heavy training: ${sess}${usualSets ? ` (usual about ${Math.round(usualSets)} for this length of time)` : ''}. Hard sessions can hold water in the muscles for a few days.`)
  else if (!trained.length && trainedBefore.length >= 3) reasons.push('No training in this stretch, after a normal block before it.')
  if (steps !== null && usualSteps !== null && Math.abs(steps / usualSteps - 1) >= 0.3) reasons.push(`Steps averaged ${Math.round(steps).toLocaleString('en-IN')} a day, ${steps > usualSteps ? 'above' : 'below'} your usual ${Math.round(usualSteps).toLocaleString('en-IN')}.`)

  let headline: string
  if (Math.abs(change) < 0.3) headline = 'Basically flat. Nothing to explain.'
  else if (fatKg === null) headline = maintenance === null ? 'Add height, birth date and sex in your profile so the calorie part can be worked out. Until then: daily weight moves by a kilo or more from water and food in the gut.' : "Not enough food logged between these weigh-ins to say."
  else if (days < 7 && Math.abs(fatKg) < Math.abs(change) / 2) headline = `Mostly not fat. Calories explain about ${sgn(fatKg)} kg of the ${sgn(change)} kg. The other ${sgn(restKg!)} kg is water, food in the gut or glycogen.`
  else if (days < 7) headline = `Calories could account for ${sgn(fatKg)} kg of the ${sgn(change)} kg, but ${days} ${days === 1 ? 'day' : 'days'} is too short to call it fat. Look at the 7-day average.`
  else if (Math.abs(restKg!) <= Math.max(0.3, Math.abs(change) * 0.3)) headline = `Calories explain it: about ${sgn(fatKg)} kg from what you ate against your maintenance.`
  else headline = `Part calories (${sgn(fatKg)} kg), part water or food in the gut (${sgn(restKg!)} kg).`
  return { from, to, days, kgFrom: a.kg, kgTo: b.kg, change, foodDays: fed.length, kcal, usualKcal, carbs, usualCarbs, trainedDays: trained.length, sets, usualSets, steps, usualSteps, maintenance, fatKg, restKg, headline, reasons }
}

/** Consecutive weigh-ins no more than 10 days apart, newest first. */
export function recentIntervals(ws: BodyWeight[], limit = 10): { from: string; to: string }[] {
  const w = dailyWeights(ws), out: { from: string; to: string }[] = []
  for (let i = w.length - 1; i > 0 && out.length < limit; i--) if (daysBetween(w[i - 1].date, w[i].date) <= 10) out.push({ from: w[i - 1].date, to: w[i].date })
  return out
}
