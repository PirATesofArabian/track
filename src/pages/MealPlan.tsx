import { useEffect, useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, type FoodEntry } from '../lib/db'
import { useSettings } from '../lib/hooks'
import { customToItem, loadFoods, unitLabel, formatAmount, type FoodItem } from '../data/foodDb'
import { BUDGET_HELP, BUDGET_LABEL, MEAL_NOW, SETTING_HELP, SETTING_LABEL, closeGap, eatNext, totalOf, withPairs, generatePlan, groceryList, groceryText, habits, hydrate, loadPrefs, loggedPlan, loggedTotals, menuVerdict, MIN_LOGGED_DAYS, savePrefs, sumN, type Budget, type Diet, type LoggedPlan, type Meal, type Portion, type Setting, type StoredPlan } from '../lib/mealplan'
import { mondayOfDate } from '../lib/adaptive'
import { Btn, Card, Chips, Empty } from '../lib/ui'
import { offerUndo } from '../lib/undo'
import { prettyDate, round0, shiftDate, todayStr } from '../lib/util'

const MEAL_LABEL: Record<Meal, string> = { breakfast: 'Breakfast', lunch: 'Lunch', snacks: 'Snacks', dinner: 'Dinner' }
const DIET_KEY = 'overload.diet'
const loadDiet = (): Diet => { const d = localStorage.getItem(DIET_KEY); return d === 'veg' || d === 'egg' || d === 'nonveg' || d === 'jain' ? d : 'veg' }

export function useFoodMap() {
  const [foods, setFoods] = useState<FoodItem[]>([])
  const customs = useLiveQuery(() => db.customFoods.toArray(), [])
  useEffect(() => { loadFoods().then(setFoods) }, [])
  return useMemo(() => { const all = [...(customs ?? []).map(customToItem), ...foods]; return { list: all, map: new Map(all.map((f) => [f.id, f])) } }, [foods, customs])
}

const entryOf = (p: Portion, date: string, meal: Meal): Omit<FoodEntry, 'id'> => ({
  date, meal: MEAL_LABEL[meal] as FoodEntry['meal'], name: p.food.name, qty: p.amount,
  serving: `${unitLabel(p.food, p.unit, p.amount)}${p.size ? ` (${p.size})` : ''}`, foodId: p.food.id, unit: p.unit, size: p.size ?? undefined,
  kcal: Math.round(p.n.kcal * 10) / 10, p: Math.round(p.n.p * 10) / 10, c: Math.round(p.n.c * 10) / 10, f: Math.round(p.n.f * 10) / 10, fib: Math.round(p.n.fib * 10) / 10,
})
async function logPortions(ps: Portion[], date: string, meal: Meal, label: string) {
  const ids = await db.foodLog.bulkAdd(ps.map((p) => entryOf(p, date, meal)), { allKeys: true })
  offerUndo(label, async () => { await db.foodLog.bulkDelete(ids as number[]) })
}

/** Suggestions for what to eat next, scored against what is left today. */
export function EatNext({ date }: { date: string }) {
  const s = useSettings()
  const { map } = useFoodMap()
  const logs = useLiveQuery(() => db.foodLog.toArray(), []) ?? []
  const today = todayStr()
  if (date !== today || !map.size) return null
  const mine = logs.filter((e) => e.date === today)
  const eaten = mine.reduce((a, e) => ({ kcal: a.kcal + e.kcal, p: a.p + e.p }), { kcal: 0, p: 0 })
  const prefs = loadPrefs()
  const meal = MEAL_NOW(new Date().getHours())
  const rem = { kcal: s.kcal - eaten.kcal, proteinG: s.p - eaten.p }
  const eatenNow = new Set(mine.map((e) => e.foodId).filter((x): x is string => !!x))
  const sug = eatNext({ remaining: rem, meal, foods: map, habits: habits(logs, today), setting: prefs.setting, budget: prefs.budget, diet: loadDiet(), eatenNow })
  if (!sug.length) return null
  const WHY = { protein: 'High protein for what is left', usual: 'You eat this', fits: 'Fits your calories', similar: 'Similar to' }
  return (
    <Card className="space-y-2">
      <div className="flex items-baseline justify-between"><h3 className="font-semibold">Eat next</h3><span className="text-xs text-zinc-500 tabular-nums">{round0(rem.kcal)} kcal · {round0(Math.max(0, rem.proteinG))} g protein left</span></div>
      {sug.map((p) => (
        <div key={p.food.id} className="flex items-center justify-between gap-3 border-t border-zinc-800 pt-2 text-sm">
          <div className="min-w-0"><p className="truncate">{p.food.name}</p><p className="text-xs text-zinc-500">{formatAmount(p.amount)} {unitLabel(p.food, p.unit, p.amount)}{p.pair ? ` + ${formatAmount(p.pair.amount)} ${unitLabel(p.pair.food, p.pair.unit, p.pair.amount)} ${p.pair.food.name.toLowerCase()}` : ''} · {round0(totalOf(p).kcal)} kcal · {round0(totalOf(p).p)} g protein · {p.why === 'similar' && p.like ? `Like your ${p.like}` : WHY[p.why]}</p></div>
          <Btn variant="ghost" className="!h-8 text-xs shrink-0" onClick={() => logPortions(withPairs([p]), today, meal, `Logged ${p.food.name}`)}>Add</Btn>
        </div>
      ))}
    </Card>
  )
}

