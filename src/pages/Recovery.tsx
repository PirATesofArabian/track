import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, type SleepLog } from '../lib/db'
import { Bar, Btn, Card, Chips, Empty, NumInput, inputCls } from '../lib/ui'
import { deleteWithUndo } from '../lib/undo'
import { prettyDate, shiftDate, todayStr } from '../lib/util'

const UNITS = ['capsule', 'tablet', 'softgel', 'scoop', 'g', 'mg', 'ml']

export function SupplementsCard() {
  const today = todayStr()
  const rows = useLiveQuery(() => db.supplements.orderBy('date').reverse().limit(200).toArray(), []) ?? []
  const [date, setDate] = useState(today)
  const [name, setName] = useState('')
  const [qty, setQty] = useState<number | null>(1)
  const [unit, setUnit] = useState('capsule')

  // Most recent entry per supplement name, so a name you've used before is one tap.
  const recent = [...new Map(rows.map((r) => [r.name.toLowerCase(), r])).values()].slice(0, 8)
  const from30 = shiftDate(today, -29)
  const days30 = (n: string) => new Set(rows.filter((r) => r.name.toLowerCase() === n.toLowerCase() && r.date >= from30).map((r) => r.date)).size
  const byDate = new Map<string, typeof rows>()
  for (const r of rows.filter((r) => r.date >= shiftDate(today, -6))) byDate.set(r.date, [...(byDate.get(r.date) ?? []), r])

  const add = async (n: string, q: number, u: string, d = date) => { await db.supplements.add({ date: d, name: n.trim(), qty: q, unit: u }) }

  return (
    <Card className="space-y-3">
      <h3 className="font-semibold">Supplements</h3>
      {recent.length > 0 && (
        <div className="space-y-1">
          <p className="text-xs text-zinc-400">Tap to log today</p>
          <div className="flex flex-wrap gap-2">
            {recent.map((r) => (
              <button key={r.id} className="px-3 h-9 rounded-full text-sm bg-zinc-800 text-zinc-300" onClick={() => add(r.name, r.qty, r.unit, today)}>
                {r.name} · {r.qty} {r.unit}{r.qty > 1 ? 's' : ''}
              </button>
            ))}
          </div>
        </div>
      )}
      <div className="grid grid-cols-6 gap-2">
        <input className={`${inputCls} col-span-6`} value={name} onChange={(e) => setName(e.target.value)} placeholder="Supplement (e.g. Creatine, Omega-3)" />
        <div className="col-span-2"><NumInput value={qty} step="0.5" onChange={setQty} placeholder="Qty" /></div>
        <select className={`${inputCls} col-span-2`} value={unit} onChange={(e) => setUnit(e.target.value)}>{UNITS.map((u) => <option key={u}>{u}</option>)}</select>
        <input type="date" max={today} className={`${inputCls} col-span-2`} value={date} onChange={(e) => setDate(e.target.value)} />
      </div>
      <Btn className="w-full" disabled={!name.trim() || !qty} onClick={async () => { await add(name, qty!, unit); setName('') }}>Log supplement</Btn>

      {byDate.size === 0 ? <Empty>Nothing logged in the last 7 days.</Empty> : [...byDate.entries()].map(([d, list]) => (
        <div key={d} className="border-t border-zinc-800 pt-2 space-y-1">
          <p className="text-xs text-zinc-400">{prettyDate(d)}</p>
          {list.map((r) => (
            <div key={r.id} className="flex justify-between text-sm">
              <span>{r.name}</span>
              <span className="text-zinc-400">{r.qty} {r.unit}{r.qty > 1 ? 's' : ''} <button className="text-zinc-600 ml-2" onClick={() => deleteWithUndo(db.supplements, r.id!, `Removed ${r.name}`)}>✕</button></span>
            </div>
          ))}
        </div>
      ))}
      {recent.length > 0 && <p className="text-xs text-zinc-500">Last 30 days: {recent.map((r) => `${r.name} ${days30(r.name)}d`).join(' · ')}</p>}
    </Card>
  )
}

const toMin = (t: string) => { const [h, m] = t.split(':').map(Number); return h * 60 + m }
/** Hours between going to bed and waking, crossing midnight when the wake time is earlier. */
export const sleepHours = (bed: string, wake: string) => { const d = toMin(wake) - toMin(bed); return Math.round(((d <= 0 ? d + 1440 : d) / 60) * 100) / 100 }
const fmtH = (h: number) => `${Math.floor(h)}h ${String(Math.round((h % 1) * 60)).padStart(2, '0')}m`

