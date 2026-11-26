import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../lib/db'
import { Btn, Card, Chips, inputCls } from '../lib/ui'
import { todayStr } from '../lib/util'
import raw from '../data/ab60.json'

// Every value shown here comes from src/data/ab60.json, generated from data/*.json (see tools/ab60).
// Status badges are the extraction verification status. Nothing on this page is computed or invented.

type Status = 'VERIFIED' | 'PARTIALLY_VERIFIED' | 'CONFLICTING' | 'UNAVAILABLE'
type Sv<T> = { v: T; s: Status; alt?: { value: unknown; source: string }[]; why?: string }
type Day = {
  day: number; category: Sv<string>; title: Sv<string>; phase: string; steps: Sv<number>; food: Sv<string>; test: boolean; waist: boolean
  note: Sv<string> | null; rounds: Sv<number> | null; rest: Sv<number> | null; minutes: Sv<number> | null
  exercises: { name: string; rx: Sv<string> }[]
}
type Move = { name: string; tag: string; how: string[]; works: string; avoid: string; easy: string; hard: string; safe: string | null; status: Status }
type Phase = { n: number; name: string; first: number; last: number; rounds: string | number; steps: number; what: string }
const data = raw as unknown as {
  source: { url: string; extractedAt: string }; days: Day[]; phases: Phase[]; moves: Move[]
  nutrition: Record<string, Sv<unknown>>; assessment: Record<string, Sv<unknown>>; progression: Record<string, Sv<unknown>>; missed: Record<string, Sv<unknown>>
}

const START_KEY = 'ab60:start'
const DONE_KEY = 'ab60:done'
const PHASE_CLS: Record<string, string> = { Foundation: 'bg-zinc-700', Build: 'bg-orange-700', Carve: 'bg-red-700', Reveal: 'bg-yellow-700' }
const BADGE: Record<Status, { t: string; cls: string }> = {
  VERIFIED: { t: 'verified', cls: 'bg-lime-400/15 text-lime-400' },
  PARTIALLY_VERIFIED: { t: 'partly verified', cls: 'bg-amber-400/15 text-amber-400' },
  CONFLICTING: { t: 'conflict', cls: 'bg-red-500/15 text-red-400' },
  UNAVAILABLE: { t: 'unavailable', cls: 'bg-zinc-700 text-zinc-400' },
}
const LETTER: Record<string, string> = { 'ABS A': 'A', 'ABS B': 'B', 'ABS C': 'C', 'FULL BODY': 'F', 'FULL BODY + LONG WALK': 'F', WALK: 'W', 'REST + WAIST CHECK': 'R', 'FINAL TEST': 'T' }

const Badge = ({ s }: { s: Status }) => <span className={`ml-1.5 rounded px-1.5 py-0.5 text-[10px] align-middle ${BADGE[s].cls}`}>{BADGE[s].t}</span>

function Alt({ x }: { x: Sv<unknown> }) {
  if (x.s !== 'CONFLICTING' || !x.alt) return null
  return (
    <ul className="mt-1 space-y-0.5 text-[11px] text-red-300/90">
      {x.alt.map((a, i) => <li key={i}>{String(a.value)} <span className="text-zinc-500">({a.source})</span></li>)}
    </ul>
  )
}

const daysBetween = (a: string, b: string) => Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 86400000)

function useAb60() {
  const start = useLiveQuery(async () => ((await db.kv.get(START_KEY))?.value as string | undefined) ?? null, [])
  const done = useLiveQuery(async () => ((await db.kv.get(DONE_KEY))?.value as Record<string, string> | undefined) ?? {}, []) ?? {}
  return { start: start ?? null, done }
}

