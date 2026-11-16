import { useEffect } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { Card } from '../lib/ui'

// Every value on this page is copied from the code that computes it (file named in each section).
// If you change a constant in src/lib, change it here too.

type Block =
  | { k: 'p'; t: string }
  | { k: 'f'; t: string[] }
  | { k: 'table'; head: string[]; rows: string[][] }
  | { k: 'list'; t: string[] }
type Tag = 'Ported' | 'Built' | 'Ported + Built'
type Section = { id: string; title: string; tag: Tag; file: string; blocks: Block[]; sources?: string }

const SECTIONS: Section[] = [
  {
    id: 'energy', title: 'Calories and macro targets', tag: 'Ported', file: 'lib/body.ts',
    blocks: [
      { k: 'p', t: 'Your body weight here is the 7-day trend weight (see Weight trend), not a single weigh-in. Age comes from your birth date.' },
      { k: 'f', t: [
        'BMR (Mifflin-St Jeor) = 10 × kg + 6.25 × cm − 5 × age + 5 (male) or − 161 (female)',
        'BMR (Katch-McArdle, used if sex is unspecified and body fat is known) = 370 + 21.6 × lean kg',
        'Daily burn = BMR × activity factor, rounded to 10',
        'Lifting allowance = (session minutes ÷ 60) × training days × (3.5 − 1) × kg ÷ 7, rounded to 10',
        'Maintenance (TDEE) = daily burn + lifting allowance',
        'Target = TDEE × (1 + goal adjustment), rounded to 50',
      ] },
      { k: 'table', head: ['Activity', 'Factor'], rows: [['Mostly sitting', '1.4'], ['Mixed', '1.5'], ['On my feet', '1.6'], ['Physical job', '1.8']] },
      { k: 'table', head: ['Goal', 'Calories vs maintenance'], rows: [['Lose fat', '−20%'], ['Aesthetic recomp', '−10%'], ['General fitness', '0%'], ['Strength', '+5%'], ['Build muscle', '+10%'], ['Strength + size', '+10%']] },
      { k: 'table', head: ['Goal', 'Protein, g per kg'], rows: [['Build muscle, strength, strength + size', '1.6 to 2.2'], ['Lose fat, aesthetic recomp', '2.0 to 2.4'], ['General fitness', '1.2 to 1.6']] },
      { k: 'p', t: 'Training days come from your logged sessions per week if you have them, otherwise the number in your profile. Session length defaults to 60 minutes.' },
      { k: 'f', t: [
        'Protein = midpoint of your goal\'s range, shown as a range (table below)',
        'Fat = the larger of 0.8 g per kg and 25% of energy ÷ 9, rounded to 5 g (inside the 20 to 35% range of the Institute of Medicine)',
        'Carbs = the calories left after protein and fat ÷ 4, rounded to 5 g',
        'Fibre = 14 g per 1,000 kcal',
        'Water = 35 ml per kg, rounded to 250 ml, kept between 1,500 and 4,500 ml',
      ] },
      { k: 'p', t: 'Expected pace for any calorie intake:' },
      { k: 'f', t: ['kg per week = (intake − maintenance) × 7 ÷ 7,700'] },
      { k: 'p', t: '7,700 kcal per kg is a rule of thumb. It overstates change after the first weeks because the body adapts, so your own weight trend over 2 to 3 weeks overrules it. These are estimates for healthy adults, not medical advice.' },
    ],
    sources: 'Mifflin et al. 1990; Wishnofsky 1958; Hall et al. 2011; Morton et al. 2018; Helms et al. 2014',
  },
  {
    id: 'body', title: 'Body numbers', tag: 'Ported', file: 'lib/body.ts',
    blocks: [
      { k: 'f', t: [
        'BMI = kg ÷ (height in m)²',
        'Lean mass = kg × (1 − body fat% ÷ 100)',
        'FFMI = lean kg ÷ (height in m)²',
        'Normalised FFMI = FFMI + 6.1 × (1.8 − height in m)',
        'Waist-to-height = waist ÷ height',
      ] },
      { k: 'table', head: ['BMI band', 'Standard', 'Asian cut-offs'], rows: [['Underweight', 'under 18.5', 'under 18.5'], ['Healthy', '18.5 to 25', '18.5 to 23'], ['Overweight', '25 to 30', '23 to 27.5'], ['Obese', '30 and over', '27.5 and over']] },
      { k: 'f', t: [
        'US Navy body fat, male = 495 ÷ (1.0324 − 0.19077 × log10(waist − neck) + 0.15456 × log10(height)) − 450',
        'US Navy body fat, female = 495 ÷ (1.29579 − 0.35004 × log10(waist + hip − neck) + 0.221 × log10(height)) − 450',
      ] },
      { k: 'p', t: 'Measurements are in cm. A Navy result outside 2% to 70% is thrown away. Which body fat is used: a value you typed in the last 60 days first, then the Navy estimate, then an older typed value.' },
    ],
  },
  {
    id: 'trend', title: 'Weight trend and pace', tag: 'Ported', file: 'lib/body.ts',
    blocks: [
      { k: 'f', t: [
        'Trend weight on a day = average of every weigh-in from that day and the 6 days before',
        'Rate = slope of a straight line through the trend points of the last 4 weeks, × 7',
      ] },
      { k: 'p', t: 'The rate needs at least 6 points spread over at least 14 days, otherwise it shows nothing. The suggested pace is a share of body weight per week:' },
      { k: 'table', head: ['Goal', 'Suggested change per week'], rows: [
        ['Lose fat', '−1% to −0.5%'], ['Aesthetic recomp', '−0.5% to 0%'], ['General fitness', '−0.25% to +0.25%'], ['Strength', '0% to +0.25%'],
        ['Build muscle or strength + size, beginner', '+0.25% to +0.5%'], ['… intermediate', '+0.2% to +0.4%'], ['… advanced', '+0.1% to +0.25%'],
      ] },
      { k: 'p', t: 'Only the Fat Loss goal has a target and a verdict: "on track" allows 0.05% of body weight either side, and outside that you see too fast, too slow, or wrong way. Every other goal shows its rate with no verdict. The pace table above is used for the calorie slider and the adaptive plan.' },
    ],
  },
  {
    id: 'burn', title: 'Calories burned', tag: 'Ported', file: 'lib/burn.ts, lib/derived.ts',
    blocks: [
      { k: 'p', t: 'Only active calories are counted, so every estimate uses (MET − 1). A number you type always replaces the estimate.' },
      { k: 'f', t: [
        'kcal = (MET − 1) × kg × minutes ÷ 60',
        'Steps: distance = steps × stride; kcal = 0.5 × kg × km',
        'Stride = 0.414 × height (0.7 m if no height)',
        'ACSM walking: oxygen use = 0.1 × m + 1.8 × m × incline + 3.5, with m = metres per minute and incline as a fraction (5% = 0.05)',
        'ACSM running: oxygen use = 0.2 × m + 0.9 × m × incline + 3.5, same units',
        'MET = oxygen use ÷ 3.5',
        'Weight training MET = 3.5 + 2.5 × share of sets within 2 reps of failure (0.5 if no RIR logged)',
      ] },
      { k: 'p', t: 'Walking speed is capped at 9 km/h (default 5). Running speed is at least 5 km/h (default 9). Incline is only used on a treadmill. Outdoor cycling by speed:' },
      { k: 'table', head: ['Speed', 'MET'], rows: [['under 16.1 km/h', '4'], ['16.1 to 19.3', '6.8'], ['19.3 to 22.5', '8'], ['22.5 to 25.7', '10'], ['25.7 and over', '12']] },
      { k: 'table', head: ['Activity', 'Light', 'Moderate', 'Hard'], rows: [
        ['Gym bike', '3.5', '6.8', '8.8'], ['Elliptical', '', '5', '9'], ['Rowing machine', '', '5', '7.3'], ['Swimming', '', '5.8', '9.8'],
        ['HIIT or circuit', '', '7', '11'], ['Something else', '2.5', '4.5', '7'], ['Stair master', 'MET 9.3 at any effort', '', ''],
      ] },
    ],
    sources: 'ACSM walking and running equations; Compendium of Physical Activities (MET values)',
  },
  {
    id: 'strength', title: 'Strength: e1RM, volume and sets', tag: 'Ported', file: 'lib/perf.ts',
    blocks: [
      { k: 'f', t: [
        'e1RM (Epley) = weight × (1 + reps ÷ 30)',
        'Reps in reserve count: reps used = reps + RIR, when RIR is above 0 and the total is 10 or less',
        'A single rep means e1RM = the weight',
      ] },
      { k: 'p', t: 'e1RM is only worked out for weight × reps exercises, with 1 to 10 reps. Warm-up sets are never counted. The Lifts chart uses one rule all the way along, your best set of 1 to 10 reps, so a change of rep range alone never moves the line.' },
      { k: 'f', t: [
        'Set volume = weight × reps (× 2 for per-hand lifts)',
        'One-sided sets: weight × (left reps + right reps)',
        'Hard set = a working set with RIR 4 or less, or no RIR logged',
        'Muscle sets = hard sets for the main muscle + 0.5 × hard sets for each secondary muscle',
      ] },
      { k: 'p', t: 'Personal records are tracked in 8 kinds: e1RM, heaviest load, best set volume, best session volume, most reps, most session reps, longest time and longest distance. A load or e1RM record must beat the old one by more than 0.01.' },
      { k: 'p', t: 'Balance (last 28 days, working sets) shows each pair\'s sets and their ratio with no verdict, because no study sets a right ratio for everyone. Only the Monday check-in acts on one: when push ÷ pull is outside 0.67 to 1.5 and the pair has at least 20 sets, it suggests a few sets of the lighter side.' },
      { k: 'p', t: 'Stalled lifts: a lift with at least 3 sessions, trained in the last 14 days, where nothing has beaten an earlier set (more weight for the same reps or more, or more reps at the same weight or more, counting only sets within 80% of your heaviest weight) for 3 weeks as a beginner, 4 as intermediate or 6 as advanced. While you eat in a deficit (goal is fat loss with a falling trend, or you log at least 250 kcal a day under maintenance) such a lift is shown as holding, not stalled, for up to 8 weeks, and holding never triggers a lighter week or counts as a stall anywhere. The cause shown comes from the first test that fits, in this order: a gap of 21+ days, trained under 0.75 times a week, median RIR 3 or more, sets per session down 25%, same top load every time, then (6+ weeks) a variation swap, (4+ weeks) a deload to 90% of top load, otherwise a new rep range.' },
    ],
  },
  {
    id: 'relative', title: 'Relative strength and real progress', tag: 'Built', file: 'lib/science.ts',
    blocks: [
      { k: 'f', t: [
        'R = e1RM ÷ body mass (shown)',
        'Sₙ = e1RM ÷ body mass^0.67 (size-adjusted index)',
        'Real change = best e1RM of the last 4 weeks ÷ best e1RM of the 4 weeks before − 1',
      ] },
      { k: 'list', t: [
        'Body mass is the latest weigh-in on or before the day, else the first one within 8 days after it. Without either, or if it is over 90 days old, relative strength is not shown.',
        'The 0.67 exponent follows Jaric\'s advice to divide force measures by body mass to that power. It is a population average.',
        'A change counts only at 5% or more, and a trend needs at least 3 sessions. Test-to-test noise in a tested 1RM is about 4.2% (Grgic et al. 2020), so the line is set slightly above.',
        'When the plain change is under 5% but the size-adjusted change clears it, the app says your strength for your size went up.',
      ] },
    ],
    sources: 'Jaric 2002; Grgic et al. 2020',
  },
  {
    id: 'progression', title: 'Progression suggestions', tag: 'Built', file: 'lib/science.ts',
    blocks: [
      { k: 'p', t: 'Double progression: fill the rep range, then add load. The logger only suggests; it never changes your routine.' },
      { k: 'f', t: ['Next load = heaviest working set + 2.5 kg (5 kg for beginners on lower-body barbell lifts), reps back to the bottom of the range'] },
      { k: 'list', t: [
        'Every working set must reach the top of the range (the bottom of it for a beginner).',
        'Logged RIR must be at or above the routine\'s target, with half a rep of slack because RIR is a guess.',
        'Otherwise it tells you to add a rep on each set first.',
        'RPE = 10 − RIR.',
      ] },
    ],
    sources: 'Plotkin et al. 2022; Zourdos et al. 2016',
  },
  {
    id: 'consistency', title: 'Frequency, adherence, load and records', tag: 'Built', file: 'lib/science.ts',
    blocks: [
      { k: 'f', t: [
        'Workouts per week = workouts ÷ (days since your first workout ÷ 7), shown from 7 days of history',
        'Adherence = completed planned sessions ÷ planned sessions × 100, over the last 4 weeks',
        'Load ratio = sets in the last 7 days ÷ the weekly average of the 4 weeks before',
        'Session load = session RPE × minutes',
      ] },
      { k: 'list', t: [
        'Adherence counts only days that have passed (today counts once you log it), and shows only when your routine has planned days.',
        'The load ratio is flagged above 1.5 and needs 5 weeks of history. It is a prompt to look at your training, not an injury prediction (Gabbett 2016).',
        'Session load is Foster\'s session RPE method, shown when you rate a finished workout.',
        'Set records are the heaviest weight you have lifted for each rep count. They win no medal.',
        'Weekly rings compare this week\'s sessions, working sets and minutes against your routine; the streak counts weeks in a row that met the planned sessions.',
      ] },
    ],
    sources: 'Gabbett 2016; Foster',
  },
  {
    id: 'regions', title: 'What each exercise works', tag: 'Ported', file: 'data/db/regions.json',
    blocks: [
      { k: 'p', t: 'Under each library exercise and on the Lifts tab: the approximate share of the work done by each muscle region, from Macrotrophy\'s public data. Each breakdown was built from EMG and muscle-growth studies of that exercise, or the closest one studied, rounded to 5%. Exercises marked as estimated borrow from a similar movement. Muscle activity is not the load each muscle carries, and form changes it, so treat the numbers as a guide. The sources are listed under each exercise.' },
    ],
  },
  {
    id: 'levels', title: 'Strength levels and DOTS', tag: 'Ported', file: 'lib/perf.ts',
    blocks: [
      { k: 'f', t: ['Ratio = best e1RM in the last 12 weeks ÷ trend body weight', 'Level = the highest row the ratio reaches'] },
      { k: 'table', head: ['Lift (male)', 'Beg', 'Nov', 'Int', 'Adv', 'Elite'], rows: [
        ['Squat', '0.75', '1.25', '1.5', '2.25', '2.75'], ['Bench press', '0.5', '0.75', '1.25', '1.75', '2'], ['Deadlift', '1', '1.5', '2', '2.5', '3'],
        ['Overhead press', '0.35', '0.55', '0.8', '1.05', '1.35'], ['Barbell row', '0.5', '0.75', '1', '1.5', '1.75'],
      ] },
      { k: 'table', head: ['Lift (female)', 'Beg', 'Nov', 'Int', 'Adv', 'Elite'], rows: [
        ['Squat', '0.5', '0.75', '1.25', '1.5', '1.75'], ['Bench press', '0.25', '0.5', '0.75', '1', '1.25'], ['Deadlift', '0.5', '1', '1.25', '1.75', '2.25'],
        ['Overhead press', '0.2', '0.35', '0.5', '0.75', '1'], ['Barbell row', '0.25', '0.4', '0.65', '0.9', '1.2'],
      ] },
      { k: 'f', t: [
        'Total = best e1RM squat + bench + deadlift (last 12 weeks; all three needed)',
        'DOTS = total × 500 ÷ (a + b·w + c·w² + d·w³ + e·w⁴), w = body weight kept between 40 and 210 kg (150 for women)',
        'Male: a −307.75076, b 24.0900756, c −0.1918759221, d 0.0007391293, e −1.093e-6',
        'Female: a −57.96288, b 13.6175032, c −0.1126655495, d 0.0005158568, e −1.0706e-6',
      ] },
      { k: 'p', t: 'Levels and DOTS need your sex set to male or female in your profile.' },
    ],
  },
  {
    id: 'food', title: 'Food: day check, maintenance and protein', tag: 'Ported', file: 'lib/foodinsights.ts',
    blocks: [
      { k: 'p', t: 'A day counts as logged only if it has 1,000 kcal or more. This keeps a half-logged day from skewing averages.' },
      { k: 'table', head: ['Day check', 'Rule'], rows: [
        ['Calories on target', 'within 90% to 110% of your target'],
        ['Protein share of calories', '10% to 35%'],
        ['Carb share', '45% to 65%'],
        ['Fat share', '20% to 35%'],
        ['Protein per kg', 'inside your goal range (table in Calories and macro targets)'],
        ['Protein per meal', 'at least 0.4 g per kg in a meal counts as a full dose'],
        ['Fibre', '14 g per 1,000 kcal eaten'],
        ['Carbs on a training day', '4 to 7 g per kg'],
      ] },
      { k: 'p', t: 'Shares use 4 kcal per g for protein and carbs, 9 per g for fat.' },
      { k: 'f', t: ['Real maintenance = average daily intake − 7,700 × (change in trend weight) ÷ days between the two trend points'] },
      { k: 'p', t: 'It looks at the 28 days up to yesterday and needs 14 logged days. The two trend points must be at least 14 days apart, each within 4 days of the window edge.' },
      { k: 'p', t: 'The target check compares your target to maintenance and predicts the weekly change as a share of body weight. It warns when a cut loses more than 1% a week, when a "cut" is not a deficit, when a surplus is faster than your training age can use, and when protein is under your goal range (or over 3 g per kg, which it calls unnecessary). If your weight disagrees with the prediction by more than 0.2 kg a week, it offers a maintenance worked out from your own weight instead.' },
    ],
  },
  {
    id: 'next-meal', title: 'Next meal', tag: 'Built', file: 'lib/mealplan.ts',
    blocks: [
      { k: 'p', t: 'Built for this app. It is not a published rule, and it only uses what you have logged.' },
      { k: 'list', t: [
        'Calorie aim = what is left today × the share this meal normally takes. The share comes from your last 28 days (your average at each remaining meal). With under 3 days of history for a meal it uses a standard split: breakfast 25%, lunch 35%, snacks 10%, dinner 30%. The aim is capped at 1.5 × what you usually eat at that meal. Protein, carbs and fat are split the same way.',
        'If this meal is not logged yet, it starts from the version of it you ate in your last 6 days that is closest to the aim, then changes portions (half to double of what you had) or adds a protein food, up to 4 changes and 2 additions, whichever lowers the gap most. If the meal is already logged, it does not rebuild it: it only tops up with up to 3 small additions.',
        'Added foods come only from foods you have logged on 2 or more days (or the common protein foods when you have little history), and each must give at least 20% of its calories as protein. It never suggests a food you have not logged, and never a chicken, fish or meat main dish for a meal already logged, a snack or breakfast.',
        'Egg limits: 3 whole eggs and 6 egg whites a day. Once used, no more are suggested anywhere (Next meal, Eat next, Left for your goal). Egg dishes such as bhurji are not counted.',
        'Fat is a hard limit: nothing is suggested that adds more fat than the day has left (fat goal − fat eaten). If fat is already at or over the goal, no card adds a food with fat. This applies to Next meal, Eat next and Left for your goal. If your usual meal has more fat than is left, it is cut down or dropped.',
        'The gap counts missing calories, missing protein (weighted most), too much protein (over 15% above aim) and too much fat.',
        'Never twice a day: oats, muesli, granola, poha, upma, porridge, cereal (any brand or recipe), or a packaged snack. Chicken, rice, roti, dal, eggs, paneer, fish, vegetables, dairy, fruit and drinks can repeat. "White rice" is not blocked by "tomato rice". If your log shows you eat a food in two meals on 2 or more days, it can repeat too.',
        'With no history for the meal it falls back to Eat next, and with under 150 kcal left it shows nothing.',
      ] },
    ],
  },
  {
    id: 'plan-day', title: 'Plan my day', tag: 'Built', file: 'lib/mealplan.ts',
    blocks: [
      { k: 'p', t: 'Built for this app. You say which foods you have today, and it spreads them over the meals with amounts. It is a best fit by my own scoring, not an optimum and not a published rule. The meal times (8:00 am, 1:00 pm, 5:00 pm, 8:30 pm) are a typical spread, not from research.' },
      { k: 'list', t: [
        'Targets are what is left today: your goals minus what you have already logged. Meals already logged are left out. Fibre aims at 14 g per 1,000 kcal of your goal.',
        'Each meal gets a share of the calories from your own split over 28 days, or 25/35/10/30 with too little history.',
        'Only the foods you pick are used. A food goes only into meals it suits: its own meal tags, or the meals where you log it if you added it yourself. Chicken, fish and meat are not put in breakfast or snacks. Your diet setting still applies.',
        'Amounts are limited to what people portion: at most 1.5 × what you usually log, 2 fruit, 200 g of chicken, fish or meat, and the day\'s egg limit (3 whole, 6 whites) across all meals together.',
        'Fat is a hard limit: the plan never goes past the fat left today.',
        'Oats-type foods, fruit and other once-a-day foods appear once. Staples such as rice, roti, chicken, eggs, dal and vegetables can be in more than one meal.',
        'It starts empty and makes the single change (add, remove, or change an amount) that lowers the score most, up to 150 times, until nothing helps. The score adds up: calories off the meal aim and off the day target, protein short (counted most) or over 10% above, carbs over the target or under 90% of it, fibre short, and a small cost for each extra item.',
        'If the foods cannot reach the targets it says which is short (protein, calories or fibre) rather than going over fat. Foods you added yourself count as 0 g fibre, so fibre can look low.',
      ] },
    ],
  },
  {
    id: 'gap', title: 'Left for your goal', tag: 'Built', file: 'lib/mealplan.ts',
    blocks: [
      { k: 'p', t: 'The scoring below is written for this app. It is not a published rule.' },
      { k: 'f', t: [
        'Left = target − eaten, for calories, protein, carbs and fat',
        'Covered = 6 × protein g + 4 × carb g + 5 × fat g that a portion fills (capped at what is left)',
        'Waste = portion kcal − (4 × protein + 4 × carb + 9 × fat it fills)',
        'Score = (Covered − 1.2 × Waste − 2 × kcal over budget) × bonus, budget = kcal left + 100',
      ] },
      { k: 'list', t: [
        'Bonus is 1.15 for foods you log (on 2+ days, or while you have fewer than 6 foods). Foods you have never logged are not suggested.',
        'Up to 3 picks. It stops when the best score is under 40 or the gap is almost closed (protein ≤ 3 g, carbs ≤ 10 g, fat ≤ 3 g).',
        'Only one pick per food category, unless it is a food you usually log.',
        'Yogabar protein oats is always paired with milk, using the amount of milk you usually log (150 ml if none).',
        'With under 3 foods in your history it falls back to generic protein foods. The fat limit and egg limits apply here too, and after a meal is logged it does not offer chicken, fish or meat.',
      ] },
    ],
  },
  {
    id: 'weekly', title: 'Weekly review', tag: 'Ported', file: 'lib/weekly.ts',
    blocks: [
      { k: 'table', head: ['Check', 'Rule'], rows: [
        ['Calorie day OK', 'within 10% of your calorie target'],
        ['Protein day OK', 'at least 90% of your protein target'],
        ['Logged day', '1,000 kcal or more'],
        ['Enough food data', '3 logged days in the week'],
        ['Enough training data', '2 sessions in the week'],
        ['Week weight', 'average of that week\'s weigh-ins, needs 3 or more'],
        ['Lift really changed', 'e1RM moved 5% or more against 4 weeks ago'],
        ['Protein per meal aim', '0.4 g per kg'],
        ['Fat-loss pace', '0.5% to 1% of body weight a week'],
        ['Your usual', 'average of the 4 weeks before, shown once you have 4 weeks of history'],
      ] },
      { k: 'f', t: [
        'Change = this week\'s average weight − last week\'s',
        'Rate % = change ÷ last week\'s average × 100',
        'Real maintenance = intake over 28 days − 7,700 × (weekly slope) ÷ 7, slope = (this week − 3 weeks ago) ÷ 3',
      ] },
      { k: 'p', t: 'Fuel pattern: sessions after days at 95% of target calories or more are compared with sessions after lower days, counting a session as a win if any lift matched or beat last time. It needs 8 sessions in each group and a gap of 20 points. It is called "established" only with 10+ in each group and a Fisher exact test p-value under 0.1, and "early" otherwise. It is never used to change your advice.' },
      { k: 'p', t: 'The three pillars: training is "on plan" at the planned number of sessions, "close" at one short. Nutrition is "on target" at 95% of your protein target and calories on 5 days (or all logged days if fewer); "close" at 85%.' },
    ],
  },
  {
    id: 'adaptive-plan', title: 'Adaptive plan', tag: 'Ported', file: 'lib/adaptive.ts',
    blocks: [
      { k: 'p', t: 'The plan reads your last weeks, then proposes changes. Nothing is applied until you tap Apply. The report opens Sunday 18:00 and covers the Monday to Sunday that just ended.' },
      { k: 'p', t: 'A week is usable only if it has 5 logged food days and 4 weigh-ins. For its first 6 logged weeks the plan says it is learning and leans on research defaults.' },

      { k: 'f', t: ['Your maintenance'] },
      { k: 'f', t: [
        'Own estimate = average intake of the last 4 weeks − slope of weekly weight (kg per week) × 7,700 ÷ 7',
        'Needs 3 usable weeks of the last 4, and the answer must be between 1,000 and 5,500 kcal',
        'Blend = n ÷ (n + 3) × own + 3 ÷ (n + 3) × research estimate, n = usable weeks (max 12)',
        'Confidence is "personal" from 4 usable weeks, "learning" before that',
      ] },

      { k: 'f', t: ['Calories'] },
      { k: 'list', t: [
        'Floor: never below the larger of 1,200 and your BMR rounded up to 50.',
        'During an event week (exams, travel, wedding, festival, vrat, Ramadan, unwell) calories move to maintenance and return afterwards.',
        'No change unless last week had 5 food days and 4 weigh-ins, and the week before also had 4 weigh-ins.',
        'No change if you ate more than 10% away from the target, since the target was not tested.',
        'Pace = average weekly weight change over two weeks when three weeks are usable, else this week minus last week.',
        'Wanted pace: lose 0.5% to 1% of body weight a week; gain by training age as in Weight trend; hold ±0.25%; recomp with no target weight −0.5% to 0%.',
        'If the pace is outside the band: step = (middle of band − your rate) × kg × 7,700 ÷ 7, rounded to 50, limited to ±150 kcal, at least 50.',
        'A cut is never raised above maintenance. A gain is never raised above 120% of maintenance.',
        'No deficit for anyone under 18, and no cut toward a target weight under a BMI of 18.5 for your height. The plan holds maintenance and says why.',
      ] },

      { k: 'f', t: ['Protein'] },
      { k: 'f', t: ['Allowed range = 1.6 to 2.2 g per kg, widened to cover your goal range, rounded to 5 g'] },
      { k: 'p', t: 'A target outside it is moved to the nearest end, unless you set your own protein.' },

      { k: 'f', t: ['Training sets'] },
      { k: 'list', t: [
        'Lift status compares the best e1RM of the last 2 weeks with the 2 weeks before: up at +2% or more, down at −3% or less with 2+ sessions, otherwise flat.',
        'Down lifts: a muscle with a lift down, while you eat 250 kcal or more under maintenance (both of the last 2 weeks) or at 16+ weekly sets, loses 2 sets, never below 4.',
        'Flat lifts: if you did at least 80% of the planned sets, the muscle gains 2 sets, up to 20 a week (lower if your own data shows a lower best band), and not while eating under maintenance.',
        'Your own data: if your logs show a muscle does best at fewer sets, it is trimmed by 2.',
        'At most 3 set changes a week, ordered by priority. Set bands: under 10, 10 to 15, 16 and over.',
        'Stalled lifts (variation cause) can swap to a close variation, at most 2 a week.',
      ] },
      { k: 'f', t: ['Lighter week'] },
      { k: 'p', t: 'Proposed when 2 or more lifts dropped and one of these holds: you are under maintenance, median RIR was 1 or less, or you did 120% or more of your usual sets (average of the 4 weeks before). Not within 4 weeks of the last one, not during an event or pain change. It is one week at 60% of sets with the same weights.' },

      { k: 'f', t: ['Pain'] },
      { k: 'p', t: 'A "Something hurts" report swaps the exercises that load that area for gentler ones from a fixed table, and trims 2 sets for the related muscles, for 2 weeks (mild) or 3 weeks (moderate). A severe report, or any of sharp pain, numbness, swelling or pain lasting over a week, sends you to a doctor or physiotherapist and the plan is not changed around it. This is training guidance, not medical advice.' },

      { k: 'f', t: ['What your logs say about you'] },
      { k: 'p', t: 'The plan compares your own weeks: how much your lifts grew after weeks with low, medium or high sets, heavy or moderate reps, short or long rest between sessions of a muscle, and eating in a deficit or fed. Each lift\'s own slowing curve (log e1RM against the square root of weeks) is removed first. A pattern is called personal only if both groups have 5+ weeks, the better group beats the other by 3.4 standard errors or more, and it still holds without the latest week.' },

      { k: 'f', t: ['Try a different plan (8 weeks)'] },
      { k: 'f', t: [
        'Weight after 8 weeks = weight + (calories − maintenance) × 7 ÷ 7,700 × 8',
        'Range = maintenance ±12% (research), ±8% (learning), ±5% (personal)',
        'Lift after 8 weeks = latest e1RM × (1 + weekly growth)^8, ± spread × √8',
        'Not allowed below the calorie floor',
      ] },
    ],
  },
  {
    id: 'goals', title: 'Goals and check-in', tag: 'Ported', file: 'lib/goals.ts',
    blocks: [
      { k: 'f', t: [
        'Progress = (now − start) ÷ (target − start), kept between 0 and 1',
        'Body weight now = trend weight; lift goal now = best e1RM (or heaviest load) of the last 8 weeks',
        'Time left = distance to target ÷ weekly rate; shown only if under 156 weeks',
      ] },
      { k: 'p', t: 'A lift\'s rate is the slope over 8 weeks and needs 4 sessions across at least 3 weeks. With a target date: "ahead" if your projected date is more than 14 days early, "on track" from 7 days late to 14 days early, otherwise "behind".' },
      { k: 'p', t: 'Monday check-in: if your sets last week were more than 1.5 times the weekly average of the 4 weeks before (it needs 5 weeks of history), it asks you to ease off back to that usual number. Otherwise it points at no sessions, missed sessions, a stalled lift (not one that is holding), or a push to pull ratio outside 0.67 to 1.5, in that order.' },
    ],
  },
  {
    id: 'timers', title: 'Rest timer', tag: 'Ported', file: 'pages/Workout.tsx, lib/plan.ts',
    blocks: [
      { k: 'p', t: 'Default rest is 120 seconds after a compound lift and 90 seconds after an isolation lift, unless the routine sets its own. Buttons set 60, 90, 120 or 180 seconds, and add or remove 15. Rest you actually take is read from when you tick sets off; compound lifts under 90 seconds and isolation lifts under 60 seconds are called short.' },
    ],
  },
]

