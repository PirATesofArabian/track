import { useEffect, useMemo, useRef, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, type Routine, type PlanDay, type Workout, type WEx, type WSet, type SetType } from '../lib/db'
import { EQUIPMENT, LIBRARY, MUSCLES, TRACKING_LABEL, cap, type Exercise, type Muscle, type Tracking } from '../data/exerciseDb'
import { Btn, Card, Chips, Empty, Field, NumInput, Sheet, TextInput, Toast, inputCls } from '../lib/ui'
import { deleteWithUndo, offerUndo } from '../lib/undo'
import { useExerciseIndex, useNow, useProfile, useSeedPlan } from '../lib/hooks'
import { RegionsCard } from '../lib/regionsUi'
import { sessionLoad, suggestNext, weeklyRings } from '../lib/science'
import { PR_LABEL, e1rm, finished, prsForWorkout, setVolume, workoutVolume, type ExIndex, type PR } from '../lib/perf'
import { blankSet, fieldsFor, setText } from '../lib/format'
import { fmtDuration, fmtInt, fmtKg, prettyDate, round0, todayStr, WEEKDAYS } from '../lib/util'
import { workoutKcal, workoutMinutes } from '../lib/derived'
import { PLAN_NOTES } from '../lib/plan'
import { warmupLadder } from '../lib/plates'
import { toggleSuperset, supersetLabels } from '../lib/superset'
import { PlateSheet } from '../lib/gymtools'
import { PainSheet } from './PlanView'
import { NowCardView } from './Achievements'
import { listenOnce, matchExercise, parseVoiceSet, speechCtor, speechErrorText } from '../lib/voice'

/** Sets from the last finished session of this exercise (for pre-filling and "last time"). */
async function lastSets(key: string, excludeId?: number): Promise<WSet[]> {
  const all = await db.workouts.orderBy('date').reverse().toArray()
  for (const w of all) {
    if (w.id === excludeId || !w.finishedAt) continue
    const ex = w.exercises.find((e) => e.key === key)
    const done = ex?.sets.filter((s) => s.done && s.setType !== 'warmup')
    if (done?.length) return done
  }
  return []
}

async function buildExercise(x: Exercise, target?: WEx['target'], excludeId?: number, note?: string): Promise<WEx> {
  const prev = await lastSets(x.key, excludeId)
  const n = Math.max(1, target?.sets ?? (prev.length || 3))
  const template = prev.length ? prev : [blankSet()]
  const sets: WSet[] = Array.from({ length: n }, (_, i) => {
    const t = template[Math.min(i, template.length - 1)]
    return { ...blankSet(), weightKg: t.weightKg, reps: t.reps, repsLeft: t.repsLeft, repsRight: t.repsRight, durationSec: t.durationSec, distanceM: t.distanceM }
  })
  return { key: x.key, name: x.name, sets, target, note }
}

export default function WorkoutPage() {
  useSeedPlan()
  const idx = useExerciseIndex()
  // null = none in progress; undefined = still loading
  const active = useLiveQuery(async () => (await db.workouts.filter((w) => !w.finishedAt).first()) ?? null, [])
  const [summaryId, setSummaryId] = useState<number | null>(null)
  const [tab, setTab] = useState<'log' | 'history' | 'plan' | 'exercises'>('log')

  return (
    <div className="space-y-4">
      <Chips value={tab} onChange={setTab} options={[{ v: 'log', label: 'Workout' }, { v: 'history', label: 'History' }, { v: 'plan', label: 'Plan' }, { v: 'exercises', label: 'Exercises' }]} />
      {tab === 'log' && active !== undefined && !summaryId && <NowCardView workoutOpen={!!active} />}
      {tab === 'log' && (active === undefined ? null : active ? <Active w={active as Workout & { id: number }} idx={idx} onDone={setSummaryId} /> : <Start idx={idx} />)}
      {tab === 'history' && <History idx={idx} onOpen={setSummaryId} />}
      {tab === 'plan' && <Plan idx={idx} />}
      {tab === 'exercises' && <Library idx={idx} />}
      {summaryId !== null && <Summary id={summaryId} idx={idx} onClose={() => setSummaryId(null)} />}
    </div>
  )
}

