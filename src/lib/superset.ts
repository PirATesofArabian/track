import type { WEx } from './db'

/** Link/unlink exercise `i` with the next one (port of the bundle's superset `u`). Returns the new exercise list. */
export function toggleSuperset(list: WEx[], i: number): WEx[] {
  const a = list[i], b = list[i + 1]
  if (!a || !b) return list
  const ga = a.supersetGroup ?? null
  const next = () => Math.max(0, ...list.map((e) => e.supersetGroup ?? 0)) + 1
  const patch = new Map<number, number | null>()
  if (ga !== null && b.supersetGroup === ga) {
    // unlink: everything after i leaves the group; groups of <2 dissolve
    const before = list.map((e, k) => ({ e, k })).filter(({ e, k }) => k <= i && e.supersetGroup === ga)
    const after = list.map((e, k) => ({ e, k })).filter(({ e, k }) => k > i && e.supersetGroup === ga)
    const g = next()
    if (before.length < 2) before.forEach(({ k }) => patch.set(k, null))
    after.forEach(({ k }) => patch.set(k, after.length < 2 ? null : g))
  } else {
    const g = ga ?? b.supersetGroup ?? next()
    patch.set(i, g); patch.set(i + 1, g)
    if (b.supersetGroup != null) list.forEach((e, k) => { if (e.supersetGroup === b.supersetGroup) patch.set(k, g) })
  }
  return list.map((e, k) => (patch.has(k) ? { ...e, supersetGroup: patch.get(k) } : e))
}

/** Labels like A1, A2, B1 for linked exercises. */
export function supersetLabels(list: WEx[]): Map<number, { label: string; linkedNext: boolean; linkedPrev: boolean }> {
  const out = new Map<number, { label: string; linkedNext: boolean; linkedPrev: boolean }>()
  let letter = 0
  list.forEach((e, i) => {
    const g = e.supersetGroup
    if (g == null) return
    const prev = list[i - 1]?.supersetGroup === g, next = list[i + 1]?.supersetGroup === g
    if (!prev && !next) return
    if (!prev) letter++
    const n = prev ? Number(out.get(i - 1)!.label.slice(1)) + 1 : 1
    out.set(i, { label: `${String.fromCharCode(64 + letter)}${n}`, linkedNext: next, linkedPrev: prev })
  })
  return out
}
