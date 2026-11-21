import { useEffect, useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, type CustomFood, type FoodEntry } from '../lib/db'
import { useSettings } from '../lib/hooks'
import { customToItem, defaultAmountFor, formatAmount, gramsPerUnit, loadFoods, nutrients, searchFoods, unitLabel, type FoodItem, type Rich, type Size, type Unit } from '../data/foodDb'
import { Bar, Btn, Card, Chips, Empty, Sheet, inputCls } from '../lib/ui'
import { mealSuggestions, quickFoods } from '../lib/foodinsights'
import { FoodInsights } from './FoodInsights'
import { EatNext, LeftToday, MealPlanView } from './MealPlan'
import { deleteWithUndo } from '../lib/undo'
import { prettyDate, round0, round1, shiftDate, todayStr } from '../lib/util'

const MEALS = ['Breakfast', 'Lunch', 'Snacks', 'Dinner'] as const

export default function FoodPage() {
  const [date, setDate] = useState(todayStr())
  const [adding, setAdding] = useState<FoodEntry['meal'] | null>(null)
  const [goalsOpen, setGoalsOpen] = useState(false)
  const [view, setView] = useState<'log' | 'plan' | 'insights'>('log')
  const allLogs = useLiveQuery(() => db.foodLog.toArray(), []) ?? []
  const entries = useLiveQuery(() => db.foodLog.where('date').equals(date).toArray(), [date]) ?? []
  const water = useLiveQuery(() => db.water.get(date), [date])?.ml ?? 0
  const s = useSettings()

  const t = entries.reduce((a, e) => ({ kcal: a.kcal + e.kcal, p: a.p + e.p, c: a.c + e.c, f: a.f + e.f }), { kcal: 0, p: 0, c: 0, f: 0 })
  const addWater = (ml: number) => db.water.put({ date, ml: Math.max(0, water + ml) })

  async function relog(items: FoodEntry[], meal: FoodEntry['meal']) {
    await db.foodLog.bulkAdd(items.map(({ id: _id, ...e }) => ({ ...e, date, meal })))
  }

  return (
    <div className="space-y-4">
      <Chips value={view} onChange={setView} options={[{ v: 'log', label: 'Log' }, { v: 'plan', label: 'Meal plan' }, { v: 'insights', label: 'Insights' }]} />
      <div className="flex items-center justify-between">
        <button className="h-10 w-10 rounded-full bg-zinc-900" onClick={() => setDate(shiftDate(date, -1))}>‹</button>
        <button className="font-semibold" onClick={() => setDate(todayStr())}>{date === todayStr() ? 'Today' : prettyDate(date)}</button>
        <button className="h-10 w-10 rounded-full bg-zinc-900 disabled:opacity-30" disabled={date >= todayStr()} onClick={() => setDate(shiftDate(date, 1))}>›</button>
      </div>

      {view === 'plan' ? <MealPlanView /> : view === 'insights' ? <FoodInsights date={date} /> : <>
      <Card className="space-y-3">
        <div className="flex items-end justify-between">
          <div>
            <p className="text-3xl font-bold tabular-nums">{round0(t.kcal)}<span className="text-base text-zinc-500 font-normal"> / {s.kcal} kcal</span></p>
            <p className="text-xs text-zinc-500">{s.kcal - t.kcal >= 0 ? `${round0(s.kcal - t.kcal)} left` : `${round0(t.kcal - s.kcal)} over`}</p>
          </div>
          <button className="text-xs text-lime-400 h-8" onClick={() => setGoalsOpen(true)}>Edit goals</button>
        </div>
        <Bar value={t.kcal} max={s.kcal} color={t.kcal > s.kcal ? 'bg-red-400' : 'bg-lime-400'} />
        <div className="grid grid-cols-3 gap-3 text-xs">
          {([['Protein', t.p, s.p, 'bg-sky-400'], ['Carbs', t.c, s.c, 'bg-amber-400'], ['Fat', t.f, s.f, 'bg-pink-400']] as const).map(([n, v, g, c]) => (
            <div key={n} className="space-y-1">
              <div className="flex justify-between"><span className="text-zinc-400">{n}</span><span className="tabular-nums">{round0(v)}/{g}g</span></div>
              <Bar value={v} max={g} color={c} />
            </div>
          ))}
        </div>
      </Card>

      <Card className="space-y-2">
        <div className="flex justify-between text-sm"><span className="font-semibold">Water</span><span className="tabular-nums text-zinc-400">{water} / {s.waterGoal} ml</span></div>
        <Bar value={water} max={s.waterGoal} color="bg-cyan-400" />
        <div className="flex gap-2">
          {[250, 500].map((n) => <Btn key={n} variant="ghost" className="flex-1 h-9" onClick={() => addWater(n)}>+{n}</Btn>)}
          <Btn variant="ghost" className="h-9" onClick={() => addWater(-250)}>–250</Btn>
        </div>
      </Card>

      <LeftToday date={date} />
      <EatNext date={date} />
      {MEALS.map((meal) => {
        const items = entries.filter((e) => e.meal === meal)
        return (
          <Card key={meal} className="space-y-2">
            <div className="flex justify-between items-center">
              <h3 className="font-semibold">{meal}</h3>
              <span className="text-xs text-zinc-500 tabular-nums">{round0(items.reduce((a, e) => a + e.kcal, 0))} kcal</span>
            </div>
            {items.map((e) => (
              <div key={e.id} className="flex justify-between items-center text-sm border-t border-zinc-800 pt-2">
                <div>
                  <p>{e.name}</p>
                  <p className="text-xs text-zinc-500">{e.qty} × {e.serving} · P{round0(e.p)} C{round0(e.c)} F{round0(e.f)}</p>
                </div>
                <div className="flex items-center gap-2">
                  <span className="tabular-nums">{round0(e.kcal)}</span>
                  <button className="text-zinc-500 h-8 w-8" onClick={() => deleteWithUndo(db.foodLog, e.id!, `Removed ${e.name}`)}>✕</button>
                </div>
              </div>
            ))}
            {!items.length && mealSuggestions(allLogs, meal, date).map((sg) => (
              <button key={sg.kind} onClick={() => relog(sg.items, meal)} className="w-full text-left rounded-[.875rem] bg-zinc-800/70 px-3 py-2 text-xs active:bg-zinc-700">
                <span className="text-lime-400 font-medium">{sg.kind === 'usual' ? `Your usual · ${sg.times}× in 4 weeks` : 'Same as last time'}</span>
                <span className="block text-zinc-300 mt-0.5">{sg.items.map((i) => i.name).join(', ')} · {round0(sg.items.reduce((a, i) => a + i.kcal, 0))} kcal · tap to log</span>
              </button>
            ))}
            <Btn variant="ghost" className="w-full h-9" onClick={() => setAdding(meal)}>+ Add food</Btn>
          </Card>
        )
      })}
      </>}

      {view === 'log' && adding && <AddFood meal={adding} date={date} onClose={() => setAdding(null)} />}
      <Goals open={goalsOpen} onClose={() => setGoalsOpen(false)} />
    </div>
  )
}