/** What is left of today's calories and macros, and foods and amounts that would close the gap. */
export function LeftToday({ date }: { date: string }) {
  const s = useSettings()
  const { map } = useFoodMap()
  const logs = useLiveQuery(() => db.foodLog.toArray(), []) ?? []
  const today = todayStr()
  const mine = logs.filter((e) => e.date === date)
  if (!mine.length) return null
  const t = mine.reduce((a, e) => ({ kcal: a.kcal + e.kcal, p: a.p + e.p, c: a.c + e.c, f: a.f + e.f }), { kcal: 0, p: 0, c: 0, f: 0 })
  const left = { kcal: s.kcal - t.kcal, p: s.p - t.p, c: s.c - t.c, f: s.f - t.f }
  const rows = [
    { k: 'Calories', v: left.kcal, u: 'kcal', tol: 100 }, { k: 'Protein', v: left.p, u: 'g', tol: 5 },
    { k: 'Carbs', v: left.c, u: 'g', tol: 15 }, { k: 'Fat', v: left.f, u: 'g', tol: 5 },
  ]
  const short = rows.filter((r) => r.v > r.tol), over = rows.filter((r) => r.v < -r.tol)
  const plan = date === today && map.size && (left.p > 5 || left.c > 15 || left.f > 5) ? closeGap({ left, foods: map, habits: habits(logs, today), diet: loadDiet() }) : null
  const meal = MEAL_NOW(new Date().getHours())
  const sum = plan ? sumN(plan.picks.map((p) => ({ n: totalOf(p) }))) : null
  return (
    <Card className="space-y-2">
      <div className="flex items-baseline justify-between"><h3 className="font-semibold">Left for your goal</h3><span className="text-xs text-zinc-500">{short.length === 0 && over.length === 0 ? 'Goal met' : date === today ? 'today' : prettyDate(date)}</span></div>
      <div className="grid grid-cols-4 gap-2 text-center">
        {rows.map((r) => (
          <div key={r.k} className="rounded-xl bg-zinc-800/60 p-2">
            <p className="text-[11px] text-zinc-400">{r.k}</p>
            <p className={`text-sm font-semibold tabular-nums ${r.v < -r.tol ? 'text-amber-300' : r.v > r.tol ? 'text-sky-300' : 'text-lime-400'}`}>{r.v < -r.tol ? '+' : ''}{round0(Math.abs(r.v) <= r.tol ? 0 : Math.abs(r.v))}<span className="text-[10px] font-normal text-zinc-500"> {r.u}</span></p>
            <p className="text-[10px] text-zinc-500">{r.v < -r.tol ? 'over' : r.v > r.tol ? 'short' : 'on target'}</p>
          </div>
        ))}
      </div>
      {short.length > 0 && !(plan && plan.picks.length) && <p className="text-xs text-zinc-400">Short by {short.map((r) => (r.u === 'kcal' ? `${round0(r.v)} kcal` : `${round0(r.v)} ${r.u} ${r.k.toLowerCase()}`)).join(', ')}.{plan ? ' No single food from what you eat closes this well; a small snack or a bit more of your usual foods would.' : ''}</p>}
      {plan && plan.picks.length > 0 && (
        <div className="space-y-2 border-t border-zinc-800 pt-2">
          <p className="text-xs text-zinc-400">To close the gap{left.kcal < 100 ? ' (this goes past your calories, because protein or carbs are short)' : ''}:</p>
          {plan.picks.map((p) => (
            <div key={p.food.id} className="flex items-center justify-between gap-3 text-sm">
              <div className="min-w-0"><p className="truncate">{p.food.name} · {formatAmount(p.amount)} {unitLabel(p.food, p.unit, p.amount)}{p.pair ? ` + ${formatAmount(p.pair.amount)} ${unitLabel(p.pair.food, p.pair.unit, p.pair.amount)} milk` : ''}</p><p className="text-xs text-zinc-500">{round0(totalOf(p).kcal)} kcal · P{round0(totalOf(p).p)} C{round0(totalOf(p).c)} F{round0(totalOf(p).f)} · {p.why === 'similar' && p.like ? `Like your ${p.like}` : p.why === 'usual' ? 'You eat this' : 'Common choice'}</p></div>
              <Btn variant="ghost" className="!h-8 text-xs shrink-0" onClick={() => logPortions(withPairs([p]), today, meal, `Logged ${p.food.name}`)}>Add</Btn>
            </div>
          ))}
          {sum && <p className="text-xs text-zinc-500">All together {round0(sum.kcal)} kcal · P{round0(sum.p)} C{round0(sum.c)} F{round0(sum.f)}. Then the day lands at {round0(t.kcal + sum.kcal)} kcal, protein {round0(t.p + sum.p)} g, carbs {round0(t.c + sum.c)} g, fat {round0(t.f + sum.f)} g.</p>}
          <Btn className="w-full h-9" onClick={() => logPortions(withPairs(plan.picks), today, meal, 'Logged gap foods')}>Add all to {MEAL_LABEL[meal]}</Btn>
          <p className="text-[11px] text-zinc-600">Picked from foods you log, then similar ones. A best fit by my own scoring, not a rule from a paper.</p>
        </div>
      )}
      {over.length > 0 && short.length === 0 && <p className="text-xs text-zinc-400">Over on {over.map((r) => r.k.toLowerCase()).join(', ')}. Nothing to add. If the weight trend is where you want it, that is fine.</p>}
    </Card>
  )
}

