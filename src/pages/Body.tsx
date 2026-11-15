import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { DEFAULT_PROFILE, db, type DailyActivity, type Goal, type Measurement, type Profile } from '../lib/db'
import { BAND_LABEL, GOAL_HELP, GOAL_LABEL, GOAL_ORDER, MEASURE_HELP, MEASURE_KEYS, MEASURE_LABEL, PAL_LABEL, bodySnapshot, paceKgPerWeek, splitMacros, targetRate, type MeasureKey } from '../lib/body'
import { Btn, Card, Chart, Chips, Empty, Field, NumInput, Sheet, Stat, TextInput, inputCls } from '../lib/ui'
import { deleteWithUndo } from '../lib/undo'
import { useProfile, useSettings } from '../lib/hooks'
import { finished } from '../lib/perf'
import PhotosCard from './Photos'
import { SleepCard, SupplementsCard } from './Recovery'
import { fmtInt, prettyDate, round0, round1, shiftDate, todayStr } from '../lib/util'

const VERDICT: Record<string, string> = { on_track: 'On track', too_fast: 'Too fast', too_slow: 'Too slow', wrong_way: 'Going the wrong way' }

export default function BodyPage() {
  const profile = useProfile()
  const settings = useSettings()
  const weights = useLiveQuery(() => db.bodyWeight.orderBy('date').toArray(), []) ?? []
  const meas = useLiveQuery(() => db.measurements.orderBy('date').toArray(), []) ?? []
  const workouts = useLiveQuery(() => db.workouts.toArray(), []) ?? []
  const [kg, setKg] = useState<number | null>(null)
  const [wdate, setWdate] = useState(todayStr())
  const [sheet, setSheet] = useState<'profile' | 'measure' | 'targets' | null>(null)
  const [editM, setEditM] = useState<Measurement | null>(null)
  const [dial, setDial] = useState<number | null>(null)

  const today = todayStr()
  const done = finished(workouts)
  const from = shiftDate(today, -27)
  const logged = done.length ? Math.round((done.filter((w) => w.date >= from).length / 4) * 10) / 10 : null
  const s = bodySnapshot({ profile, weights, measurements: meas, today, loggedDaysPerWeek: logged })
  const missing = [!s.kg && 'a weigh-in', !profile.heightCm && 'height', !profile.birthDate && 'birth date', profile.sex === 'unspecified' && 'sex'].filter(Boolean) as string[]
  const recent = weights.slice(-60)

  return (
    <div className="space-y-4">
      <Card className="space-y-3">
        <div className="flex justify-between items-center">
          <h3 className="font-semibold">Weight</h3>
          <button className="text-xs text-lime-400 h-8" onClick={() => setSheet('profile')}>Edit profile</button>
        </div>
        <div className="flex gap-2">
          <NumInput value={kg} step="0.1" onChange={setKg} placeholder="kg (morning, after bathroom)" />
          <input type="date" max={today} className={`${inputCls} !w-40`} value={wdate} onChange={(e) => setWdate(e.target.value)} />
          <Btn disabled={!kg} onClick={async () => { await db.bodyWeight.add({ date: wdate, kg: kg! }); setKg(null) }}>Log</Btn>
        </div>
        {s.kg !== null ? (
          <>
            <div className="grid grid-cols-3 gap-2">
              <Stat label="7-day avg" value={`${round1(s.kg)} kg`} />
              <Stat label="Latest" value={`${weights[weights.length - 1]?.kg ?? '–'} kg`} sub={weights.length ? prettyDate(weights[weights.length - 1].date) : ''} />
              <Stat label="Rate" value={s.rate ? `${s.rate.kgPerWeek > 0 ? '+' : ''}${round1(s.rate.kgPerWeek * 10) / 10} kg/wk` : '—'} sub={s.rate ? VERDICT[s.rate.verdict] : 'needs 2+ weeks'} />
            </div>
            <Chart points={recent.map((w) => ({ x: w.date, y: w.kg, label: prettyDate(w.date) }))} trend={s.trend.slice(-60).map((t) => ({ x: t.date, y: t.trendKg }))} color="#38bdf8" unit="kg" />
            <p className="text-xs text-zinc-500">Dashed line = 7-day average, the real direction. Daily weight swings with water and salt.</p>
            {s.rate && <p className="text-xs text-zinc-400">Target pace for “{GOAL_LABEL[profile.goal]}”: {round1(s.rate.target[0] * s.kg * 100) / 100} to {round1(s.rate.target[1] * s.kg * 100) / 100} kg/week.</p>}
          </>
        ) : <Empty>Log your first weigh-in.</Empty>}
        {weights.slice(-5).reverse().map((w) => (
          <div key={w.id} className="flex justify-between text-sm"><span className="text-zinc-400">{prettyDate(w.date)}</span><span>{w.kg} kg <button className="text-zinc-600 ml-2" onClick={() => deleteWithUndo(db.bodyWeight, w.id!, `Removed ${w.kg} kg weigh-in`)}>✕</button></span></div>
        ))}
      </Card>

      <Card className="space-y-3">
        <h3 className="font-semibold">Body numbers</h3>
        {missing.length > 0 && <p className="text-xs text-amber-300/80">Add {missing.join(', ')} in “Edit profile” to unlock everything.</p>}
        <div className="grid grid-cols-2 gap-2">
          <Stat label="BMI" value={s.bmi ? round1(s.bmi.value) : '—'} sub={s.bmi ? `${BAND_LABEL[s.bmi.band]} · Asian cut-offs: ${BAND_LABEL[s.bmi.asian]}` : 'needs weight + height'} />
          <Stat label="Body fat" value={s.bf ? `${round1(s.bf.pct)}%` : '—'} sub={s.bf ? (s.bf.source === 'navy' ? 'US Navy tape estimate' : 'measured') : 'add waist + neck'} />
          <Stat label="Lean mass" value={s.lean ? `${round1(s.lean)} kg` : '—'} sub={s.bf && s.kg ? `fat ${round1(s.kg - (s.lean ?? 0))} kg` : undefined} />
          <Stat label="FFMI" value={s.ffmi ? round1(s.ffmi.norm) : '—'} sub={s.ffmi ? `raw ${round1(s.ffmi.value)}` : 'needs body fat'} />
          <Stat label="Waist / height" value={s.whtr ? round1(s.whtr * 100) / 100 : '—'} sub={s.whtr ? (s.whtr < 0.5 ? 'below 0.5 — good' : 'aim for under 0.5') : 'needs waist + height'} />
          <Stat label="Age" value={s.age ?? '—'} sub={profile.heightCm ? `${profile.heightCm} cm` : undefined} />
        </div>
        <p className="text-xs text-zinc-500">BMI ignores muscle: at your training it can read high. Waist, body fat and FFMI are better guides.</p>
      </Card>

      <Card className="space-y-3">
        <div className="flex justify-between items-center">
          <h3 className="font-semibold">Measurements</h3>
          <Btn className="h-9" onClick={() => { setEditM({ date: today }); setSheet('measure') }}>+ Add</Btn>
        </div>
        {MEASURE_KEYS.filter((k) => s.measures[k]).length === 0 && <Empty>Waist is the most important one. Measure weekly, same conditions.</Empty>}
        <div className="grid grid-cols-2 gap-2">
          {MEASURE_KEYS.filter((k) => s.measures[k]).map((k) => {
            const hist = meas.filter((m) => m[k] != null)
            const first = hist[0]?.[k] as number | undefined, cur = s.measures[k]!.value
            return <Stat key={k} label={MEASURE_LABEL[k]} value={`${cur} cm`} sub={first !== undefined && hist.length > 1 ? `${cur - first >= 0 ? '+' : ''}${round1(cur - first)} since ${prettyDate(hist[0].date, { day: 'numeric', month: 'short' })}` : prettyDate(s.measures[k]!.date)} />
          })}
        </div>
        {meas.filter((m) => m.waistCm != null).length >= 2 && (
          <>
            <p className="text-xs text-zinc-400 pt-1">Waist trend</p>
            <Chart points={meas.filter((m) => m.waistCm != null).map((m) => ({ x: m.date, y: m.waistCm as number, label: prettyDate(m.date) }))} color="#f472b6" unit="cm" />
          </>
        )}
        {[...meas].reverse().slice(0, 6).map((m) => (
          <button key={m.id} className="w-full flex justify-between text-sm text-left border-t border-zinc-800 pt-2" onClick={() => { setEditM(m); setSheet('measure') }}>
            <span className="text-zinc-400">{prettyDate(m.date)}</span>
            <span className="text-zinc-300 text-xs text-right">{MEASURE_KEYS.filter((k) => m[k] != null).map((k) => `${MEASURE_LABEL[k]} ${m[k]}`).join(' · ')}{m.bodyFatPct != null ? ` · BF ${m.bodyFatPct}%` : ''}</span>
          </button>
        ))}
      </Card>

      <Card className="space-y-2">
        <div className="flex justify-between items-center"><h3 className="font-semibold">Energy & targets</h3><button className="text-xs text-lime-400 h-8" onClick={() => setSheet('targets')}>Apply to my goals</button></div>
        <div className="space-y-1.5">
          <p className="text-xs text-zinc-400">What are you training for?</p>
          <Chips value={profile.goalChosen ? profile.goal : (null as unknown as Goal)} onChange={async (v: Goal) => { await db.profile.put({ ...DEFAULT_PROFILE, ...profile, id: 1, goal: v, goalChosen: true }); setSheet('targets') }} options={GOAL_ORDER.map((g) => ({ v: g, label: GOAL_LABEL[g] }))} className="!flex-wrap !overflow-visible" />
          <p className="text-xs text-zinc-500">{profile.goalChosen ? GOAL_HELP[profile.goal] : 'Pick one and your calories and macros are worked out from your current weight. Protein is 2 to 2.2 g per kg; the rest of the calories split between carbs and fat.'}</p>
        </div>
        {s.energy ? (
          <div className="space-y-2 text-sm">
            <div className="grid grid-cols-2 gap-2">
              <Stat label="Maintenance (TDEE)" value={`${fmtInt(s.energy.tdee)} kcal`} sub={`${s.energy.method === 'mifflin' ? 'Mifflin-St Jeor' : 'Katch-McArdle'} BMR ${fmtInt(s.energy.bmr)}`} />
              <Stat label={`Target · ${GOAL_LABEL[profile.goal]}`} value={`${fmtInt(s.energy.targetKcal)} kcal`} sub={s.energy.adjustment === 0 ? 'maintenance' : `${s.energy.adjustment > 0 ? '+' : '−'}${Math.round(Math.abs(s.energy.adjustment) * 100)}%`} />
              <Stat label="Protein (2–2.2 g/kg)" value={`${s.energy.proteinG} g`} sub={`${round0(s.energy.protein[0])}–${round0(s.energy.protein[1])} g range`} />
              <Stat label="Carbs / Fat" value={`${s.energy.carbs} g / ${s.energy.fat} g`} sub="rest of calories, 60 / 40" />
            </div>
            <p className="text-xs text-zinc-500">
              BMR {fmtInt(s.energy.bmr)} × {({ sitting: 1.4, mixed: 1.5, on_feet: 1.6, physical: 1.8 })[profile.dailyActivity]} ({PAL_LABEL[profile.dailyActivity].toLowerCase()}) ≈ {fmtInt(s.energy.dailyKcal)}, plus ~{s.energy.trainingKcal} kcal/day for {logged ?? profile.trainingDays} lifting sessions a week → {fmtInt(s.energy.tdee)}.
              These are formulas, not measurements. Your own weight trend over 2–3 weeks is the real test: if it's flat, change intake by about 100–150 kcal.
            </p>
          </div>
        ) : <p className="text-xs text-zinc-500">Needs weight, height, birth date and sex (or body fat) in your profile.</p>}
        {s.energy && s.kg && (() => {
          const e = s.energy, kg = s.kg
          const lo = Math.round((e.tdee * 0.7) / 50) * 50, hi = Math.round((e.tdee * 1.25) / 50) * 50
          const kcal = Math.min(hi, Math.max(lo, dial ?? settings.kcal))
          const pace = paceKgPerWeek(kcal, e.tdee), [ra, rb] = targetRate(profile.goal, profile.experience)
          const protein = e.proteinG, m = splitMacros(kcal, kg, protein)
          const r2 = (v: number) => Math.round(v * 100) / 100
          const wlo = r2(Math.min(ra, rb) * kg), whi = r2(Math.max(ra, rb) * kg)
          const fmtW = (v: number) => `${v > 0 ? '+' : ''}${v}`
          const note = pace >= wlo - 0.05 && pace <= whi + 0.05 ? `Inside the ${fmtW(wlo)} to ${fmtW(whi)} kg/week suggested for “${GOAL_LABEL[profile.goal]}”.`
            : pace < wlo ? `Below the ${fmtW(wlo)} to ${fmtW(whi)} kg/week suggested for this goal. ${whi <= 0 ? 'Larger deficits cost more muscle.' : 'You would be losing weight.'}`
            : `Above the ${fmtW(wlo)} to ${fmtW(whi)} kg/week suggested for this goal. ${wlo >= 0 ? 'More of the surplus ends up as fat.' : 'You would lose fat more slowly, or gain.'}`
          return (
            <div className="space-y-2 border-t border-zinc-800 pt-3">
              <div className="flex justify-between items-baseline"><p className="text-sm font-medium">Daily calories</p><p className="text-lg font-semibold tabular-nums">{fmtInt(kcal)} kcal</p></div>
              <input type="range" className="w-full accent-lime-400" min={lo} max={hi} step={50} value={kcal} onChange={(ev) => setDial(+ev.target.value)} />
              <div className="flex justify-between text-[11px] text-zinc-500"><span>{fmtInt(lo)}</span><span>maintenance {fmtInt(e.tdee)}</span><span>{fmtInt(hi)}</span></div>
              <p className="text-sm">{kcal === e.tdee ? 'Maintenance' : `${kcal > e.tdee ? '+' : '−'}${fmtInt(Math.abs(kcal - e.tdee))} kcal vs maintenance`} → about <b>{pace > 0 ? '+' : ''}{r2(pace)} kg/week</b></p>
              <p className="text-xs text-zinc-400">{note}</p>
              <p className="text-xs text-zinc-400">Protein {protein} g · Carbs {m.carbs} g · Fat {m.fat} g</p>
              <div className="flex gap-2">
                <Btn variant="ghost" className="flex-1" onClick={() => setDial(e.targetKcal)}>Use calculated ({fmtInt(e.targetKcal)})</Btn>
                <Btn className="flex-1" disabled={kcal === settings.kcal && protein === settings.p && m.carbs === settings.c && m.fat === settings.f} onClick={async () => { await db.settings.put({ ...settings, kcal, p: protein, c: m.carbs, f: m.fat }); setDial(null) }}>Save as my goal</Btn>
              </div>
              <p className="text-xs text-zinc-500">How the number is built: Mifflin-St Jeor resting burn (Mifflin et al., 1990) × activity factor + lifting. The pace uses 7,700 kcal per kg of body mass (Wishnofsky, 1958); it overstates change after the first weeks because the body adapts (Hall et al., 2011). Protein 2–2.2 g/kg is the range reported to maximise muscle gain in training (Morton et al., 2018) and to protect it in a deficit (Helms et al., 2014). These are estimates: if your 7-day weight average isn't moving as shown after 2–3 weeks, move the slider by 100–150 kcal.</p>
            </div>
          )
        })()}
      </Card>

      <SupplementsCard />
      <SleepCard />
      <PhotosCard />

      <ProfileSheet open={sheet === 'profile'} onClose={() => setSheet(null)} profile={profile} />
      <MeasureSheet open={sheet === 'measure'} onClose={() => setSheet(null)} entry={editM} sex={profile.sex} />
      <Sheet open={sheet === 'targets'} onClose={() => setSheet(null)} title="Apply targets">
        {s.energy && (
          <div className="space-y-3 text-sm">
            <p className="text-xs text-zinc-400">{GOAL_LABEL[profile.goal]} at {round1(s.kg ?? 0)} kg: protein 2–2.2 g per kg, then the rest of the calories split between carbs and fat.</p>
            <p>Set daily goals to <b>{fmtInt(s.energy.targetKcal)} kcal</b>, <b>{s.energy.proteinG} g</b> protein, <b>{s.energy.carbs} g</b> carbs and <b>{s.energy.fat} g</b> fat?</p>
            <p className="text-xs text-zinc-500">Current: {settings.kcal} kcal · P{settings.p} C{settings.c} F{settings.f}</p>
            <Btn className="w-full" onClick={async () => { await db.settings.put({ ...settings, kcal: s.energy!.targetKcal, p: s.energy!.proteinG, c: s.energy!.carbs, f: s.energy!.fat }); setSheet(null) }}>Apply</Btn>
          </div>
        )}
      </Sheet>
    </div>
  )
}