// ───────────── start screen ─────────────
function Start({ idx }: { idx: ExIndex }) {
  const routines = useLiveQuery(() => db.routines.toArray(), []) ?? []
  const all = useLiveQuery(() => db.workouts.toArray(), []) ?? []
  const profile = useProfile()
  const rings = weeklyRings({ ws: all, routines, sessionMinutes: profile.sessionMinutes ?? null, today: todayStr() })
  const recent = useLiveQuery(() => db.workouts.orderBy('date').reverse().filter((w) => !!w.finishedAt).limit(1).toArray(), []) ?? []
  const today = new Date().getDay()

  async function startDay(r: Routine, d: PlanDay) {
    const exercises: WEx[] = []
    for (const p of d.exercises) {
      exercises.push(await buildExercise(idx.get(p.key), { sets: p.sets, repMin: p.repMin, repMax: p.repMax, rir: p.rir, rest: p.rest, cue: p.cue }))
    }
    await db.workouts.add({ date: todayStr(), name: d.name, startedAt: Date.now(), routineId: r.id, dayName: d.name, exercises })
  }
  const todays = routines.flatMap((r) => r.days.filter((d) => d.weekdays.includes(today)).map((d) => ({ r, d })))

  const ring = (label: string, done: number, planned: number | null) => (
    <div className="flex-1 text-center">
      <svg viewBox="0 0 36 36" className="w-14 h-14 mx-auto -rotate-90"><circle cx="18" cy="18" r="15" fill="none" stroke="#27272a" strokeWidth="4" /><circle cx="18" cy="18" r="15" fill="none" stroke="#a3e635" strokeWidth="4" strokeLinecap="round" strokeDasharray={`${planned ? Math.min(1, done / planned) * 94.2 : 0} 94.2`} /></svg>
      <p className="text-sm font-semibold tabular-nums">{done}{planned ? <span className="text-zinc-500">/{planned}</span> : ''}</p>
      <p className="text-[11px] text-zinc-500">{label}</p>
    </div>
  )

  return (
    <div className="space-y-3">
      <Card className="space-y-2">
        <div className="flex justify-between items-baseline"><h3 className="font-semibold">This week</h3><span className="text-xs text-zinc-500">{rings.streak ? `${rings.streak}-week streak` : 'against your plan'}</span></div>
        <div className="flex gap-2">{ring('Sessions', rings.sessions.done, rings.sessions.planned)}{ring('Working sets', rings.sets.done, rings.sets.planned)}{ring('Minutes', rings.minutes.done, rings.minutes.planned)}</div>
      </Card>
      {todays.map(({ r, d }) => (
        <Card key={`${r.id}-${d.name}`} className="space-y-2 border-lime-400/40">
          <p className="text-xs text-lime-400">Today · {WEEKDAYS[today]}</p>
          <h2 className="font-semibold text-lg">{d.name}</h2>
          <p className="text-xs text-zinc-400">{d.focus} · {d.exercises.length} exercises · {d.exercises.reduce((a, e) => a + e.sets, 0)} sets</p>
          <Btn className="w-full" onClick={() => startDay(r, d)}>Start {d.name}</Btn>
        </Card>
      ))}
      <Card className="space-y-2">
        <h3 className="font-semibold">Start something else</h3>
        <Btn variant="ghost" className="w-full" onClick={() => db.workouts.add({ date: todayStr(), name: 'Workout', startedAt: Date.now(), exercises: [] })}>Empty workout</Btn>
        {routines.flatMap((r) => r.days.map((d) => (
          <Btn key={`${r.id}-${d.name}`} variant="ghost" className="w-full !h-auto py-2 text-left" onClick={() => startDay(r, d)}>
            <span className="block">{d.name}</span>
            <span className="text-xs text-zinc-500">{d.weekdays.map((x) => WEEKDAYS[x]).join(', ') || 'any day'} · {d.exercises.length} exercises</span>
          </Btn>
        )))}
        {recent[0] && (
          <Btn variant="ghost" className="w-full !h-auto py-2 text-left" onClick={async () => {
            const w = recent[0]
            const exercises: WEx[] = []
            for (const e of w.exercises) exercises.push(await buildExercise(idx.get(e.key, e.name), { sets: e.sets.length, repMin: 0, repMax: 0 }))
            await db.workouts.add({ date: todayStr(), name: w.name, startedAt: Date.now(), exercises: exercises.map((e) => ({ ...e, target: undefined })) })
          }}>
            <span className="block">Repeat last: {recent[0].name}</span>
            <span className="text-xs text-zinc-500">{prettyDate(recent[0].date)}</span>
          </Btn>
        )}
      </Card>
    </div>
  )
}

