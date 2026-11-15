import { useEffect, useMemo, useRef, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { Link } from 'react-router-dom'
import { db } from '../lib/db'
import { useExerciseIndex, useProfile, useSettings } from '../lib/hooks'
import { GROUP_LABEL, MONTHS, TIER_LABEL, computeBadges, nowCard, usualHour, weeklyTarget, wrappedCard, wrappedOffer, wrappedStats, type Badge } from '../lib/achievements'
import { useAdaptive } from '../lib/adaptiveStore'
import { MEAL_NOW, eatNext, habits, loadPrefs } from '../lib/mealplan'
import { loadFoods, type FoodItem } from '../data/foodDb'
import { Bar, Btn, Card, Chips, Empty, Sheet } from '../lib/ui'
import { prettyDate, shiftDate, todayStr } from '../lib/util'

const TIER_COLOR = { bronze: '#cd8a4f', silver: '#cfd5dc', gold: '#f2c14e', legend: '#c58bff' }
const ICON: Record<Badge['group'], string> = { workouts: '🏋️', streaks: '🔥', medals: '🏅', tonnage: '⚖️', plates: '🛞', habits: '⏰' }

function Medal({ b, size = 64 }: { b: Badge; size?: number }) {
  const on = !!b.earnedAt, c = TIER_COLOR[b.tier]
  return (
    <div className="grid place-items-center rounded-full" style={{ width: size, height: size, background: on ? c : '#27272a', boxShadow: on ? `0 0 18px ${c}55` : 'none', opacity: on ? 1 : 0.6 }}>
      <span style={{ fontSize: size * 0.42, filter: on ? 'none' : 'grayscale(1)' }}>{ICON[b.group]}</span>
    </div>
  )
}

export function BadgesView() {
  const idx = useExerciseIndex(), profile = useProfile()
  const workouts = useLiveQuery(() => db.workouts.toArray(), []) ?? []
  const weights = useLiveQuery(() => db.bodyWeight.toArray(), []) ?? []
  const routines = useLiveQuery(() => db.routines.toArray(), []) ?? []
  const [open, setOpen] = useState<Badge | null>(null)
  const badges = useMemo(() => {
    const days = routines[0]?.days.reduce((s, d) => s + d.weekdays.length, 0) ?? 0
    return computeBadges({ workouts, idx, weights, minSessions: weeklyTarget(profile.trainingDays, days), today: todayStr() })
  }, [workouts, idx, weights, routines, profile.trainingDays])
  const earned = badges.filter((b) => b.earnedAt)
  const latest = [...earned].sort((a, b) => b.earnedAt!.localeCompare(a.earnedAt!))[0]
  const almost = badges.filter((b) => !b.earnedAt && b.current > 0).sort((a, b) => b.current / b.target - a.current / a.target).slice(0, 3)
  const label = (b: Badge) => `${b.current.toLocaleString('en-GB')} of ${b.target.toLocaleString('en-GB')}`
  return (
    <div className="space-y-4">
      <Card className="flex items-center gap-4">
        {latest && <button onClick={() => setOpen(latest)}><Medal b={latest} size={72} /></button>}
        <div className="min-w-0 flex-1 space-y-1">
          <p className="text-2xl font-bold tabular-nums">{earned.length}<span className="text-base text-zinc-500 font-normal"> of {badges.length}</span></p>
          <p className="text-xs text-zinc-400">badges collected{latest ? `. Latest: ${latest.title}, ${prettyDate(latest.earnedAt!)}` : ''}</p>
          <Bar value={earned.length} max={badges.length} />
        </div>
      </Card>
      {almost.length > 0 && (
        <div className="space-y-2">
          <h3 className="font-semibold">Almost there</h3>
          {almost.map((b) => (
            <button key={b.id} onClick={() => setOpen(b)} className="w-full text-left rounded-[1rem] bg-zinc-900 p-3 flex items-center gap-3">
              <Medal b={b} size={48} />
              <span className="min-w-0 flex-1"><span className="block text-sm font-medium">{b.title}</span><span className="block text-xs text-zinc-500">{b.goal}</span><span className="block text-xs text-lime-400 font-semibold tabular-nums">{label(b)}</span><Bar value={b.current} max={b.target} /></span>
            </button>
          ))}
        </div>
      )}
      {(Object.keys(GROUP_LABEL) as Badge['group'][]).map((g) => {
        const list = badges.filter((b) => b.group === g)
        return (
          <div key={g} className="space-y-2">
            <h3 className="font-semibold">{GROUP_LABEL[g]}<span className="ml-2 text-xs text-zinc-500 tabular-nums">{list.filter((b) => b.earnedAt).length}/{list.length}</span></h3>
            <div className="grid grid-cols-3 gap-2">
              {list.map((b) => (
                <button key={b.id} onClick={() => setOpen(b)} className="rounded-[1rem] bg-zinc-900 px-1.5 pt-3 pb-2.5 flex flex-col items-center gap-1.5 text-center">
                  <Medal b={b} />
                  <span className={`text-[11px] font-semibold leading-tight line-clamp-2 ${b.earnedAt ? 'text-zinc-100' : 'text-zinc-500'}`}>{b.title}</span>
                  <span className={`text-[10px] tabular-nums ${b.earnedAt ? 'text-zinc-500' : 'text-lime-400 font-semibold'}`}>{b.earnedAt ? TIER_LABEL[b.tier] : label(b)}</span>
                </button>
              ))}
            </div>
          </div>
        )
      })}
      <Sheet open={!!open} onClose={() => setOpen(null)} title={open?.title ?? 'Badge'}>
        {open && (
          <div className="flex flex-col items-center gap-2 text-center">
            <Medal b={open} size={140} />
            <p className="text-xs text-zinc-400 font-semibold">{TIER_LABEL[open.tier]} · {GROUP_LABEL[open.group]}</p>
            <p className="text-sm">{open.goal}.</p>
            {open.earnedAt ? <p className="text-xs text-zinc-500">Earned {prettyDate(open.earnedAt)}</p> : <div className="w-full"><Bar value={open.current} max={open.target} /><p className="text-xs text-zinc-500 mt-1 tabular-nums">{label(open)}</p></div>}
          </div>
        )}
      </Sheet>
    </div>
  )
}

// ───────── Wrapped + share card ─────────
type Card = ReturnType<typeof wrappedCard>
const ACCENTS = [{ v: '#d2f25c', n: 'Lime' }, { v: '#ffffff', n: 'White' }, { v: '#ffb020', n: 'Amber' }, { v: '#5cc8ff', n: 'Sky' }, { v: '#ff6b5b', n: 'Coral' }, { v: '#c58bff', n: 'Violet' }]
const DESIGNS = [{ id: 'A', name: 'Stats' }, { id: 'G', name: 'Rings' }, { id: 'B', name: 'Receipt' }] as const
type DesignId = (typeof DESIGNS)[number]['id']

function drawCard(cv: HTMLCanvasElement, c: Card, design: DesignId, accent: string, name: string | null) {
  const W = 1080, H = 1920, x = cv.getContext('2d')!
  cv.width = W; cv.height = H
  const g = x.createLinearGradient(0, 0, 0, H)
  g.addColorStop(0, '#0b0d08'); g.addColorStop(1, '#000')
  x.fillStyle = g; x.fillRect(0, 0, W, H)
  const font = (w: number, s: number, mono = false) => `${w} ${s}px ${mono ? "ui-monospace, 'SF Mono', Menlo, monospace" : "-apple-system, 'Inter', 'Segoe UI', sans-serif"}`
  const T = (t: string, px: number, py: number, f: string, col: string, align: CanvasTextAlign = 'left', alpha = 1) => { x.font = f; x.fillStyle = col; x.textAlign = align; x.textBaseline = 'alphabetic'; x.globalAlpha = alpha; x.fillText(t, px, py); x.globalAlpha = 1 }
  const fit = (t: string, maxW: number, w: number, s: number, mono = false) => { let z = s; x.font = font(w, z, mono); while (z > 14 && x.measureText(t).width > maxW) { z -= 2; x.font = font(w, z, mono) } return z }
  const pill = (t: string, px: number, py: number, filled: boolean) => { x.font = font(600, 34); const w = x.measureText(t).width + 56; x.beginPath(); x.roundRect(px, py, w, 64, 32); x.fillStyle = filled ? accent : 'rgba(255,255,255,0.14)'; x.fill(); T(t, px + 28, py + 43, font(600, 34), filled ? '#10130a' : '#fff'); return w + 14 }
  if (name) T(`${name}'s`, 88, 150, font(600, 38), '#fff', 'left', 0.7)
  if (design === 'A') {
    T(c.title, 88, 330, font(700, 52), accent); T(c.sub, 88, 392, font(400, 40), '#fff', 'left', 0.7)
    let sz = 400
    const span = (z: number) => { x.font = font(800, z); const a = x.measureText(c.big.v).width; x.font = font(600, z * 0.3); return a + 24 + x.measureText(c.big.u).width }
    while (sz > 40 && span(sz) > 904) sz -= 8
    x.font = font(800, sz); const bw = x.measureText(c.big.v).width
    T(c.big.v, 88, 780, font(800, sz), '#fff'); T(c.big.u, 88 + bw + 24, 780, font(600, sz * 0.3), accent)
    T(`${c.big.l}. ${c.note}`, 88, 880, font(400, 42), '#fff', 'left', 0.85)
    x.fillStyle = 'rgba(255,255,255,0.2)'; x.fillRect(88, 960, 904, 3)
    const items = [...c.stats, ...(c.more ? [c.more] : [])].slice(0, 4)
    items.forEach((s, i) => { const px = 88 + (i % 2) * 464, py = 1050 + Math.floor(i / 2) * 250; T(s.l, px, py, font(400, 36), '#fff', 'left', 0.7); const v = fit(s.v, 330, 700, 120); x.font = font(700, v); const w = x.measureText(s.v).width; T(s.v, px, py + 130, font(700, v), '#fff'); if (s.u) T(s.u, px + w + 12, py + 130, font(500, v * 0.45), '#fff', 'left', 0.7) })
    let px = 88; c.chips.slice(0, 3).forEach((t, i) => { px += pill(t, px, 1620, i === 0) })
  } else if (design === 'G') {
    T(c.title, 88, 330, font(700, 56), accent); T(c.sub, 88, 396, font(400, 40), '#fff', 'left', 0.7)
    c.rings.forEach((r, i) => {
      const cx = 540, cy = 640 + i * 400, rad = 150
      x.lineWidth = 42; x.lineCap = 'round'
      x.strokeStyle = 'rgba(255,255,255,0.14)'; x.beginPath(); x.arc(cx - 260, cy, rad, 0, Math.PI * 2); x.stroke()
      x.strokeStyle = accent; x.beginPath(); x.arc(cx - 260, cy, rad, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * Math.max(0.02, r.frac)); x.stroke()
      x.font = font(800, 130); const w = x.measureText(r.v).width
      T(r.v, cx - 20, cy + 30, font(800, 130), '#fff'); if (r.u) T(r.u, cx - 20 + w + 10, cy + 30, font(500, 56), '#fff', 'left', 0.6)
      T(r.l, cx - 20, cy + 90, font(500, 40), accent)
    })
    T(c.ringsNote, 88, 1780, font(400, 34), '#fff', 'left', 0.6)
  } else {
    const L = 120, R = 960; x.setLineDash([]); 
    x.beginPath(); x.roundRect(88, 260, 904, 1330, 24); x.fillStyle = 'rgba(255,255,255,0.06)'; x.fill()
    T(c.title.toUpperCase(), 540, 380, font(700, 56, true), accent, 'center'); T(c.short, 540, 440, font(400, 36, true), '#fff', 'center', 0.6)
    const rows: [string, string][] = [['WORKOUTS', c.big.v], ...c.stats.map((s) => [s.l.toUpperCase(), `${s.v}${s.u ? ' ' + s.u : ''}`] as [string, string]), ...(c.more ? [[c.more.l.toUpperCase().slice(0, 18), `${c.more.v} ${c.more.u}`] as [string, string]] : []), ...c.bars.map((b) => [b.l.toUpperCase(), b.label] as [string, string])]
    rows.slice(0, 9).forEach(([k, v], i) => { const y = 560 + i * 100; T(k, L, y, font(500, 40, true), '#fff'); T(v, R, y, font(700, 40, true), '#fff', 'right'); x.setLineDash([4, 10]); x.strokeStyle = 'rgba(255,255,255,0.3)'; x.lineWidth = 2; x.beginPath(); x.moveTo(L + x.measureText(k).width + 12, y); x.lineTo(R - x.measureText(v).width - 12, y); x.stroke(); x.setLineDash([]) })
    T(c.note.toUpperCase(), 540, 1500, font(500, 34, true), accent, 'center')
  }
  T('Made with Gym Tracker', W - 88, 1830, font(500, 32), '#fff', 'right', 0.45)
}

export function WrappedView() {
  const idx = useExerciseIndex()
  const workouts = useLiveQuery(() => db.workouts.toArray(), []) ?? []
  const now = new Date(), offer = wrappedOffer(now)
  const [pick, setPick] = useState<'month' | 'year' | 'custom'>('month')
  const [ym, setYm] = useState(() => ({ y: offer.month.year, m: offer.month.month }))
  const [design, setDesign] = useState<DesignId>('A')
  const [accent, setAccent] = useState(ACCENTS[0].v)
  const [name, setName] = useState('')
  const cv = useRef<HTMLCanvasElement>(null)
  const years = [...new Set(workouts.filter((w) => w.finishedAt).map((w) => +w.date.slice(0, 4)))].sort((a, b) => b - a)
  const stats = useMemo(() => {
    if (pick === 'year') return wrappedStats(workouts, idx, { year: offer.year ?? now.getFullYear() - (now.getMonth() === 0 ? 1 : 0), month: null })
    return wrappedStats(workouts, idx, { year: ym.y, month: ym.m })
  }, [workouts, idx, pick, ym]) // eslint-disable-line react-hooks/exhaustive-deps
  const card = useMemo(() => (stats ? wrappedCard(stats, now) : null), [stats]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (cv.current && card) drawCard(cv.current, card, design, accent, name.trim() || null) }, [card, design, accent, name])
  const blob = () => new Promise<Blob | null>((r) => cv.current?.toBlob(r, 'image/png') ?? r(null))
  async function save() { const b = await blob(); if (b) { const u = URL.createObjectURL(b), a = document.createElement('a'); a.href = u; a.download = `wrapped-${stats?.key}.png`; a.click(); setTimeout(() => URL.revokeObjectURL(u), 4000) } }
  async function share() {
    const b = await blob(); if (!b) return
    const f = new File([b], `wrapped-${stats?.key}.png`, { type: 'image/png' })
    if (navigator.canShare?.({ files: [f] })) { try { await navigator.share({ files: [f], title: card?.title }) } catch { /* cancelled */ } } else save()
  }
  const monthsWithData = [...new Set(workouts.filter((w) => w.finishedAt).map((w) => w.date.slice(0, 7)))].sort().reverse()
  return (
    <div className="space-y-4">
      <Chips value={pick} onChange={setPick} options={[{ v: 'month', label: 'Month' }, { v: 'year', label: 'Year' }]} />
      {pick === 'month' && (
        <select className="h-11 w-full rounded-[.875rem] bg-zinc-800 px-3 text-sm" value={`${ym.y}-${String(ym.m + 1).padStart(2, '0')}`} onChange={(e) => { const [y, m] = e.target.value.split('-'); setYm({ y: +y, m: +m - 1 }) }}>
          {[...new Set([`${offer.month.year}-${String(offer.month.month + 1).padStart(2, '0')}`, ...monthsWithData])].map((k) => <option key={k} value={k}>{MONTHS[+k.slice(5) - 1]} {k.slice(0, 4)}</option>)}
        </select>
      )}
      {pick === 'year' && years.length > 0 && <p className="text-xs text-zinc-500">Showing {offer.year ?? now.getFullYear()}. Years with workouts: {years.join(', ')}.</p>}
      {!stats || !card ? <Empty>Nothing to wrap yet. Log at least 3 workouts in a period and its recap appears here.</Empty> : (
        <>
          <canvas ref={cv} className="w-full rounded-[1.25rem] border border-zinc-800" style={{ aspectRatio: '1080 / 1920' }} />
          <div className="space-y-2">
            <Chips value={design} onChange={setDesign} options={DESIGNS.map((d) => ({ v: d.id, label: d.name }))} />
            <div className="flex gap-2">{ACCENTS.map((a) => <button key={a.v} aria-label={a.n} onClick={() => setAccent(a.v)} className={`h-8 w-8 rounded-full border-2 ${accent === a.v ? 'border-white' : 'border-transparent'}`} style={{ background: a.v }} />)}</div>
            <input className="h-11 w-full rounded-[.875rem] bg-zinc-800 px-3 text-sm placeholder:text-zinc-500" placeholder="Your name on the card (optional)" value={name} onChange={(e) => setName(e.target.value)} />
            <div className="flex gap-2"><Btn className="flex-1" onClick={share}>Share</Btn><Btn variant="ghost" className="flex-1" onClick={save}>Save PNG</Btn></div>
          </div>
        </>
      )}
    </div>
  )
}