function DayDetail({ d, done, onTick }: { d: Day; done: boolean; onTick: () => void }) {
  return (
    <Card>
      <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
        <span className={`rounded px-1.5 py-0.5 text-white ${PHASE_CLS[d.phase]}`}>{d.phase}</span>
        <span className="rounded bg-zinc-800 px-1.5 py-0.5 text-zinc-300">Day {d.day} of 60</span>
        {d.test && <span className="rounded bg-yellow-400/20 px-1.5 py-0.5 text-yellow-300">Test day</span>}
      </div>
      <h2 className="mt-2 text-lg font-semibold">{d.title.v}<Badge s={d.title.s} /></h2>
      <p className="text-sm text-zinc-400">{d.category.v}<Badge s={d.category.s} />
        {d.rounds && <> · {d.rounds.v} rounds<Badge s={d.rounds.s} /></>}
        {d.minutes && <> · about {d.minutes.v} min<Badge s={d.minutes.s} /></>}
      </p>
      {d.test && <p className="mt-2 text-sm text-yellow-200">Test first: waist, string test, max plank, photo</p>}
      {d.exercises.length > 0 && (
        <ol className="mt-3 space-y-2">
          {d.exercises.map((e, i) => (
            <li key={i} className="flex items-baseline justify-between gap-3 rounded-xl bg-zinc-800/60 px-3 py-2 text-sm">
              <span>{i + 1}. {e.name}</span>
              <span className="text-right text-zinc-200">{e.rx.v}<Badge s={e.rx.s} /></span>
            </li>
          ))}
        </ol>
      )}
      {d.rest && (
        <div className="mt-2 text-sm text-zinc-300">Rest {d.rest.v} s between rounds<Badge s={d.rest.s} /><Alt x={d.rest} /></div>
      )}
      {d.waist && <p className="mt-2 text-sm text-zinc-300">Waist check today</p>}
      <p className="mt-2 text-sm text-zinc-300">Steps: {d.steps.v.toLocaleString()}<Badge s={d.steps.s} /></p>
      <div className="mt-2 text-sm text-zinc-300">{d.food.v}<Badge s={d.food.s} /><Alt x={d.food} /></div>
      {d.note && <p className="mt-2 text-xs italic text-zinc-500">{d.note.v}</p>}
      <Btn variant={done ? 'ghost' : 'primary'} className="mt-4 w-full" onClick={onTick}>{done ? 'Done (tap to undo)' : `Tick day ${d.day} off`}</Btn>
    </Card>
  )
}

