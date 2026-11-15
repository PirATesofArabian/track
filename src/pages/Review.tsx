import { useEffect, useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../lib/db'
import { useExerciseIndex, useProfile, useSettings } from '../lib/hooks'
import { buildWeeklyReport, muscleLabel, type Action, type WeeklyReport } from '../lib/weekly'
import { addDays, reportWindow } from '../lib/adaptive'
import { Bar, Btn, Card, Chart, Empty, Stat } from '../lib/ui'
import { fmtInt, prettyDate } from '../lib/util'

const STATUS_CLS = { good: 'bg-lime-400/15 text-lime-300', close: 'bg-amber-400/15 text-amber-300', off: 'bg-red-500/15 text-red-300', none: 'bg-zinc-800 text-zinc-500' }
const TILE: Record<string, { label: string; unit: string }> = { hardSets: { label: 'Hard sets', unit: '' }, volume: { label: 'Volume', unit: 'kg' }, minutes: { label: 'Minutes', unit: 'min' }, effort: { label: 'Avg reps left', unit: '' }, kcal: { label: 'Avg calories', unit: '' }, protein: { label: 'Avg protein', unit: 'g' } }
const WD = ['S', 'M', 'T', 'W', 'T', 'F', 'S']

export function ReportView() {
  const idx = useExerciseIndex(), profile = useProfile(), settings = useSettings()
  const win = reportWindow(new Date())
  const [week, setWeek] = useState(win.open)
  const data = useLiveQuery(async () => ({
    workouts: await db.workouts.toArray(), logs: await db.foodLog.toArray(), weights: await db.bodyWeight.toArray(), measurements: await db.measurements.toArray(),
    goals: await db.goals.toArray(), routines: await db.routines.toArray(), prev: await db.reports.get(addDays(week, -7)),
  }), [week])

  const report = useMemo<WeeklyReport | null>(() => {
    if (!data) return null
    const planned = data.routines.reduce((a, r) => a + r.days.reduce((b, d) => b + d.weekdays.length, 0), 0) || null
    const prevActions = (data.prev?.report as WeeklyReport | undefined)?.actions as Action[] | undefined
    return buildWeeklyReport({
      weekStart: week, idx, workouts: data.workouts, logs: data.logs, weights: data.weights, measurements: data.measurements, goals: data.goals,
      targets: { kcal: settings.kcal, proteinG: settings.p }, ownTargets: true, fatLoss: profile.goal === 'fat_loss', planned, previousActions: prevActions ?? null,
    })
  }, [data, week, idx, settings, profile])

  // Save weeks so the next week's report can grade this week's actions.
  useEffect(() => {
    if (report && week <= win.open) void db.reports.put({ weekStart: week, madeAt: report.madeAt, report })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [report?.weekStart, report?.counts.sessions, report?.counts.foodDays])

  if (!report) return <Empty>Loading…</Empty>
  const r = report
  const range = `${prettyDate(r.weekStart, { day: 'numeric', month: 'short' })} – ${prettyDate(r.weekEnd, { day: 'numeric', month: 'short' })}`
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2 print:hidden">
        <Btn variant="ghost" className="!px-3" onClick={() => setWeek(addDays(week, -7))}>‹</Btn>
        <div className="text-center"><p className="font-semibold">{range}</p><p className="text-[11px] text-zinc-500">{week === win.open ? 'Latest report' : 'Earlier week'}</p></div>
        <Btn variant="ghost" className="!px-3" disabled={week >= win.open} onClick={() => setWeek(addDays(week, 7))}>›</Btn>
      </div>

      <Card className="space-y-3">
        <p className="text-sm">{r.verdict.en}</p>
        <div className="grid grid-cols-3 gap-2">
          {(['training', 'nutrition', 'body'] as const).map((k) => (
            <div key={k} className={`rounded-[.875rem] p-2.5 ${STATUS_CLS[r.pillars[k].status]}`}>
              <p className="text-[11px] opacity-80 capitalize">{k}</p>
              <p className="text-sm font-semibold leading-tight">{r.pillars[k].label}</p>
              <p className="text-[11px] opacity-80 mt-0.5">{r.pillars[k].detail}</p>
            </div>
          ))}
        </div>
      </Card>

      {r.win && (
        <Card className="flex items-center gap-4 border-lime-400/40">
          <p className="text-3xl font-bold text-lime-400 tabular-nums">{r.win.big}</p>
          <div><p className="font-semibold">{r.win.title}</p><p className="text-xs text-zinc-400">{r.win.detail}</p></div>
        </Card>
      )}

      {r.tiles.length > 0 && (
        <div className="grid grid-cols-2 gap-2">
          {r.tiles.map((t) => (
            <Stat key={t.key} label={TILE[t.key]?.label ?? t.key} value={`${fmtInt(t.value)}${TILE[t.key]?.unit ? ` ${TILE[t.key].unit}` : ''}`} sub={t.usual !== null ? `usual ${fmtInt(t.usual)}` : undefined} />
          ))}
        </div>
      )}

      <Card className="space-y-2">
        <h3 className="font-semibold">Day by day</h3>
        <div className="grid grid-cols-7 gap-1 text-center">
          {r.days.map((d) => (
            <div key={d.date} className="rounded-lg bg-zinc-800/60 py-1.5 text-[10px] space-y-0.5">
              <p className="text-zinc-500">{WD[d.weekday]}</p>
              <p className={d.session ? 'text-lime-400' : 'text-zinc-600'}>{d.session ? '●' : '○'}</p>
              <p className={d.kcalOk === null ? 'text-zinc-600' : d.kcalOk ? 'text-lime-300' : 'text-amber-300'}>{d.kcal !== null ? Math.round(d.kcal) : '–'}</p>
              <p className={d.proteinOk === null ? 'text-zinc-600' : d.proteinOk ? 'text-lime-300' : 'text-amber-300'}>{d.proteinG !== null ? `${Math.round(d.proteinG)}g` : '–'}</p>
            </div>
          ))}
        </div>
        <p className="text-[11px] text-zinc-500">● trained · calories · protein. Green = within target.</p>
      </Card>

      {r.lifts.length > 0 && (
        <Card className="space-y-2">
          <h3 className="font-semibold">Lifts · estimated 1RM, 8 weeks</h3>
          {r.lifts.map((l) => (
            <div key={l.exerciseKey} className="space-y-1">
              <div className="flex justify-between text-sm"><span className="truncate">{l.name}</span><span className={`text-xs tabular-nums ${l.pct > 0 ? 'text-lime-400' : l.pct < 0 ? 'text-amber-300' : 'text-zinc-400'}`}>{Math.round(l.now)} kg · {l.pct > 0 ? '+' : ''}{l.pct}%{l.real ? '' : ' (within noise)'}</span></div>
              <Chart height={70} unit="kg" points={l.weeks.map((v, i) => ({ x: addDays(r.weekStart, (i - 7) * 7), y: v })).filter((p): p is { x: string; y: number } => p.y !== null)} />
            </div>
          ))}
        </Card>
      )}

      {r.muscles.length > 0 && (
        <Card className="space-y-2">
          <h3 className="font-semibold">Sets per muscle vs your usual</h3>
          {r.muscles.map((m) => (
            <div key={m.muscle} className="flex items-center gap-3 text-sm">
              <span className="w-24 text-zinc-400">{muscleLabel(m.muscle)}</span>
              <div className="flex-1"><Bar value={m.sets} max={Math.max(m.sets, m.usual ?? 0, 10)} /></div>
              <span className="w-20 text-right text-xs tabular-nums">{m.sets}{m.usual !== null ? <span className="text-zinc-500"> / {Math.round(m.usual)}</span> : ''}</span>
            </div>
          ))}
        </Card>
      )}

      {r.body && (
        <Card className="space-y-2">
          <h3 className="font-semibold">Body weight</h3>
          <Chart points={r.body.points.map((p) => ({ x: p.date, y: p.kg }))} trend={r.body.points.filter((p) => p.trend !== null).map((p) => ({ x: p.date, y: p.trend as number }))} unit="kg" />
          <p className="text-xs text-zinc-300">
            {r.body.weekMean !== null && <>This week {r.body.weekMean} kg. </>}
            {r.body.changeKg !== null && <>{r.body.changeKg > 0 ? '+' : ''}{r.body.changeKg} kg vs last week{r.body.ratePct !== null ? ` (${r.body.ratePct}% a week)` : ''}. </>}
            {r.body.projection && <>At this pace you reach {r.body.projection.targetKg} kg in {r.body.projection.weeksLo}–{r.body.projection.weeksHi} weeks{r.body.projection.goalDate ? `, around ${prettyDate(r.body.projection.goalDate, { day: 'numeric', month: 'short', year: 'numeric' })}` : ''}.</>}
          </p>
        </Card>
      )}

      {r.energy && (
        <Card className="space-y-1">
          <h3 className="font-semibold">Energy balance</h3>
          <p className="text-xs text-zinc-300">You ate about {fmtInt(r.energy.meanIntake)} kcal a day. Your weight moved {r.energy.changeKgPerWeek > 0 ? '+' : ''}{r.energy.changeKgPerWeek} kg/week, which puts your real maintenance near {fmtInt(r.energy.maintenance)} kcal. Actual deficit {fmtInt(r.energy.actualDeficit)} kcal{r.energy.plannedDeficit !== null ? ` vs planned ${fmtInt(r.energy.plannedDeficit)}` : ''}.</p>
        </Card>
      )}

      {r.nutrition && (
        <Card className="space-y-2">
          <h3 className="font-semibold">Nutrition</h3>
          <div className="grid grid-cols-2 gap-2">
            <Stat label="Protein / day" value={`${r.nutrition.proteinAvg} g`} sub={r.nutrition.proteinPerKg ? `${r.nutrition.proteinPerKg} g/kg` : undefined} />
            <Stat label="Calories / day" value={fmtInt(r.nutrition.calorieAvg)} sub={r.nutrition.calorieDays !== null ? `${r.nutrition.calorieDays} days on target` : undefined} />
            <Stat label="Fibre / day" value={`${r.nutrition.fibreAvg} g`} sub={`aim ${r.nutrition.fibreAim} g`} />
            {r.nutrition.carbsTraining != null && <Stat label="Carbs g/kg" value={`${r.nutrition.carbsTraining}`} sub={r.nutrition.carbsRest != null ? `rest days ${r.nutrition.carbsRest}` : 'training days'} />}
          </div>
          {r.nutrition.meals.length > 0 && (
            <div className="space-y-1 pt-1">
              {r.nutrition.meals.map((m) => (
                <div key={m.meal} className="flex items-center gap-3 text-sm"><span className="w-20 capitalize text-zinc-400">{m.meal}</span><div className="flex-1"><Bar value={m.avgG} max={Math.max(m.avgG, r.nutrition!.mealAim ?? 0, 10)} /></div><span className="w-16 text-right text-xs tabular-nums">{m.avgG} g</span></div>
              ))}
              {r.nutrition.mealAim && <p className="text-[11px] text-zinc-500">Aim for about {r.nutrition.mealAim} g of protein per meal.</p>}
            </div>
          )}
        </Card>
      )}

      {r.findings.length > 0 && (
        <Card className="space-y-3">
          <h3 className="font-semibold">What your logs show</h3>
          {r.findings.map((f) => <FindingRow key={f.id} f={f} />)}
        </Card>
      )}

      {r.actions.length > 0 && (
        <Card className="space-y-3">
          <h3 className="font-semibold">Next week</h3>
          {r.actions.map((a) => (
            <div key={a.id} className="space-y-0.5"><p className="text-sm font-medium">{a.title}</p><p className="text-xs text-zinc-400">{a.detail}</p><p className="text-[11px] text-lime-400/80">Check: {a.checkText}</p></div>
          ))}
        </Card>
      )}

      {r.lastWeek && (
        <Card className="space-y-2">
          <h3 className="font-semibold">Last week's actions</h3>
          {r.lastWeek.map((g, i) => <p key={i} className="text-sm flex gap-2"><span className={g.done ? 'text-lime-400' : 'text-amber-300'}>{g.done ? '✓' : '✗'}</span><span>{g.title}<span className="block text-xs text-zinc-500">{g.result}</span></span></p>)}
        </Card>
      )}

      <Card className="space-y-2">
        <h3 className="font-semibold">Inputs that sharpen this report</h3>
        {r.inputs.map((x) => <p key={x.key} className="text-sm flex gap-2"><span className={x.has ? 'text-lime-400' : 'text-zinc-600'}>{x.has ? '✓' : '○'}</span><span>{x.label}{!x.has && <span className="block text-xs text-zinc-500">{x.unlock}</span>}</span></p>)}
      </Card>

      <Btn variant="ghost" className="w-full print:hidden" onClick={() => window.print()}>Save as PDF / print</Btn>
    </div>
  )
}

function FindingRow({ f }: { f: WeeklyReport['findings'][number] }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="space-y-1">
      <div className="flex items-start justify-between gap-2">
        <p className="text-sm font-medium">{f.title}</p>
        <span className={`text-[10px] px-2 py-0.5 rounded-full shrink-0 ${f.label === 'established' ? 'bg-lime-400/15 text-lime-300' : 'bg-zinc-800 text-zinc-400'}`}>{f.label}</span>
      </div>
      <p className="text-xs text-zinc-400">{f.saw}</p>
      <button className="text-xs text-lime-400 print:hidden" onClick={() => setOpen(!open)}>{open ? 'Hide why' : 'Why?'}</button>
      {open && (
        <div className="text-xs text-zinc-300 space-y-1 rounded-lg bg-zinc-800/60 p-2.5">
          <p>{f.why}</p>
          {f.evidence.length > 0 && <ul className="list-disc pl-4 text-zinc-400">{f.evidence.map((e, i) => <li key={i}>{e}</li>)}</ul>}
          {f.pattern && <p className="text-zinc-500">Fisher exact test: {f.pattern.aDone}/{f.pattern.aN} vs {f.pattern.bDone}/{f.pattern.bN}, p = {f.pattern.p.toFixed(3)}.</p>}
        </div>
      )}
    </div>
  )
}
