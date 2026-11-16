import { useEffect, useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, type FoodEntry } from '../lib/db'
import { useSettings } from '../lib/hooks'
import { customToItem, loadFoods, unitLabel, formatAmount, type FoodItem } from '../data/foodDb'
import { BUDGET_HELP, BUDGET_LABEL, MEAL_NOW, SETTING_HELP, SETTING_LABEL, MAIN_DISH, closeGap, daySplit, eatNext, eggRoom, MEAL_TIME, nextMeal, planDay, smartSearch, repeatBlocker, totalOf, withPairs, generatePlan, groceryList, groceryText, habits, hydrate, loadPrefs, loggedPlan, loggedTotals, menuVerdict, MIN_LOGGED_DAYS, savePrefs, sumN, type Budget, type Diet, type LoggedPlan, type Meal, type Portion, type Setting, type StoredPlan } from '../lib/mealplan'
import { mondayOfDate } from '../lib/adaptive'
import { Btn, Card, Chips, Empty, inputCls } from '../lib/ui'
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
  const hab = habits(logs, today)
  const fatLeft = s.f - mine.reduce((a, e) => a + e.f, 0)
  const plan = nextMeal({ remaining: { kcal: rem.kcal, p: rem.proteinG, c: s.c - mine.reduce((a, e) => a + e.c, 0), f: s.f - mine.reduce((a, e) => a + e.f, 0) }, meal, foods: map, habits: hab, logs, today, diet: loadDiet(), dayKcal: s.kcal })
  if (plan) return <NextMealCard plan={plan} rem={rem} today={today} />
  const allowed = withoutRepeats(map, mine, logs, today)
  const sug = eatNext({ remaining: rem, meal, foods: allowed, habits: hab, setting: prefs.setting, budget: prefs.budget, diet: loadDiet(), eatenNow, eggsLeft: eggRoom(mine), fatLeft })
  if (!sug.length && fatLeft < 1 && rem.kcal >= 100) return <Card><p className="text-sm">Fat is already at your goal, so nothing with fat is suggested. You have {round0(rem.kcal)} kcal and {round0(Math.max(0, rem.proteinG))} g protein left.</p></Card>
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