// ───────────── active workout ─────────────
function Active({ w, idx, onDone }: { w: Workout & { id: number }; idx: ExIndex; onDone: (id: number) => void }) {
  const [picker, setPicker] = useState(false)
  const [swap, setSwap] = useState<number | null>(null)
  const [rest, setRest] = useState<{ until: number; total: number } | null>(null)
  const [toast, setToast] = useState<string | null>(null)
  const [plates, setPlates] = useState<number | null | undefined>(undefined)
  const [listening, setListening] = useState<string | null>(null)
  const now = useNow(500)
  const profile = useProfile()
  const save = (exercises: WEx[]) => db.workouts.update(w.id, { exercises })
  const keys = w.exercises.map((e) => e.key).join('|')
  const prev = useLiveQuery(async () => {
    const m: Record<string, WSet[]> = {}
    for (const e of w.exercises) m[e.key] = await lastSets(e.key, w.id)
    return m
  }, [keys]) ?? {}
  const elapsed = Math.floor((now - w.startedAt) / 1000)
  const vol = workoutVolume(w, idx)
  const doneSets = w.exercises.reduce((a, e) => a + e.sets.filter((s) => s.done && s.setType !== 'warmup').length, 0)
  const totalSets = w.exercises.reduce((a, e) => a + e.sets.filter((s) => s.setType !== 'warmup').length, 0)

  function patchSet(ei: number, si: number, patch: Partial<WSet>) {
    save(w.exercises.map((e, i) => (i !== ei ? e : { ...e, sets: e.sets.map((s, j) => (j === si ? { ...s, ...patch } : s)) })))
  }
  const ss = supersetLabels(w.exercises)
  function addWarmups(ei: number) {
    const e = w.exercises[ei]
    const top = e.sets.find((s) => s.setType !== 'warmup' && s.weightKg)?.weightKg ?? prev[e.key]?.find((s) => s.weightKg)?.weightKg
    if (!top) { setToast('Enter a working weight first'); return }
    const equip = idx.get(e.key, e.name).equipment
    const ladder = warmupLadder(top, { bar: equip === 'barbell' ? 20 : null, step: 2.5 })
    if (!ladder.length) { setToast('Working weight is too light to need warm-ups'); return }
    const rows: WSet[] = ladder.map((l) => ({ ...blankSet(), setType: 'warmup', weightKg: l.weight, reps: l.reps }))
    save(w.exercises.map((q, i) => (i === ei ? { ...q, sets: [...rows, ...q.sets.filter((s) => s.setType !== 'warmup' || s.done)] } : q)))
  }
  async function voice() {
    if (!speechCtor()) { setToast('Voice input is not supported in this browser'); return }
    setListening('Listening…')
    try {
      const { promise } = listenOnce((t) => setListening(t || 'Listening…'))
      const text = await promise
      const r = parseVoiceSet(text)
      setListening(null)
      if (!r) { setToast(`Did not catch a set in "${text}"`); return }
      const cand = w.exercises.map((e, i) => ({ name: e.name, i }))
      let ei: number
      if (r.kind === 'set' && r.exercise) {
        const m = matchExercise(r.exercise, cand)
        if (!m) { setToast(`No exercise in this workout matches "${r.exercise}"`); return }
        ei = m.i
      } else {
        ei = w.exercises.findIndex((e) => e.sets.some((s) => !s.done && s.setType !== 'warmup'))
        if (ei < 0) ei = w.exercises.length - 1
      }
      if (ei < 0) return
      const e = w.exercises[ei]
      const lastDone = [...e.sets].reverse().find((s) => s.done && s.setType !== 'warmup')
      let weightKg: number | null, reps: number | null, sure: boolean
      if (r.kind === 'same') {
        if (!lastDone) { setToast('Nothing to repeat yet'); return }
        weightKg = lastDone.weightKg; reps = lastDone.reps; sure = true
      } else {
        weightKg = r.weight === null ? lastDone?.weightKg ?? null : r.unit === 'lb' ? Math.round(r.weight * 0.45359237 * 100) / 100 : r.weight
        reps = r.reps ?? lastDone?.reps ?? null
        sure = r.sure
      }
      const at = e.sets.findIndex((s) => !s.done && s.setType !== 'warmup')
      const row: WSet = { ...blankSet(), weightKg, reps, done: sure, doneAt: sure ? Date.now() : undefined }
      const sets = [...e.sets]
      if (at >= 0) sets[at] = { ...sets[at], weightKg, reps, done: sure, doneAt: sure ? Date.now() : undefined }; else sets.push(row)
      save(w.exercises.map((q, i) => (i === ei ? { ...q, sets } : q)))
      setToast(sure ? `Logged ${e.name}: ${weightKg ?? '–'} × ${reps ?? '–'}` : `Filled ${e.name}: ${weightKg ?? '–'} × ${reps ?? '–'} — tap ✓ to confirm`)
      if (sure) { const sec = e.target?.rest ?? (idx.get(e.key, e.name).category === 'compound' ? 120 : 90); if (!ss.get(ei)?.linkedNext) setRest({ until: Date.now() + sec * 1000, total: sec }) }
    } catch (err) {
      setListening(null)
      setToast(speechErrorText((err as Error).message))
    }
  }
  function toggle(ei: number, si: number) {
    const e = w.exercises[ei], s = e.sets[si]
    patchSet(ei, si, { done: !s.done, doneAt: s.done ? undefined : Date.now() })
    if (!s.done && s.setType !== 'warmup' && !ss.get(ei)?.linkedNext) {
      const sec = e.target?.rest ?? (idx.get(e.key, e.name).category === 'compound' ? 120 : 90)
      setRest({ until: Date.now() + sec * 1000, total: sec })
    }
  }

  async function finish() {
    const cleaned = w.exercises.map((e) => ({ ...e, sets: e.sets.filter((s) => s.done) })).filter((e) => e.sets.length)
    if (!cleaned.length) {
      if (confirm('No completed sets. Discard this workout?')) await deleteWithUndo(db.workouts, w.id, 'Workout discarded')
      return
    }
    await db.workouts.update(w.id, { exercises: cleaned, finishedAt: Date.now() })
    onDone(w.id)
  }

  const remaining = rest ? Math.max(0, Math.ceil((rest.until - now) / 1000)) : 0
  useEffect(() => { if (rest && remaining === 0) { navigator.vibrate?.([200, 100, 200]); const t = setTimeout(() => setRest(null), 4000); return () => clearTimeout(t) } }, [rest, remaining])

  return (
    <div className="space-y-3 pb-16">
      <div className="flex items-center gap-2">
        <TextInput value={w.name} onCommit={(v) => db.workouts.update(w.id, { name: v })} />
        <div className="text-right text-xs text-zinc-400 whitespace-nowrap tabular-nums">{fmtDuration(elapsed)}<br />{fmtInt(vol)} kg</div>
      </div>
      <div className="flex items-center justify-between">
        <p className="text-xs text-zinc-500">{doneSets}/{totalSets} sets done</p>
        <div className="flex gap-1.5">
          <button className="h-8 px-3 rounded-full bg-zinc-800 text-xs text-zinc-300" onClick={() => setPlates(null)}>🧮 Plates</button>
          <button className={`h-8 px-3 rounded-full text-xs ${listening ? 'bg-red-500/30 text-red-300' : 'bg-zinc-800 text-zinc-300'}`} onClick={voice} disabled={!!listening}>🎙️ Say a set</button>
        </div>
      </div>
      {listening && <p className="text-xs text-red-300">{listening}</p>}

      {w.exercises.map((e, ei) => (
        <ExCard key={`${e.key}-${ei}`} experience={profile.experience} e={e} x={idx.get(e.key, e.name)} prev={prev[e.key] ?? []}
          ss={ss.get(ei)} canLink={ei < w.exercises.length - 1}
          onSuperset={() => save(toggleSuperset(w.exercises, ei))} onWarmups={() => addWarmups(ei)}
          onPlates={(wt) => setPlates(wt)}
          onPatch={(si, p) => patchSet(ei, si, p)} onToggle={(si) => toggle(ei, si)}
          onNote={(note) => save(w.exercises.map((q, i) => (i === ei ? { ...q, note } : q)))}
          onAddSet={(type) => save(w.exercises.map((q, i) => {
            if (i !== ei) return q
            const last = [...q.sets].reverse().find((s) => s.setType === 'working') ?? q.sets[q.sets.length - 1]
            const ns: WSet = { ...blankSet(), setType: type, weightKg: type === 'warmup' ? null : last?.weightKg ?? null, reps: last?.reps ?? null, repsLeft: last?.repsLeft, repsRight: last?.repsRight, durationSec: last?.durationSec ?? null, distanceM: last?.distanceM ?? null }
            if (type === 'warmup') { const at = q.sets.findIndex((s) => s.setType !== 'warmup'); const sets = [...q.sets]; sets.splice(at < 0 ? sets.length : at, 0, ns); return { ...q, sets } }
            return { ...q, sets: [...q.sets, ns] }
          }))}
          onRemoveSet={(si) => {
            const gone = w.exercises[ei].sets[si]
            save(w.exercises.map((q, i) => (i === ei ? { ...q, sets: q.sets.filter((_, j) => j !== si) } : q)))
            offerUndo('Set removed', async () => {
              const cur = await db.workouts.get(w.id)
              if (!cur?.exercises[ei]) return
              await db.workouts.update(w.id, { exercises: cur.exercises.map((q, i) => { if (i !== ei) return q; const sets = [...q.sets]; sets.splice(Math.min(si, sets.length), 0, gone); return { ...q, sets } }) })
            })
          }}
          onRemove={() => {
            const gone = w.exercises[ei]
            save(w.exercises.filter((_, i) => i !== ei))
            offerUndo(`${gone.name} removed`, async () => {
              const cur = await db.workouts.get(w.id)
              if (!cur) return
              const exercises = [...cur.exercises]; exercises.splice(Math.min(ei, exercises.length), 0, gone)
              await db.workouts.update(w.id, { exercises })
            })
          }}
          onSwap={() => setSwap(ei)}
        />
      ))}
      {!w.exercises.length && <Empty>Add your first exercise.</Empty>}

      <Btn variant="ghost" className="w-full" onClick={() => setPicker(true)}>+ Add exercise</Btn>
      <div className="flex gap-2">
        <Btn className="flex-1" onClick={finish}>Finish workout</Btn>
        <Btn variant="danger" onClick={() => confirm('Discard this workout?') && deleteWithUndo(db.workouts, w.id, 'Workout discarded')}>Discard</Btn>
      </div>

      <ExercisePicker open={picker} onClose={() => setPicker(false)} idx={idx} onPick={async (x) => { setPicker(false); save([...w.exercises, await buildExercise(x, undefined, w.id)]) }} />
      <ExercisePicker open={swap !== null} onClose={() => setSwap(null)} idx={idx} title="Swap exercise" muscle={swap !== null ? idx.get(w.exercises[swap].key, w.exercises[swap].name).primary : undefined}
        onPick={async (x) => {
          if (swap === null) return
          const old = w.exercises[swap]
          const ne = await buildExercise(x, old.target, w.id, old.note)
          save(w.exercises.map((q, i) => (i === swap ? ne : q)))
          setSwap(null)
        }} />

      {rest && (
        <div className="fixed bottom-20 inset-x-0 z-40 px-4">
          <div className="mx-auto max-w-md rounded-2xl bg-zinc-800 border border-zinc-700 p-3 shadow-xl">
            <div className="flex items-center justify-between text-sm">
              <span className="text-zinc-400">{remaining ? 'Rest' : 'Go!'}</span>
              <span className={`text-2xl font-bold tabular-nums ${remaining ? '' : 'text-lime-400'}`}>{fmtDuration(remaining)}</span>
              <div className="flex gap-1">
                <button className="h-9 px-3 rounded-xl bg-zinc-700 text-xs" onClick={() => setRest({ ...rest, until: rest.until - 15000 })}>−15</button>
                <button className="h-9 px-3 rounded-xl bg-zinc-700 text-xs" onClick={() => setRest({ ...rest, until: rest.until + 15000 })}>+15</button>
                <button className="h-9 px-3 rounded-xl bg-zinc-700 text-xs" onClick={() => setRest(null)}>Skip</button>
              </div>
            </div>
            <div className="mt-2 flex gap-1">
              {[60, 90, 120, 180].map((s) => <button key={s} className={`h-8 flex-1 rounded-xl text-xs ${rest.total === s ? 'bg-lime-400/30 text-lime-300' : 'bg-zinc-700'}`} onClick={() => setRest({ until: Date.now() + s * 1000, total: s })}>{s} s</button>)}
            </div>
            <div className="mt-2 h-1.5 rounded-full bg-zinc-700 overflow-hidden"><div className="h-full bg-lime-400" style={{ width: `${rest.total ? Math.max(0, Math.min(100, (remaining / rest.total) * 100)) : 0}%` }} /></div>
          </div>
        </div>
      )}
      <PlateSheet key={String(plates)} open={plates !== undefined} onClose={() => setPlates(undefined)} initial={plates ?? null} />
      <Toast msg={toast} onDone={() => setToast(null)} />
    </div>
  )
}

