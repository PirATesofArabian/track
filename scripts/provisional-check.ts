// Run: npx tsx scripts/provisional-check.ts /path/to/{food,w}.json
import { readFileSync } from 'node:fs'
import { weightTrend } from '../src/lib/body'
import { provisionalMaintenance, realMaintenance } from '../src/lib/foodinsights'

const d = JSON.parse(readFileSync(process.argv[2], 'utf8'))
const trend = weightTrend(d.w)
let bad = 0
const eq = (name: string, got: unknown, want: unknown) => { if (JSON.stringify(got) !== JSON.stringify(want)) { bad++; console.log('FAIL', name, got, want) } else console.log('ok  ', name) }

const r = provisionalMaintenance(d.food, trend, '2026-11-27')
console.log(r)
eq('real maintenance still needs 14 days', realMaintenance(d.food, trend, '2026-11-27'), null)
eq('provisional: 13 logged days to yesterday', r?.loggedDays, 13)
eq('provisional: weigh-in span 12 days', r?.days, 12)
eq('provisional: ~2730 kcal (hand-calculated from the same data)', r?.kcal, 2730)
eq('provisional: refuses with <7 logged days', provisionalMaintenance(d.food.filter((e: { date: string }) => e.date <= '2026-11-18'), trend, '2026-11-19'), null)
eq('provisional: refuses with no weigh-ins', provisionalMaintenance(d.food, [], '2026-11-27'), null)
process.exit(bad ? 1 : 0)