const NOT_COVERED = [
  'Eat next suggestions, the meal-plan generator, food search ranking and portion maths (katori and cup sizes, light / normal / rich oil).',
  'Badge and Wrapped thresholds.',
  'Sleep duration and the 1 to 5 rested average.',
]

function Render({ b }: { b: Block }) {
  if (b.k === 'p') return <p className="text-sm text-zinc-300 leading-relaxed">{b.t}</p>
  if (b.k === 'f') return (
    <div className="space-y-1">
      {b.t.map((x) => <p key={x} className="font-mono text-[12px] leading-snug text-lime-200 bg-zinc-800/60 rounded-lg px-2 py-1.5 break-words">{x}</p>)}
    </div>
  )
  if (b.k === 'list') return (
    <ul className="space-y-1.5 list-disc pl-4 text-sm text-zinc-300 leading-relaxed marker:text-zinc-600">
      {b.t.map((x) => <li key={x}>{x}</li>)}
    </ul>
  )
  return (
    <div className="overflow-x-auto rounded-lg border border-zinc-800">
      <table className="w-full text-xs">
        <thead><tr className="bg-zinc-800/60 text-zinc-400">{b.head.map((h) => <th key={h} className="text-left font-medium px-2 py-1.5 whitespace-nowrap">{h}</th>)}</tr></thead>
        <tbody>
          {b.rows.map((r) => (
            <tr key={r.join('|')} className="border-t border-zinc-800 text-zinc-300">
              {r.map((c, i) => <td key={i} className="px-2 py-1.5 align-top">{c}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export default function HowPage() {
  const { hash } = useLocation()
  useEffect(() => {
    const el = hash ? document.getElementById(decodeURIComponent(hash.slice(1))) : null
    if (el) el.scrollIntoView()
    else window.scrollTo(0, 0)
  }, [hash])

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <Link to="/progress?tab=data" className="text-sm text-zinc-400">← Back</Link>
      </div>
      <div className="space-y-1">
        <h1 className="text-xl font-semibold">How every number is calculated</h1>
        <p className="text-sm text-zinc-400">The formulas, thresholds and sources behind the numbers in this app. They are estimates for healthy adults, not medical advice. Your own weight trend over 2 to 3 weeks is the real test.</p>
      </div>
      <div className="flex gap-2 overflow-x-auto no-scrollbar">
        {SECTIONS.map((s) => (
          <Link key={s.id} replace to={{ hash: `#${s.id}` }} className="px-3 h-9 inline-flex items-center rounded-full text-sm whitespace-nowrap bg-zinc-800 text-zinc-300">{s.title.split(':')[0].split(' and ')[0]}</Link>
        ))}
      </div>
      <Card className="text-xs text-zinc-400 space-y-1">
        <p><span className="text-zinc-200 font-medium">Ported</span>: logic or constants taken from Macrotrophy's public bundle.</p>
        <p><span className="text-zinc-200 font-medium">Built</span>: written for this project.</p>
        <p>Each section names the file the maths lives in.</p>
      </Card>
      {SECTIONS.map((s) => (
        <Card key={s.id} className="space-y-3 scroll-mt-4">
          <div id={s.id} className="scroll-mt-4 space-y-1">
            <div className="flex items-start justify-between gap-2">
              <h2 className="text-base font-semibold">{s.title}</h2>
              <span className={`shrink-0 text-[11px] px-2 py-0.5 rounded-full ${s.tag === 'Built' ? 'bg-sky-500/15 text-sky-300' : 'bg-lime-400/15 text-lime-300'}`}>{s.tag}</span>
            </div>
            <p className="text-[11px] text-zinc-500">src/{s.file}</p>
          </div>
          {s.blocks.map((b, i) => <Render key={i} b={b} />)}
          {s.sources && <p className="text-[11px] text-zinc-500">Sources: {s.sources}</p>}
        </Card>
      ))}
      <Card className="space-y-2">
        <h2 className="text-base font-semibold">Not explained here yet</h2>
        <ul className="space-y-1.5 list-disc pl-4 text-sm text-zinc-400 marker:text-zinc-600">
          {NOT_COVERED.map((x) => <li key={x}>{x}</li>)}
        </ul>
      </Card>
    </div>
  )
}
