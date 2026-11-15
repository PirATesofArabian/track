import { useState } from 'react'
import { BARS, PLATES, plateBreakdown, type PlateUnit } from './plates'
import { Chips, NumInput, Sheet } from './ui'

const PLATE_COLOR: Record<number, string> = { 25: 'bg-red-500', 20: 'bg-blue-500', 15: 'bg-yellow-400', 10: 'bg-green-500', 5: 'bg-zinc-100', 2.5: 'bg-zinc-400', 1.25: 'bg-zinc-500', 45: 'bg-blue-500', 35: 'bg-yellow-400' }

/** Plate calculator sheet (greedy plates per side, bars 20/15/10 kg or 45/35/25 lb). */
export function PlateSheet({ open, onClose, initial }: { open: boolean; onClose: () => void; initial?: number | null }) {
  const [unit, setUnit] = useState<PlateUnit>('kg')
  const [bar, setBar] = useState(20)
  const [target, setTarget] = useState<number | null>(initial ?? null)
  const res = target ? plateBreakdown(target, bar, PLATES[unit]) : null
  return (
    <Sheet open={open} onClose={onClose} title="Plate calculator">
      <div className="space-y-3">
        <Chips value={unit} options={[{ v: 'kg', label: 'kg' }, { v: 'lb', label: 'lb' }]} onChange={(u) => { setUnit(u); setBar(BARS[u][0]) }} />
        <Chips value={bar} options={BARS[unit].map((b) => ({ v: b, label: `${b} ${unit} bar` }))} onChange={setBar} />
        <NumInput value={target} onChange={setTarget} placeholder={`Total weight (${unit})`} />
        {target !== null && !res && <p className="text-sm text-amber-400">That is lighter than the bar.</p>}
        {res && (
          <div className="space-y-2">
            <div className="flex items-center justify-center gap-1 py-2">
              {[...res.perSide].reverse().map((p, i) => <span key={`l${i}`} className={`w-3 rounded-sm ${PLATE_COLOR[p] ?? 'bg-zinc-500'}`} style={{ height: 24 + p * 1.6 }} />)}
              <span className="h-2 w-16 rounded bg-zinc-600" />
              {res.perSide.map((p, i) => <span key={`r${i}`} className={`w-3 rounded-sm ${PLATE_COLOR[p] ?? 'bg-zinc-500'}`} style={{ height: 24 + p * 1.6 }} />)}
            </div>
            <p className="text-sm text-center">{res.perSide.length ? <>Each side: <b>{res.perSide.join(' + ')}</b> {unit}</> : 'Just the bar'}</p>
            <p className="text-xs text-center text-zinc-500">Total {res.achieved} {unit}{res.remainder > 0 ? ` · ${res.remainder} ${unit} short with these plates` : ''}</p>
          </div>
        )}
      </div>
    </Sheet>
  )
}
