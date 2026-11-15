# Gym & Food Tracker — features

A private, free, single-user workout and Indian food tracker. A personal rebuild of the features of Macrotrophy (https://macrotrophy.in/), made from their public static bundle only. No backend, no accounts, no paywall.

**Where your data lives:** only in this browser (IndexedDB database `gym-food-tracker`), on this device. Nothing is sent anywhere. Clearing site data deletes it, and another device or browser starts empty. Back up with **Progress → Data → Export JSON**.

**Legend**
- **Ported**: logic, constants or data taken from Macrotrophy's public bundle.
- **Built**: written for this project, not ported.
- **Estimate**: values I back-solved or assumed. Replace them with real ones where you can.

---

## Tabs

| Tab | Route | What it does |
|---|---|---|
| Lift | `/workout` | Log workouts, routines, exercise library, history |
| Food | `/food` | Food log, meal plan, insights |
| Steps | `/activity` | Steps and cardio, calories burned |
| Body | `/body` | Weight, measurements, targets, supplements, sleep, photos |
| Progress | `/progress` | Overview, weekly review, plan, goals, badges, Wrapped, lifts, data |

---

## Lift

- **Exercise library:** 120 exercises (Ported), with muscle, equipment, compound or isolation, how it's tracked and per-hand or total load. You can add custom exercises (Built).
- **Tracking types:** weight × reps, bodyweight reps, added weight, assisted, time, distance, cardio. One-sided exercises log left and right reps (Ported).
- **Logger:** sets with weight, reps and RIR, set types (working, warm-up, back-off, drop), swap exercise, discard, finish, session RPE, notes (Ported).
- **Rest timer** with ±15 s, vibration, and a default of 150 s for compounds and 90 s for isolation (Ported).
- **Tools** (Ported): plate calculator, warm-up ladder, supersets, voice input for sets. Voice never guesses and rejects 3 or more numbers.
- **Routines:** a six-day "V-Taper" plan from your PDF mapped to library exercises (Built), plus a plan view.
- **History** of past sessions, and a pain report ("Something hurts") that adapts the plan.
- **Workout summary** when you finish: duration, total volume, estimated calories and any new personal records (Ported record detection). There are no alerts mid-workout.

## Food

- **Food database:** 10,774 foods (Ported): 449 curated base foods, 1,206 regional dishes, 862 INDB (Indian Nutrient Databank) foods and 8,257 USDA foods. Each has units such as piece, g, ml, katori, glass or serving.
- **Katori and cup sizes** (small, medium, large) and **light / normal / rich** cooking oil (Ported).
- **Logging** by meal (Breakfast, Lunch, Snacks, Dinner), with search, your usual meals and "same as last time" one-tap relog.
- **Custom foods** per serving (Built). The app treats one serving as 100 g.
- **Water log** with a goal.
- **Daily goals** for calories, protein, carbs, fat, water and steps.
- **Left for your goal** (Built): what's left of calories, protein, carbs and fat. When short, it picks foods and amounts to close the gap, from foods you log first and similar ones next, and has an "Add all" button. The scoring is my own, not a published rule.
- **Eat next** (Ported scorer, rewritten to use your log): suggestions from what you log, then similar foods ("Like your …"), falling back to generic pools if you have little history.
- **Food pairing** (Built): Yogabar protein oats are always suggested and logged with milk.
- **Meal plan:** a week plan generator with grocery list, plus a "From what I eat" mode that builds the week from your last 28 days, with no new foods. Also a menu checker for eating out (Ported generator, "From what I eat" Built).
- **Insights** (Ported): your day analysed against published ranges, protein trend, real maintenance from your logs and weight, and a check on whether your targets are right.

## Steps

- **Steps** as a day total or at a time of day, **cardio and runs**, and a burned-calories summary (Ported estimators).
- **Estimators:** ACSM walking, running and cycling equations, MET compendium values, steps to distance to kcal (stride about 0.414 × height).
- A number you type always replaces the estimate.

## Body

- **Weight** log with a 7-day average trend and weekly rate of change, shown against the pace suggested for your goal.
- **Body numbers:** BMI (with Asian cut-offs), US Navy body-fat estimate, lean mass, FFMI, waist-to-height (Ported).
- **Measurements:** waist, neck, chest, arm, thigh, calf, hips.
- **Energy and targets** (Ported formulas):
  - Mifflin-St Jeor BMR × activity factor + lifting allowance gives maintenance (TDEE).
  - Goal picker: lose fat, build muscle, recomp, strength + size, strength, general fitness.
  - Protein 2–2.2 g/kg. The remaining calories split 60% carbs and 40% fat, with fat never below 0.8 g/kg.
- **Daily calories slider** (Built): drag the calories and see the difference from maintenance and the expected weekly pace, with a check against your goal's suggested range. You can save the number as your goal. The 7,700 kcal per kg rule is a first-weeks guide.
- **Supplements** (Built): log name, quantity, unit and date, one-tap relog, 7-day list, days taken in the last 30.
- **Sleep** (Built): bed and wake time (works past midnight), a 1–5 "rested" score, a 7-night average and bars.
- **Progress photos** (Built): front, side and back; side-by-side and slider compare; stored in the browser as JPEG.

## Progress

- **Overview:** balance, sets per muscle, weekly volume, recent sessions, stalled lifts, strength levels with a DOTS score (Ported).
- **Week:** the weekly report, with nutrition, sets, strength and bodyweight read together (Ported).
- **Plan:** the adaptive plan, which proposes changes to calories, protein and sets each week. Nothing changes until you apply it. Also an 8-week "Try a different plan" what-if (Ported).
- **Goals:** body weight and lift goals with milestones, plus rest-between-sets analysis (Ported).
- **Badges** across workouts, streaks, medals, total lifted, plates and habits, and **Wrapped** by month or year with share cards: Stats, Rings and Receipt (Ported, 3 of their 7 designs).
- **Lifts:** per-exercise history, e1RM (Epley, RIR-adjusted), personal records and set records (Ported).
- **Data:** see below.

## Data and safety

- **Export JSON:** full backup, including photos.
- **Import JSON:** restores a backup. **It replaces everything**, with an Undo.
- **Add entries from file** (Built): adds rows from a JSON file without clearing anything. It skips rows that already exist, so running it twice adds nothing, and has an Undo. Used for the Nov 12–15 data.
- **Undo** for deletes and imports.

## Data from your Nov 12–15 notes

Imported with the additive importer: food, two workouts (Legs A and Push B), body weight, steps and supplements. Mapping notes:
- **Yogabar protein oats**, **wheat bread** and **The Whole Truth whey** use your label values (custom foods).
- Ragi ball was logged as ragi mudde, the 3-egg omelette as boiled eggs, peanut butter as a generic entry.
- Belt squat and lying leg raise are custom exercises.
- Seated leg curl and triceps rope extension used the lower end of your reported weight range; rep ranges used the lower number.
- RIR and rest times were not recorded.

---

## Not built

- **AI chat and "Explain", plus AI photo, label and menu food logging.** These need a server. You decided against AI image features, and AI chat is deferred.
- **Groups, leaderboards and duels** (social, server-side).
- **Cross-device sync.** Each device keeps its own data. Planned: a small server on the Raspberry Pi with one login per user, over Tailscale.
- **A "How every number is calculated" page** with the formulas and sources.
- **Possibly missing, not yet checked against the code:**
  - relative strength (e1RM ÷ body weight^0.67)
  - the training-load ratio that flags sudden jumps in weekly sets
  - session load (RPE × minutes)
  - adherence (the percentage of planned sessions done)
  - per-exercise muscle-region shares from EMG studies
- Only 3 of their 7 share-card designs, without their brand fonts or photo editor.

## Approximate, not exact

- Formulas are estimates for healthy adults, not medical advice. Your own weight trend over 2–3 weeks is the real test.
- Home-cooked dish values are usually within 10–20%. A label in your hand beats the database.
- Some Indian foods use the closest USDA food.
- The first-weeks pace uses 7,700 kcal per kg and overstates change as the body adapts.

---

## Tech

React 19, TypeScript, Vite, Tailwind CSS 4, Dexie 4 (IndexedDB), React Router 7, PWA (installable, works offline). Hosted as static files, with `netlify.toml` for Netlify.

```
src/pages/   one file per screen
src/lib/     calculation and storage logic (perf, weekly, adaptive, mealplan, body, ...)
src/data/    exercise and food databases (db/*.json)
```

Run it:

```
npm install
npm run dev      # http://localhost:5173
npm run build    # output in dist/
```
