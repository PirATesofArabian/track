import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, type EventKind, type PainArea, type PainRec } from '../lib/db'
import { useExerciseIndex, useSettings } from '../lib/hooks'
import { Btn, Card, Chips, Empty, Field, Sheet, TextInput, inputCls } from '../lib/ui'
import { EVENT_KINDS, EVENT_NAME, PAIN_AREAS, PAIN_NAME, RED_FLAGS, MAX_EVENT_DAYS, type Change } from '../lib/adaptive'
import { PlanError, addEvent, addPain, addMemory, applyDecision, editMemory, keepDecision, looksLikeMemory, useAdaptive } from '../lib/adaptiveStore'
import { deleteWithUndo, offerUndo } from '../lib/undo'
import { WhatIfButton } from './WhatIf'
import { prettyDate, shiftDate, todayStr } from '../lib/util'

export function PlanView() {
  const a = useAdaptive()
  const idx = useExerciseIndex()
  const settings = useSettings()
  const [picked, setPicked] = useState<Set<string> | null>(null)
  const [busy, setBusy] = useState(false)
  const [sheet, setSheet] = useState<'event' | 'pain' | null>(null)
  const memories = useLiveQuery(() => db.memories.toArray(), []) ?? []
  const [note, setNote] = useState('')
  const [err, setErr] = useState('')

  if (!a) return <Empty>Loading…</Empty>
  const d = a.decision
  const sel = picked ?? new Set(d?.changes.map((c) => c.id) ?? [])
  const toggle = (id: string) => { const s = new Set(sel); s.has(id) ? s.delete(id) : s.add(id); setPicked(s) }
  const settled = !!a.record

  async function apply() {
    if (!d) return
    setBusy(true)
    const before = { routines: await db.routines.toArray(), settings: await db.settings.get(1), kv: await db.kv.toArray(), pain: await db.pain.toArray() }
    try {
      const res = await applyDecision(d, idx, { accept: [...sel] })
      offerUndo(`Applied ${res.applied.length} change${res.applied.length === 1 ? '' : 's'}`, async () => {
        await db.transaction('rw', [db.routines, db.settings, db.kv, db.pain], async () => {
          await db.routines.clear(); await db.routines.bulkAdd(before.routines)
          await db.settings.clear(); if (before.settings) await db.settings.put(before.settings)
          await db.kv.clear(); await db.kv.bulkAdd(before.kv)
          await db.pain.clear(); await db.pain.bulkAdd(before.pain)
        })
      })
      setPicked(null)
    } finally { setBusy(false) }
  }

  async function saveNote() {
    setErr('')
    try { await addMemory(note); setNote('') } catch (e) { setErr(e instanceof PlanError ? e.message : 'Could not save.') }
  }

  return (
    <div className="space-y-4">
      <Card className="space-y-3">
        <div className="flex items-start justify-between gap-2">
          <div>
            <h3 className="font-semibold">Plan for the week of {prettyDate(a.nextWeekStart, { day: 'numeric', month: 'short' })}</h3>
            <p className="text-xs text-zinc-500">Review opens Sunday 6 pm. {a.model.stage.learning ? `Learning your patterns: week ${Math.max(1, a.model.stage.week)} of ${a.model.stage.of}.` : 'Using your own logs.'}</p>
          </div>
        </div>
        {a.model.maintenance && (
          <p className="text-xs text-zinc-300">Maintenance estimate <b>{Math.round(a.model.maintenance.value / 10) * 10} kcal</b>{a.model.maintenance.own !== null ? ` (your logs ${Math.round(a.model.maintenance.own)}, research ${a.model.maintenance.research !== null ? Math.round(a.model.maintenance.research) : '–'})` : ' (research estimate; your own needs 3 good weeks)'}.</p>
        )}
        {!a.hasRoutine && <Empty>No plan to adjust. Restore a backup or add a plan first.</Empty>}
        {d && d.warnings.map((w) => <p key={w.area} className="text-xs rounded-lg bg-red-500/10 text-red-300 p-2.5">{w.text}</p>)}
        {settled && <p className="text-xs rounded-lg bg-lime-400/10 text-lime-300 p-2.5">{a.record!.outcome === 'applied' ? 'You applied this week’s changes.' : 'You kept the plan as it is this week.'}</p>}
        {d && !settled && d.changes.length === 0 && <p className="text-sm text-zinc-300">No changes this week. {d.holds[0]?.reason}</p>}
        {d && !settled && d.changes.map((c) => <ChangeRow key={c.id} c={c} on={sel.has(c.id)} toggle={() => toggle(c.id)} />)}
        {d && !settled && d.holds.slice(d.changes.length === 0 ? 1 : 0).map((h, i) => <p key={i} className="text-xs text-zinc-500">{h.reason}</p>)}
        {d && d.notes.map((n, i) => <p key={i} className="text-xs text-zinc-500">{n}</p>)}
        {d && !settled && (
          <div className="flex gap-2">
            <Btn className="flex-1" disabled={busy || sel.size === 0} onClick={apply}>Apply {sel.size || ''}</Btn>
            <Btn variant="ghost" className="flex-1" disabled={busy} onClick={() => keepDecision(d)}>Keep my plan</Btn>
          </div>
        )}
        <p className="text-[11px] text-zinc-600">Targets now: {settings.kcal} kcal · {settings.p} g protein. Changes edit your plan and targets directly; Undo restores them.</p>
      </Card>

      {a.temps.length > 0 && (
        <Card className="space-y-1.5">
          <h3 className="font-semibold">Temporary changes</h3>
          {a.temps.map((t) => <p key={t.id} className="text-sm">{t.label}<span className="text-xs text-zinc-500"> · until {prettyDate(t.until, { day: 'numeric', month: 'short' })}</span></p>)}
          <p className="text-[11px] text-zinc-500">They restore automatically from the next review.</p>
        </Card>
      )}

      <Card className="space-y-2">
        <div className="flex items-center justify-between"><h3 className="font-semibold">Coming up</h3><Btn variant="ghost" className="!h-9" onClick={() => setSheet('event')}>Add</Btn></div>
        {a.events.length === 0 && <p className="text-xs text-zinc-500">Exams, travel, a wedding, a festival, vrat, Ramzan or being unwell. The plan eases off and returns afterwards.</p>}
        {a.events.map((e) => (
          <div key={e.id} className="flex items-center justify-between text-sm"><span>{EVENT_NAME[e.kind]} <span className="text-xs text-zinc-500">· {prettyDate(e.start, { day: 'numeric', month: 'short' })}{e.start !== e.end ? ` – ${prettyDate(e.end, { day: 'numeric', month: 'short' })}` : ''}</span></span><button className="text-xs text-red-400 h-8" onClick={() => deleteWithUndo(db.events, e.id!, 'Event removed')}>Remove</button></div>
        ))}
      </Card>

      <Card className="space-y-2">
        <div className="flex items-center justify-between"><h3 className="font-semibold">Something hurts</h3><Btn variant="ghost" className="!h-9" onClick={() => setSheet('pain')}>Report</Btn></div>
        <PainList />
      </Card>

      <Card className="space-y-2">
        <h3 className="font-semibold">Things to remember about you</h3>
        <p className="text-xs text-zinc-500">Short notes such as “I train at 6 am” or “my left knee clicks”. They are kept on this device and shown in your plan context. Up to 40, 160 characters each.</p>
        {memories.map((m) => (
          <div key={m.id} className="flex items-center gap-2"><div className="flex-1"><TextInput value={m.text} onCommit={(v) => editMemory(m.id!, v).catch(() => undefined)} /></div><button className="text-xs text-red-400 h-9 px-1" onClick={() => deleteWithUndo(db.memories, m.id!, 'Note deleted')}>✕</button></div>
        ))}
        <div className="flex gap-2"><input className={inputCls} placeholder="I … / my …" value={note} maxLength={160} onChange={(e) => setNote(e.target.value)} /><Btn variant="ghost" disabled={!note.trim()} onClick={saveNote}>Add</Btn></div>
        {note.trim() && !looksLikeMemory(note) && <p className="text-[11px] text-amber-300/80">That reads like a question or a short phrase. Notes work best as a statement starting with “I” or “my”.</p>}
        {err && <p className="text-xs text-red-400">{err}</p>}
      </Card>

      {a.decisions.length > 0 && (
        <Card className="space-y-2">
          <h3 className="font-semibold">Past decisions</h3>
          {[...a.decisions].reverse().slice(0, 6).map((r) => (
            <div key={r.at} className="text-sm"><p>{prettyDate(r.weekStart, { day: 'numeric', month: 'short' })} · {r.outcome === 'applied' ? 'Applied' : 'Kept plan'}</p>{r.changes.filter((c) => c.applied).map((c) => <p key={c.id} className="text-xs text-zinc-500">{c.title}</p>)}</div>
          ))}
        </Card>
      )}

      {a.hasRoutine && <WhatIfButton brain={a} />}

      <EventSheet open={sheet === 'event'} onClose={() => setSheet(null)} />
      <PainSheet open={sheet === 'pain'} onClose={() => setSheet(null)} />
    </div>
  )
}

