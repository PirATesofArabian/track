import { useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, type PhotoRec, type Workout } from '../lib/db'
import { MUSCLES, TRACKING_LABEL, cap, type Exercise } from '../data/exerciseDb'
import { Bar, Btn, Card, Chart, Chips, Empty, Stat, inputCls } from '../lib/ui'
import { offerUndo } from '../lib/undo'
import { applyAdditive, type AddFile } from '../lib/addImport'
import { useExerciseIndex, useProfile } from '../lib/hooks'
import { LEVELS, PR_LABEL, balance, currentBests, daysSinceMuscle, detectPRs, detectStalls, e1rmSlope, finished, muscleSets, sessionsByExercise, setVolume, strengthLevels, dotsFromSessions, workoutVolume, type PR } from '../lib/perf'
import { download, fmtDuration, fmtInt, fmtKg, prettyDate, round0, round1, shiftDate, todayStr } from '../lib/util'
import { setText } from '../lib/format'
import { weightTrend } from '../lib/body'
import { ReportView } from './Review'
import { PlanView } from './PlanView'
import { GoalsView } from './Goals'
import { BadgesView, WrappedView } from './Achievements'
import { useSearchParams } from 'react-router-dom'

const prValue = (p: PR) => (p.type === 'reps' || p.type === 'session_reps' ? `${p.value} reps` : p.type === 'duration' ? fmtDuration(p.value) : p.type === 'distance' ? `${fmtInt(p.value)} m` : `${fmtKg(Math.round(p.value * 10) / 10)} kg`)
const VERDICT: Record<string, string> = { too_little: 'Not enough data (need 20+ sets in 4 weeks)', a_heavy: 'Skewed to the first', b_heavy: 'Skewed to the second', balanced: 'Balanced' }
const STALL_NAME: Record<string, string> = { break: 'Break', frequency: 'Frequency', effort: 'Effort', volume: 'Volume', variation: 'Variation', same_load: 'Same load', deload: 'Deload', rep_range: 'Rep range' }

export default function ProgressPage() {
  const idx = useExerciseIndex()
  const profile = useProfile()
  const workouts = useLiveQuery(() => db.workouts.toArray(), []) ?? []
  const weights = useLiveQuery(() => db.bodyWeight.toArray(), []) ?? []
  type Tab = 'overview' | 'week' | 'plan' | 'goals' | 'badges' | 'wrapped' | 'lifts' | 'records' | 'data'
  const [sp] = useSearchParams()
  const want = sp.get('tab') as Tab | null
  const [tab, setTab] = useState<Tab>(want && ['week', 'plan', 'goals', 'badges', 'wrapped'].includes(want) ? want : 'overview')
  const today = todayStr()
  const done = useMemo(() => finished(workouts), [workouts])
  const map = useMemo(() => sessionsByExercise(workouts, idx), [workouts, idx])
  const prs = useMemo(() => detectPRs(map), [map])

  return (
    <div className="space-y-4">
      <Chips value={tab} onChange={setTab} options={[{ v: 'overview', label: 'Overview' }, { v: 'week', label: 'Week' }, { v: 'plan', label: 'Plan' }, { v: 'goals', label: 'Goals' }, { v: 'badges', label: 'Badges' }, { v: 'wrapped', label: 'Wrapped' }, { v: 'lifts', label: 'Lifts' }, { v: 'records', label: `Records${prs.length ? ` (${prs.length})` : ''}` }, { v: 'data', label: 'Data' }]} />
      {tab === 'overview' && <Overview ws={workouts} done={done} idx={idx} map={map} today={today} bodyKg={weightTrend(weights).slice(-1)[0]?.trendKg ?? null} sex={profile.sex} />}
      {tab === 'week' && <ReportView />}
      {tab === 'plan' && <PlanView />}
      {tab === 'goals' && <GoalsView />}
      {tab === 'badges' && <BadgesView />}
      {tab === 'wrapped' && <WrappedView />}
      {tab === 'lifts' && <Lifts map={map} idx={idx} prs={prs} today={today} />}
      {tab === 'records' && <Records prs={prs} idx={idx} />}
      {tab === 'data' && <Data />}
    </div>
  )
}

