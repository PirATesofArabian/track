// Plate calculator + warm-up ladder, ported from the Macrotrophy bundle (O_/k_/A_/j_/M_/N_).
export type PlateUnit = 'kg' | 'lb'
export const PLATES: Record<PlateUnit, number[]> = { kg: [25, 20, 15, 10, 5, 2.5, 1.25], lb: [45, 35, 25, 10, 5, 2.5] }
export const BARS: Record<PlateUnit, number[]> = { kg: [20, 15, 10], lb: [45, 35, 25] }

/** Greedy plates per side for a target total on a bar. null when the target is below the bar. */
export function plateBreakdown(target: number, bar: number, plates: number[]) {
  if (!(target >= bar)) return null
  let rem = (target - bar) / 2
  const perSide: number[] = []
  for (const p of [...plates].sort((a, b) => b - a)) while (rem >= p - 1e-9) { perSide.push(p); rem -= p }
  const achieved = bar + perSide.reduce((a, b) => a + b, 0) * 2
  return { perSide, achieved, remainder: Math.round((target - achieved) * 1000) / 1000 }
}

/** Warm-up ladder: bar x10 when working weight > 1.5x bar, then 40%x5, 60%x3, 80%x1 (floored to `step`). */
export function warmupLadder(working: number, o: { bar: number | null; step: number }) {
  const { bar, step } = o
  if (!(working > 0)) return []
  const floor = (v: number) => Math.floor(v / step) * step
  const out: { weight: number; reps: number }[] = []
  if (bar !== null && working > bar * 1.5) out.push({ weight: bar, reps: 10 })
  for (const [frac, reps] of [[0.4, 5], [0.6, 3], [0.8, 1]] as const) {
    const w = floor(working * frac)
    if (w > (out[out.length - 1]?.weight ?? 0) && w < working && (bar === null || w > bar)) out.push({ weight: w, reps })
  }
  return out
}
