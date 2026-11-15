// Food data extracted from the Macrotrophy app bundle (per-100 g values + serving units).
// Sources: curated base foods (used by meal plans), regional recipe dishes, INDB (IFCT-based) and USDA.
export type Per100 = { kcal: number; p: number; c: number; f: number; fib: number }
export type Unit = 'piece' | 'g' | 'serving' | 'katori' | 'plate' | 'ladle' | 'bowl' | 'tbsp' | 'glass' | 'ml' | 'tsp' | 'cup'
export type Size = 'small' | 'medium' | 'large'
export type Rich = 'light' | 'normal' | 'rich'

export type FoodItem = {
  id: string
  name: string
  aliases?: string[]
  per100: Per100
  fatPer100?: Per100 // extra nutrients contributed by cooking fat, scaled by richness
  units: Unit[]
  diet?: string
  category?: string
  region?: string
  meals?: string[]
  jain?: boolean
  source?: string
  density?: number
  pieceG?: number
  pieceName?: [string, string]
  servingG?: number
  plateG?: number
  bowlG?: number
  defaultAmount?: number
  custom?: boolean
}

/** A custom food is stored per serving; the app treats one serving as 100 g so the per-100 g values equal the serving's. */
export const customToItem = (c: { id?: number; name: string; kcal: number; p: number; c: number; f: number }): FoodItem =>
  ({ id: `custom-${c.id}`, name: c.name, per100: { kcal: c.kcal, p: c.p, c: c.c, f: c.f, fib: 0 }, units: ['serving'], servingG: 100, custom: true })

let cache: Promise<FoodItem[]> | null = null

export function loadFoods(): Promise<FoodItem[]> {
  cache ??= Promise.all([import('./db/base.json'), import('./db/regional.json'), import('./db/indb.json'), import('./db/usda.json')]).then(
    ([b, r, i, u]) => [...(b.default as FoodItem[]), ...(r.default as FoodItem[]), ...(i.default as FoodItem[]), ...(u.default as FoodItem[])],
  )
  return cache
}

const VOL_FACTOR: Partial<Record<Unit, number>> = { katori: 0.8, glass: 0.9, cup: 0.9 }
const KATORI_ML: Record<Size, number> = { small: 150, medium: 200, large: 250 }
const CUP_ML: Record<Size, number> = { small: 100, medium: 150, large: 150 }
const RICH_FACTOR: Record<Rich, number> = { light: 0.5, normal: 1, rich: 2 }

/** Grams in ONE of the given unit, or null if the food has no such measure. */
export function gramsPerUnit(f: FoodItem, unit: Unit, size: Size = 'medium'): number | null {
  const d = f.density ?? 1
  const vol = (ml: number) => ml * (VOL_FACTOR[unit] ?? 1) * d
  switch (unit) {
    case 'katori': return vol(KATORI_ML[size])
    case 'cup': return vol(CUP_ML[size])
    case 'ladle': return vol(60)
    case 'glass': return vol(200)
    case 'tbsp': return vol(15)
    case 'tsp': return vol(5)
    case 'piece': return f.pieceG ?? null
    case 'serving': return f.servingG ?? null
    case 'g': return 1
    case 'ml': return d
    case 'plate': return f.plateG ?? null
    case 'bowl': return f.bowlG ?? null
  }
}

export function nutrients(f: FoodItem, grams: number, rich: Rich = 'normal') {
  const k = grams / 100
  const out = { kcal: f.per100.kcal * k, p: f.per100.p * k, c: f.per100.c * k, f: f.per100.f * k, fib: (f.per100.fib ?? 0) * k }
  if (f.fatPer100 && rich !== 'normal') {
    const x = ((RICH_FACTOR[rich] - 1) * grams) / 100
    out.kcal += f.fatPer100.kcal * x
    out.p += f.fatPer100.p * x
    out.c += f.fatPer100.c * x
    out.f += f.fatPer100.f * x
    out.fib += (f.fatPer100.fib ?? 0) * x
  }
  return out
}

export function defaultAmountFor(f: FoodItem, unit: Unit): number {
  if (unit === 'g' || unit === 'ml') return f.units[0] === unit && f.defaultAmount ? f.defaultAmount : 100
  return f.units[0] === unit && f.defaultAmount ? f.defaultAmount : 1
}

export function unitLabel(f: FoodItem, unit: Unit, amount: number): string {
  if (unit === 'g' || unit === 'ml') return unit
  if (unit === 'piece' && f.pieceName) return amount > 1 ? f.pieceName[1] : f.pieceName[0]
  const plural: Record<string, string> = { glass: 'glasses', tbsp: 'tbsp', tsp: 'tsp', ladle: 'ladles' }
  return amount > 1 ? plural[unit] ?? `${unit}s` : unit
}

export function formatAmount(n: number): string {
  const t = Math.floor(n), r = n - t
  const frac = Math.abs(r - 0.5) < 0.01 ? '½' : Math.abs(r - 0.25) < 0.01 ? '¼' : Math.abs(r - 0.75) < 0.01 ? '¾' : ''
  return frac ? (t ? `${t}${frac}` : frac) : String(Math.round(n * 10) / 10)
}

export function searchFoods(all: FoodItem[], q: string, limit = 40): FoodItem[] {
  const terms = q.toLowerCase().split(/\s+/).filter(Boolean)
  if (!terms.length) return []
  const scored: [number, number, FoodItem][] = []
  all.forEach((f, i) => {
    const name = f.name.toLowerCase()
    const hay = [name, ...(f.aliases ?? []).map((a) => a.toLowerCase())]
    if (!terms.every((t) => hay.some((h) => h.includes(t)))) return
    const score = name.startsWith(terms[0]) ? 0 : name.split(/[\s,(]+/).some((w) => w.startsWith(terms[0])) ? 1 : 2
    scored.push([score, i, f])
  })
  return scored.sort((a, b) => a[0] - b[0] || a[1] - b[1]).slice(0, limit).map((x) => x[2])
}