function Totals({ n }: { n: { kcal: number; p: number } }) { return <>{round0(n.kcal)} kcal · {round0(n.p)} g</> }

function GeneratedView() {
  const s = useSettings()
  const { map, list } = useFoodMap()
  const [prefs, setPrefs] = useState(loadPrefs)
  const [diet, setDiet] = useState<Diet>(loadDiet)
  const [day, setDay] = useState(() => Math.min(6, Math.max(0, (new Date(todayStr() + 'T12:00:00').getDay() + 6) % 7)))
  const [copied, setCopied] = useState(false)
  const [menu, setMenu] = useState('')
  const logs = useLiveQuery(() => db.foodLog.toArray(), []) ?? []
  const week = mondayOfDate(todayStr())
  const stored = useLiveQuery(async () => (await db.kv.get(`mealplan:${week}`))?.value as StoredPlan | undefined, [week])
  const today = todayStr()

  const plan = useMemo(() => (stored && map.size ? hydrate(stored, map) : null), [stored, map])
  const grocery = useMemo(() => (plan && stored ? groceryList(plan, stored.setting) : []), [plan, stored])
  const setP = (p: typeof prefs) => { setPrefs(p); savePrefs(p) }
  const setD = (d: Diet) => { setDiet(d); localStorage.setItem(DIET_KEY, d ?? 'veg') }

  async function make(seed: number) {
    const before = (await db.kv.get(`mealplan:${week}`))?.value
    const p = generatePlan({ foods: map, targets: { kcal: s.kcal, proteinG: s.p }, diet, setting: prefs.setting, budget: prefs.budget, seed })
    const { totals: _t, ...store } = p
    await db.kv.put({ key: `mealplan:${week}`, value: store })
    if (before) offerUndo('Replaced your meal plan', async () => { await db.kv.put({ key: `mealplan:${week}`, value: before }) })
  }
  async function copy() {
    const text = grocery.map((g) => `${g.name}: ${groceryText(g)}`).join('\n')
    try { await navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 2000) } catch { /* clipboard blocked */ }
  }

  const remaining = useMemo(() => {
    const t = logs.filter((e) => e.date === today).reduce((a, e) => ({ kcal: a.kcal + e.kcal, p: a.p + e.p }), { kcal: 0, p: 0 })
    return { kcal: Math.max(0, s.kcal - t.kcal), proteinG: Math.max(0, s.p - t.p) }
  }, [logs, s.kcal, s.p, today])
  const dishes = menu.split('\n').map((x) => x.trim()).filter(Boolean).slice(0, 25)
  const verdicts = useMemo(() => (dishes.length && list.length ? menuVerdict({ dishes, all: list, remaining, diet }) : []), [menu, list, remaining, diet]) // eslint-disable-line react-hooks/exhaustive-deps
  const V = { best: ['Good pick', 'text-lime-400'], fits: ['Fits', 'text-zinc-300'], over: ['Over what is left', 'text-amber-400'], unknown: ['Not found', 'text-zinc-500'] } as const

  const d = plan?.[day]
  const date = shiftDate(week, day)
  return (
    <div className="space-y-4">
      <Card className="space-y-3">
        <h3 className="font-semibold">Plan my week</h3>
        <div className="space-y-1"><p className="text-xs text-zinc-400">Where you eat</p><Chips value={prefs.setting} onChange={(v) => setP({ ...prefs, setting: v as Setting })} options={(Object.keys(SETTING_LABEL) as Setting[]).map((v) => ({ v, label: SETTING_LABEL[v] }))} /><p className="text-xs text-zinc-500">{SETTING_HELP[prefs.setting]}</p></div>
        <div className="space-y-1"><p className="text-xs text-zinc-400">Budget</p><Chips value={prefs.budget} onChange={(v) => setP({ ...prefs, budget: v as Budget })} options={(Object.keys(BUDGET_LABEL) as Budget[]).map((v) => ({ v, label: BUDGET_LABEL[v] }))} /><p className="text-xs text-zinc-500">{BUDGET_HELP[prefs.budget]}</p></div>
        <div className="space-y-1"><p className="text-xs text-zinc-400">Diet</p><Chips value={diet ?? 'veg'} onChange={(v) => setD(v as Diet)} options={[{ v: 'veg', label: 'Veg' }, { v: 'egg', label: 'Eggetarian' }, { v: 'nonveg', label: 'Non-veg' }, { v: 'jain', label: 'Jain' }]} /></div>
        <p className="text-xs text-zinc-400">Aiming at {s.kcal.toLocaleString('en-IN')} kcal and {s.p} g protein a day (your current targets).</p>
        <Btn className="w-full" disabled={!map.size} onClick={() => make(stored ? stored.seed + 1 : 0)}>{stored ? 'Make another week' : 'Make my week'}</Btn>
      </Card>

      {stored && plan && d && (
        <>
          {stored.proteinShort && <p className="text-xs rounded-[.875rem] bg-zinc-800 p-3 text-zinc-400">Your protein target could not be fully met with this kitchen and budget. A wider budget, or eggs or whey if you eat them, closes it.</p>}
          <div className="flex gap-2 overflow-x-auto no-scrollbar">
            {plan.map((x) => { const dt = shiftDate(week, x.index); return <button key={x.index} onClick={() => setDay(x.index)} className={`shrink-0 px-3.5 h-9 rounded-full text-xs ${x.index === day ? 'bg-zinc-100 text-black font-semibold' : 'bg-zinc-900 text-zinc-400'}`}>{prettyDate(dt, { weekday: 'short', day: 'numeric' })}</button> })}
          </div>
          <Card className="divide-y divide-zinc-800 !py-0">
            {d.meals.map((m) => (
              <div key={m.meal} className="py-3 space-y-1">
                <div className="flex items-baseline justify-between"><h4 className="font-semibold text-sm">{MEAL_LABEL[m.meal]}{m.kitchen && <span className="ml-2 text-xs font-normal text-zinc-500">as served</span>}</h4><span className="text-xs text-zinc-500 tabular-nums"><Totals n={sumN(m.items)} /></span></div>
                <ul className="text-sm text-zinc-300 space-y-0.5">{m.items.map((p) => <li key={p.food.id}>{p.food.name} <span className="text-zinc-500">· {formatAmount(p.amount)} {unitLabel(p.food, p.unit, p.amount)}</span></li>)}</ul>
                {date <= today && <Btn variant="ghost" className="!h-8 text-xs" onClick={() => logPortions(m.items, date, m.meal, `Logged ${MEAL_LABEL[m.meal].toLowerCase()}`)}>Log this meal</Btn>}
              </div>
            ))}
            <p className="py-3 text-sm font-medium tabular-nums">Day total: {round0(d.totals.kcal).toLocaleString('en-IN')} kcal · {round0(d.totals.p)} g protein</p>
          </Card>
          {grocery.length > 0 && (
            <Card className="space-y-2">
              <div className="flex items-center justify-between"><h3 className="font-semibold">{stored.setting === 'home' ? 'Grocery list for the week' : 'To keep in your room'}</h3><Btn variant="ghost" className="!h-8 text-xs" onClick={copy}>{copied ? 'Copied' : 'Copy'}</Btn></div>
              <ul className="grid grid-cols-1 gap-1 text-sm">{grocery.map((g) => <li key={g.name} className="flex justify-between gap-3"><span>{g.name}</span><span className="tabular-nums text-zinc-400 shrink-0">{groceryText(g)}</span></li>)}</ul>
              <p className="text-xs text-zinc-500">One person, seven days, rounded up to the nearest 50 g. Oil, salt and spices are included where a recipe uses them.</p>
            </Card>
          )}
        </>
      )}
      {!stored && <Empty>No plan for this week yet.</Empty>}

      <Card className="space-y-2">
        <h3 className="font-semibold">Eating out? Check a menu</h3>
        <p className="text-xs text-zinc-500">Type the dishes, one per line. Each is matched to a food and judged against what is left today ({round0(remaining.kcal)} kcal, {round0(remaining.proteinG)} g protein).</p>
        <textarea className="w-full rounded-[.875rem] bg-zinc-800 p-3 text-sm outline-none focus:ring-2 focus:ring-lime-400/60 placeholder:text-zinc-500 min-h-24" placeholder={'paneer tikka\nchicken biryani\ndal makhani'} value={menu} onChange={(e) => setMenu(e.target.value)} />
        {verdicts.map((r) => (
          <div key={r.dish} className="flex items-center justify-between gap-3 border-t border-zinc-800 pt-2 text-sm">
            <div className="min-w-0"><p className="truncate">{r.portion ? r.portion.food.name : r.dish}</p>{r.portion && <p className="text-xs text-zinc-500">{formatAmount(r.portion.amount)} {unitLabel(r.portion.food, r.portion.unit, r.portion.amount)} · {round0(r.portion.n.kcal)} kcal · {round0(r.portion.n.p)} g protein</p>}</div>
            <span className={`text-xs shrink-0 ${V[r.verdict][1]}`}>{V[r.verdict][0]}</span>
          </div>
        ))}
      </Card>
    </div>
  )
}

