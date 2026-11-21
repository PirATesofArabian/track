import { useEffect, useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, type PhotoRec } from '../lib/db'
import { Btn, Card, Chips, Sheet } from '../lib/ui'
import { PHOTO_ACCEPT, isHeic, photoProblem, resize } from '../lib/photoFile'
import { deleteWithUndo } from '../lib/undo'
import { prettyDate, todayStr } from '../lib/util'

type Pose = PhotoRec['pose']
const POSES: { v: Pose; label: string }[] = [{ v: 'front', label: 'Front' }, { v: 'side', label: 'Side' }, { v: 'back', label: 'Back' }]
/** Object URLs for a list of photos, revoked when the list changes. */
function useUrls(photos: PhotoRec[]) {
  const urls = useMemo(() => new Map(photos.map((p) => [p.id!, URL.createObjectURL(p.blob)])), [photos])
  useEffect(() => () => { urls.forEach((u) => URL.revokeObjectURL(u)) }, [urls])
  return urls
}

export default function PhotosCard() {
  const all = useLiveQuery(() => db.photos.orderBy('date').toArray(), []) ?? []
  const today = todayStr()
  const [date, setDate] = useState(today)
  const [view, setView] = useState<PhotoRec | null>(null)
  const [compare, setCompare] = useState(false)
  const [busy, setBusy] = useState<Pose | null>(null)
  const [err, setErr] = useState('')
  const day = useMemo(() => all.filter((p) => p.date === date), [all, date])
  const urls = useUrls(day)
  const days = useMemo(() => [...new Set(all.map((p) => p.date))].reverse().slice(0, 12), [all])

  async function add(file: File, pose: Pose) {
    const problem = photoProblem(file)
    if (problem) { setErr(problem); return }
    setBusy(pose); setErr('')
    try { await db.photos.add({ date, pose, blob: await resize(file) }) }
    catch { setErr(isHeic(file) ? 'This browser cannot open HEIC photos (Chrome cannot). Use Safari, or convert it to JPEG first.' : 'Could not read that image.') }
    setBusy(null)
  }

  return (
    <Card className="space-y-3">
      <div className="flex justify-between items-center">
        <h3 className="font-semibold">Progress photos</h3>
        {all.length >= 2 && <button className="text-xs text-lime-400 h-8" onClick={() => setCompare(true)}>Compare</button>}
      </div>
      <div className="flex items-center gap-2 text-xs text-zinc-400">
        <span>Day</span>
        <input type="date" max={today} value={date} onChange={(e) => e.target.value && setDate(e.target.value)} className="bg-zinc-800 rounded-lg px-2 h-8 text-zinc-200" />
        {date !== today && <button className="text-lime-400 h-8" onClick={() => setDate(today)}>Today</button>}
      </div>
      {days.length > 0 && (
        <div className="flex gap-2 overflow-x-auto no-scrollbar">
          {days.map((d) => <button key={d} onClick={() => setDate(d)} className={`shrink-0 px-3 h-8 rounded-full text-xs ${d === date ? 'bg-lime-400 text-black font-medium' : 'bg-zinc-800 text-zinc-300'}`}>{prettyDate(d, { day: 'numeric', month: 'short' })}</button>)}
        </div>
      )}
      <div className="grid grid-cols-3 gap-2">
        {POSES.flatMap((o) => {
          const mine = day.filter((p) => p.pose === o.v)
          return [
            ...mine.map((p) => (
              <button key={p.id} className="relative aspect-[3/4] rounded-xl overflow-hidden bg-zinc-800" onClick={() => setView(p)}>
                <img src={urls.get(p.id!)} alt={`${o.label} ${p.date}`} className="w-full h-full object-cover" />
                <span className="absolute bottom-0 inset-x-0 bg-black/60 text-[10px] py-0.5">{o.label}</span>
              </button>
            )),
            ...(mine.length ? [] : [(
              <label key={`add-${o.v}`} className="aspect-[3/4] rounded-xl border border-dashed border-zinc-700 flex items-center justify-center text-xs text-zinc-400 text-center cursor-pointer">
                {busy === o.v ? 'Saving…' : `+ Add ${o.label.toLowerCase()}`}
                <input type="file" accept={PHOTO_ACCEPT} className="hidden" data-testid={`photo-input-${o.v}`} onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) add(f, o.v) }} />
              </label>
            )]),
          ]
        })}
      </div>
      {day.length === 0 && <p className="text-xs text-zinc-500">No photos on {prettyDate(date)}.</p>}
      {day.length > 0 && day.length < 3 && <p className="text-xs text-zinc-500">{day.length} of 3 poses on {prettyDate(date)}.</p>}
      {err && <p className="text-xs text-red-400">{err}</p>}
      <p className="text-xs text-zinc-500">JPEG and PNG photos, and iPhone photos (HEIC where the browser can open them). A Live Photo is saved as its still picture, without the movement. Photos are kept on this device, and sent to your server when you are signed in (Progress → Data → Account). They are also in the JSON backup.</p>

      <Sheet open={!!view} onClose={() => setView(null)} title={view ? `${POSES.find((o) => o.v === view.pose)!.label} · ${prettyDate(view.date)}` : ''}>
        {view && (
          <div className="space-y-3">
            <img src={urls.get(view.id!)} alt="" className="w-full rounded-xl" />
            <Btn variant="danger" className="w-full" onClick={async () => { const id = view.id!; setView(null); await deleteWithUndo(db.photos, id, 'Photo deleted') }}>Delete</Btn>
          </div>
        )}
      </Sheet>
      <CompareSheet open={compare} onClose={() => setCompare(false)} all={all} />
    </Card>
  )
}