function ExCard({ experience, e, x, prev, ss, canLink, onSuperset, onWarmups, onPlates, onPatch, onToggle, onAddSet, onRemoveSet, onRemove, onSwap, onNote }: {
  experience: string; e: WEx; x: Exercise; prev: WSet[]
  ss?: { label: string; linkedNext: boolean; linkedPrev: boolean }; canLink: boolean
  onSuperset: () => void; onWarmups: () => void; onPlates: (w: number | null) => void
  onPatch: (si: number, p: Partial<WSet>) => void; onToggle: (si: number) => void; onAddSet: (t: SetType) => void
  onRemoveSet: (si: number) => void; onRemove: () => void; onSwap: () => void; onNote: (n: string) => void
}) {
  const fields = fieldsFor(x)
  const [menu, setMenu] = useState(false)
  const [hurt, setHurt] = useState(false)
  const [showNote, setShowNote] = useState(!!e.note)
  const t = e.target
  const cols = `1.75rem repeat(${fields.length}, minmax(0,1fr)) 2.75rem`
  const lastTop = prev.length ? prev.reduce((a, s) => ((s.weightKg ?? 0) > (a.weightKg ?? 0) ? s : a), prev[0]) : null
  // double-progression hint: if every previous set reached the top of the range, suggest more load
  const hint = suggestNext(prev, t, x, experience)?.text ?? null
  let wn = 0

  return (
    <Card className="space-y-2">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          {ss && <p className="text-[11px] font-semibold text-sky-400">Superset {ss.label}{ss.linkedNext ? ' · no rest before the next exercise' : ' · rest after this one'}</p>}
          <h3 className="font-semibold leading-tight">{e.name}</h3>
          <p className="text-[11px] text-zinc-500">
            {cap(x.primary)}{x.secondary.length ? ` + ${x.secondary.join(', ')}` : ''} · {x.equipment}
            {t && t.repMax ? ` · ${t.sets}×${t.repMin}–${t.repMax}${t.rir ? ` @${t.rir} RIR` : ''}` : ''}
          </p>
        </div>
        <div className="relative">
          <button className="h-8 w-8 text-zinc-400" onClick={() => setMenu(!menu)}>⋯</button>
          {menu && (
            <div className="absolute right-0 z-10 w-48 rounded-xl bg-zinc-800 border border-zinc-700 text-sm shadow-xl" onClick={() => setMenu(false)}>
              <button className="w-full text-left px-3 py-2.5" onClick={onSwap}>Swap exercise</button>
              {x.tracking === 'weight_reps' && <button className="w-full text-left px-3 py-2.5" onClick={onWarmups}>Auto warm-up sets</button>}
              {x.equipment === 'barbell' && <button className="w-full text-left px-3 py-2.5" onClick={() => onPlates(e.sets.find((s) => s.setType !== 'warmup' && s.weightKg)?.weightKg ?? null)}>Plate calculator</button>}
              {(canLink || ss?.linkedNext) && <button className="w-full text-left px-3 py-2.5" onClick={onSuperset}>{ss?.linkedNext ? 'Unlink from next' : 'Superset with next'}</button>}
              <button className="w-full text-left px-3 py-2.5" onClick={() => setShowNote(true)}>Add note</button>
              <button className="w-full text-left px-3 py-2.5" onClick={() => setHurt(true)}>Something hurts</button>
              <button className="w-full text-left px-3 py-2.5 text-red-400" onClick={onRemove}>Remove</button>
            </div>
          )}
        </div>
      </div>
      {t?.cue && <p className="text-xs text-amber-300/80">{t.cue}</p>}
      {prev.length > 0 && <p className="text-xs text-zinc-500">Last time: {prev.map((s) => setText(s, x)).join('  ·  ')}</p>}
      {hint && <p className="text-xs text-lime-400/80">{hint}</p>}
      {showNote && <input className={inputCls} placeholder="Note (machine setting, pain, tempo…)" defaultValue={e.note ?? ''} onBlur={(ev) => onNote(ev.target.value)} />}

      <div className="grid gap-1.5 text-[11px] text-zinc-500 px-0.5" style={{ gridTemplateColumns: cols }}>
        <span>Set</span>{fields.map((f) => <span key={f.id}>{f.label}</span>)}<span />
      </div>
      {e.sets.map((s, si) => {
        const warm = s.setType === 'warmup'
        if (!warm) wn++
        return (
          <div key={si} className="grid gap-1.5 items-center" style={{ gridTemplateColumns: cols }}>
            <button className={`text-sm text-left pl-0.5 ${warm ? 'text-amber-400' : 'text-zinc-400'}`} title="Tap to change set type" onClick={() => {
              const order: SetType[] = ['working', 'warmup', 'backoff', 'drop']
              onPatch(si, { setType: order[(order.indexOf(s.setType) + 1) % order.length] })
            }}>{warm ? 'W' : s.setType === 'drop' ? 'D' : s.setType === 'backoff' ? 'B' : wn}</button>
            {fields.map((f) => (
              <NumInput key={f.id} step={f.step} value={f.get(s)} placeholder={f.id === 'w' && lastTop ? fmtKg(lastTop.weightKg ?? 0) : f.id === 'r' && t?.repMin ? `${t.repMin}-${t.repMax}` : '0'}
                className={`!px-2 text-center ${s.done ? 'opacity-60' : ''}`} onChange={(v) => onPatch(si, f.set(s, v))} />
            ))}
            <button onClick={() => onToggle(si)} onContextMenu={(ev) => { ev.preventDefault(); onRemoveSet(si) }}
              className={`h-11 rounded-[.875rem] text-lg ${s.done ? 'bg-lime-400 text-black' : 'bg-zinc-800 text-zinc-500'}`}>✓</button>
          </div>
        )
      })}
      <div className="flex gap-2">
        <Btn variant="ghost" className="flex-1 h-9" onClick={() => onAddSet('working')}>+ Set</Btn>
        {x.tracking === 'weight_reps' && <Btn variant="ghost" className="h-9" onClick={() => onAddSet('warmup')}>+ Warm-up</Btn>}
        {e.sets.length > 1 && <Btn variant="ghost" className="h-9" onClick={() => onRemoveSet(e.sets.length - 1)}>− Set</Btn>}
      </div>
      <PainSheet open={hurt} onClose={() => setHurt(false)} exerciseKey={e.key} />
    </Card>
  )
}

