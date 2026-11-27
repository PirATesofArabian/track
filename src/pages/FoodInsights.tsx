import { useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, DEFAULT_SETTINGS } from '../lib/db'
import { Btn, Card, Stat } from '../lib/ui'
import { useExerciseIndex, useProfile, useSettings } from '../lib/hooks'
import { bodySnapshot, PROTEIN_PER_KG } from '../lib/body'
import { analyseDay, calcTargets, critiqueTargets, macrosForKcal, proteinTrend, provisionalMaintenance, realMaintenance, type Verdict } from '../lib/foodinsights'
import { e1rmSlope, finished, sessionsByExercise } from '../lib/perf'
import { offerUndo } from '../lib/undo'
import { fmtInt, round0, shiftDate, todayStr } from '../lib/util'

const V: Record<Verdict, string> = { low: 'Low', high: 'High', in_range: 'In range' }
const VC: Record<Verdict, string> = { low: 'text-amber-400', high: 'text-amber-400', in_range: 'text-lime-400' }
const TONE = { good: 'border-lime-400/60', warn: 'border-amber-400/70', info: 'border-sky-400/50' }

export function FoodInsights({ date }: { date: string }) {
  const profile = useProfile(), s = useSettings(), idx = useExerciseIndex()
  const logs = useLiveQuery(() => db.foodLog.toArray(), []) ?? []
  const weights = useLiveQuery(() => db.bodyWeight.toArray(), []) ?? []
  const meas = useLiveQuery(() => db.measurements.toArray(), []) ?? []
  const workouts = useLiveQuery(() => db.workouts.toArray(), []) ?? []
  const [days, setDays] = useState<7 | 14 | 28>(14)
  const today = todayStr()

  const d = useMemo(() => {
    const done = finished(workouts), from = shiftDate(today, -27)
    const logged = done.length ? Math.round((done.filter((w) => w.date >= from).length / 4) * 10) / 10 : null
    const snap = bodySnapshot({ profile, weights, measurements: meas, today, loggedDaysPerWeek: logged })
    const maint = realMaintenance(logs, snap.trend, today)
    const early = maint ? null : provisionalMaintenance(logs, snap.trend, today)
    const tdee = maint?.kcal ?? snap.energy?.tdee ?? null
    const trainingDates = new Set(done.map((w) => w.date))
    const slopes = [...sessionsByExercise(workouts, idx).values()].map((l) => e1rmSlope(l, today)).filter((x): x is number => x !== null)
    const rate = snap.rate?.kgPerWeek ?? null
    return {
      snap, maint, early, trainingDates,
      day: analyseDay({ logs, date, today, weightKg: snap.kg, kcalTarget: s.kcal, maintenanceKcal: tdee, proteinRangeGPerKg: PROTEIN_PER_KG[profile.goal], trainingDay: trainingDates.has(date) }),
      trend: proteinTrend({ logs, today, days, proteinTargetG: s.p, trainingDates }),
      calc: calcTargets(snap.energy ? { targetKcal: snap.energy.targetKcal, protein: snap.energy.protein } : null, snap.kg),
      critique: critiqueTargets({ targets: { kcal: s.kcal, p: s.p }, tdee: snap.energy?.tdee ?? null, weightKg: snap.kg, rateKgPerWeek: rate, goal: profile.goal, experience: profile.experience, liftRates: slopes }),
    }
  }, [logs, weights, meas, workouts, profile, s.kcal, s.p, date, days, idx, today])

  async function setTargets(patch: Partial<{ kcal: number; p: number }>) {
    const before = (await db.settings.get(1)) ?? DEFAULT_SETTINGS
    const kcal = patch.kcal ?? before.kcal
    const fixed = patch.p != null ? { p: patch.p } : patch.kcal != null ? { p: before.p } : undefined
    const m = macrosForKcal({ kcal, weightKg: d.snap.kg, goal: profile.goal, fixed })
    await db.settings.put({ ...before, id: 1, kcal, p: m.p, c: m.c, f: m.f })
    offerUndo('Targets updated', async () => { await db.settings.put(before) })
  }
  async function useCalculated() {
    if (!d.calc) return
    const before = (await db.settings.get(1)) ?? DEFAULT_SETTINGS
    await db.settings.put({ ...before, id: 1, kcal: d.calc.kcal, p: d.calc.p, c: d.calc.c, f: d.calc.f })
    offerUndo('Targets set to calculated', async () => { await db.settings.put(before) })
  }

  const day = d.day
  return (
    <div className="space-y-4">
      <Card className="space-y-3">
        <h3 className="font-semibold">Your day</h3>
        {!day ? <p className="text-sm text-zinc-500">Log something for {date === today ? 'today' : date} to see the analysis.</p> : (
          <>
            {day.partial && <p className="text-xs text-zinc-500">Day still in progress, so intake judgements are provisional.</p>}
            <div className="grid grid-cols-2 gap-2">
              <Stat label="Calories" value={fmtInt(day.kcal)} sub={day.energy.ofTarget !== null ? `${Math.round(day.energy.ofTarget * 100)}% of target · ${V[day.energy.verdict!]}` : undefined} />
              <Stat label="Vs real maintenance" value={day.energy.vsMaintenance === null ? '—' : `${day.energy.vsMaintenance > 0 ? '+' : ''}${fmtInt(day.energy.vsMaintenance)}`} sub={d.maint ? 'from your logs + weight' : 'estimated'} />
            </div>
            {day.split && (
              <div className="space-y-2 text-xs">
                <p className="text-zinc-400">Share of calories (acceptable range)</p>
                {([['Protein', day.split.protein], ['Carbs', day.split.carbs], ['Fat', day.split.fat]] as const).map(([n, x]) => (
                  <div key={n} className="flex justify-between"><span>{n} {x.value}% <span className="text-zinc-500">({x.range[0]}–{x.range[1]}%)</span></span><span className={VC[x.verdict]}>{V[x.verdict]}</span></div>
                ))}
              </div>
            )}
            <div className="space-y-1 text-xs">
              {day.proteinPerKg && <div className="flex justify-between"><span>Protein {day.proteinPerKg.value} g/kg <span className="text-zinc-500">({day.proteinPerKg.range[0]}–{day.proteinPerKg.range[1]})</span></span><span className={VC[day.proteinPerKg.verdict]}>{V[day.proteinPerKg.verdict]}</span></div>}
              {day.proteinSpread && day.proteinSpread.meals.length > 0 && <div className="flex justify-between"><span>Meals with ≥{day.proteinSpread.doseG} g protein</span><span className={day.proteinSpread.reached.length >= Math.min(3, day.proteinSpread.meals.length) ? 'text-lime-400' : 'text-amber-400'}>{day.proteinSpread.reached.length} of {day.proteinSpread.meals.length}</span></div>}
              <div className="flex justify-between"><span>Fibre {day.fibre.value} g <span className="text-zinc-500">(≥{day.fibre.target})</span></span><span className={VC[day.fibre.verdict]}>{V[day.fibre.verdict]}</span></div>
              {day.trainingCarbs && <div className="flex justify-between"><span>Carbs on a training day {day.trainingCarbs.value} g/kg <span className="text-zinc-500">(4–7)</span></span><span className={VC[day.trainingCarbs.verdict]}>{V[day.trainingCarbs.verdict]}</span></div>}
            </div>
          </>
        )}
      </Card>

      <Card className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold">Protein trend</h3>
          <div className="flex gap-1">{([7, 14, 28] as const).map((n) => <button key={n} onClick={() => setDays(n)} className={`px-2.5 h-8 rounded-full text-xs ${days === n ? 'bg-lime-400 text-black' : 'bg-zinc-800'}`}>{n}d</button>)}</div>
        </div>
        {d.trend.loggedDays < 3 ? <p className="text-sm text-zinc-500">Needs 3 or more full logged days (≥1,000 kcal) in the window. You have {d.trend.loggedDays}.</p> : (
          <>
            <div className="grid grid-cols-3 gap-2">
              <Stat label="Average" value={`${round0(d.trend.avg ?? 0)} g`} sub={`${d.trend.loggedDays} days`} />
              <Stat label="Hit target" value={`${d.trend.proteinHitDays}/${d.trend.loggedDays}`} sub={`≥${s.p} g`} />
              <Stat label="Train / rest" value={`${d.trend.proteinTraining ?? '—'} / ${d.trend.proteinRest ?? '—'}`} sub="g" />
            </div>
            <div className="flex items-end gap-0.5 h-16">
              {d.trend.series.map((x) => <div key={x.date} title={`${x.date}: ${round0(x.proteinG)} g`} className={`flex-1 rounded-sm ${x.proteinG >= s.p ? 'bg-lime-400' : 'bg-zinc-600'}`} style={{ height: `${Math.min(100, (x.proteinG / Math.max(s.p, 1)) * 100)}%` }} />)}
            </div>
            {d.trend.topProtein.length > 0 && (
              <div className="text-xs space-y-1"><p className="text-zinc-400">Where your protein comes from</p>
                {d.trend.topProtein.map((t) => <div key={t.foodName} className="flex justify-between"><span className="truncate pr-2">{t.foodName}</span><span className="tabular-nums text-zinc-400">{t.proteinG} g</span></div>)}
              </div>
            )}
          </>
        )}
      </Card>

      <Card className="space-y-3">
        <h3 className="font-semibold">Your real maintenance</h3>
        {d.maint ? (
          <>
            <p className="text-3xl font-bold tabular-nums">{fmtInt(d.maint.kcal)}<span className="text-base text-zinc-500 font-normal"> kcal/day</span></p>
            <p className="text-xs text-zinc-400">You averaged {fmtInt(d.maint.meanIntake)} kcal over {d.maint.loggedDays} logged days while your trend weight moved {d.maint.changeKg > 0 ? '+' : ''}{d.maint.changeKg.toFixed(2)} kg in {d.maint.days} days{d.snap.energy ? `. The formula estimate is ${fmtInt(d.snap.energy.tdee)}.` : '.'}</p>
          </>
        ) : d.early ? (
          <>
            <p className="text-3xl font-bold tabular-nums">~{fmtInt(d.early.kcal)}<span className="text-base text-zinc-500 font-normal"> kcal/day · provisional</span></p>
            <p className="text-xs text-zinc-400">You averaged {fmtInt(d.early.meanIntake)} kcal over {d.early.loggedDays} logged days while your trend weight moved {d.early.changeKg > 0 ? '+' : ''}{d.early.changeKg.toFixed(2)} kg in {d.early.days} days. Over this short a window, a 0.5 kg water swing moves the answer by about ±{fmtInt(d.early.wobbleKcal)} kcal. It is not used for your targets or the verdicts above; the full estimate needs 14+ logged days and weigh-ins spanning 14+ days at both ends of the last 4 weeks.</p>
          </>
        ) : <p className="text-sm text-zinc-500">Needs 14 or more days with at least 1,000 kcal logged in the last 4 weeks, and weigh-ins spanning 14+ days at both ends.</p>}
      </Card>

      <Card className="space-y-3">
        <div className="flex items-center justify-between"><h3 className="font-semibold">Are your targets right?</h3>{d.calc && <Btn variant="ghost" className="!h-8 text-xs" onClick={useCalculated}>Use calculated</Btn>}</div>
        {d.calc && <p className="text-xs text-zinc-400">Calculated for your goal: {fmtInt(d.calc.kcal)} kcal · P {d.calc.p} · C {d.calc.c} · F {d.calc.f} g · fibre {d.calc.fib} g{d.calc.waterMl ? ` · water ${fmtInt(d.calc.waterMl)} ml` : ''}</p>}
        {!d.critique.length && <p className="text-sm text-zinc-500">Needs a weigh-in and your profile (Body tab) to judge.</p>}
        {d.critique.map((c) => (
          <div key={c.id} className={`border-l-2 pl-3 space-y-1 ${TONE[c.tone]}`}>
            <p className="text-sm font-medium">{c.title}</p>
            <p className="text-xs text-zinc-400">{c.body}</p>
            {c.suggestKcal && c.suggestKcal !== s.kcal && <Btn variant="ghost" className="!h-8 text-xs" onClick={() => setTargets({ kcal: c.suggestKcal })}>Set {fmtInt(c.suggestKcal)} kcal</Btn>}
            {c.suggestProteinG && c.suggestProteinG !== s.p && <Btn variant="ghost" className="!h-8 text-xs" onClick={() => setTargets({ p: c.suggestProteinG })}>Set {c.suggestProteinG} g protein</Btn>}
          </div>
        ))}
      </Card>
    </div>
  )
}
