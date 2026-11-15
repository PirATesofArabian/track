import { useEffect, useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, type PhotoRec } from '../lib/db'
import { Btn, Card, Chips, Sheet } from '../lib/ui'
import { deleteWithUndo } from '../lib/undo'
import { prettyDate, todayStr } from '../lib/util'

type Pose = PhotoRec['pose']
const POSES: { v: Pose; label: string }[] = [{ v: 'front', label: 'Front' }, { v: 'side', label: 'Side' }, { v: 'back', label: 'Back' }]
const MAX_SIDE = 1440

/** Same pipeline as theirs: respect EXIF orientation, cap the longest side at 1440px, JPEG at 0.85. */
async function resize(file: File): Promise<Blob> {
  const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' })
  const k = Math.min(1, MAX_SIDE / Math.max(bmp.width, bmp.height))
  const c = document.createElement('canvas')
  c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k)
  c.getContext('2d')!.drawImage(bmp, 0, 0, c.width, c.height)
  bmp.close?.()
  return await new Promise<Blob>((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error('encode failed'))), 'image/jpeg', 0.85))
}

/** Object URLs for a list of photos, revoked when the list changes. */
function useUrls(photos: PhotoRec[]) {
  const urls = useMemo(() => new Map(photos.map((p) => [p.id!, URL.createObjectURL(p.blob)])), [photos])
  useEffect(() => () => { urls.forEach((u) => URL.revokeObjectURL(u)) }, [urls])
  return urls
}

export default function PhotosCard() {
  const all = useLiveQuery(() => db.photos.orderBy('date').toArray(), []) ?? []
  const [pose, setPose] = useState<Pose>('front')
  const [view, setView] = useState<PhotoRec | null>(null)
  const [compare, setCompare] = useState(false)
  const [busy, setBusy] = useState(false)
  const [date, setDate] = useState(todayStr())
  const list = useMemo(() => all.filter((p) => p.pose === pose), [all, pose])
  const urls = useUrls(list)

  async function add(file: File) {
    setBusy(true)
    try { await db.photos.add({ date, pose, blob: await resize(file) }) } catch { alert('Could not read that image.') }
    setBusy(false)
  }

  return (
    <Card className="space-y-3">
      <div className="flex justify-between items-center">
        <h3 className="font-semibold">Progress photos</h3>
        {list.length >= 2 && <button className="text-xs text-lime-400 h-8" onClick={() => setCompare(true)}>Compare</button>}
      </div>
      <Chips value={pose} onChange={setPose} options={POSES} />
      <div className="flex items-center gap-2 text-xs text-zinc-400">
        <span>Photo date</span>
        <input type="date" max={todayStr()} value={date} onChange={(e) => setDate(e.target.value)} className="bg-zinc-800 rounded-lg px-2 h-8 text-zinc-200" />
      </div>
      <div className="grid grid-cols-3 gap-2">
        <label className="aspect-[3/4] rounded-xl border border-dashed border-zinc-700 flex items-center justify-center text-xs text-zinc-400 text-center cursor-pointer">
          {busy ? 'Saving…' : `+ Add ${pose}`}
          <input type="file" accept="image/*" className="hidden" data-testid="photo-input" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) add(f) }} />
        </label>
        {[...list].reverse().map((p) => (
          <button key={p.id} className="relative aspect-[3/4] rounded-xl overflow-hidden bg-zinc-800" onClick={() => setView(p)}>
            <img src={urls.get(p.id!)} alt={`${pose} ${p.date}`} className="w-full h-full object-cover" />
            <span className="absolute bottom-0 inset-x-0 bg-black/60 text-[10px] py-0.5">{prettyDate(p.date, { day: 'numeric', month: 'short' })}</span>
          </button>
        ))}
      </div>
      <p className="text-xs text-zinc-500">Photos stay on this device only. They are included in the JSON backup.</p>

      <Sheet open={!!view} onClose={() => setView(null)} title={view ? `${POSES.find((o) => o.v === view.pose)!.label} · ${prettyDate(view.date)}` : ''}>
        {view && (
          <div className="space-y-3">
            <img src={urls.get(view.id!)} alt="" className="w-full rounded-xl" />
            <Btn variant="danger" className="w-full" onClick={async () => { const id = view.id!; setView(null); await deleteWithUndo(db.photos, id, 'Photo deleted') }}>Delete</Btn>
          </div>
        )}
      </Sheet>
      <CompareSheet open={compare} onClose={() => setCompare(false)} list={list} urls={urls} />
    </Card>
  )
}

function CompareSheet({ open, onClose, list, urls }: { open: boolean; onClose: () => void; list: PhotoRec[]; urls: Map<number, string> }) {
  const [a, setA] = useState<number | null>(null)
  const [b, setB] = useState<number | null>(null)
  const [mode, setMode] = useState<'side' | 'slider'>('side')
  const [pct, setPct] = useState(50)
  const before = list.find((p) => p.id === a) ?? list[0]
  const after = list.find((p) => p.id === b) ?? list[list.length - 1]
  if (!before || !after) return null
  const opts = list.map((p) => <option key={p.id} value={p.id}>{prettyDate(p.date)}</option>)
  const sel = 'bg-zinc-800 rounded-lg h-9 px-2 text-sm w-full'
  return (
    <Sheet open={open} onClose={onClose} title="Compare">
      <div className="space-y-3">
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
      </div>
    </Sheet>
  )
}