// ───────────── exercise picker / library ─────────────
export function ExercisePicker({ open, onClose, onPick, idx, title = 'Pick exercise', muscle }: {
  open: boolean; onClose: () => void; onPick: (x: Exercise) => void; idx: ExIndex; title?: string; muscle?: Muscle
}) {
  const [q, setQ] = useState('')
  const [m, setM] = useState<Muscle | 'all'>(muscle ?? 'all')
  const [creating, setCreating] = useState(false)
  useEffect(() => { if (open) { setM(muscle ?? 'all'); setQ('') } }, [open, muscle])
  const list = useMemo(() => idx.all.filter((e) => (m === 'all' || e.primary === m) && e.name.toLowerCase().includes(q.toLowerCase())), [idx, m, q])
  return (
    <Sheet open={open} onClose={onClose} title={creating ? 'New custom exercise' : title}>
      {creating ? <CustomExerciseForm initialName={q} onDone={(x) => { setCreating(false); if (x) onPick(x) }} /> : (
        <>
          <input autoFocus className={inputCls} placeholder="Search…" value={q} onChange={(e) => setQ(e.target.value)} />
          <Chips className="py-3" value={m} onChange={setM} options={[{ v: 'all', label: 'All' }, ...MUSCLES.map((k) => ({ v: k, label: cap(k) }))]} />
          <Btn variant="ghost" className="w-full mb-2" onClick={() => setCreating(true)}>+ Custom exercise{q.trim() ? ` “${q.trim()}”` : ''}</Btn>
          {list.map((e) => (
            <button key={e.key} onClick={() => onPick(e)} className="w-full text-left py-2.5 border-b border-zinc-800 flex justify-between gap-3">
              <span><span className="block text-sm">{e.name}{e.custom ? ' ★' : ''}</span><span className="text-xs text-zinc-500">{e.equipment} · {TRACKING_LABEL[e.tracking]}</span></span>
              <span className="text-xs text-zinc-500 whitespace-nowrap">{cap(e.primary)}</span>
            </button>
          ))}
          {!list.length && <Empty>No match — create it as a custom exercise.</Empty>}
        </>
      )}
    </Sheet>
  )
}