function Overview({ ws, done, idx, map, today, bodyKg, sex }: { ws: Workout[]; done: ReturnType<typeof finished>; idx: ReturnType<typeof useExerciseIndex>; map: ReturnType<typeof sessionsByExercise>; today: string; bodyKg: number | null; sex: string }) {
  const [days, setDays] = useState(7)
  const from = days > 3650 ? '0000-01-01' : shiftDate(today, -(days - 1))
  const inRange = done.filter((w) => w.date >= from)
  const vol = inRange.reduce((a, w) => a + workoutVolume(w, idx), 0)
  const sets = muscleSets(ws, idx, from, today).filter((m) => m.muscle !== 'cardio')
  const maxW = Math.max(10, ...sets.map((m) => m.weighted))
  const bal = balance(ws, idx, today)
  const stalls = detectStalls(ws, idx, today)
  const levels = strengthLevels(map, today, bodyKg, sex)
  const dots = dotsFromSessions(map, today, bodyKg, sex)
  const since = daysSinceMuscle(ws, idx, today).filter((m) => m.muscle !== 'cardio' && m.muscle !== 'adductors')
  // weekly volume chart
  const weekly = useMemo(() => {
    const out: { x: string; y: number }[] = []
    for (let i = 7; i >= 0; i--) {
      const to = shiftDate(today, -i * 7), fr = shiftDate(to, -6)
      out.push({ x: to, y: done.filter((w) => w.date >= fr && w.date <= to).reduce((a, w) => a + workoutVolume(w, idx), 0) / 1000 })
    }
    return out
  }, [done, idx, today])

  if (!done.length) return <Empty>Finish a workout to see your progress.</Empty>
  return (
    <div className="space-y-4">
      <Chips value={days} onChange={setDays} options={[{ v: 7, label: '7 days' }, { v: 14, label: '14 days' }, { v: 28, label: '28 days' }, { v: 90, label: '90 days' }, { v: 36500, label: 'All time' }]} />
      <div className="grid grid-cols-3 gap-2">
        <Stat label="Workouts" value={inRange.length} sub={`${done.length} total`} />
        <Stat label="Volume" value={`${round1(vol / 1000)} t`} />
        <Stat label="Sets" value={inRange.reduce((a, w) => a + w.exercises.reduce((b, e) => b + e.sets.filter((s) => s.setType !== 'warmup').length, 0), 0)} />
      </div>

      <Card className="space-y-2">
        <h3 className="font-semibold">Weekly volume (tonnes)</h3>
        <Chart points={weekly.map((p) => ({ ...p, label: `week to ${prettyDate(p.x, { day: 'numeric', month: 'short' })}` }))} unit="t" />
      </Card>

      <Card className="space-y-2">
        <h3 className="font-semibold">Sets per muscle · {days > 3650 ? 'all time' : `last ${days} days`}</h3>
        <p className="text-xs text-zinc-500">Direct sets count fully, indirect (secondary) count half. Sets within 4 reps of failure.</p>
        {sets.filter((m) => m.weighted > 0).map((m) => (
          <div key={m.muscle} className="flex items-center gap-3 text-sm">
            <span className="w-20 text-zinc-400">{cap(m.muscle)}</span>
            <div className="flex-1"><Bar value={m.weighted} max={maxW} /></div>
            <span className="w-16 text-right tabular-nums text-xs">{m.direct}{m.indirect ? <span className="text-zinc-500"> +{m.indirect}</span> : ''}</span>
          </div>
        ))}
        {!sets.some((m) => m.weighted > 0) && <Empty>Nothing in this period.</Empty>}
        <div className="flex flex-wrap gap-1.5 pt-1">
          {since.map((m) => <span key={m.muscle} className={`text-[11px] px-2 py-1 rounded-full ${m.daysSince === null ? 'bg-zinc-800 text-zinc-600' : m.daysSince > 7 ? 'bg-amber-400/15 text-amber-300' : 'bg-zinc-800 text-zinc-400'}`}>{cap(m.muscle)} {m.daysSince === null ? '—' : m.daysSince === 0 ? 'today' : `${m.daysSince}d`}</span>)}
        </div>
      </Card>

      <Card className="space-y-3">
        <h3 className="font-semibold">Balance · last 4 weeks</h3>
        {bal.map((b) => (
          <div key={b.label} className="space-y-1">
            <div className="flex justify-between text-sm"><span>{b.label}</span><span className="text-xs text-zinc-400 tabular-nums">{b.aL} {b.a} : {b.b} {b.bL}{b.ratio !== null ? ` (${round1(b.ratio * 100) / 100})` : ''}</span></div>
            <Bar value={b.a} max={Math.max(1, b.a + b.b)} color={b.verdict === 'balanced' ? 'bg-lime-400' : b.verdict === 'too_little' ? 'bg-zinc-600' : 'bg-amber-400'} />
            <p className={`text-xs ${b.verdict === 'balanced' ? 'text-lime-400/80' : 'text-zinc-500'}`}>{b.verdict === 'a_heavy' ? `More ${b.aL.toLowerCase()} than ${b.bL.toLowerCase()}` : b.verdict === 'b_heavy' ? `More ${b.bL.toLowerCase()} than ${b.aL.toLowerCase()}` : VERDICT[b.verdict]}</p>
          </div>
        ))}
      </Card>

      {levels.length > 0 && (
        <Card className="space-y-3">
          <h3 className="font-semibold">Strength levels · best e1RM of last 12 weeks</h3>
          {levels.map((l) => (
            <div key={l.key} className="space-y-1">
              <div className="flex justify-between text-sm"><span>{l.name} · {round0(l.e1rm)} kg</span><span className="text-xs text-lime-400">{l.level ?? 'Below beginner'} · {round1(l.ratio * 100) / 100}× BW</span></div>
              <Bar value={l.progress} max={1} />
              {l.next && l.nextKg && <p className="text-xs text-zinc-500">{l.next} at {round0(l.nextKg)} kg</p>}
            </div>
          ))}
          {dots && <p className="text-sm">DOTS score <b className="text-lime-400">{round1(dots.score)}</b> <span className="text-xs text-zinc-500">· squat + bench + deadlift e1RM total {round0(dots.totalKg)} kg at {round1(bodyKg ?? 0)} kg</span></p>}
          <p className="text-xs text-zinc-500">Levels: {LEVELS.join(' → ')}, as multiples of body weight.</p>
        </Card>
      )}

      {stalls.length > 0 && (
        <Card className="space-y-3">
          <h3 className="font-semibold">Stalled lifts</h3>
          {stalls.map((s) => (
            <div key={s.key} className="space-y-0.5">
              <p className="text-sm">{idx.get(s.key).name} <span className="text-xs text-zinc-500">· {s.weeks} weeks, {s.sessionsSince} sessions since best {fmtKg(s.bestKg)}×{s.bestReps}</span></p>
              <p className="text-xs text-amber-300/80">{STALL_NAME[s.cause]}: {s.text}</p>
            </div>
          ))}
        </Card>
      )}
    </div>
  )
}