export function SleepCard() {
  const today = todayStr()
  const rows = useLiveQuery(() => db.sleep.orderBy('date').reverse().limit(60).toArray(), []) ?? []
  const [date, setDate] = useState(today)
  const [bed, setBed] = useState('23:00')
  const [wake, setWake] = useState('06:30')
  const [quality, setQuality] = useState<SleepLog['quality'] | 0>(0)
  const hours = sleepHours(bed, wake)

  const avg = (n: number) => {
    const from = shiftDate(today, -(n - 1)), r = rows.filter((x) => x.date >= from)
    return r.length ? { v: r.reduce((a, x) => a + x.hours, 0) / r.length, n: r.length } : null
  }
  const a7 = avg(7)
  const verdict = a7 && a7.n >= 3 ? (a7.v >= 7 ? 'In the 7 to 9 hour range adults are advised to get.' : 'Below the 7 hours a night adults are advised to get.') : null

  return (
    <Card className="space-y-3">
      <h3 className="font-semibold">Sleep</h3>
      {a7 && (
        <div className="grid grid-cols-2 gap-2 text-sm">
          <div className="rounded-xl bg-zinc-800/60 p-3"><p className="text-xs text-zinc-400">7-night average</p><p className="font-semibold">{fmtH(a7.v)}</p><p className="text-[11px] text-zinc-500">{a7.n} nights logged</p></div>
          <div className="rounded-xl bg-zinc-800/60 p-3"><p className="text-xs text-zinc-400">Last night</p><p className="font-semibold">{rows[0] ? fmtH(rows[0].hours) : '—'}</p><p className="text-[11px] text-zinc-500">{rows[0] ? prettyDate(rows[0].date) : ''}</p></div>
        </div>
      )}
      {verdict && <p className="text-xs text-zinc-400">{verdict}</p>}
      <div className="grid grid-cols-3 gap-2">
        <label className="text-xs text-zinc-400 space-y-1">Bed<input type="time" className={inputCls} value={bed} onChange={(e) => setBed(e.target.value)} /></label>
        <label className="text-xs text-zinc-400 space-y-1">Woke<input type="time" className={inputCls} value={wake} onChange={(e) => setWake(e.target.value)} /></label>
        <label className="text-xs text-zinc-400 space-y-1">Morning of<input type="date" max={today} className={inputCls} value={date} onChange={(e) => setDate(e.target.value)} /></label>
      </div>
      <div className="space-y-1">
        <p className="text-xs text-zinc-400">How rested do you feel? (optional)</p>
        <Chips value={quality as number} onChange={(v: number) => setQuality(v === quality ? 0 : (v as SleepLog['quality']))} options={[1, 2, 3, 4, 5].map((v) => ({ v, label: String(v) }))} />
      </div>
      <Btn className="w-full" onClick={async () => { await db.sleep.put({ date, bed, wake, hours, ...(quality ? { quality } : {}) }) }}>Log {fmtH(hours)}</Btn>
      {rows.length === 0 && <Empty>Log last night to start the 7-night average.</Empty>}
      {rows.slice(0, 7).map((r) => (
        <div key={r.date} className="space-y-1 border-t border-zinc-800 pt-2">
          <div className="flex justify-between text-sm">
            <span className="text-zinc-400">{prettyDate(r.date)} <span className="text-zinc-600">{r.bed}–{r.wake}{r.quality ? ` · rested ${r.quality}/5` : ''}</span></span>
            <span>{fmtH(r.hours)} <button className="text-zinc-600 ml-2" onClick={() => deleteWithUndo(db.sleep, r.date, `Removed sleep ${r.date}`)}>✕</button></span>
          </div>
          <Bar value={r.hours} max={9} color={r.hours >= 7 ? 'bg-lime-400' : 'bg-amber-400'} />
        </div>
      ))}
      <p className="text-xs text-zinc-500">Adults are advised at least 7 hours a night (Watson et al., AASM/SRS consensus, 2015). In a small trial of dieters, cutting sleep to 5.5 h cut the share of weight lost as fat by about 55% (Nedeltcheva et al., 2010).</p>
    </Card>
  )
}