export function CustomExerciseForm({ initialName = '', onDone, existing }: { initialName?: string; onDone: (x?: Exercise) => void; existing?: Exercise & { id?: number } }) {
  const [f, setF] = useState({
    name: existing?.name ?? initialName, primary: (existing?.primary ?? 'chest') as Muscle, secondary: (existing?.secondary ?? []) as Muscle[],
    equipment: existing?.equipment ?? 'dumbbell', category: (existing?.category ?? 'compound') as 'compound' | 'isolation',
    tracking: (existing?.tracking ?? 'weight_reps') as Tracking, loadMode: (existing?.loadMode ?? 'total') as 'total' | 'per_hand', eachSide: existing?.eachSide ?? false, instructions: existing?.instructions ?? '',
  })
  const id = existing && existing.key.startsWith('custom:') ? +existing.key.slice(7) : undefined
  const dup = LIBRARY.some((e) => e.name.toLowerCase() === f.name.trim().toLowerCase())
  return (
    <div className="space-y-3">
      <input className={inputCls} placeholder="Name" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
      {dup && <p className="text-xs text-red-400">That name is already in the library.</p>}
      <Field label="Primary muscle"><Chips value={f.primary} onChange={(v) => setF({ ...f, primary: v })} options={MUSCLES.map((k) => ({ v: k, label: cap(k) }))} /></Field>
      <Field label="Also works (secondary)">
        <div className="flex flex-wrap gap-1.5">
          {MUSCLES.filter((k) => k !== f.primary).map((k) => (
            <button key={k} onClick={() => setF({ ...f, secondary: f.secondary.includes(k) ? f.secondary.filter((z) => z !== k) : [...f.secondary, k] })}
              className={`px-2.5 h-7 rounded-full text-xs ${f.secondary.includes(k) ? 'bg-lime-400 text-black' : 'bg-zinc-800 text-zinc-300'}`}>{cap(k)}</button>
          ))}
        </div>
      </Field>
      <Field label="How is it tracked?">
        <select className={inputCls} value={f.tracking} onChange={(e) => setF({ ...f, tracking: e.target.value as Tracking })}>
          {(Object.keys(TRACKING_LABEL) as Tracking[]).map((t) => <option key={t} value={t}>{TRACKING_LABEL[t]}</option>)}
        </select>
      </Field>
      <div className="grid grid-cols-2 gap-2">
        <Field label="Equipment"><select className={inputCls} value={f.equipment} onChange={(e) => setF({ ...f, equipment: e.target.value })}>{EQUIPMENT.map((q) => <option key={q}>{q}</option>)}</select></Field>
        <Field label="Type"><select className={inputCls} value={f.category} onChange={(e) => setF({ ...f, category: e.target.value as 'compound' | 'isolation' })}><option>compound</option><option>isolation</option></select></Field>
      </div>
      {f.tracking === 'weight_reps' && (
        <Field label="Weight entered is"><Chips value={f.loadMode} onChange={(v) => setF({ ...f, loadMode: v })} options={[{ v: 'total', label: 'Total load' }, { v: 'per_hand', label: 'Per hand (×2 volume)' }]} /></Field>
      )}
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={f.eachSide} onChange={(e) => setF({ ...f, eachSide: e.target.checked })} /> One side at a time (log left / right reps)</label>
      <div className="flex gap-2">
        <Btn className="flex-1" disabled={!f.name.trim() || (dup && !existing)} onClick={async () => {
          const rec = { ...f, name: f.name.trim(), secondary: f.secondary.filter((k) => k !== f.primary) }
          const nid = id ?? ((await db.customExercises.add(rec)) as number)
          if (id) await db.customExercises.update(id, rec)
          onDone({ ...rec, key: `custom:${nid}`, custom: true })
        }}>Save</Btn>
        <Btn variant="ghost" onClick={() => onDone()}>Cancel</Btn>
      </div>
    </div>
  )
}