function Lifts({ map, idx, prs, today }: { map: ReturnType<typeof sessionsByExercise>; idx: ReturnType<typeof useExerciseIndex>; prs: PR[]; today: string }) {
  const keys = [...map.keys()].filter((k) => map.get(k)!.length).sort((a, b) => idx.get(a).name.localeCompare(idx.get(b).name))
  const [sel, setSel] = useState('')
  const [q, setQ] = useState('')
  const key = sel && map.has(sel) ? sel : keys[0]
  const workouts = useLiveQuery(() => db.workouts.toArray(), []) ?? []
  if (!keys.length) return <Empty>Log some sets to see per-exercise progress.</Empty>
  const x: Exercise = idx.get(key)
  const list = map.get(key)!
  const best = currentBests(list)
  const myPrs = prs.filter((p) => p.exerciseKey === key)
  const prDates = new Set(myPrs.filter((p) => p.type === 'e1rm' || p.type === 'load' || p.type === 'reps' || p.type === 'duration' || p.type === 'distance').map((p) => p.date))
  const slope = e1rmSlope(list, today)
  const metric: { name: string; unit: string; get: (s: (typeof list)[number]) => number | null; fmt?: (n: number) => string } =
    x.tracking === 'weight_reps' ? { name: 'Estimated 1RM', unit: 'kg', get: (s) => s.chartE1rm }
    : x.tracking === 'weighted_bodyweight' ? { name: 'Added weight', unit: 'kg', get: (s) => s.heaviestLoad }
    : x.tracking === 'bodyweight_reps' || x.tracking === 'assisted_bodyweight' ? { name: 'Best reps in a set', unit: 'reps', get: (s) => s.mostReps }
    : x.tracking === 'duration' ? { name: 'Longest time', unit: '', get: (s) => s.longestDuration, fmt: fmtDuration }
    : { name: 'Longest distance', unit: 'm', get: (s) => s.longestDistance }
  const pts = list.map((s) => ({ x: s.date, y: metric.get(s) as number, label: prettyDate(s.date), flag: prDates.has(s.date) })).filter((p) => p.y !== null && p.y !== undefined)
  const history = workouts.filter((w) => w.finishedAt && w.exercises.some((e) => e.key === key)).sort((a, b) => b.date.localeCompare(a.date)).slice(0, 8)
  const filtered = q ? keys.filter((k) => idx.get(k).name.toLowerCase().includes(q.toLowerCase())) : keys

  return (
    <div className="space-y-4">
      <input className={inputCls} placeholder="Filter exercises…" value={q} onChange={(e) => setQ(e.target.value)} />
      <select className={inputCls} value={key} onChange={(e) => setSel(e.target.value)}>{(filtered.includes(key) ? filtered : [key, ...filtered]).map((k) => <option key={k} value={k}>{idx.get(k).name}</option>)}</select>
      <Card className="space-y-2">
        <div className="flex justify-between"><h3 className="font-semibold">{metric.name}</h3><span className="text-xs text-zinc-500">{cap(x.primary)} · {TRACKING_LABEL[x.tracking]}</span></div>
        <Chart points={pts} unit={metric.unit} format={metric.fmt} />
        <p className="text-xs text-zinc-500"><span className="text-yellow-400">●</span> = new record. Drag across the chart to read each session.</p>
        {slope !== null && <p className="text-xs text-zinc-300">Trend: {slope >= 0 ? '+' : ''}{round1(slope * 10) / 10} kg/week (last 8 weeks)</p>}
        {x.tracking === 'weight_reps' && <p className="text-xs text-zinc-500">Epley estimate from sets of ≤10 reps, counting reps in reserve. It's an estimate, not a tested max.</p>}
      </Card>
      <div className="grid grid-cols-2 gap-2">
        {best.e1rm !== null && <Stat label="Best e1RM" value={`${round0(best.e1rm)} kg`} />}
        {best.load !== null && <Stat label={x.tracking === 'weighted_bodyweight' ? 'Heaviest added' : 'Heaviest load'} value={`${fmtKg(best.load)} kg`} />}
        {best.reps !== null && <Stat label="Most reps in a set" value={best.reps} />}
        {best.setVolume !== null && best.setVolume > 0 && <Stat label="Best set volume" value={`${fmtInt(best.setVolume)} kg`} />}
        {best.sessionVolume !== null && best.sessionVolume > 0 && <Stat label="Best session volume" value={`${fmtInt(best.sessionVolume)} kg`} />}
        {best.duration !== null && <Stat label="Longest time" value={fmtDuration(best.duration)} />}
        {best.distance !== null && <Stat label="Longest distance" value={`${fmtInt(best.distance)} m`} />}
      </div>
      <Card className="space-y-2">
        <h3 className="font-semibold">Recent sessions</h3>
        {history.map((w) => {
          const e = w.exercises.find((q) => q.key === key)!
          return <div key={w.id} className="text-sm"><div className="flex justify-between"><span>{prettyDate(w.date)}</span><span className="text-xs text-zinc-500">{(() => { const v = e.sets.reduce((a, s) => a + setVolume(s, x), 0); return v > 0 ? `${fmtInt(v)} kg vol` : '' })()}</span></div><p className="text-xs text-zinc-400">{e.sets.map((s) => setText(s, x)).join('  ·  ')}</p></div>
        })}
      </Card>
    </div>
  )
}

function Records({ prs, idx }: { prs: PR[]; idx: ReturnType<typeof useExerciseIndex> }) {
  const [type, setType] = useState<string>('all')
  const list = prs.filter((p) => type === 'all' || p.type === type)
  const types = [...new Set(prs.map((p) => p.type))]
  if (!prs.length) return <Empty>Records appear when you beat a previous best. Your first session sets the baseline.</Empty>
  return (
    <div className="space-y-3">
      <Chips value={type} onChange={setType} options={[{ v: 'all', label: 'All' }, ...types.map((t) => ({ v: t as string, label: PR_LABEL[t] }))]} />
      {list.slice(0, 80).map((p) => (
        <Card key={p.id} className="!py-3 flex justify-between items-center gap-3">
          <div className="min-w-0"><p className="text-sm font-medium truncate">🏆 {idx.get(p.exerciseKey).name}</p><p className="text-xs text-zinc-500">{PR_LABEL[p.type]} · {prettyDate(p.date)}{p.weightKg && p.reps ? ` · ${fmtKg(p.weightKg)}×${p.reps}` : ''}</p></div>
          <div className="text-right"><p className="font-semibold tabular-nums">{prValue(p)}</p><p className="text-[11px] text-zinc-500">was {p.type === 'duration' ? fmtDuration(p.previousBest) : p.type === 'reps' || p.type === 'session_reps' ? p.previousBest : fmtKg(Math.round(p.previousBest * 10) / 10)}</p></div>
        </Card>
      ))}
    </div>
  )
}

const blobToUrl = (b: Blob) => new Promise<string>((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result as string); r.onerror = rej; r.readAsDataURL(b) })
const urlToBlob = async (u: string) => (await fetch(u)).blob()