/** Foods left after dropping ones you already had today, egg-type limits, and full dishes for a meal that is already logged. */
function withoutRepeats(map: Map<string, FoodItem>, mine: FoodEntry[], logs: FoodEntry[], today: string) {
  const blocked = repeatBlocker({ eatenToday: mine, logs, today })
  const mealLogged = mine.some((e) => e.meal === MEAL_LABEL[MEAL_NOW(new Date().getHours())])
  // A meal that is already logged is not given another full dish (chicken, dosa, dal, rice dishes...), only small additions.
  return new Map([...map].filter(([, f]) => !blocked(f) && !(mealLogged && MAIN_DISH.has(f.category ?? ''))))
}
const KIND_NOTE = { usual: 'as usual', more: 'more than usual', less: 'less than usual', added: 'add' } as const
/** A target for the next meal and a version of your usual meal that hits it. */
function NextMealCard({ plan, rem, today }: { plan: NonNullable<ReturnType<typeof nextMeal>>; rem: { kcal: number; proteinG: number }; today: string }) {
  const t = plan.total, tg = plan.target
  const later = plan.later.map((m) => MEAL_LABEL[m].toLowerCase())
  return (
    <Card className="space-y-2">
      <div className="flex items-baseline justify-between"><h3 className="font-semibold">{plan.topUp ? `Top up ${MEAL_LABEL[plan.meal].toLowerCase()}` : `Next: ${MEAL_LABEL[plan.meal].toLowerCase()}`}</h3><span className="text-xs text-zinc-500 tabular-nums">{round0(rem.kcal)} kcal · {round0(Math.max(0, rem.proteinG))} g protein left today</span></div>
      <p className="text-sm">{plan.topUp ? `${MEAL_LABEL[plan.meal]} is already logged. To use the rest of today, add about ` : 'Aim for about '}<b>{round0(tg.kcal)} kcal</b> and <b>{round0(tg.p)} g protein</b>.</p>
      <p className="text-xs text-zinc-500">{plan.topUp ? 'Small additions only: your usual foods and eggs, paneer or yogurt. No main dish is added to a meal you already logged.' : plan.pattern ? `You usually have about ${round0(plan.usual)} kcal at ${MEAL_LABEL[plan.meal].toLowerCase()}.` : 'Not enough history for this meal yet, so this uses a standard share of the day.'}{!plan.topUp && later.length ? ` That leaves ${round0(rem.kcal - tg.kcal)} kcal for ${later.join(' and ')}.` : ''}</p>
      {plan.items.map((i) => (
        <div key={i.p.food.id} className="flex items-center justify-between gap-3 border-t border-zinc-800 pt-2 text-sm">
          <div className="min-w-0">
            <p className="truncate">{i.p.food.name}</p>
            <p className="text-xs text-zinc-500">
              {formatAmount(i.p.amount)} {unitLabel(i.p.food, i.p.unit, i.p.amount)} · {round0(i.p.n.kcal)} kcal · {round0(i.p.n.p)} g protein ·{' '}
              <span className={i.kind === 'more' || i.kind === 'added' ? 'text-lime-400' : i.kind === 'less' ? 'text-amber-300' : ''}>
                {i.kind === 'added' ? 'add' : plan.from ? (i.kind === 'more' || i.kind === 'less' ? `${KIND_NOTE[i.kind]} (you had ${formatAmount(i.was!.amount)})` : KIND_NOTE[i.kind]) : 'suggested'}
              </span>
            </p>
          </div>
        </div>
      ))}
      <p className="text-xs text-zinc-500">Together {round0(t.kcal)} kcal · P{round0(t.p)} C{round0(t.c)} F{round0(t.f)}.{plan.skipped.length ? ` Left out because you had it today: ${plan.skipped.join(', ')}.` : ''}</p>
      <Btn className="w-full h-9" onClick={() => logPortions(plan.items.map((i) => i.p), today, plan.meal, `Logged ${MEAL_LABEL[plan.meal].toLowerCase()}`)}>Add all to {MEAL_LABEL[plan.meal]}</Btn>
      <p className="text-[11px] text-zinc-600">Built from what you logged for this meal in the last 4 weeks, with portions changed and foods you already log added to reach the aim. Eggs stop at 3 whole and 6 whites a day, and oats-type foods are not repeated. My own scoring, not a published rule.</p>
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
  const plan = date === today && map.size && (left.p > 5 || left.c > 15 || left.f > 5) ? closeGap({ left, foods: withoutRepeats(map, mine, logs, today), habits: habits(logs, today), diet: loadDiet(), eggsLeft: eggRoom(mine) }) : null
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
          <p className="text-[11px] text-zinc-600">Picked from foods you log. A best fit by my own scoring, not a rule from a paper.</p>
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
  const [source, setSource] = useState<'new' | 'logged' | 'day'>(() => { const v = localStorage.getItem(SOURCE_KEY); return v === 'logged' || v === 'day' ? v : 'new' })
  const pick = (v: 'new' | 'logged' | 'day') => { setSource(v); localStorage.setItem(SOURCE_KEY, v) }
  return (
    <div className="space-y-4">
      <Chips value={source} onChange={pick} options={[{ v: 'day', label: 'Plan my day' }, { v: 'new', label: 'New ideas' }, { v: 'logged', label: 'From what I eat' }]} />
      {source === 'day' ? <DayPlanView /> : source === 'new' ? <GeneratedView /> : <LoggedView />}
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

const HAVE_KEY = 'overload.dayFoods'
const MEAL_LIST: Meal[] = ['breakfast', 'lunch', 'snacks', 'dinner']
/** You say which foods you have today; this spreads them over the day's meals with amounts to reach what is left of your goals. */
function DayPlanView() {
  const s = useSettings()
  const { map, list } = useFoodMap()
  const logs = useLiveQuery(() => db.foodLog.toArray(), []) ?? []
  const today = todayStr()
  const [have, setHave] = useState<string[]>(() => { try { const v = JSON.parse(localStorage.getItem(HAVE_KEY) ?? '{}'); return v.date === today ? v.ids : [] } catch { return [] } })
  const [q, setQ] = useState('')
  const mine = logs.filter((e) => e.date === today)
  const doneMeals = new Set(mine.map((e) => e.meal.toLowerCase() as Meal))
  const [meals, setMeals] = useState<Meal[] | null>(null)
  const use = meals ?? MEAL_LIST.filter((m) => !doneMeals.has(m))
  const hab = useMemo(() => habits(logs, today), [logs, today])
  const setIds = (ids: string[]) => { setHave(ids); localStorage.setItem(HAVE_KEY, JSON.stringify({ date: today, ids })) }
  const toggle = (id: string) => setIds(have.includes(id) ? have.filter((x) => x !== id) : [...have, id])
  const usual = [...hab].filter(([id, h]) => map.has(id) && h.days >= 2).sort((a, b) => b[1].days - a[1].days).slice(0, 14).map(([id]) => map.get(id)!)
  const found = q.trim() ? smartSearch(list, q, 6).filter((f) => !have.includes(f.id)) : []
  const eaten = mine.reduce((a, e) => ({ kcal: a.kcal + e.kcal, p: a.p + e.p, c: a.c + e.c, f: a.f + e.f, fib: a.fib + (e.fib ?? 0) }), { kcal: 0, p: 0, c: 0, f: 0, fib: 0 })
  const target = { kcal: s.kcal - eaten.kcal, p: s.p - eaten.p, c: s.c - eaten.c, f: s.f - eaten.f, fib: Math.max(0, (14 * s.kcal) / 1000 - eaten.fib) }
  const plan = useMemo(() => {
    const chosen = have.map((id) => map.get(id)).filter((f): f is FoodItem => !!f)
    if (!chosen.length || !use.length || target.kcal < 100) return null
    return planDay({ foods: chosen, target, meals: use, split: daySplit(logs, today, s.kcal, use), habits: hab, blocked: repeatBlocker({ eatenToday: mine, logs, today }), eggsLeft: eggRoom(mine), diet: loadDiet() })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [have, map, use.join(), logs, s.kcal, s.p, s.c, s.f])
  const t = plan?.total
  return (
    <div className="space-y-4">
      <Card className="space-y-3">
        <h3 className="font-semibold">What foods do you have today?</h3>
        <p className="text-xs text-zinc-400">Pick what is in your kitchen or what you can get. I will split it over the day's meals and say how much of each. Only these foods are used.</p>
        {usual.length > 0 && <div className="flex flex-wrap gap-2">{usual.map((f) => <button key={f.id} onClick={() => toggle(f.id)} className={`px-3 h-8 rounded-full text-xs ${have.includes(f.id) ? 'bg-lime-400 text-black font-medium' : 'bg-zinc-800 text-zinc-300'}`}>{f.name}</button>)}</div>}
        <input className={inputCls} placeholder="Search another food…" value={q} onChange={(e) => setQ(e.target.value)} />
        {found.map((f) => <button key={f.id} onClick={() => { toggle(f.id); setQ('') }} className="block w-full text-left text-sm py-1.5 border-t border-zinc-800">{f.name}<span className="text-xs text-zinc-500"> · add</span></button>)}
        {have.filter((id) => !usual.some((f) => f.id === id)).length > 0 && <div className="flex flex-wrap gap-2">{have.filter((id) => !usual.some((f) => f.id === id)).map((id) => <button key={id} onClick={() => toggle(id)} className="px-3 h-8 rounded-full text-xs bg-lime-400 text-black font-medium">{map.get(id)?.name ?? id} ✕</button>)}</div>}
        <div className="space-y-1"><p className="text-xs text-zinc-400">Meals to plan{doneMeals.size ? ' (the ones already logged today are off)' : ''}</p>
          <div className="flex flex-wrap gap-2">{MEAL_LIST.map((m) => <button key={m} onClick={() => setMeals(use.includes(m) ? use.filter((x) => x !== m) : MEAL_LIST.filter((x) => x === m || use.includes(x)))} className={`px-3 h-8 rounded-full text-xs ${use.includes(m) ? 'bg-lime-400 text-black font-medium' : 'bg-zinc-800 text-zinc-300'}`}>{MEAL_LABEL[m]}</button>)}</div></div>
        <p className="text-xs text-zinc-500">Left today: {round0(Math.max(0, target.kcal))} kcal · protein {round0(Math.max(0, target.p))} g · carbs {round0(Math.max(0, target.c))} g · fat {round0(Math.max(0, target.f))} g (never exceeded)</p>
      </Card>
      {!have.length && <Empty>Pick a few foods above.</Empty>}
      {have.length > 0 && !plan && <Card><p className="text-sm text-zinc-400">{target.kcal < 100 ? 'Your calories for today are already used.' : !use.length ? 'Choose at least one meal to plan.' : 'No plan could be made from these foods.'}</p></Card>}
      {plan && t && (
        <Card className="divide-y divide-zinc-800 !py-0">
          {plan.meals.map((m) => (
            <div key={m.meal} className="py-3 space-y-1">
              <div className="flex items-baseline justify-between"><h4 className="font-semibold text-sm">{MEAL_LABEL[m.meal]}<span className="ml-2 text-xs font-normal text-zinc-500">around {MEAL_TIME[m.meal]}</span></h4><span className="text-xs text-zinc-500 tabular-nums">{round0(m.total.kcal)} kcal · P{round0(m.total.p)} C{round0(m.total.c)} F{round0(m.total.f)}</span></div>
              <ul className="text-sm text-zinc-300 space-y-0.5">{m.items.map((p) => <li key={p.food.id}>{p.food.name} <span className="text-zinc-500">· {formatAmount(p.amount)} {unitLabel(p.food, p.unit, p.amount)} · {round0(p.n.kcal)} kcal</span></li>)}</ul>
              <Btn variant="ghost" className="!h-8 text-xs" onClick={() => logPortions(m.items, today, m.meal, `Logged ${MEAL_LABEL[m.meal].toLowerCase()}`)}>Log this meal</Btn>
            </div>
          ))}
          <div className="py-3 space-y-1">
            <p className="text-sm font-medium tabular-nums">Plan total: {round0(t.kcal)} kcal · P{round0(t.p)} C{round0(t.c)} F{round0(t.f)} · fibre {round0(t.fib)} g</p>
            <p className="text-xs text-zinc-500">{round0(eaten.kcal + t.kcal)} kcal for the day against your {s.kcal.toLocaleString('en-IN')} target, with what you have already logged.</p>
            {plan.notes.map((n) => <p key={n} className="text-xs text-amber-300">{n}</p>)}
            {plan.unused.length > 0 && <p className="text-xs text-zinc-500">Not needed: {plan.unused.join(', ')}.</p>}
            <p className="text-[11px] text-zinc-600">A good fit by my own scoring, not a rule from a paper. Times are a typical spread, not from research.</p>
          </div>
        </Card>
      )}
    </div>
  )
}
