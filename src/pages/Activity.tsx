import { useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, type ActivityLog } from '../lib/db'
import { ACTIVITIES, cardioKcal, stepsKcal, strideM, type ActivityId, type Effort } from '../lib/burn'
import { Bar, Btn, Card, Chart, Chips, Empty, Field, NumInput, Sheet, Stat, inputCls } from '../lib/ui'
import { deleteWithUndo } from '../lib/undo'
import { useProfile, useSettings } from '../lib/hooks'
import { weightOn, workoutKcal } from '../lib/derived'
import { fmtInt, prettyDate, round1, shiftDate, todayStr } from '../lib/util'

const nowHM = () => new Date().toTimeString().slice(0, 5)

export default function ActivityPage() {
  const [date, setDate] = useState(todayStr())
  const [sheet, setSheet] = useState<'steps' | 'cardio' | null>(null)
  const settings = useSettings()
  const profile = useProfile()
  const logs = useLiveQuery(() => db.activity.where('date').equals(date).toArray(), [date]) ?? []
  const range = useLiveQuery(() => db.activity.where('date').between(shiftDate(todayStr(), -29), todayStr(), true, true).toArray(), []) ?? []
  const weights = useLiveQuery(() => db.bodyWeight.toArray(), []) ?? []
  const workouts = useLiveQuery(() => db.workouts.where('date').equals(date).toArray(), [date]) ?? []

  const steps = logs.filter((l) => l.kind === 'steps').sort((a, b) => (a.time ?? '').localeCompare(b.time ?? ''))
  const cardio = logs.filter((l) => l.kind === 'cardio')
  const totalSteps = steps.reduce((a, l) => a + (l.steps ?? 0), 0)
  const stepsK = steps.reduce((a, l) => a + l.kcal, 0)
  const cardioK = cardio.reduce((a, l) => a + l.kcal, 0)
  const liftK = workouts.filter((w) => w.finishedAt).reduce((a, w) => a + (workoutKcal(w, weights)?.kcal ?? 0), 0)
  const total = stepsK + cardioK + liftK
  const kg = weightOn(weights, date)

  const days30 = useMemo(() => {
    const m = new Map<string, number>()
    for (const l of range) if (l.kind === 'steps') m.set(l.date, (m.get(l.date) ?? 0) + (l.steps ?? 0))
    return [...m].sort((a, b) => a[0].localeCompare(b[0]))
  }, [range])
  const avg7 = (() => {
    const from = shiftDate(todayStr(), -6)
    const v = days30.filter(([d]) => d >= from).map(([, s]) => s)
    return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null
  })()
  const avgPrev = (() => {
    const a = shiftDate(todayStr(), -13), b = shiftDate(todayStr(), -7)
    const v = days30.filter(([d]) => d >= a && d <= b).map(([, s]) => s)
    return v.length ? v.reduce((x, y) => x + y, 0) / v.length : null
  })()

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <button className="h-10 w-10 rounded-full bg-zinc-900" onClick={() => setDate(shiftDate(date, -1))}>‹</button>
        <button className="font-semibold" onClick={() => setDate(todayStr())}>{date === todayStr() ? 'Today' : prettyDate(date)}</button>
        <button className="h-10 w-10 rounded-full bg-zinc-900 disabled:opacity-30" disabled={date >= todayStr()} onClick={() => setDate(shiftDate(date, 1))}>›</button>
      </div>

      <Card className="space-y-2">
        <div className="flex justify-between items-end">
          <div><p className="text-3xl font-bold tabular-nums">{fmtInt(totalSteps)}<span className="text-base text-zinc-500 font-normal"> / {fmtInt(settings.stepGoal)} steps</span></p></div>
          <Btn className="h-9" onClick={() => setSheet('steps')}>{steps.length ? '+ Add' : 'Add steps'}</Btn>
        </div>
        <Bar value={totalSteps} max={settings.stepGoal} color="bg-emerald-400" />
        {steps.map((l) => (
          <div key={l.id} className="flex items-center justify-between text-sm border-t border-zinc-800 pt-2">
            <div>
              <p>{fmtInt(l.steps ?? 0)} steps{l.time ? ` · ${l.time}` : ' · whole day'}{l.label ? ` · ${l.label}` : ''}</p>
              <p className="text-xs text-zinc-500">{l.kcalSource === 'typed' ? 'Calories typed by you' : `~${l.kcal} kcal · ${l.basis ?? ''}`}</p>
            </div>
            <button className="text-zinc-500 h-8 w-8" onClick={() => deleteWithUndo(db.activity, l.id!, 'Steps removed')}>✕</button>
          </div>
        ))}
        {!steps.length && <p className="text-xs text-zinc-500">Log a day total from your phone/watch, or add steps for part of the day (e.g. 6:30 morning walk, 1,800 steps).</p>}
      </Card>

      <Card className="space-y-2">
        <div className="flex justify-between items-center">
          <h3 className="font-semibold">Runs & cardio</h3>
          <Btn variant="ghost" className="h-9" onClick={() => setSheet('cardio')}>+ Log</Btn>
        </div>
        {cardio.map((l) => (
          <div key={l.id} className="flex items-center justify-between text-sm border-t border-zinc-800 pt-2">
            <div>
              <p>{ACTIVITIES.find((a) => a.id === l.activity)?.label ?? l.label ?? 'Cardio'} · {l.minutes} min{l.distanceKm ? ` · ${l.distanceKm} km` : ''}</p>
              <p className="text-xs text-zinc-500">
                {l.distanceKm && l.minutes ? `${(l.minutes / l.distanceKm).toFixed(1)} min/km · ${(l.distanceKm / (l.minutes / 60)).toFixed(1)} km/h · ` : ''}
                {l.kcalSource === 'typed' ? `${l.kcal} kcal (typed)` : `~${l.kcal} kcal`}
              </p>
            </div>
            <button className="text-zinc-500 h-8 w-8" onClick={() => deleteWithUndo(db.activity, l.id!, 'Cardio removed')}>✕</button>
          </div>
        ))}
        {!cardio.length && <Empty>No cardio logged.</Empty>}
      </Card>

      <Card className="space-y-3">
        <div className="flex justify-between items-baseline">
          <h3 className="font-semibold">Burned</h3>
          <span className="text-2xl font-bold tabular-nums">{total > 0 ? `~${fmtInt(total)}` : 0}<span className="text-xs text-zinc-500 font-normal"> kcal active</span></span>
        </div>
        <div className="grid grid-cols-3 gap-2">
          <Stat label="Weights" value={fmtInt(liftK)} /><Stat label="Cardio" value={fmtInt(cardioK)} /><Stat label="Steps" value={fmtInt(stepsK)} />
        </div>
        <p className="text-xs text-zinc-500">Active calories are those above what your body burns at rest, so they add to your daily target. {kg ? '' : 'Log your body weight for estimates. '}Estimates can be off; type a number from a watch to override.</p>
      </Card>

      <Card className="space-y-2">
        <h3 className="font-semibold">Steps · last 30 days</h3>
        {avg7 !== null && (
          <div className="grid grid-cols-2 gap-2">
            <Stat label="7-day average" value={fmtInt(avg7)} sub={avgPrev !== null ? `${avg7 - avgPrev >= 0 ? '+' : ''}${fmtInt(avg7 - avgPrev)} vs previous week` : undefined} />
            <Stat label="Days over goal" value={`${days30.filter(([, s]) => s >= settings.stepGoal).length}/${days30.length}`} />
          </div>
        )}
        <Chart points={days30.map(([d, s]) => ({ x: d, y: s, label: prettyDate(d) }))} color="#34d399" unit="steps" format={(n) => fmtInt(n)} />
        <p className="text-xs text-zinc-500">Tip from your plan: build gradually from 3–4k toward 7–9k, about +1k/day every few days.</p>
      </Card>

      <StepsSheet open={sheet === 'steps'} onClose={() => setSheet(null)} date={date} kg={kg} heightCm={profile.heightCm} />
      <CardioSheet open={sheet === 'cardio'} onClose={() => setSheet(null)} date={date} kg={kg} />
    </div>
  )
}