function ProfileSheet({ open, onClose, profile }: { open: boolean; onClose: () => void; profile: Profile }) {
  const [p, setP] = useState<Profile>(profile)
  const [synced, setSynced] = useState(false)
  if (open && !synced) { setP({ ...DEFAULT_PROFILE, ...profile }); setSynced(true) }
  if (!open && synced) setSynced(false)
  const settings = useSettings()
  return (
    <Sheet open={open} onClose={onClose} title="Profile">
      <div className="space-y-3">
        <Field label="Sex (for BMR and body-fat formulas)"><Chips value={p.sex} onChange={(v) => setP({ ...p, sex: v })} options={[{ v: 'male', label: 'Male' }, { v: 'female', label: 'Female' }, { v: 'unspecified', label: 'Prefer not to say' }]} /></Field>
        <div className="grid grid-cols-2 gap-2">
          <Field label="Height (cm)"><NumInput value={p.heightCm} onChange={(v) => setP({ ...p, heightCm: v ?? undefined })} placeholder="185" /></Field>
          <Field label="Birth date"><input type="date" className={inputCls} value={p.birthDate ?? ''} max={todayStr()} onChange={(e) => setP({ ...p, birthDate: e.target.value || undefined })} /></Field>
        </div>
        <Field label="Goal"><Chips value={p.goal} onChange={(v: Goal) => setP({ ...p, goal: v, goalChosen: true })} options={GOAL_ORDER.map((g) => ({ v: g, label: GOAL_LABEL[g] }))} /></Field>
        <Field label="Daily activity outside the gym"><Chips value={p.dailyActivity} onChange={(v: DailyActivity) => setP({ ...p, dailyActivity: v })} options={(Object.keys(PAL_LABEL) as DailyActivity[]).map((g) => ({ v: g, label: PAL_LABEL[g] }))} /></Field>
        <Field label="Lifting experience"><Chips value={p.experience} onChange={(v) => setP({ ...p, experience: v })} options={[{ v: 'beginner', label: 'Beginner' }, { v: 'intermediate', label: 'Intermediate' }, { v: 'advanced', label: 'Advanced' }]} /></Field>
        <div className="grid grid-cols-2 gap-2">
          <Field label="Training days / week (used until you've logged 4 weeks)"><NumInput value={p.trainingDays} onChange={(v) => setP({ ...p, trainingDays: v ?? undefined })} /></Field>
          <Field label="Session minutes"><NumInput value={p.sessionMinutes} onChange={(v) => setP({ ...p, sessionMinutes: v ?? undefined })} /></Field>
        </div>
        <Field label="Daily step goal"><NumInput value={settings.stepGoal} onChange={(v) => v && db.settings.put({ ...settings, stepGoal: v })} /></Field>
        <Btn className="w-full" onClick={async () => { await db.profile.put({ ...p, id: 1 }); onClose() }}>Save</Btn>
      </div>
    </Sheet>
  )
}