const toItem = customToItem

function AddFood({ meal, date, onClose }: { meal: FoodEntry['meal']; date: string; onClose: () => void }) {
  const [q, setQ] = useState('')
  const [foods, setFoods] = useState<FoodItem[]>([])
  const [picked, setPicked] = useState<FoodItem | null>(null)
  const [unit, setUnit] = useState<Unit>('g')
  const [amount, setAmount] = useState(1)
  const [size, setSize] = useState<Size>('medium')
  const [rich, setRich] = useState<Rich>('normal')
  const [mealSel, setMealSel] = useState(meal)
  const [custom, setCustom] = useState(false)
  const [editing, setEditing] = useState<CustomFood | null>(null)
  const [tab, setTab] = useState<'all' | 'mine'>('all')
  const customs = useLiveQuery(() => db.customFoods.toArray(), []) ?? []
  const allLogs = useLiveQuery(() => db.foodLog.toArray(), []) ?? []
  const quick = useMemo(() => quickFoods(allLogs, meal, date), [allLogs, meal, date])
  const again = async (e: FoodEntry) => { const { id: _id, ...rest } = e; await db.foodLog.add({ ...rest, date, meal: mealSel }); onClose() }

  useEffect(() => { loadFoods().then(setFoods) }, [])

  const results = useMemo(() => searchFoods([...customs.map(toItem), ...foods], q), [q, foods, customs])
  // My foods: only the foods you created, the ones you log most first; typing narrows the list by name.
  const mine = useMemo(() => {
    const used = new Map<string, number>()
    for (const e of allLogs) if (e.foodId) used.set(e.foodId, (used.get(e.foodId) ?? 0) + 1)
    const w = q.trim().toLowerCase()
    return customs.map(toItem).filter((f) => !w || f.name.toLowerCase().includes(w)).sort((a, b) => (used.get(b.id) ?? 0) - (used.get(a.id) ?? 0) || a.name.localeCompare(b.name))
  }, [customs, allLogs, q])

  function pick(f: FoodItem) {
    const u = f.units[0]
    setPicked(f); setUnit(u); setAmount(defaultAmountFor(f, u)); setSize('medium'); setRich('normal')
  }

  const gPer = picked ? gramsPerUnit(picked, unit, size) : null
  const grams = gPer ? gPer * amount : 0
  const n = picked && grams ? nutrients(picked, grams, rich) : null
  const step = unit === 'g' || unit === 'ml' ? 10 : 0.25

  async function log() {
    if (!picked || !n) return
    await db.foodLog.add({
      date, meal: mealSel, name: picked.name, qty: amount,
      serving: `${unitLabel(picked, unit, amount)}${unit === 'katori' || unit === 'cup' ? ` (${size})` : ''}${rich !== 'normal' ? `, ${rich}` : ''}`,
      foodId: picked.id, unit, size, rich,
      kcal: round1(n.kcal), p: round1(n.p), c: round1(n.c), f: round1(n.f), fib: round1(n.fib),
    })
    onClose()
  }

  return (
    <Sheet open onClose={onClose} title={picked ? picked.name : editing ? 'Edit food' : custom ? 'Custom food' : `Add to ${meal}`}>
      {custom || editing ? (
        <CustomForm onDone={() => { setCustom(false); setEditing(null) }} initialName={q} existing={editing ?? undefined} usedIn={editing ? allLogs.filter((e) => e.foodId === `custom-${editing.id}`).length : 0} />
      ) : picked ? (
        <div className="space-y-3">
          <div className="flex gap-2 flex-wrap">
            {picked.units.filter((u) => gramsPerUnit(picked, u) !== null).map((u) => (
              <button key={u} onClick={() => { setUnit(u); setAmount(defaultAmountFor(picked, u)) }} className={`px-3 h-9 rounded-full text-sm ${unit === u ? 'bg-lime-400 text-black' : 'bg-zinc-800'}`}>{u}</button>
            ))}
          </div>
          <div className="flex items-center gap-3">
            <button className="h-11 w-11 rounded-[.875rem] bg-zinc-800 text-xl" onClick={() => setAmount(Math.max(step, amount - step))}>–</button>
            <input type="number" inputMode="decimal" className={`${inputCls} text-center`} value={amount} onChange={(e) => setAmount(+e.target.value)} />
            <button className="h-11 w-11 rounded-[.875rem] bg-zinc-800 text-xl" onClick={() => setAmount(amount + step)}>+</button>
          </div>
          <p className="text-center text-xs text-zinc-500">
            {formatAmount(amount)} {unitLabel(picked, unit, amount)}{gPer && unit !== 'g' ? ` ≈ ${round0(grams)} g` : ''}
          </p>
          {(unit === 'katori' || unit === 'cup') && (
            <div className="flex gap-2">
              {(['small', 'medium', 'large'] as const).map((z) => <button key={z} onClick={() => setSize(z)} className={`flex-1 h-9 rounded-full text-sm capitalize ${size === z ? 'bg-zinc-100 text-black' : 'bg-zinc-800'}`}>{z}</button>)}
            </div>
          )}
          {picked.fatPer100 && (
            <div>
              <p className="text-xs text-zinc-500 mb-1">Oil / ghee</p>
              <div className="flex gap-2">
                {(['light', 'normal', 'rich'] as const).map((r) => <button key={r} onClick={() => setRich(r)} className={`flex-1 h-9 rounded-full text-sm capitalize ${rich === r ? 'bg-zinc-100 text-black' : 'bg-zinc-800'}`}>{r}</button>)}
              </div>
            </div>
          )}
          <div className="flex gap-2 flex-wrap">
            {MEALS.map((m) => <button key={m} onClick={() => setMealSel(m)} className={`px-3 h-9 rounded-full text-sm ${mealSel === m ? 'bg-lime-400 text-black' : 'bg-zinc-800'}`}>{m}</button>)}
          </div>
          {n && (
            <div className="text-center">
              <p className="text-2xl font-bold tabular-nums">{round0(n.kcal)} kcal</p>
              <p className="text-xs text-zinc-500">P {round1(n.p)} · C {round1(n.c)} · F {round1(n.f)}</p>
            </div>
          )}
          <div className="flex gap-2">
            <Btn className="flex-1" disabled={!n || amount <= 0} onClick={log}>Log it</Btn>
            <Btn variant="ghost" onClick={() => setPicked(null)}>Back</Btn>
          </div>
        </div>
      ) : (
        <div className="space-y-2">
          <Chips value={tab} onChange={setTab} options={[{ v: 'all', label: 'All foods' }, { v: 'mine', label: `My foods${customs.length ? ` (${customs.length})` : ''}` }]} />
          <input autoFocus className={inputCls} placeholder={tab === 'mine' ? 'Search my foods…' : foods.length ? 'Search: dosa, paneer, dal…' : 'Loading foods…'} value={q} onChange={(e) => setQ(e.target.value)} />
          {tab === 'mine' && mine.map((f) => (
            <div key={f.id} className="flex items-center gap-2 border-b border-zinc-800">
              <button onClick={() => pick(f)} className="flex-1 min-w-0 text-left py-2.5 flex justify-between gap-3">
                <span><span className="block text-sm">{f.name}</span><span className="text-xs text-zinc-500">per serving · P {round1(f.per100.p)} · C {round1(f.per100.c)} · F {round1(f.per100.f)}{f.per100.fib ? ` · fibre ${round1(f.per100.fib)}` : ''}</span></span>
                <span className="text-sm tabular-nums text-zinc-300 whitespace-nowrap">{round0(f.per100.kcal)} kcal</span>
              </button>
              <button className="text-xs text-lime-400 h-9 px-2 shrink-0" onClick={() => setEditing(customs.find((c) => `custom-${c.id}` === f.id) ?? null)}>Edit</button>
            </div>
          ))}
          {tab === 'mine' && !mine.length && <Empty>{customs.length ? 'No match in your foods.' : 'You have not made any foods yet. Use + Custom food below.'}</Empty>}
          {tab === 'all' && !q && (quick.recent.length > 0 || quick.usual.length > 0) && (
            <div className="space-y-1.5 pb-1">
              {quick.usual.length > 0 && <p className="text-xs text-zinc-500">Often · tap to log again</p>}
              <div className="flex flex-wrap gap-1.5">{quick.usual.map(({ log, days }) => <button key={log.id} onClick={() => again(log)} className="px-3 h-8 rounded-full bg-lime-400/15 text-lime-300 text-xs">{log.name} · {days}d</button>)}</div>
              <p className="text-xs text-zinc-500">Recent</p>
              <div className="flex flex-wrap gap-1.5">{quick.recent.map((log) => <button key={log.id} onClick={() => again(log)} className="px-3 h-8 rounded-full bg-zinc-800 text-xs">{log.name}</button>)}</div>
            </div>
          )}
          {tab === 'all' && results.map((f) => (
            <button key={f.id} onClick={() => pick(f)} className="w-full text-left py-2.5 border-b border-zinc-800 flex justify-between gap-3">
              <span><span className="block text-sm">{f.name}</span><span className="text-xs text-zinc-500">{f.custom ? 'custom' : f.id.split('-')[0] === 'usda' ? 'USDA · per 100 g' : f.id.startsWith('indb') ? 'INDB · per 100 g' : f.units.join(' / ')}</span></span>
              <span className="text-sm tabular-nums text-zinc-300 whitespace-nowrap">{round0(f.per100.kcal)} /100g</span>
            </button>
          ))}
          {tab === 'all' && q && foods.length > 0 && !results.length && <Empty>No match.</Empty>}
          <Btn variant="ghost" className="w-full" onClick={() => setCustom(true)}>+ Custom food</Btn>
        </div>
      )}
    </Sheet>
  )
}