function StepsSheet({ open, onClose, date, kg, heightCm }: { open: boolean; onClose: () => void; date: string; kg: number | null; heightCm?: number }) {
  const [steps, setSteps] = useState<number | null>(null)
  const [mode, setMode] = useState<'day' | 'time'>('day')
  const [time, setTime] = useState(nowHM())
  const [label, setLabel] = useState('')
  const [typed, setTyped] = useState<number | null>(null)
  const est = steps && kg ? stepsKcal(steps, kg, heightCm) : null
  async function save() {
    if (!steps) return
    if (mode === 'day') await db.activity.where('date').equals(date).filter((l) => l.kind === 'steps' && !l.time).delete() // a day total replaces the previous day total
    await db.activity.add({
      date, kind: 'steps', steps, time: mode === 'time' ? time : undefined, label: label || undefined,
      kcal: typed ?? est?.kcal ?? 0, kcalSource: typed !== null ? 'typed' : 'estimated', basis: est?.basis,
    })
    setSteps(null); setTyped(null); setLabel(''); onClose()
  }
  return (
    <Sheet open={open} onClose={onClose} title="Add steps">
      <div className="space-y-3">
        <Chips value={mode} onChange={setMode} options={[{ v: 'day', label: 'Day total' }, { v: 'time', label: 'At a time of day' }]} />
        <Field label="Steps"><NumInput value={steps} onChange={setSteps} placeholder="e.g. 6500" /></Field>
        {mode === 'time' && (
          <div className="grid grid-cols-2 gap-2">
            <Field label="Time"><input type="time" className={inputCls} value={time} onChange={(e) => setTime(e.target.value)} /></Field>
            <Field label="Label"><input className={inputCls} placeholder="Morning walk" value={label} onChange={(e) => setLabel(e.target.value)} /></Field>
          </div>
        )}
        {mode === 'day' && <p className="text-xs text-zinc-500">Replaces today's earlier day total. Use "At a time of day" to add several walks; they add up.</p>}
        <Field label="Calories (optional — type from a watch)" hint={est ? `Estimate ≈ ${est.kcal} kcal · ${est.basis}` : !kg ? 'Log your body weight (Body tab) to get an estimate' : `Stride ${Math.round(strideM(heightCm) * 100)} cm${heightCm ? ' (from your height)' : ' (default)'}`}>
          <NumInput value={typed} onChange={setTyped} placeholder="leave empty to estimate" />
        </Field>
        <Btn className="w-full" disabled={!steps} onClick={save}>Save</Btn>
      </div>
    </Sheet>
  )
}

function CardioSheet({ open, onClose, date, kg }: { open: boolean; onClose: () => void; date: string; kg: number | null }) {
  const [act, setAct] = useState<ActivityId>('run_outdoor')
  const [min, setMin] = useState<number | null>(null)
  const [km, setKm] = useState<number | null>(null)
  const [speed, setSpeed] = useState<number | null>(null)
  const [incline, setIncline] = useState<number | null>(null)
  const [effort, setEffort] = useState<Effort>('moderate')
  const [typed, setTyped] = useState<number | null>(null)
  const def = ACTIVITIES.find((a) => a.id === act)!
  const est = min && kg ? cardioKcal({ activity: act, minutes: min, weightKg: kg, distanceKm: km ?? undefined, speedKmh: speed ?? undefined, inclinePct: incline ?? undefined, effort }) : null
  const pace = min && km ? min / km : null
  async function save() {
    if (!min) return
    await db.activity.add({
      date, kind: 'cardio', activity: act, minutes: min, distanceKm: km ?? undefined, speedKmh: speed ?? undefined, inclinePct: incline ?? undefined, effort,
      kcal: typed ?? est?.kcal ?? 0, kcalSource: typed !== null ? 'typed' : 'estimated', basis: est?.basis,
    })
    setMin(null); setKm(null); setSpeed(null); setIncline(null); setTyped(null); onClose()
  }
  return (
    <Sheet open={open} onClose={onClose} title="Log cardio / run">
      <div className="space-y-3">
        <Chips value={act} onChange={setAct} options={ACTIVITIES.map((a) => ({ v: a.id, label: a.label }))} />
        <div className="grid grid-cols-2 gap-2">
          <Field label="Minutes"><NumInput value={min} onChange={setMin} placeholder="30" /></Field>
          {'distance' in def && def.distance && <Field label="Distance (km)"><NumInput value={km} step="0.01" onChange={setKm} placeholder="4.5" /></Field>}
          {'speed' in def && def.speed && <Field label="Speed (km/h)"><NumInput value={speed} step="0.1" onChange={setSpeed} placeholder="9" /></Field>}
          {'incline' in def && def.incline && <Field label="Incline (%)"><NumInput value={incline} onChange={setIncline} placeholder="0" /></Field>}
        </div>
        {'effort' in def && def.effort && <Field label="Effort"><Chips value={effort} onChange={setEffort} options={[{ v: 'light', label: 'Light' }, { v: 'moderate', label: 'Moderate' }, { v: 'hard', label: 'Hard' }]} /></Field>}
        {pace && <p className="text-sm text-zinc-300">Pace {Math.floor(pace)}:{String(Math.round((pace % 1) * 60)).padStart(2, '0')} /km · {round1(km! / (min! / 60))} km/h</p>}
        <Field label="Calories (optional — type from a watch)" hint={est ? `Estimate ≈ ${est.kcal} kcal · ${est.basis}` : !kg ? 'Log your body weight (Body tab) to get an estimate' : undefined}>
          <NumInput value={typed} onChange={setTyped} placeholder="leave empty to estimate" />
        </Field>
        <Btn className="w-full" disabled={!min} onClick={save}>Save</Btn>
      </div>
    </Sheet>
  )
}

export type { ActivityLog }