function Data() {
  async function exportAll() {
    const data: Record<string, unknown> = { _app: 'gym-food-tracker', _version: 2, _exported: new Date().toISOString() }
    for (const t of db.tables) data[t.name] = await t.toArray()
    data.photos = await Promise.all((data.photos as PhotoRec[]).map(async (p) => ({ ...p, blob: await blobToUrl(p.blob) })))
    download(`tracker-backup-${todayStr()}.json`, JSON.stringify(data))
  }
  async function importAll(file: File) {
    let d: Record<string, unknown>
    try { d = JSON.parse(await file.text()) } catch { alert('That file is not valid JSON.'); return }
    if (d._app !== 'gym-food-tracker') { alert('This is not a backup from this app.'); return }
    if (!confirm('This replaces everything currently stored on this device. Continue?')) return
    const before: Record<string, unknown[]> = {}
    for (const t of db.tables) before[t.name] = await t.toArray()
    if (Array.isArray(d.photos)) d.photos = await Promise.all((d.photos as { blob: unknown }[]).map(async (p) => ({ ...p, blob: typeof p.blob === 'string' ? await urlToBlob(p.blob) : p.blob })))
    await db.transaction('rw', db.tables, async () => {
      for (const t of db.tables) { await t.clear(); const rows = d[t.name]; if (Array.isArray(rows)) await t.bulkAdd(rows) }
    })
    offerUndo('Backup imported', () => db.transaction('rw', db.tables, async () => {
      for (const t of db.tables) { await t.clear(); await t.bulkAdd(before[t.name]) }
    }))
  }
  async function addNotes(file: File) {
    let d: AddFile
    try { d = JSON.parse(await file.text()) } catch { alert('That file is not valid JSON.'); return }
    if (d._app !== 'gym-food-tracker' || d._kind !== 'additive') { alert('This is not an "add entries" file.'); return }
    const r = await applyAdditive(d)
    const fmt = (m: Record<string, number>) => Object.entries(m).map(([k, v]) => `${v} ${k}`).join(', ') || 'nothing'
    alert(`Added: ${fmt(r.added)}.\nSkipped (already there): ${fmt(r.skipped)}.`)
    offerUndo(d._label ?? 'Entries added', r.undo)
  }
  return (
    <Card className="space-y-2">
      <h3 className="font-semibold">Your data</h3>
      <p className="text-xs text-zinc-500">Everything lives only in this browser on this device. Back it up now and then — clearing site data deletes it. Backups include workouts, food, steps, cardio, body, measurements, custom exercises and your plan.</p>
      <div className="flex gap-2">
        <Btn variant="ghost" className="flex-1" onClick={exportAll}>Export JSON</Btn>
        <label className="flex-1 h-11 rounded-[.875rem] bg-zinc-800 text-sm flex items-center justify-center cursor-pointer">Import JSON
          <input type="file" accept="application/json" className="hidden" onChange={(e) => e.target.files?.[0] && importAll(e.target.files[0])} />
        </label>
      </div>
      <label className="h-11 rounded-[.875rem] bg-zinc-800 text-sm flex items-center justify-center cursor-pointer">Add entries from file (keeps your data)
        <input type="file" accept="application/json" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) addNotes(f) }} />
      </label>
    </Card>
  )
}

export { MUSCLES }
