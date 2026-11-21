import { useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../lib/db'
import { useExerciseIndex, useProfile } from '../lib/hooks'
import { bodySnapshot } from '../lib/body'
import { realMaintenance } from '../lib/foodinsights'
import { dailyWeights, weightWhy } from '../lib/weightwhy'
import { Card, inputCls } from '../lib/ui'
import { fmtInt, prettyDate, todayStr } from '../lib/util'

const sg = (n: number) => `${n > 0 ? '+' : n < 0 ? '−' : ''}${Math.abs(n)}`

export default function WeightWhy() {
  const idx = useExerciseIndex(), profile = useProfile()
  const [pick, setPick] = useState<{ from: string; to: string } | null>(null)
  const data = useLiveQuery(async () => ({
    logs: await db.foodLog.toArray(), workouts: await db.workouts.toArray(), activity: await db.activity.toArray(),
    water: await db.water.toArray(), weights: await db.bodyWeight.toArray(), measurements: await db.measurements.toArray(),
  }), [])
  const days = useMemo(() => dailyWeights(data?.weights ?? []), [data])
  const out = useMemo(() => {
    if (!data || days.length < 2) return null
    const to = pick?.to ?? days[days.length - 1].date
    const from = pick?.from ?? days[days.length - 2].date
    const today = todayStr()
    const snap = bodySnapshot({ profile, weights: data.weights, measurements: data.measurements, today, loggedDaysPerWeek: null })
    const maint = realMaintenance(data.logs, snap.trend, today)?.kcal ?? snap.energy?.tdee ?? null
    const d = { logs: data.logs, workouts: data.workouts, activity: data.activity, water: data.water, weights: data.weights, profile }
    return { from, to, why: weightWhy(from, to, d, idx, maint), maint }
  }, [data, days, pick, idx, profile])

  if (!data || days.length < 2) return null
  const dates = days.map((x) => x.date)
  const set = (k: 'from' | 'to', v: string) => setPick({ from: out!.from, to: out!.to, [k]: v })
  const w = out?.why
  return (
    <Card className="space-y-3">
      <h3 className="font-semibold">Why did my weight change?</h3>
      <div className="flex items-center gap-2 text-sm">
        <select className={`${inputCls} !w-auto`} value={out!.from} onChange={(e) => set('from', e.target.value)}>
          {dates.slice(0, -1).map((x) => <option key={x} value={x}>{prettyDate(x)}</option>)}
        </select>
        <span className="text-zinc-500">to</span>
        <select className={`${inputCls} !w-auto`} value={out!.to} onChange={(e) => set('to', e.target.value)}>
          {dates.slice(1).map((x) => <option key={x} value={x}>{prettyDate(x)}</option>)}
        </select>
      </div>
      {!w ? <p className="text-sm text-zinc-500">Pick a start date that is before the end date.</p> : (
        <>
          <p className="text-sm tabular-nums"><b>{w.kgFrom} → {w.kgTo} kg</b> <span className={w.change > 0 ? 'text-amber-300' : w.change < 0 ? 'text-lime-300' : 'text-zinc-300'}>({sg(w.change)} kg in {w.days} {w.days === 1 ? 'day' : 'days'})</span></p>
          <p className="text-sm text-zinc-200">{w.headline}</p>
          {w.reasons.length > 0 && <ul className="list-disc pl-5 text-xs text-zinc-300 space-y-1">{w.reasons.map((r) => <li key={r}>{r}</li>)}</ul>}
          {w.fatKg !== null && w.kcal !== null && (
            <p className="text-[11px] text-zinc-500">Calories: you ate about {fmtInt(w.kcal)} a day against a maintenance of about {fmtInt(w.maintenance ?? 0)}, which is {sg(Math.round(w.fatKg * 10) / 10)} kg over {w.days} {w.days === 1 ? 'day' : 'days'} (7,700 kcal per kg). Whatever is left of the change is water, food in the gut or glycogen.</p>
          )}
        </>
      )}
      <p className="text-[11px] text-zinc-500">Uses only what you logged. It cannot see salt, sleep or stress, and one or two days of change is mostly water. See How every number is calculated: Why did my weight change.</p>
    </Card>
  )
}