const SOURCE_KEY = 'overload.mealSource'
export function MealPlanView() {
  const [source, setSource] = useState<'new' | 'logged'>(() => (localStorage.getItem(SOURCE_KEY) === 'logged' ? 'logged' : 'new'))
  const pick = (v: 'new' | 'logged') => { setSource(v); localStorage.setItem(SOURCE_KEY, v) }
  return (
    <div className="space-y-4">
      <Chips value={source} onChange={pick} options={[{ v: 'new', label: 'New ideas' }, { v: 'logged', label: 'From what I eat' }]} />
      {source === 'new' ? <GeneratedView /> : <LoggedView />}
    </div>
  )
}

/** A week built only from meals you already logged. Nothing new is suggested. */
function LoggedView() {
  const s = useSettings()
  const logs = useLiveQuery(() => db.foodLog.toArray(), []) ?? []
  const today = todayStr(), week = mondayOfDate(today)
  const stored = useLiveQuery(async () => (await db.kv.get(`mealplan-logged:${week}`))?.value as LoggedPlan | undefined, [week])
  const [day, setDay] = useState(() => Math.min(6, Math.max(0, (new Date(today + 'T12:00:00').getDay() + 6) % 7)))
  const fresh = useMemo(() => loggedPlan(logs, today, stored?.seed ?? 0), [logs, today, stored?.seed])
  const plan = stored ?? fresh
  async function make(seed: number) {
    const p = loggedPlan(logs, today, seed)
    if (!p) return
    const before = (await db.kv.get(`mealplan-logged:${week}`))?.value
    await db.kv.put({ key: `mealplan-logged:${week}`, value: p })
    if (before) offerUndo('Replaced your week', async () => { await db.kv.put({ key: `mealplan-logged:${week}`, value: before }) })
  }
  if (!fresh && !stored) return <Card className="space-y-2"><h3 className="font-semibold">From what I eat</h3><p className="text-sm text-zinc-400">Log at least {MIN_LOGGED_DAYS} full days of food and this builds your week out of the meals you actually eat. Nothing new gets added.</p></Card>
  const d = plan!.days[day], date = shiftDate(week, day), t = loggedTotals(d.meals)
  const asLog = (items: typeof d.meals[number]['items'], meal: Meal, on: string) => items.map((e) => ({ ...e, date: on, meal: MEAL_LABEL[meal] as FoodEntry['meal'] }))
  async function logMeal(items: typeof d.meals[number]['items'], meal: Meal) {
    const ids = await db.foodLog.bulkAdd(asLog(items, meal, date), { allKeys: true })
    offerUndo(`Logged ${MEAL_LABEL[meal].toLowerCase()}`, async () => { await db.foodLog.bulkDelete(ids as number[]) })
  }
  const off = Math.round(t.kcal - s.kcal)
  return (
    <div className="space-y-4">
      <Card className="space-y-2">
        <h3 className="font-semibold">From what I eat</h3>
        <p className="text-xs text-zinc-400">Built from {plan!.daysUsed} days you logged since {prettyDate(plan!.from, { day: 'numeric', month: 'short' })}. Foods you eat most days in a meal stay fixed; the foods that change (like your non-veg) rotate through what you have actually eaten.</p>
        <Btn variant="ghost" className="w-full" onClick={() => make((stored?.seed ?? 0) + 1)}>{stored ? 'Shuffle the varied meals' : 'Save this week'}</Btn>
      </Card>
      <div className="flex gap-2 overflow-x-auto no-scrollbar">
        {plan!.days.map((_, i) => <button key={i} onClick={() => setDay(i)} className={`shrink-0 px-3.5 h-9 rounded-full text-xs ${i === day ? 'bg-zinc-100 text-black font-semibold' : 'bg-zinc-900 text-zinc-400'}`}>{prettyDate(shiftDate(week, i), { weekday: 'short', day: 'numeric' })}</button>)}
      </div>
      <Card className="divide-y divide-zinc-800 !py-0">
        {d.meals.map((m) => (
          <div key={m.meal} className="py-3 space-y-1">
            <div className="flex items-baseline justify-between"><h4 className="font-semibold text-sm">{MEAL_LABEL[m.meal]}<span className="ml-2 text-xs font-normal text-zinc-500">{m.options === 0 ? 'your usual' : m.fixedCount === 0 ? `${m.times}× logged` : `usual + varied (${m.times}× logged)`}</span></h4><span className="text-xs text-zinc-500 tabular-nums">{round0(m.items.reduce((a, e) => a + e.kcal, 0))} kcal · {round0(m.items.reduce((a, e) => a + e.p, 0))} g</span></div>
            <ul className="text-sm text-zinc-300 space-y-0.5">{m.items.map((e, i) => <li key={i}>{e.name} <span className="text-zinc-500">· {e.serving ? `${formatAmount(e.qty)} ${e.serving}` : formatAmount(e.qty)}{i >= m.fixedCount ? ' · varies' : ''}</span></li>)}</ul>
            {date <= today && <Btn variant="ghost" className="!h-8 text-xs" onClick={() => logMeal(m.items, m.meal)}>Log this meal</Btn>}
          </div>
        ))}
        <p className="py-3 text-sm font-medium tabular-nums">Day total: {round0(t.kcal).toLocaleString('en-IN')} kcal · {round0(t.p)} g protein<span className="block text-xs font-normal text-zinc-500">{Math.abs(off) < 50 ? 'On your calorie target.' : `${Math.abs(off)} kcal ${off > 0 ? 'over' : 'under'} your ${s.kcal.toLocaleString('en-IN')} target.`}</span></p>
      </Card>
    </div>
  )
}
