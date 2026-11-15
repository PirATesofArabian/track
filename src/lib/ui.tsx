import { useEffect, useRef, useState, type ReactNode } from 'react'

export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`rounded-[1.375rem] bg-zinc-900 border border-zinc-800 p-4 ${className}`}>{children}</div>
}

export function Btn({ children, onClick, variant = 'primary', className = '', disabled, type = 'button' }: {
  children: ReactNode; onClick?: () => void; variant?: 'primary' | 'ghost' | 'danger'; className?: string; disabled?: boolean; type?: 'button' | 'submit'
}) {
  const styles = {
    primary: 'bg-lime-400 text-black font-semibold active:bg-lime-300',
    ghost: 'bg-zinc-800 text-zinc-100 active:bg-zinc-700',
    danger: 'bg-red-500/15 text-red-400 active:bg-red-500/25',
  }[variant]
  return (
    <button type={type} disabled={disabled} onClick={onClick} className={`h-11 px-4 rounded-[.875rem] text-sm disabled:opacity-40 ${styles} ${className}`}>
      {children}
    </button>
  )
}

export const inputCls = 'h-11 w-full rounded-[.875rem] bg-zinc-800 px-3 text-sm outline-none focus:ring-2 focus:ring-lime-400/60 placeholder:text-zinc-500'

export function Bar({ value, max, color = 'bg-lime-400' }: { value: number; max: number; color?: string }) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0
  return (
    <div className="h-2 rounded-full bg-zinc-800 overflow-hidden">
      <div className={`h-full rounded-full transition-[width] duration-300 ${color}`} style={{ width: `${pct}%` }} />
    </div>
  )
}

export function Sheet({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: string; children: ReactNode }) {
  if (!open) return null
  return (
    <div className="fixed inset-0 z-50 flex items-end bg-black/60" onClick={onClose}>
      <div className="w-full max-w-md mx-auto max-h-[88vh] overflow-y-auto rounded-t-3xl bg-zinc-900 p-4 pb-8" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-lg font-semibold">{title}</h2>
          <button onClick={onClose} className="text-zinc-400 text-sm px-2 h-9">Close</button>
        </div>
        {children}
      </div>
    </div>
  )
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="text-center text-sm text-zinc-500 py-6">{children}</p>
}

export function Chips<T extends string | number>({ value, options, onChange, className = '' }: {
  value: T; options: { v: T; label: string }[]; onChange: (v: T) => void; className?: string
}) {
  return (
    <div className={`flex gap-2 overflow-x-auto no-scrollbar ${className}`}>
      {options.map((o) => (
        <button key={String(o.v)} onClick={() => onChange(o.v)} className={`px-3 h-9 rounded-full text-sm whitespace-nowrap ${value === o.v ? 'bg-lime-400 text-black font-medium' : 'bg-zinc-800 text-zinc-300'}`}>{o.label}</button>
      ))}
    </div>
  )
}

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="block text-xs text-zinc-400 space-y-1">
      <span>{label}</span>
      {children}
      {hint && <span className="block text-[11px] text-zinc-600">{hint}</span>}
    </label>
  )
}

export function NumInput({ value, onChange, placeholder, step, className = '' }: {
  value: number | null | undefined; onChange: (v: number | null) => void; placeholder?: string; step?: string; className?: string
}) {
  // Local text state so typing "7." or clearing the box isn't clobbered by the async database round-trip.
  const [txt, setTxt] = useState(value == null ? '' : String(value))
  useEffect(() => {
    if ((value ?? null) !== (txt === '' ? null : +txt)) setTxt(value == null ? '' : String(value))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value])
  return (
    <input type="number" inputMode="decimal" step={step} className={`${inputCls} ${className}`} placeholder={placeholder} value={txt}
      onChange={(e) => { setTxt(e.target.value); onChange(e.target.value === '' || Number.isNaN(+e.target.value) ? null : +e.target.value) }} />
  )
}

export function TextInput({ value, onCommit, placeholder, className = '' }: { value: string; onCommit: (v: string) => void; placeholder?: string; className?: string }) {
  const [txt, setTxt] = useState(value)
  useEffect(() => setTxt(value), [value])
  return <input className={`${inputCls} ${className}`} placeholder={placeholder} value={txt} onChange={(e) => setTxt(e.target.value)} onBlur={() => txt !== value && onCommit(txt)} />
}

export function Stat({ label, value, sub }: { label: string; value: ReactNode; sub?: ReactNode }) {
  return (
    <div className="rounded-[.875rem] bg-zinc-800/60 px-3 py-2.5 min-w-0">
      <p className="text-[11px] text-zinc-500">{label}</p>
      <p className="text-lg font-semibold tabular-nums leading-tight">{value}</p>
      {sub && <p className="text-[11px] text-zinc-500">{sub}</p>}
    </div>
  )
}