function Library({ idx }: { idx: ExIndex }) {
  const [q, setQ] = useState('')
  const [m, setM] = useState<Muscle | 'all'>('all')
  const [open, setOpen] = useState<Exercise | null>(null)
  const [creating, setCreating] = useState<Exercise | 'new' | null>(null)
  const list = idx.all.filter((e) => (m === 'all' || e.primary === m) && e.name.toLowerCase().includes(q.toLowerCase()))
  const workouts = useLiveQuery(() => db.workouts.toArray(), []) ?? []
  const used = (key: string) => workouts.some((w) => w.exercises.some((e) => e.key === key))
  return (
    <div className="space-y-3">
      <input className={inputCls} placeholder={`Search ${idx.all.length} exercises…`} value={q} onChange={(e) => setQ(e.target.value)} />
      <Chips value={m} onChange={setM} options={[{ v: 'all', label: 'All' }, ...MUSCLES.map((k) => ({ v: k, label: cap(k) }))]} />
      <Btn variant="ghost" className="w-full" onClick={() => setCreating('new')}>+ Custom exercise</Btn>
      <Card className="!p-0 divide-y divide-zinc-800">
        {list.map((e) => (
          <button key={e.key} className="w-full text-left px-4 py-3 flex justify-between gap-3" onClick={() => setOpen(e)}>
            <span><span className="block text-sm">{e.name}{e.custom ? ' ★' : ''}</span><span className="text-xs text-zinc-500">{e.equipment} · {e.category}{e.secondary.length ? ` · +${e.secondary.join(', ')}` : ''}</span></span>
            <span className="text-xs text-zinc-500">{cap(e.primary)}</span>
          </button>
        ))}
      </Card>
      <Sheet open={!!open} onClose={() => setOpen(null)} title={open?.name ?? ''}>
        {open && (
          <div className="space-y-3 text-sm">
            <p className="text-zinc-400">{cap(open.primary)}{open.secondary.length ? ` · also ${open.secondary.join(', ')}` : ''} · {open.equipment} · {open.category}</p>
            <p className="text-zinc-400">Tracked as: {TRACKING_LABEL[open.tracking]}{open.loadMode === 'per_hand' ? ' (per hand)' : ''}{open.eachSide ? ' · each side' : ''}</p>
            {open.instructions && <p>{open.instructions}</p>}
            <RegionsCard exKey={open.key} />
            {open.custom && (
              <div className="flex gap-2">
                <Btn variant="ghost" className="flex-1" onClick={() => { setCreating(open); setOpen(null) }}>Edit</Btn>
                <Btn variant="danger" disabled={used(open.key)} onClick={async () => { const name = open.name; await deleteWithUndo(db.customExercises, +open.key.slice(7), `Deleted ${name}`); setOpen(null) }}>{used(open.key) ? 'In use' : 'Delete'}</Btn>
              </div>
            )}
          </div>
        )}
      </Sheet>
      <Sheet open={creating !== null} onClose={() => setCreating(null)} title={creating === 'new' ? 'New custom exercise' : 'Edit exercise'}>
        {creating !== null && <CustomExerciseForm existing={creating === 'new' ? undefined : creating} onDone={() => setCreating(null)} />}
      </Sheet>
    </div>
  )
}