function MeasureSheet({ open, onClose, entry, sex }: { open: boolean; onClose: () => void; entry: Measurement | null; sex: string }) {
  const [m, setM] = useState<Measurement>({ date: todayStr() })
  const [key, setKey] = useState<number | undefined>()
  const id = entry?.id ?? -1
  if (open && key !== id) { setM(entry ?? { date: todayStr() }); setKey(id) }
  if (!open && key !== undefined) setKey(undefined)
  const keys: MeasureKey[] = sex === 'female' ? ['waistCm', 'neckCm', 'hipCm', 'chestCm', 'armCm', 'thighCm', 'calfCm'] : ['waistCm', 'neckCm', 'chestCm', 'armCm', 'thighCm', 'calfCm', 'hipCm']
  const any = keys.some((k) => m[k] != null) || m.bodyFatPct != null
  return (
    <Sheet open={open} onClose={onClose} title={entry?.id ? 'Edit measurements' : 'Add measurements'}>
      <div className="space-y-3">
        <p className="text-xs text-zinc-500">Fill in any you like. Waist + neck give a body-fat estimate.</p>
        <Field label="Date"><input type="date" max={todayStr()} className={inputCls} value={m.date} onChange={(e) => setM({ ...m, date: e.target.value })} /></Field>
        <div className="grid grid-cols-2 gap-2">
          {keys.map((k) => <Field key={k} label={`${MEASURE_LABEL[k]} (cm)`} hint={MEASURE_HELP[k]}><NumInput value={m[k]} step="0.1" onChange={(v) => setM({ ...m, [k]: v })} /></Field>)}
        </div>
        <Field label="Body fat % (optional — from a scan/scale)"><NumInput value={m.bodyFatPct} step="0.1" onChange={(v) => setM({ ...m, bodyFatPct: v })} /></Field>
        <Field label="Note"><TextInput value={m.note ?? ''} onCommit={(v) => setM({ ...m, note: v })} /></Field>
        <div className="flex gap-2">
          <Btn className="flex-1" disabled={!any} onClick={async () => { if (m.id) await db.measurements.put(m); else await db.measurements.add(m); onClose() }}>Save</Btn>
          {entry?.id && <Btn variant="danger" onClick={async () => { onClose(); await deleteWithUndo(db.measurements, entry.id!, 'Measurements deleted') }}>Delete</Btn>}
        </div>
      </div>
    </Sheet>
  )
}
