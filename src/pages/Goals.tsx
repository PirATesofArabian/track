import { useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, type GoalRec } from '../lib/db'
import { useExerciseIndex, useProfile } from '../lib/hooks'
import { buildExerciseIndex, sessionsByExercise } from '../lib/perf'
import { weightTrend } from '../lib/body'
import { deficitNow } from '../lib/science'
import { GoalError, fmtRest, goalProgress, milestones, restAnalysis, validateGoal, weeklyCheckin } from '../lib/goals'
import { Bar, Btn, Card, Chips, Empty, Field, NumInput, Sheet, inputCls } from '../lib/ui'
import { deleteWithUndo } from '../lib/undo'
import { prettyDate, round1, shiftDate, todayStr } from '../lib/util'

const REST_TEXT = { compound_short: 'Your compound rests are short. Under about 90 s costs reps on the next set.', isolation_short: 'Your isolation rests are short. Under about 60 s costs reps on the next set.', on_target: 'Your rest times look fine.' }

export function GoalsView() {
  const idx = useExerciseIndex(), profile = useProfile()
  const today = todayStr()
  const data = useLiveQuery(async () => ({ workouts: await db.workouts.toArray(), weights: await db.bodyWeight.toArray(), goals: await db.goals.toArray(), routines: await db.routines.toArray(), logs: await db.foodLog.toArray(), measurements: await db.measurements.toArray() }), [])
  const [sheet, setSheet] = useState<GoalRec | 'new' | null>(null)
  const [restDays, setRestDays] = useState(90)
  const map = useMemo(() => (data ? sessionsByExercise(data.workouts, idx) : new Map()), [data, idx])
  if (!data) return <Empty>Loading…</Empty>
  const perWeek = data.routines.reduce((a, r) => a + r.days.reduce((b, d) => b + d.weekdays.length, 0), 0) || profile.trainingDays || null
  const check = weeklyCheckin({ workouts: data.workouts, idx, target: perWeek, experience: profile.experience, today, deficit: deficitNow({ profile, weights: data.weights, measurements: data.measurements, logs: data.logs, today }) })
  const ms = milestones(data.workouts, data.weights, idx, today, perWeek)
  const rest = restAnalysis(data.workouts, idx, shiftDate(today, -restDays), shiftDate(today, 1))
  const active = data.goals.filter((g) => !g.achievedAt), reached = data.goals.filter((g) => g.achievedAt)

  return (
    <div className="space-y-4">
      {check && (
        <Card className="space-y-2 border-lime-400/40">
          <p className="text-xs text-lime-400">Monday check-in · week of {prettyDate(check.weekStart, { day: 'numeric', month: 'short' })}</p>
          <p className="text-sm">{check.sessions}{check.target ? ` of ${check.target}` : ''} sessions · {check.workingSets} working sets · {check.records} {check.records === 1 ? 'record' : 'records'}</p>
          {check.improved.length > 0 && <p className="text-xs text-zinc-300">Stronger: {check.improved.slice(0, 3).map((i) => `${i.name} +${round1(i.gainKg)} kg`).join(', ')}</p>}
          <p className="text-sm font-medium">{check.focus.text}</p>
        </Card>
      )}

      <Card className="space-y-3">
        <div className="flex items-center justify-between"><h3 className="font-semibold">Goals</h3><Btn variant="ghost" className="!h-9" onClick={() => setSheet('new')}>New goal</Btn></div>
        {active.length === 0 && <p className="text-xs text-zinc-500">Set a body-weight, lift (e1RM) or lift (top load) goal and get a projected date from your own trend.</p>}
        {active.map((g) => {
          const p = goalProgress(g, map, data.weights, today)
          const unit = g.kind === 'body_weight' ? 'kg' : 'kg'
          const name = g.kind === 'body_weight' ? 'Body weight' : `${idx.get(g.exerciseKey!).name} · ${g.kind === 'exercise_e1rm' ? 'e1RM' : 'top load'}`
          return (
            <div key={g.id} className="space-y-1.5">
              <div className="flex items-start justify-between gap-2">
                <div><p className="text-sm font-medium">{name}</p><p className="text-xs text-zinc-500">{p.start !== null ? `${round1(p.start)} → ` : ''}{g.targetValue} {unit}{g.targetDate ? ` by ${prettyDate(g.targetDate, { day: 'numeric', month: 'short', year: 'numeric' })}` : ''}</p></div>
                <div className="flex gap-2 shrink-0"><button className="text-xs text-lime-400 h-8" onClick={() => setSheet(g)}>Edit</button><button className="text-xs text-red-400 h-8" onClick={() => deleteWithUndo(db.goals, g.id!, 'Goal deleted')}>Delete</button></div>
              </div>
              <Bar value={p.fraction ?? 0} max={1} />
              <p className="text-xs text-zinc-400">
                {p.current !== null ? `Now ${round1(p.current)} kg. ` : 'No data yet. '}
                {p.reached ? 'Reached.' : p.projected ? `At ${Math.abs(round1(p.ratePerWeek ?? 0))} kg/week you get there around ${prettyDate(p.projected, { day: 'numeric', month: 'short', year: 'numeric' })}.` : 'Not enough trend to project a date yet.'}
                {p.pace && <span className={p.pace === 'behind' ? ' text-amber-300' : ' text-lime-400'}> {p.pace === 'ahead' ? 'Ahead of your date.' : p.pace === 'on_track' ? 'On track.' : 'Behind your date.'}</span>}
              </p>
              {p.reached && <Btn variant="ghost" className="!h-8 text-xs" onClick={() => db.goals.update(g.id!, { achievedAt: today })}>Mark achieved</Btn>}
            </div>
          )
        })}
        {reached.length > 0 && <div className="pt-1 border-t border-zinc-800"><p className="text-xs text-zinc-500 mb-1">Achieved</p>{reached.map((g) => <p key={g.id} className="text-sm">🏁 {g.kind === 'body_weight' ? 'Body weight' : idx.get(g.exerciseKey!).name} → {g.targetValue} kg <span className="text-xs text-zinc-500">· {g.achievedAt}</span></p>)}</div>}
      </Card>

      <Card className="space-y-2">
        <h3 className="font-semibold">Milestones · {ms.length}</h3>
        {ms.length === 0 && <p className="text-xs text-zinc-500">Your first finished workout sets the baseline.</p>}
        {[...ms].reverse().slice(0, 40).map((m) => (
          <div key={m.id} className="flex items-start gap-3"><span className="text-lg">{m.kind === 'lift' || m.kind === 'bodyweight' ? '🏋️' : m.kind === 'streak' ? '🔥' : m.kind === 'volume' ? '🏗️' : m.kind === 'anniversary' ? '🎂' : '🎯'}</span><div><p className="text-sm font-medium">{m.title}</p><p className="text-xs text-zinc-500">{m.detail} · {prettyDate(m.achievedAt, { day: 'numeric', month: 'short', year: 'numeric' })}</p></div></div>
        ))}
      </Card>

      <Card className="space-y-2">
        <div className="flex items-center justify-between"><h3 className="font-semibold">Rest between sets</h3><Chips value={restDays} onChange={setRestDays} options={[{ v: 28, label: '4 wk' }, { v: 90, label: '3 mo' }, { v: 365, label: '1 yr' }]} /></div>
        {rest.timedSets < 8 || rest.intervals < 5 ? <p className="text-xs text-zinc-500">Needs workouts where sets were ticked as you did them (new workouts record this). {rest.timedSets} timed sets so far.</p> : (
          <>
            <div className="grid grid-cols-3 gap-2 text-center">
              {[['Compound', rest.compound.median], ['Isolation', rest.isolation.median], ['Between exercises', rest.betweenExercises.median]].map(([l, v]) => (
                <div key={l as string} className="rounded-[.875rem] bg-zinc-800/60 p-2"><p className="text-[11px] text-zinc-500">{l}</p><p className="font-semibold tabular-nums">{v === null ? '–' : fmtRest(v as number)}</p></div>
              ))}
            </div>
            {rest.verdicts.map((v) => <p key={v} className="text-xs text-zinc-300">{REST_TEXT[v]}</p>)}
            <div className="space-y-1">
              {rest.bands.filter((b) => b.pairs > 0).map((b) => (
                <div key={b.from} className="flex items-center gap-3 text-xs"><span className="w-20 text-zinc-400">{fmtRest(b.from)}–{b.to === Infinity ? '+' : fmtRest(b.to)}</span><div className="flex-1"><Bar value={b.kept ?? 0} max={1.2} /></div><span className="w-24 text-right tabular-nums text-zinc-400">{b.kept !== null ? `${Math.round(b.kept * 100)}% reps kept` : ''} ({b.pairs})</span></div>
              ))}
            </div>
            {rest.personal && <p className="text-xs text-lime-400/90">Your reps hold up best after {fmtRest(rest.personal.band.from)}–{rest.personal.band.to === Infinity ? '+' : fmtRest(rest.personal.band.to)} of rest.</p>}
          </>
        )}
      </Card>

      {sheet && <GoalSheet key={typeof sheet === 'string' ? 'new' : sheet.id} goal={sheet === 'new' ? null : sheet} onClose={() => setSheet(null)} />}
    </div>
  )
}