// ───────────── plan ─────────────
function Plan({ idx }: { idx: ExIndex }) {
  const routines = useLiveQuery(() => db.routines.toArray(), []) ?? []
  const [open, setOpen] = useState<string | null>(null)
  return (
    <div className="space-y-3">
      {routines.map((r) => (
        <Card key={r.id} className="space-y-2">
          <div className="flex justify-between items-start gap-2">
            <h3 className="font-semibold">{r.name}</h3>
            <button className="text-xs text-red-400 h-8" onClick={() => confirm(`Delete “${r.name}”?`) && deleteWithUndo(db.routines, r.id!, `Deleted plan “${r.name}”`)}>Delete</button>
          </div>
          {r.description && <p className="text-xs text-zinc-400">{r.description}</p>}
          {r.days.map((d, di) => {
            const k = `${r.id}-${di}`
            return (
              <div key={k} className="rounded-xl bg-zinc-800/60">
                <button className="w-full flex justify-between items-center px-3 py-2.5 text-left" onClick={() => setOpen(open === k ? null : k)}>
                  <span><span className="font-medium text-sm">{d.name}</span><span className="block text-xs text-zinc-500">{d.weekdays.map((x) => WEEKDAYS[x]).join(', ')} · {d.focus}</span></span>
                  <span className="text-zinc-500">{open === k ? '–' : '+'}</span>
                </button>
                {open === k && (
                  <div className="px-3 pb-3 space-y-1.5">
                    {d.exercises.map((p, i) => (
                      <div key={i} className="text-sm flex justify-between gap-2">
                        <span>{idx.get(p.key).name}</span>
                        <span className="text-zinc-500 whitespace-nowrap">{p.sets}×{p.repMin}–{p.repMax}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )
          })}
        </Card>
      ))}
      {!routines.length && <Empty>No plan. You can import one by restoring a backup.</Empty>}
      <Card className="space-y-1.5">
        <h3 className="font-semibold text-sm">Notes from your PDF</h3>
        {PLAN_NOTES.map((n, i) => <p key={i} className="text-xs text-zinc-400">• {n}</p>)}
      </Card>
    </div>
  )
}

// ───────────── history & summary ─────────────
function History({ idx, onOpen }: { idx: ExIndex; onOpen: (id: number) => void }) {
  const all = useLiveQuery(() => db.workouts.toArray(), []) ?? []
  const items = finished(all).reverse()
  const weights = useLiveQuery(() => db.bodyWeight.toArray(), []) ?? []
  if (!items.length) return <Empty>No finished workouts yet.</Empty>
  return (
    <div className="space-y-3">
      {items.map((w) => {
        const k = workoutKcal(w, weights)
        return (
          <button key={w.id} className="w-full text-left" onClick={() => onOpen(w.id)}>
            <Card className="space-y-1">
              <div className="flex justify-between"><h3 className="font-semibold">{w.name}</h3><span className="text-xs text-zinc-500">{prettyDate(w.date)}</span></div>
              <p className="text-xs text-zinc-500">{workoutMinutes(w)} min · {fmtInt(workoutVolume(w, idx))} kg{k ? ` · ${k.estimated ? '~' : ''}${k.kcal} kcal` : ''} · {w.exercises.reduce((a, e) => a + e.sets.length, 0)} sets</p>
              <p className="text-xs text-zinc-400 line-clamp-2">{w.exercises.map((e) => e.name).join(', ')}</p>
            </Card>
          </button>
        )
      })}
    </div>
  )
}

function Summary({ id, idx, onClose }: { id: number; idx: ExIndex; onClose: () => void }) {
  const all = useLiveQuery(() => db.workouts.toArray(), [])
  const weights = useLiveQuery(() => db.bodyWeight.toArray(), []) ?? []
  const w = all?.find((x) => x.id === id)
  const prs: PR[] = useMemo(() => (all ? prsForWorkout(all, id, idx) : []), [all, id, idx])
  const confirmed = useRef(false)
  if (!w) return null
  const k = workoutKcal(w, weights)
  return (
    <Sheet open onClose={onClose} title={w.name}>
      <div className="space-y-3">
        <p className="text-xs text-zinc-500">{prettyDate(w.date)} · {workoutMinutes(w)} min{workoutVolume(w, idx) > 0 ? ` · ${fmtInt(workoutVolume(w, idx))} kg total` : ''}{k ? ` · ${k.estimated ? '~' : ''}${k.kcal} kcal` : ''}</p>
        {prs.length > 0 && (
          <div className="rounded-2xl border border-yellow-400/40 bg-yellow-400/10 p-3 space-y-1">
            <p className="text-sm font-semibold text-yellow-300">🏆 {prs.length} new record{prs.length > 1 ? 's' : ''}</p>
            {prs.map((p) => (
              <p key={p.id} className="text-sm">{idx.get(p.exerciseKey).name} — <span className="text-zinc-300">{PR_LABEL[p.type]}</span>{' '}
                <b>{p.type === 'reps' || p.type === 'session_reps' ? `${p.value} reps` : p.type === 'duration' ? fmtDuration(p.value) : p.type === 'distance' ? `${Math.round(p.value)} m` : `${fmtKg(Math.round(p.value * 10) / 10)} kg`}</b>
                <span className="text-zinc-500"> (was {p.type === 'duration' ? fmtDuration(p.previousBest) : fmtKg(Math.round(p.previousBest * 10) / 10)})</span></p>
            ))}
          </div>
        )}
        {w.exercises.map((e, i) => {
          const x = idx.get(e.key, e.name)
          const best = Math.max(0, ...e.sets.map((s) => (x.tracking === 'weight_reps' ? e1rm(s.weightKg, s.reps, s.rir) ?? 0 : 0)))
          return (
            <div key={i} className="text-sm">
              <div className="flex justify-between"><span>{e.name}</span>{best > 0 && <span className="text-xs text-zinc-500">e1RM {round0(best)} kg</span>}</div>
              <p className="text-xs text-zinc-400">{e.sets.map((s) => setText(s, x)).join('  ·  ')}</p>
              {e.note && <p className="text-xs text-amber-300/70">{e.note}</p>}
            </div>
          )
        })}
        <div className="space-y-2 pt-2 border-t border-zinc-800">
          <Field label="Session effort (RPE 1–10)" hint={sessionLoad(w) ? `Session load ${sessionLoad(w)} = effort × minutes (Foster)` : undefined}><NumInput value={w.sessionRpe} onChange={(v) => db.workouts.update(id, { sessionRpe: v })} /></Field>
          <Field label="Calories burned (optional — from a watch)" hint={k?.estimated ? `Estimate: ${k.basis}` : undefined}><NumInput value={w.kcalBurned} onChange={(v) => db.workouts.update(id, { kcalBurned: v })} /></Field>
          <Field label="Notes"><TextInput value={w.notes ?? ''} onCommit={(v) => db.workouts.update(id, { notes: v })} placeholder="How did it go?" /></Field>
        </div>
        <div className="flex gap-2">
          <Btn className="flex-1" onClick={onClose}>Done</Btn>
          <Btn variant="danger" onClick={() => { if (!confirmed.current && confirm('Delete this workout?')) { confirmed.current = true; deleteWithUndo(db.workouts, id, 'Workout deleted'); onClose() } }}>Delete</Btn>
        </div>
      </div>
    </Sheet>
  )
}

export { setVolume }
