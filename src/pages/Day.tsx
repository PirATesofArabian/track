import { useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../lib/db'
import { useExerciseIndex, useProfile, useSettings } from '../lib/hooks'
import { compareDay, tomorrowPlan, type Row } from '../lib/daysummary'
import { Card, Empty } from '../lib/ui'
import { restDatesOf, setRestDay } from '../lib/derived'
import { fmtInt, prettyDate, shiftDate, todayStr } from '../lib/util'

const TONE = { good: 'text-lime-300', off: 'text-amber-300', plain: 'text-zinc-200' }
const KIND_LABEL: Record<string, string> = { add_load: 'Add weight', add_rep: 'Add reps', hold: 'Hold the weight', lighter: 'Step back', harder: 'Make it harder', none: '' }

function diffText(r: Row) {
  if (r.diff === null || r.usual === null) return 'no usual yet'
  const d = Math.round(r.diff)
  return `${d === 0 ? 'same as' : d > 0 ? `+${fmtInt(d)} vs` : `−${fmtInt(-d)} vs`} usual ${fmtInt(r.usual)}`
}

export default function DayView() {
  const idx = useExerciseIndex(), profile = useProfile(), settings = useSettings()
  const [date, setDate] = useState(todayStr())
  const data = useLiveQuery(async () => ({
    logs: await db.foodLog.toArray(), workouts: await db.workouts.toArray(), activity: await db.activity.toArray(),
    water: await db.water.toArray(), weights: await db.bodyWeight.toArray(), routines: await db.routines.toArray(), kv: await db.kv.toArray(),
  }), [])
  const out = useMemo(() => {
    if (!data) return null
    const d = { logs: data.logs, workouts: data.workouts, activity: data.activity, water: data.water, weights: data.weights, profile }
    return { cmp: compareDay(date, d, idx, settings), next: tomorrowPlan({ date, d, idx, s: settings, routines: data.routines }) }
  }, [data, date, idx, settings, profile])
  if (!out) return <Empty>Loading…</Empty>
  const { cmp, next } = out
  const shown = cmp.rows.filter((r) => r.value !== null)
  const rest = restDatesOf(data?.kv ?? []).has(date)
  const trained = data?.workouts.some((w) => w.date === date && w.finishedAt) ?? false

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <button className="h-9 w-9 text-zinc-400" onClick={() => setDate(shiftDate(date, -1))}>‹</button>
        <h3 className="font-semibold">{date === todayStr() ? 'Today' : prettyDate(date)}</h3>
        <button className="h-9 w-9 text-zinc-400 disabled:opacity-30" disabled={date >= todayStr()} onClick={() => setDate(shiftDate(date, 1))}>›</button>
      </div>

      <Card className="space-y-2">
        <h3 className="font-semibold">How the day went</h3>
        {rest && <p className="text-sm text-sky-300">Rest day. Not counted as a missed session.</p>}
        {!shown.length && !rest && <p className="text-sm text-zinc-500">Nothing logged on this day.</p>}
        {!trained && <button className="text-xs text-zinc-400 underline text-left" onClick={() => setRestDay(date, !rest)}>{rest ? 'Undo rest day' : 'Mark this day as a rest day'}</button>}
        {shown.map((r) => (
          <div key={r.id} className="flex justify-between gap-3 text-sm border-b border-zinc-800/60 pb-1.5">
            <span className="min-w-0">
              <span className="block">{r.label}</span>
              <span className="text-[11px] text-zinc-500">{diffText(r)}{r.place ? ` · ${r.place.n === 1 ? 'highest' : `#${r.place.n}`} of last ${r.place.of} days` : ''}</span>
            </span>
            <span className="text-right whitespace-nowrap">
              <span className={`block font-semibold tabular-nums ${TONE[r.tone]}`}>{fmtInt(r.value as number)} {r.unit}</span>
              {r.target ? <span className="text-[11px] text-zinc-500">{r.targetKind === 'cap' ? 'limit' : 'target'} {fmtInt(r.target)}</span> : null}
            </span>
          </div>
        ))}
        <p className="text-[11px] text-zinc-500">"Usual" is your average of the last 14 days that have that number ({cmp.foodDays} with food logged, {cmp.trainDays} training days). Rank is out of the last 30 days. Burned calories are estimates.</p>
      </Card>

      <Card className="space-y-2 border-lime-400/30">
        <p className="text-xs text-lime-400">Up next{next.sessionName ? `: ${next.sessionName}` : ': no plan'}{next.after ? ` (after ${next.after})` : ''}</p>
        <h3 className="font-semibold">Food and daily targets</h3>
        <p className="text-sm tabular-nums">{fmtInt(next.food.kcal)} kcal · P {next.food.p} · C {next.food.c} · F max {next.food.f} g</p>
        <p className="text-xs text-zinc-400">About {next.food.perMealP} g protein per meal across 4 meals · {fmtInt(next.food.waterMl)} ml water · {fmtInt(next.food.steps)} steps</p>
        <ul className="list-disc pl-5 text-sm space-y-1 text-zinc-300">{next.food.notes.map((n) => <li key={n}>{n}</li>)}</ul>
      </Card>

      {next.lifts.length > 0 && (
        <Card className="space-y-3">
          <h3 className="font-semibold">Lifts: what to change</h3>
          {next.lifts.map((l) => (
            <div key={l.key} className="space-y-0.5 border-b border-zinc-800/60 pb-2">
              <div className="flex justify-between gap-2"><span className="text-sm font-medium">{l.name}</span><span className="text-[11px] text-zinc-500 whitespace-nowrap">{l.target}</span></div>
              {l.last && <p className="text-xs text-zinc-500">Last: {l.last}</p>}
              <p className="text-xs text-lime-300">{KIND_LABEL[l.kind] ? <b>{KIND_LABEL[l.kind]}. </b> : null}{l.next}</p>
              {l.trend && <p className="text-[11px] text-zinc-500">Strength trend: {l.trend}</p>}
            </div>
          ))}
        </Card>
      )}
      <p className="text-[11px] text-zinc-500">These are this app's own rules (see How every number is calculated: Day summary). They suggest, they never change your plan.</p>
    </div>
  )
}