function ChangeRow({ c, on, toggle }: { c: Change; on: boolean; toggle: () => void }) {
  return (
    <label className="flex gap-3 rounded-[.875rem] bg-zinc-800/60 p-3 cursor-pointer">
      <input type="checkbox" checked={on} onChange={toggle} className="mt-1 accent-lime-400 size-4" />
      <span className="min-w-0">
        <span className="block text-sm font-medium">{c.title}</span>
        <span className="block text-xs text-zinc-400">{c.reason}</span>
        {c.until && <span className="block text-[11px] text-zinc-500 mt-0.5">Temporary: goes back on {prettyDate(c.until, { day: 'numeric', month: 'short' })}</span>}
      </span>
    </label>
  )
}

export function PainList() {
  const pains = useLiveQuery(() => db.pain.toArray(), []) ?? []
  const open = pains.filter((p) => !p.done)
  if (!open.length) return <p className="text-xs text-zinc-500">Report pain and the next review swaps exercises and trims sets around it for a couple of weeks. Sharp pain, numbness or swelling is a doctor’s call, not the app’s.</p>
  return <>{open.map((p) => (
    <div key={p.id} className="flex items-center justify-between text-sm"><span>{PAIN_NAME[p.area]} <span className="text-xs text-zinc-500">· {p.severity}{p.redFlags.length ? ' · red flag' : ''} · {prettyDate(p.start, { day: 'numeric', month: 'short' })}</span></span><button className="text-xs text-red-400 h-8" onClick={() => deleteWithUndo(db.pain, p.id!, 'Pain report removed')}>Remove</button></div>
  ))}</>
}

function EventSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [kind, setKind] = useState<EventKind>('travel')
  const [start, setStart] = useState(shiftDate(todayStr(), 1))
  const [end, setEnd] = useState(shiftDate(todayStr(), 7))
  const [err, setErr] = useState('')
  return (
    <Sheet open={open} onClose={onClose} title="What is coming up">
      <div className="space-y-3">
        <Chips value={kind} onChange={setKind} options={EVENT_KINDS.map((k) => ({ v: k, label: EVENT_NAME[k] }))} />
        <div className="grid grid-cols-2 gap-2">
          <Field label="First day"><input type="date" className={inputCls} value={start} onChange={(e) => setStart(e.target.value)} /></Field>
          <Field label="Last day"><input type="date" className={inputCls} value={end} onChange={(e) => setEnd(e.target.value)} /></Field>
        </div>
        <p className="text-xs text-zinc-500">Up to {MAX_EVENT_DAYS} days. If it covers most of a week the review eats at maintenance, shortens sessions (exams, travel) and keeps training easy (vrat, Ramzan, unwell).</p>
        {err && <p className="text-xs text-red-400">{err}</p>}
        <Btn className="w-full" onClick={async () => { try { await addEvent({ kind, start, end }); setErr(''); onClose() } catch (e) { setErr(e instanceof PlanError ? e.message : 'Could not save.') } }}>Save</Btn>
      </div>
    </Sheet>
  )
}

export function PainSheet({ open, onClose, exerciseKey }: { open: boolean; onClose: () => void; exerciseKey?: string }) {
  const [area, setArea] = useState<PainArea | null>(null)
  const [sev, setSev] = useState<PainRec['severity'] | null>(null)
  const [flags, setFlags] = useState<string[]>([])
  const [done, setDone] = useState(false)
  const [err, setErr] = useState('')
  const red = sev === 'severe' || flags.length > 0
  async function save() {
    if (!area || !sev) return
    try {
      await addPain({ area, severity: sev, redFlags: flags, exerciseKey })
      setDone(true)
    } catch (e) { setErr(e instanceof PlanError ? e.message : 'Could not save.') }
  }
  function close() { setDone(false); setArea(null); setSev(null); setFlags([]); setErr(''); onClose() }
  return (
    <Sheet open={open} onClose={close} title="Something hurts">
      {done ? (
        <div className="space-y-3">
          <p className="text-sm">{red ? 'Saved. Because of the severity or the red flags, the plan will not be changed around this. Please see a doctor or physiotherapist, and skip anything that brings the pain on.' : 'Saved. The next weekly review will swap exercises that load it and trim a few sets around it for a couple of weeks, then restore them.'}</p>
          <Btn className="w-full" onClick={close}>Done</Btn>
        </div>
      ) : (
        <div className="space-y-3">
          <p className="text-xs text-zinc-500">Training guidance, not medical advice.</p>
          <Field label="Where"><div className="flex flex-wrap gap-2">{PAIN_AREAS.map((p) => <button key={p} onClick={() => setArea(p)} className={`px-3 h-9 rounded-full text-sm ${area === p ? 'bg-lime-400 text-black' : 'bg-zinc-800 text-zinc-300'}`}>{PAIN_NAME[p]}</button>)}</div></Field>
          <Field label="How bad">
            <div className="grid gap-2">
              {([['mild', 'Mild', 'Uncomfortable, but I can train.'], ['moderate', 'Moderate', 'It changes how I move.'], ['severe', 'Severe', 'I cannot train it.']] as const).map(([v, t, s]) => (
                <button key={v} onClick={() => setSev(v)} className={`text-left rounded-[.875rem] px-3 py-2 ${sev === v ? 'bg-lime-400 text-black' : 'bg-zinc-800'}`}><span className="block text-sm font-medium">{t}</span><span className="block text-xs opacity-70">{s}</span></button>
              ))}
            </div>
          </Field>
          <Field label="Any of these?">
            <div className="space-y-1">{RED_FLAGS.map((f) => (
              <label key={f.v} className="flex items-center gap-2 text-sm"><input type="checkbox" className="accent-lime-400" checked={flags.includes(f.v)} onChange={() => setFlags(flags.includes(f.v) ? flags.filter((x) => x !== f.v) : [...flags, f.v])} />{f.label}</label>
            ))}</div>
          </Field>
          {err && <p className="text-xs text-red-400">{err}</p>}
          <Btn className="w-full" disabled={!area || !sev} onClick={save}>Save</Btn>
        </div>
      )}
    </Sheet>
  )
}