/** Interactive line/area chart: hover or drag to scrub, tap to pin. Optional trend line and highlighted points (e.g. PRs). */
export type ChartPoint = { x: string; y: number; label?: string; flag?: boolean }
export function Chart({ points, trend, color = '#a3e635', unit = '', height = 150, format }: {
  points: ChartPoint[]; trend?: { x: string; y: number }[]; color?: string; unit?: string; height?: number; format?: (n: number) => string
}) {
  const ref = useRef<SVGSVGElement>(null)
  const [sel, setSel] = useState<number | null>(null)
  const fmt = format ?? ((n: number) => String(Math.round(n * 10) / 10))
  useEffect(() => setSel(null), [points.length])
  if (points.length < 2) return <p className="text-xs text-zinc-500 py-3">Needs at least 2 data points.</p>

  const W = 320, H = height, pl = 34, pr = 8, pt = 10, pb = 20
  const all = [...points.map((p) => p.y), ...(trend?.map((t) => t.y) ?? [])]
  let lo = Math.min(...all), hi = Math.max(...all)
  const nonNeg = lo >= 0
  const pad = (hi - lo || Math.abs(hi) * 0.1 || 1) * 0.15
  lo -= pad; hi += pad
  if (nonNeg && lo < 0) lo = 0
  const X = (i: number) => pl + (i / (points.length - 1)) * (W - pl - pr)
  const Y = (v: number) => pt + (1 - (v - lo) / (hi - lo)) * (H - pt - pb)
  const xi = new Map(points.map((p, i) => [p.x, i]))
  const path = points.map((p, i) => `${i ? 'L' : 'M'}${X(i).toFixed(1)},${Y(p.y).toFixed(1)}`).join(' ')
  const area = `${path} L${X(points.length - 1)},${H - pb} L${X(0)},${H - pb} Z`
  const tpath = trend?.filter((t) => xi.has(t.x)).map((t, i) => `${i ? 'L' : 'M'}${X(xi.get(t.x)!).toFixed(1)},${Y(t.y).toFixed(1)}`).join(' ')
  const ticks = [0, 0.5, 1].map((f) => lo + (hi - lo) * f)

  const pick = (clientX: number) => {
    const r = ref.current!.getBoundingClientRect()
    const px = ((clientX - r.left) / r.width) * W
    setSel(Math.max(0, Math.min(points.length - 1, Math.round(((px - pl) / (W - pl - pr)) * (points.length - 1)))))
  }
  const s = sel !== null ? points[sel] : null

  return (
    <div>
      <div className="h-5 text-xs flex justify-between text-zinc-400 tabular-nums">
        <span>{s ? s.label ?? s.x : `${points[0].x} → ${points[points.length - 1].x}`}</span>
        <span className="text-zinc-100 font-medium">{s ? `${fmt(s.y)} ${unit}` : `${fmt(points[points.length - 1].y)} ${unit} latest`}{s?.flag ? ' · PR' : ''}</span>
      </div>
      <svg ref={ref} viewBox={`0 0 ${W} ${H}`} className="w-full touch-pan-y select-none" style={{ height }}
        onPointerMove={(e) => pick(e.clientX)} onPointerDown={(e) => pick(e.clientX)} onPointerLeave={() => setSel(null)}>
        {ticks.map((t, i) => (
          <g key={i}>
            <line x1={pl} x2={W - pr} y1={Y(t)} y2={Y(t)} stroke="#27272a" strokeWidth="1" />
            <text x={pl - 4} y={Y(t) + 3} fontSize="9" fill="#71717a" textAnchor="end">{fmt(t)}</text>
          </g>
        ))}
        <path d={area} fill={color} opacity="0.1" />
        {tpath && <path d={tpath} fill="none" stroke="#e4e4e7" strokeWidth="1.5" strokeDasharray="4 3" />}
        <path d={path} fill="none" stroke={color} strokeWidth="2.25" strokeLinejoin="round" strokeLinecap="round" />
        {points.map((p, i) => p.flag && <circle key={i} cx={X(i)} cy={Y(p.y)} r="4" fill="#facc15" stroke="#09090b" strokeWidth="1.5" />)}
        {points.length <= 40 && points.map((p, i) => !p.flag && <circle key={i} cx={X(i)} cy={Y(p.y)} r="2" fill={color} />)}
        {sel !== null && s && (
          <g>
            <line x1={X(sel)} x2={X(sel)} y1={pt} y2={H - pb} stroke="#a1a1aa" strokeWidth="1" strokeDasharray="3 3" />
            <circle cx={X(sel)} cy={Y(s.y)} r="5" fill={color} stroke="#09090b" strokeWidth="2" />
          </g>
        )}
        <text x={pl} y={H - 5} fontSize="9" fill="#71717a">{points[0].x.slice(5)}</text>
        <text x={W - pr} y={H - 5} fontSize="9" fill="#71717a" textAnchor="end">{points[points.length - 1].x.slice(5)}</text>
      </svg>
    </div>
  )
}

export function Toast({ msg, onDone }: { msg: string | null; onDone: () => void }) {
  useEffect(() => { if (msg) { const t = setTimeout(onDone, 2500); return () => clearTimeout(t) } }, [msg, onDone])
  if (!msg) return null
  return <div className="fixed bottom-24 inset-x-0 z-[60] flex justify-center pointer-events-none"><div className="px-4 py-2 rounded-full bg-zinc-100 text-black text-sm shadow-lg">{msg}</div></div>
}
