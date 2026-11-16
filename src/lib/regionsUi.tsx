import { useState } from 'react'
import { Card } from './ui'
import { regionSource, regionsFor } from './science'

/** What each exercise works: approximate share of the work by muscle region (EMG based), with confidence, note and sources. */
export function RegionsCard({ exKey }: { exKey: string }) {
  const r = regionsFor(exKey)
  const [open, setOpen] = useState(false)
  if (!r) return null
  return (
    <Card className="space-y-2">
      <div className="flex justify-between items-baseline"><h3 className="font-semibold">What it works</h3><span className={`text-[11px] ${r.confidence === 'low' ? 'text-amber-300' : 'text-zinc-500'}`}>{r.confidence === 'low' ? 'estimated, borrowed from a similar move' : `${r.confidence} confidence`}</span></div>
      {[...r.regions].sort((a, b) => b.share - a.share).map((g) => (
        <div key={g.region} className="flex items-center gap-3 text-sm">
          <span className="w-28 text-zinc-300 truncate">{g.region}</span>
          <div className="flex-1 h-1.5 rounded-full bg-zinc-800 overflow-hidden"><div className="h-full bg-lime-400" style={{ width: `${g.share}%` }} /></div>
          <span className="w-10 text-right tabular-nums text-xs">{g.share}%</span>
        </div>
      ))}
      <p className="text-xs text-zinc-400">{r.note}</p>
      <button className="text-xs text-lime-400" onClick={() => setOpen(!open)}>{open ? 'Hide sources' : `Sources (${r.sources.length})`}</button>
      {open && (
        <ul className="text-[11px] text-zinc-500 space-y-1">
          {r.sources.map((id) => {
            const s = regionSource(id)
            if (!s) return <li key={id}>{id}</li>
            const href = s.doi ? `https://doi.org/${s.doi}` : s.url
            return <li key={id}>{s.authors.split(',').slice(0, 2).join(',')}{s.authors.split(',').length > 2 ? ' et al.' : ''} ({s.year}). {s.title}. {s.journal}. {href && <a className="text-sky-400 underline" href={href} target="_blank" rel="noreferrer">link</a>}</li>
          })}
        </ul>
      )}
      <p className="text-[11px] text-zinc-600">Rounded to 5%. Muscle activity is not the load each muscle carries, and form changes it. A guide, not a measurement.</p>
    </Card>
  )
}