function CustomForm({ onDone, initialName, existing, usedIn = 0 }: { onDone: () => void; initialName: string; existing?: CustomFood; usedIn?: number }) {
  const [f, setF] = useState({ name: existing?.name ?? initialName, serving: existing?.serving ?? '1 serving', kcal: existing?.kcal ?? 0, p: existing?.p ?? 0, c: existing?.c ?? 0, f: existing?.f ?? 0, fib: existing?.fib ?? 0 })
  const num = (k: 'kcal' | 'p' | 'c' | 'f' | 'fib', label: string) => (
    <label className="text-xs text-zinc-400 space-y-1 block">{label}
      <input type="number" inputMode="decimal" className={inputCls} value={f[k] || ''} onChange={(e) => setF({ ...f, [k]: +e.target.value })} />
    </label>
  )
  return (
    <div className="space-y-3">
      <input className={inputCls} placeholder="Name" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
      <input className={inputCls} placeholder="Serving (e.g. 1 bowl, 100 g)" value={f.serving} onChange={(e) => setF({ ...f, serving: e.target.value })} />
      <div className="grid grid-cols-2 gap-2">{num('kcal', 'Calories')}{num('p', 'Protein g')}{num('c', 'Carbs g')}{num('f', 'Fat g')}{num('fib', 'Fibre g (optional)')}</div>
      {existing && <p className="text-xs text-zinc-500">Changes apply to foods you log from now on. Meals you already logged keep the numbers they had.</p>}
      <div className="flex gap-2">
        <Btn className="flex-1" disabled={!f.name.trim() || !f.kcal} onClick={async () => { const rec = { ...f, name: f.name.trim() }; if (existing?.id !== undefined) await db.customFoods.update(existing.id, rec); else await db.customFoods.add(rec); onDone() }}>Save</Btn>
        <Btn variant="ghost" onClick={onDone}>Cancel</Btn>
      </div>
      {existing?.id !== undefined && (
        <div className="space-y-1">
          <Btn variant="danger" className="w-full" onClick={async () => { const id = existing.id!, name = existing.name; onDone(); await deleteWithUndo(db.customFoods, id, `Deleted ${name}`) }}>Delete this food</Btn>
          <p className="text-xs text-zinc-500">{usedIn ? `You logged it ${usedIn} time${usedIn === 1 ? '' : 's'}. Those meals stay as they are. ` : ''}It is removed from your foods and from your other devices. You can undo it for a few seconds.</p>
        </div>
      )}
    </div>
  )
}

function Goals({ open, onClose }: { open: boolean; onClose: () => void }) {
  const s = useSettings()
  const [g, setG] = useState(s)
  const [synced, setSynced] = useState(false)
  if (open && !synced) { setG(s); setSynced(true) }
  if (!open && synced) setSynced(false)
  const field = (k: 'kcal' | 'p' | 'c' | 'f' | 'waterGoal', label: string) => (
    <label className="text-xs text-zinc-400 space-y-1 block">{label}
      <input type="number" inputMode="numeric" className={inputCls} value={g[k] || ''} onChange={(e) => setG({ ...g, [k]: +e.target.value })} />
    </label>
  )
  return (
    <Sheet open={open} onClose={onClose} title="Daily goals">
      <div className="grid grid-cols-2 gap-2">{field('kcal', 'Calories')}{field('p', 'Protein g')}{field('c', 'Carbs g')}{field('f', 'Fat g')}{field('waterGoal', 'Water ml')}</div>
      <Btn className="w-full mt-4" onClick={async () => { await db.settings.put({ ...g, id: 1 }); onClose() }}>Save</Btn>
    </Sheet>
  )
}