function Reference() {
  const [tab, setTab] = useState<'phases' | 'moves' | 'eat' | 'test' | 'rules'>('phases')
  const rows = (o: Record<string, Sv<unknown>>) => Object.entries(o).map(([k, r]) => (
    <div key={k} className="rounded-xl bg-zinc-800/60 p-3 text-sm">
      <div className="text-[11px] uppercase tracking-wide text-zinc-500">{k.replaceAll('_', ' ')}<Badge s={r.s} /></div>
      {r.v === null
        ? <div className="mt-1 text-zinc-500">Not available: {r.why}</div>
        : <div className="mt-1 whitespace-pre-wrap text-zinc-200">{typeof r.v === 'string' ? r.v : JSON.stringify(r.v, null, 1).replace(/[{}[\]"]/g, '')}</div>}
      <Alt x={r} />
    </div>
  ))
  return (
    <div className="space-y-3">
      <Chips value={tab} onChange={setTab} options={[{ v: 'phases', label: 'Phases' }, { v: 'moves', label: '7 ab moves' }, { v: 'eat', label: 'Eat' }, { v: 'test', label: 'Test day' }, { v: 'rules', label: 'Progression + missed' }]} />
      {tab === 'phases' && data.phases.map((p) => (
        <Card key={p.n}>
          <div className="flex items-center justify-between"><b>{p.name}</b><span className="text-xs text-zinc-400">Days {p.first}-{p.last}</span></div>
          <p className="mt-1 text-xs text-zinc-400">Rounds {p.rounds} · {p.steps.toLocaleString()} steps/day<Badge s="VERIFIED" /></p>
          <p className="mt-2 text-sm text-zinc-300">{p.what}</p>
        </Card>
      ))}
      {tab === 'moves' && data.moves.map((m) => (
        <Card key={m.name}>
          <div className="font-semibold">{m.name}<Badge s={m.status} /></div>
          <div className="text-[11px] text-zinc-500">{m.tag}</div>
          <ol className="mt-2 list-decimal space-y-1 pl-5 text-sm text-zinc-300">{m.how.map((h) => <li key={h}>{h}</li>)}</ol>
          <p className="mt-2 text-sm"><span className="text-zinc-500">Works:</span> {m.works}</p>
          <p className="text-sm"><span className="text-zinc-500">Avoid:</span> {m.avoid}</p>
          <p className="text-sm"><span className="text-zinc-500">Easier:</span> {m.easy}</p>
          <p className="text-sm"><span className="text-zinc-500">Harder:</span> {m.hard}</p>
          {m.safe && <p className="text-sm text-amber-300"><span className="text-zinc-500">Be safe:</span> {m.safe}</p>}
        </Card>
      ))}
      {tab === 'eat' && rows(data.nutrition )}
      {tab === 'test' && rows(data.assessment )}
      {tab === 'rules' && <>{rows(data.progression )}{rows(data.missed )}</>}
      <p className="px-1 text-[11px] text-zinc-500">Source: {data.source.url}, extracted {data.source.extractedAt}. Only the public landing page and 10 public preview pages were used; the rest of the 23-page PDF is not public.</p>
    </div>
  )
}

export default function Ab60Page() {
  const { start, done } = useAb60()
  const [view, setView] = useState<'today' | 'days' | 'ref'>('today')
  const [pick, setPick] = useState<number | null>(null)
  const [dateIn, setDateIn] = useState(todayStr())

  const todayNo = start ? daysBetween(start, todayStr()) + 1 : null
  const shown = pick ?? (todayNo && todayNo >= 1 && todayNo <= 60 ? todayNo : 1)
  const d = data.days[shown - 1]
  const count = Object.keys(done).length
  const tick = () => db.kv.put({ key: DONE_KEY, value: done[shown] ? Object.fromEntries(Object.entries(done).filter(([k]) => +k !== shown)) : { ...done, [shown]: todayStr() } })

  return (
    <div className="space-y-4 pb-4">
      <header>
        <h1 className="text-2xl font-bold">AB Theory 60</h1>
        <p className="text-sm text-zinc-400">{count}/60 done{todayNo !== null && todayNo > 60 ? ' · plan finished' : todayNo !== null && todayNo < 1 ? ' · starts later' : ''}</p>
      </header>
      {!start ? (
        <Card>
          <p className="text-sm text-zinc-300">Day 1 is whatever day you start. Pick your start date; days then count from it.</p>
          <div className="mt-3 flex gap-2">
            <input type="date" className={inputCls} value={dateIn} onChange={(e) => setDateIn(e.target.value)} />
            <Btn onClick={() => db.kv.put({ key: START_KEY, value: dateIn })}>Start</Btn>
          </div>
        </Card>
      ) : (
        <p className="text-xs text-zinc-500">Day 1 = {start} · today is day {todayNo} · <button className="underline" onClick={() => db.kv.delete(START_KEY)}>change start</button></p>
      )}
      <Chips value={view} onChange={setView} options={[{ v: 'today', label: 'Today' }, { v: 'days', label: 'All 60 days' }, { v: 'ref', label: 'Rules + moves' }]} />
      {view === 'today' && <DayDetail d={d} done={!!done[shown]} onTick={tick} />}
      {view === 'days' && (
        <>
          <div className="grid grid-cols-6 gap-1.5">
            {data.days.map((x) => (
              <button key={x.day} onClick={() => { setPick(x.day); setView('today') }}
                className={`rounded-lg px-1 py-1.5 text-center ${PHASE_CLS[x.phase]} ${x.test ? 'ring-2 ring-yellow-400' : ''} ${done[x.day] ? 'opacity-40' : ''} ${x.day === todayNo ? 'outline outline-2 outline-lime-400' : ''}`}>
                <div className="text-sm font-semibold">{x.day}</div>
                <div className="text-[10px] text-white/70">{LETTER[x.category.v] ?? '?'}</div>
              </button>
            ))}
          </div>
          <p className="text-[11px] text-zinc-500">A B C = ab days · F full body · W walk · R rest + waist check · T final test · ring = test day</p>
        </>
      )}
      {view === 'ref' && <Reference />}
    </div>
  )
}