function CompareSheet({ open, onClose, all }: { open: boolean; onClose: () => void; all: PhotoRec[] }) {
  const [pose, setPose] = useState<Pose>('front')
  const list = useMemo(() => (open ? all.filter((p) => p.pose === pose) : []), [open, all, pose])
  const urls = useUrls(list)
  const [a, setA] = useState<number | null>(null)
  const [b, setB] = useState<number | null>(null)
  const [mode, setMode] = useState<'side' | 'slider'>('side')
  const [pct, setPct] = useState(50)
  const before = list.find((p) => p.id === a) ?? list[0]
  const after = list.find((p) => p.id === b) ?? list[list.length - 1]
  const opts = list.map((p) => <option key={p.id} value={p.id}>{prettyDate(p.date)}</option>)
  const sel = 'bg-zinc-800 rounded-lg h-9 px-2 text-sm w-full'
  return (
    <Sheet open={open} onClose={onClose} title="Compare">
      <div className="space-y-3">
        <Chips value={pose} onChange={(v: Pose) => { setPose(v); setA(null); setB(null) }} options={POSES} />
        {(!before || !after) && <p className="text-sm text-zinc-400">Needs at least two {pose} photos to compare.</p>}
        {before && after && <>
        <div className="grid grid-cols-2 gap-2 text-xs text-zinc-400">
          <label>Before<select className={sel} value={before.id} onChange={(e) => setA(+e.target.value)}>{opts}</select></label>
          <label>After<select className={sel} value={after.id} onChange={(e) => setB(+e.target.value)}>{opts}</select></label>
        </div>
        <Chips value={mode} onChange={setMode} options={[{ v: 'side', label: 'Side by side' }, { v: 'slider', label: 'Slider' }]} />
        {mode === 'side' ? (
          <div className="grid grid-cols-2 gap-2">
            {[before, after].map((p, i) => (
              <figure key={i}>
                <img src={urls.get(p.id!)} alt="" className="w-full aspect-[3/4] object-cover rounded-xl" />
                <figcaption className="text-xs text-zinc-400 text-center mt-1">{prettyDate(p.date)}</figcaption>
              </figure>
            ))}
          </div>
        ) : (
          <div className="space-y-2">
            <div className="relative w-full aspect-[3/4] rounded-xl overflow-hidden bg-zinc-800">
              <img src={urls.get(before.id!)} alt="" className="absolute inset-0 w-full h-full object-cover" />
              <img src={urls.get(after.id!)} alt="" className="absolute inset-0 w-full h-full object-cover" style={{ clipPath: `inset(0 0 0 ${pct}%)` }} />
              <div className="absolute top-0 bottom-0 w-0.5 bg-white/80" style={{ left: `${pct}%` }} />
            </div>
            <input type="range" min={0} max={100} value={pct} onChange={(e) => setPct(+e.target.value)} className="w-full" aria-label="Slider" />
            <div className="flex justify-between text-xs text-zinc-400"><span>{prettyDate(before.date)}</span><span>{prettyDate(after.date)}</span></div>
          </div>
        )}
        </>}
      </div>
    </Sheet>
  )
}