/** Where you are when you set the goal: trend weight, or best e1RM / top load over the last 8 weeks. */
async function startOf(kind: GoalRec['kind'], key?: string): Promise<number | null> {
  if (kind === 'body_weight') { const t = weightTrend(await db.bodyWeight.toArray()); return t.length ? round1(t[t.length - 1].trendKg) : null }
  const idxAll = buildExerciseIndex(await db.customExercises.toArray())
  const l = (sessionsByExercise(await db.workouts.toArray(), idxAll).get(key!) ?? []).filter((s) => s.date >= shiftDate(todayStr(), -56))
  const v = l.map((s) => (kind === 'exercise_e1rm' ? s.bestE1rm : s.heaviestLoad) ?? 0).filter((x) => x > 0)
  return v.length ? round1(Math.max(...v)) : null
}

function GoalSheet({ goal, onClose }: { goal: GoalRec | null; onClose: () => void }) {
  const idx = useExerciseIndex()
  const [kind, setKind] = useState<GoalRec['kind']>(goal?.kind ?? 'body_weight')
  const [key, setKey] = useState(goal?.exerciseKey ?? 'barbell-bench-press')
  const [target, setTarget] = useState<number | null>(goal?.targetValue ?? null)
  const [date, setDate] = useState(goal?.targetDate ?? '')
  const [err, setErr] = useState('')
  const lifts = idx.all.filter((e) => e.tracking === 'weight_reps')
  async function save() {
    try {
      const v = validateGoal({ kind, exerciseKey: kind === 'body_weight' ? undefined : key, startValue: goal?.startValue ?? null, targetValue: target ?? NaN, targetDate: date || null }, todayStr())
      if (goal) await db.goals.update(goal.id!, { kind: v.kind, exerciseKey: v.exerciseKey, targetValue: v.targetValue, targetDate: v.targetDate, achievedAt: goal.targetValue === v.targetValue ? goal.achievedAt : null })
      else await db.goals.add({ kind: v.kind, exerciseKey: v.exerciseKey, startValue: await startOf(v.kind, v.exerciseKey), targetValue: v.targetValue, targetDate: v.targetDate, createdAt: todayStr(), achievedAt: null })
      onClose()
    } catch (e) { setErr(e instanceof GoalError ? e.message : 'Could not save.') }
  }
  return (
    <Sheet open onClose={onClose} title={goal ? 'Edit goal' : 'New goal'}>
      <div className="space-y-3">
        <Chips value={kind} onChange={setKind} options={[{ v: 'body_weight', label: 'Body weight' }, { v: 'exercise_e1rm', label: 'Lift e1RM' }, { v: 'exercise_load', label: 'Lift top load' }]} />
        {kind !== 'body_weight' && <Field label="Exercise"><select className={inputCls} value={key} onChange={(e) => setKey(e.target.value)}>{lifts.map((e) => <option key={e.key} value={e.key}>{e.name}</option>)}</select></Field>}
        <Field label="Target (kg)"><NumInput value={target} onChange={setTarget} step="0.5" /></Field>
        <Field label="By when (optional)"><input type="date" className={inputCls} value={date} onChange={(e) => setDate(e.target.value)} /></Field>
        {err && <p className="text-xs text-red-400">{err}</p>}
        <Btn className="w-full" onClick={save}>Save</Btn>
      </div>
    </Sheet>
  )
}
