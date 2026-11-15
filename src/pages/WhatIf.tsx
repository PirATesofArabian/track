import { useMemo, useState } from 'react'
import { Btn, Sheet } from '../lib/ui'
import { whatIf } from '../lib/adaptive'
import { muscleLabel } from '../lib/weekly'
import type { useAdaptive } from '../lib/adaptiveStore'

type Brain = NonNullable<ReturnType<typeof useAdaptive>>
const r50 = (n: number) => Math.round(n / 50) * 50
const f1 = (n: number) => (Math.round(n * 10) / 10).toFixed(1)
const signed = (n: number) => `${n > 0 ? '+' : n < 0 ? '−' : ''}${Math.abs(n).toFixed(2)}`
const inr = (n: number) => n.toLocaleString('en-IN')

/** "Try a different plan": what a calorie level and weekly sets would likely do over 8 weeks. Ported from their ReportPage (`Be`, `Ve`, `Re`). */
export function WhatIfButton({ brain }: { brain: Brain }) {
  const [open, setOpen] = useState(false)
  if (!brain.model.maintenance || !brain.input.person.weightKg) return null
  return (
    <>
      <Btn variant="ghost" className="w-full" onClick={() => setOpen(true)}>Try a different plan</Btn>
      <Sheet open={open} onClose={() => setOpen(false)} title="Try a different plan">
        {open && <Body brain={brain} />}
      </Sheet>
    </>
  )
}

function Body({ brain }: { brain: Brain }) {
  const { model, input, weeks } = brain
  const maint = r50(model.maintenance!.value), weightKg = input.person.weightKg!
  const pick = useMemo(() => {
    const last = weeks[weeks.length - 1]
    const best = Object.entries(model.lifts).map(([id, trend]) => {
      const muscle = [...weeks].reverse().find((w) => w.lifts[id])?.lifts[id]?.muscle
      return muscle ? { id, trend, muscle } : null
    }).filter((x): x is NonNullable<typeof x> => x !== null).sort((a, b) => b.trend.weeks - a.trend.weeks || b.trend.latest - a.trend.latest)[0]
    if (!best) return null
    const n = Math.round(input.plan.muscleSets[best.muscle] ?? last?.muscles[best.muscle] ?? 10)
    return { ...best, planned: Math.max(4, Math.min(20, n)) }
  }, [weeks, model.lifts, input.plan.muscleSets])
  const [kcal, setKcal] = useState(input.plan.kcal ?? maint)
  const [sets, setSets] = useState(pick?.planned ?? 10)
  const res = whatIf({ model, weightKg, bmrKcal: input.person.bmrKcal, kcal, lift: pick ? { exerciseId: pick.id, muscle: pick.muscle, sets } : null })
  const lo = Math.min(res.floor, r50(maint - 800)), hi = r50(maint + 600)
  const c = model.maintenance!.confidence
  const basis = c === 'personal' ? `Based on the plan's estimate of maintenance, about ${inr(maint)} kcal, from ${model.maintenance!.n} logged weeks.`
    : c === 'learning' ? `Based on the plan's estimate of maintenance, about ${inr(maint)} kcal, part your logs and part the body formula. The range is wider until more weeks are logged.`
    : `Based on the formula estimate of maintenance, about ${inr(maint)} kcal. Log food and weigh in for a few weeks to make this yours.`
  return (
    <div className="space-y-5">
      <div className="space-y-2">
        <div className="flex items-baseline justify-between"><label htmlFor="wi-kcal" className="font-semibold">Calories a day</label><span className="tabular-nums font-semibold" data-testid="wi-kcal">{inr(kcal)}</span></div>
        <input id="wi-kcal" type="range" min={lo} max={hi} step={50} value={kcal} onChange={(e) => setKcal(+e.target.value)} className="w-full accent-lime-400" />
        {!res.allowed && <p className="text-xs text-red-300" role="status">Under {inr(res.floor)} kcal is below the lowest target the plan allows for you.</p>}
      </div>
      {pick && (
        <div className="space-y-2">
          <div className="flex items-baseline justify-between"><label htmlFor="wi-sets" className="font-semibold">{muscleLabel(pick.muscle)} sets a week</label><span className="tabular-nums font-semibold">{sets}</span></div>
          <input id="wi-sets" type="range" min={4} max={20} step={1} value={sets} onChange={(e) => setSets(+e.target.value)} className="w-full accent-lime-400" />
        </div>
      )}
      <div className="rounded-xl bg-zinc-800/60 p-4 space-y-3">
        {res.weight && (
          <div data-testid="wi-weight">
            <p className="text-xs text-zinc-400">Body weight in 8 weeks</p>
            <p className="text-xl font-semibold tabular-nums">{f1(res.weight.mid)} kg <span className="text-sm text-zinc-400 font-normal">({f1(Math.min(res.weight.lo, res.weight.hi))} to {f1(Math.max(res.weight.lo, res.weight.hi))})</span></p>
            <p className="text-xs text-zinc-400 tabular-nums">{signed(res.weight.perWeek)} kg a week from {f1(weightKg)} kg</p>
          </div>
        )}
        {res.lift && pick && (
          <div data-testid="wi-lift">
            <p className="text-xs text-zinc-400">{input.exName(pick.id)}, estimated 1RM in 8 weeks</p>
            <p className="text-xl font-semibold tabular-nums">{f1(res.lift.mid)} kg <span className="text-sm text-zinc-400 font-normal">({f1(res.lift.lo)} to {f1(res.lift.hi)})</span></p>
            <p className="text-xs text-zinc-400">{res.lift.personal ? 'From how this muscle has answered to this many sets in your own logs.' : 'Your trend of the last 8 weeks carried forward. Your logs do not yet show how sets change it.'}</p>
          </div>
        )}
      </div>
      <p className="text-xs text-zinc-400">{basis} The 7,700 kcal per kg rule is a guide for the first weeks; the body adapts as weight changes.</p>
    </div>
  )
}