// ───────── Home "Now" card ─────────
export function NowCardView({ workoutOpen }: { workoutOpen: boolean }) {
  const s = useSettings(), idx = useExerciseIndex()
  const ad = useAdaptive()
  const [foods, setFoods] = useState<FoodItem[]>([])
  useEffect(() => { loadFoods().then(setFoods) }, [])
  const data = useLiveQuery(async () => ({ food: await db.foodLog.toArray(), weights: await db.bodyWeight.toArray(), workouts: await db.workouts.toArray(), routines: await db.routines.toArray() }), [])
  const card = useMemo(() => {
    if (!data) return null
    const now = new Date(), today = todayStr(), hour = now.getHours()
    const mine = data.food.filter((e) => e.date === today)
    const eaten = mine.reduce((a, e) => ({ kcal: a.kcal + e.kcal, p: a.p + e.p }), { kcal: 0, p: 0 })
    const kcalLeft = s.kcal ? s.kcal - eaten.kcal : null, proteinLeft = s.p ? s.p - eaten.p : null
    const meal = MEAL_NOW(hour)
    const foodDays7 = new Set(data.food.filter((e) => e.date > shiftDate(today, -7) && e.date <= today).map((e) => e.date)).size
    const map = new Map(foods.map((f) => [f.id, f]))
    const prefs = loadPrefs()
    const fits = hour >= 19 && kcalLeft !== null && map.size
      ? eatNext({ remaining: { kcal: kcalLeft, proteinG: proteinLeft ?? 0 }, meal, foods: map, habits: habits(data.food, today), setting: prefs.setting, budget: prefs.budget, diet: (localStorage.getItem('overload.diet') as 'veg' | 'egg' | 'nonveg' | 'jain' | null) ?? 'veg' }).map((x) => (x.pair ? `${x.food.name} + milk` : x.food.name))
      : []
    const w14 = data.weights.filter((w) => w.date >= shiftDate(today, -14))
    const done = data.workouts.filter((w) => w.finishedAt).sort((a, b) => a.startedAt - b.startedAt).slice(-8)
    const routine = data.routines[0]
    const planned = routine?.days.find((d) => d.weekdays.includes(now.getDay()))?.name ?? null
    const offer = wrappedOffer(now)
    const wr = wrappedStats(data.workouts, idx, offer.month)
    return nowCard({
      hour, dayOfMonth: now.getDate(), reviewChanges: ad && !ad.record && ad.win.started ? ad.decision?.changes.length ?? 0 : 0, wrappedMonth: wr ? MONTHS[offer.month.month] : null,
      weighedToday: data.weights.some((w) => w.date === today), weighIns14: w14.length, usualWeighHour: usualHour(w14.map((w) => new Date(`${w.date}T08:00:00`).getTime())),
      plannedDay: planned, usualGymHour: usualHour(done.map((w) => w.startedAt)), workoutOpen, foodDays7, kcalLeft, proteinLeft, mealNow: meal, mealLogged: mine.some((e) => e.meal.toLowerCase() === meal), fits,
    })
  }, [data, foods, s.kcal, s.p, idx, ad, workoutOpen])
  if (!card) return null
  const to = card.to.startsWith('/progress#') ? `/progress?tab=${card.to.split('#')[1]}` : card.to
  return (
    <Card className="flex items-center gap-3 border border-lime-400/30">
      <div className="min-w-0 flex-1"><p className="text-[11px] uppercase tracking-wide text-lime-400">Now</p><p className="font-semibold text-sm">{card.title}</p><p className="text-xs text-zinc-400">{card.detail}</p></div>
      <Link to={to} className="shrink-0 h-9 px-4 grid place-items-center rounded-full bg-lime-400 text-black text-sm font-medium">{card.action}</Link>
    </Card>
  )
}
