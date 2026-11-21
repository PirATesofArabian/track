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
- **Up next, earlier days and editing (Built):** the Lift start screen suggests the plan day that follows the one you did last, in plan order, not by weekday, so a missed or swapped day does not push the wrong session at you. "Log a workout for an earlier day" starts a workout on any past date (no timer, no rest timer, you type the minutes; last-time numbers come only from sessions on or before that date). A finished workout has an **Edit** button that reopens it, and its date and minutes can be changed. The **Plan** tab can add, remove, reorder and edit exercises (sets, reps, rest) and set weekdays. A workout left open for over 3 hours is counted as 4 minutes per working set.
- **Rest days (Built):** "Rest day today" on the Lift screen (hidden once you have trained today) and "Mark this day as a rest day" in the earlier-day sheet or on the Day tab for any past date. A rest day is not counted as a missed planned session in adherence, does not move your plan (the same day stays Up next), and syncs like the rest of your data. One tap undoes it.
- **Rest timer** with 60 / 90 / 120 / 180 s presets, ±15 s, vibration, and a default of 120 s for compounds and 90 s for isolation (Ported). The logger also suggests what to do next time (Built): fill the rep range, then add one step to each weight you used (the smallest jump you have made on that lift, else 2.5 kg; 5 kg for beginners on lower-body barbell lifts). Two steps if every set had 2 or more reps in hand, hold the weight if RIR was below target, a step lighter if half the sets missed the bottom of the range, otherwise add a rep per set. Works for weighted, assisted and bodyweight lifts. The hold, step-back, two-step and own-step-size rules are this app's own, not published (Estimate).
- **Tools** (Ported): plate calculator, warm-up ladder, supersets, voice input for sets. Voice never guesses and rejects 3 or more numbers.
- **Routines:** a six-day "V-Taper" plan from your PDF mapped to library exercises (Built), plus a plan view.
- **History** of past sessions, and a pain report ("Something hurts") that adapts the plan.
- **Workout summary** when you finish: duration, total volume, estimated calories and any new personal records (Ported record detection). There are no alerts mid-workout.

## Food

- **Food database:** 10,774 foods (Ported): 449 curated base foods, 1,206 regional dishes, 862 INDB (Indian Nutrient Databank) foods and 8,257 USDA foods. Each has units such as piece, g, ml, katori, glass or serving.
- **Katori and cup sizes** (small, medium, large) and **light / normal / rich** cooking oil (Ported).
- **Logging** by meal (Breakfast, Lunch, Snacks, Dinner), with search, your usual meals and "same as last time" one-tap relog.
- **Custom foods** per serving (Built). The app treats one serving as 100 g. The Add food sheet has an **All foods / My foods** switch: My foods lists only the foods you made (the ones you log most first), with its own search. Each food in My foods has an **Edit** button (name, serving, calories, protein, carbs, fat, fibre). An edit changes the same food, syncs to your other devices, and applies to foods you log from then on; meals already logged keep the numbers they had. **Fibre** is an optional field (0 if left empty), counted in the day's fibre and in the meal planner. Tried in Chrome, and the edit sync against a real server (`scripts/custom-check.ts`). Custom foods belong to your account: they sync to your other devices, and are not shared with other users on the server.
- **Water log** with a goal.
- **Daily goals** for calories, protein, carbs, fat, water and steps.
- **Next meal** (Built): a card on Food that says how many calories and how much protein to aim for at the next meal, and a version of your usual meal that gets there (more rice or chicken than last time, or an egg, paneer or yogurt). The calorie share comes from how you really split your day over the last 4 weeks. If that meal is already logged it becomes **Top up**: a few small additions, never another main dish. Suggestions use only foods you have logged. Fat is a hard limit: no card suggests more fat than the day has left. Eggs stop at 3 whole and 6 whites a day. Oats, muesli, poha and the like are not repeated in a day; chicken, rice, roti, dal and eggs can be. Checked with `scripts/nextmeal-check.ts` on made-up eating histories, including your own day; **not tried on your real log or in a browser yet**.
- **Left for your goal** (Built): what's left of calories, protein, carbs and fat. When short, it picks foods and amounts to close the gap, from foods you log (never ones you have not logged), and has an "Add all" button. It follows the same egg limit and no-repeat rules. The scoring is my own, not a published rule.
- **Eat next** (Ported scorer, rewritten to use your log): suggestions only from foods you log, falling back to generic protein foods if you have logged fewer than 3. It follows the same egg limit and no-repeat rules.
- **Food pairing** (Built): Yogabar protein oats are always suggested and logged with milk.
- **Plan my day** (Built): on Food > Meal plan, pick the foods you have today (your usual foods are shown as chips, or search) and it splits them over breakfast, lunch, snacks and dinner with an amount for each, aiming at what is left of your calories, protein and carbs and fibre. Fat is a hard limit. Meals already logged are skipped, eggs stop at 3 whole and 6 whites across the whole day, oats-type foods and fruit appear once, and each meal has a "Log this meal" button. If your foods cannot reach the goals it says what is short. The times shown are a typical spread, not from research. Checked with `scripts/dayplan-check.ts` on made-up histories; **not tried on your real log or in a browser yet**.
- **Meal plan:** a week plan generator with grocery list, plus a "From what I eat" mode that builds the week from your last 28 days, with no new foods. Also a menu checker for eating out (Ported generator, "From what I eat" Built).
- **Insights** (Ported): your day analysed against published ranges, protein trend, real maintenance from your logs and weight, and a check on whether your targets are right.

## Steps

- **Steps** as a day total or at a time of day, **cardio and runs**, and a burned-calories summary (Ported estimators).
- **Estimators:** ACSM walking, running and cycling equations, MET compendium values, steps to distance to kcal (stride about 0.414 × height).
- A number you type always replaces the estimate.

## Body

- **Weight** log with a 7-day average trend and weekly rate of change, shown against the pace suggested for your goal.
- **Why did my weight change? (Built, Estimate):** pick two weigh-ins (the latest two by default). It splits the change into what your logged calories explain (average kcal against maintenance, 7,700 kcal per kg) and what is left (water, food in the gut, glycogen), and lists what differed from your usual: calories, carbs, steps, heavy training. Under 7 days it never calls a change fat. It only reads your logs, so it cannot see salt, sleep or stress. Checked on your real Pi data; not tried on a phone.
- **Body numbers:** BMI (with Asian cut-offs), US Navy body-fat estimate, lean mass, FFMI, waist-to-height (Ported).
- **Measurements:** waist, neck, chest, arm, thigh, calf, hips.
- **Energy and targets** (Ported formulas):
  - Mifflin-St Jeor BMR × activity factor + lifting allowance gives maintenance (TDEE).
  - Goal picker: lose fat, build muscle, recomp, strength + size, strength, general fitness.
  - Protein by goal: 1.6–2.2 g/kg to build, 2.0–2.4 to lose fat or recomp, 1.2–1.6 for general fitness. Fat is the larger of 0.8 g/kg and 25% of calories; carbs are the rest.
  - The weekly rate is a 4-week slope of the trend. Only the Fat Loss goal gets a target and verdict; other goals show the rate alone.
- **Daily calories slider** (Built): drag the calories and see the difference from maintenance and the expected weekly pace, with a check against your goal's suggested range. You can save the number as your goal. The 7,700 kcal per kg rule is a first-weeks guide.
- **Supplements** (Built): log name, quantity, unit and date, one-tap relog, 7-day list, days taken in the last 30.
- **Sleep** (Built): bed and wake time (works past midnight), a 1–5 "rested" score, a 7-night average and bars.
- **Progress photos** (Built): pick a day (date box, or tap one of the days that have photos) and the card shows that day's front, side and back, with an add slot for each pose still missing. Photos you add go on the chosen day. JPEG and PNG are accepted and saved as JPEG (a PNG with see-through parts gets a white background). iPhone photos: HEIC is opened only where the browser can decode it (Safari yes, Chrome no). A **Live Photo** is saved as its still picture; the movement is not kept, and picking the video part is refused with a message. Compare has its own Front/Side/Back choice, and side-by-side and slider views. Stored in the browser, and sent to your Pi when you are signed in (one file per photo, 500 MB per account). JPEG, PNG and the per-day view were tried in Chrome with made-up images; **HEIC and Live Photos were not tried on an iPhone**.

## Progress

- **Overview:** workouts per week and month, adherence to your planned days, a load-ratio warning above 1.5, balance cards (sets and ratio, no verdict), sets per muscle, weekly volume, stalled lifts (3, 4 or 6 weeks by experience; shown as *holding* while in a deficit), strength levels with a DOTS score (Ported + Built).
- **Day:** one day next to your last 14 and 30 days (calories, protein, carbs, fat, fibre, water, steps, active calories burned, sets, volume, minutes), then tomorrow: your targets, notes on what to fix (fat over, protein short, water, steps), and for the routine day planned tomorrow each lift's last session and what to change (add weight, add reps, hold, step back), with a stalled-lift note after 3 sessions with no gain. All rules are this app's own (Estimate). Not tried on a phone.
- **Week:** the weekly report, with nutrition, sets, strength and bodyweight read together (Ported). The weight card now says why when it cannot compare (this week or last week had fewer than 3 weigh-ins). It opens on the week you are in, marked "This week so far", and updates as you log. That week is not saved or graded until Sunday 18:00; use ‹ for the last finished report (Built).
- **Plan:** the adaptive plan, which proposes changes to calories, protein and sets each week. Nothing changes until you apply it. Also an 8-week "Try a different plan" what-if (Ported).
- **Goals:** body weight and lift goals with milestones, plus rest-between-sets analysis (Ported).
- **Badges** across workouts, streaks, medals, total lifted, plates and habits, and **Wrapped** by month or year with share cards: Stats, Rings and Receipt (Ported, 3 of their 7 designs).
- **Lifts:** per-exercise history, e1RM (Epley, RIR-adjusted, best set of 1–10 reps), personal records, set records (heaviest weight per rep count), relative strength (e1RM ÷ body mass and ÷ mass^0.67), a real-change test (5% and 3 sessions), and what the exercise works by muscle region (Ported + Built).
- **Lift home:** weekly rings (sessions, working sets, minutes against your plan) and a weekly streak. Session load (RPE × minutes) shows after you rate a workout (Built).
- **Muscle regions** (Ported): an EMG-based share of work by region for 111 exercises (not cardio), with confidence, a note and sources. Shown in the Library sheet and on the Lifts tab.
- **Data:** see below. It links to **How every number is calculated** (`/how`): the formulas, thresholds and sources for targets, body numbers, burn, strength, relative strength, progression, consistency, regions, food checks, the weekly review and the adaptive plan, each naming its file (Built). Its figures follow the science page in `The science behind every number _ Macrotrophy.html`. Not covered yet: Eat next, meal plan generator, food search, badges and Wrapped thresholds, sleep averages.

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

## Pi server (Built)

- `server/server.py`: one Python file, standard library and SQLite, no install. Logins only; people create their own account in the app (a taken name is refused with a note to contact the admin; `SIGNUP=0` closes it), and a default `admin` user is created on first start. It also serves the built app, so the app and API share an address. See `server/README.md`.
- **Account** card in Progress → Data: sign in or create an account, sign out. Admins also see the user list (joined, last login, devices signed in). The app works fully without an account.
- Plain HTTP by design: use Tailscale or your home network.

## Cross-device sync (Built)

- **Latest edit wins, per record.** Every row has a unique id and an edit time. If the same entry is changed on two devices, the later edit is kept on both. Different entries never conflict: both are kept. A delete is an edit too, so an older change made offline cannot bring a deleted entry back.
- **When it runs:** on sign-in, 2 seconds after you change something, every 5 seconds while the app is open, when the app comes back to the front, and when the network returns (after a failed attempt it waits 30 seconds before retrying). **Sync now** and the last-synced time are in Progress → Data → Account.
- **Synced:** workouts, food, custom foods and exercises, routines, body weight, measurements, steps and cardio, water, sleep, supplements, goals, events, pain, notes, reports, meal plans, settings and profile.
- **Custom foods and exercises are kept safe** (Built): they get large unique ids, so two devices never clash. A backup restore now renumbers them too (and every log entry, workout and routine that points at them). If the browser empties this device's database but keeps the sync position, a new empty database now resets that position, so the next sync pulls everything back from the Pi (before, nothing came back). A synced food or exercise whose id matches a different local one is now kept next to it under a new id, instead of overwriting it. The app also asks the browser to keep its storage; that request only works on a secure page (https or localhost), so over plain `http://` to the Pi it is probably ignored. Checked with `scripts/custom-check.ts` against a real server; **the cause of the data you lost on your device is not confirmed**.
- **Photos:** the record syncs; the JPEG is uploaded as a file (`PUT /api/photo/<uid>`) before its record, and downloaded by other devices. A photo is never changed after it is saved, so "latest edit wins" only matters for deleting it. Checked with a real server and two-device test (`scripts/sync-e2e.ts`) using tiny made-up images; **not tried with real photos or a phone**.
- **First sync on a device that already has data** merges both sides; nothing is dropped. Signing into a different account or server does the same.
- **Needs the clock to be roughly right.** "Later" is decided by each device's clock; the server ignores edit times more than 2 minutes in the future.
- **Honest limits:** if you edit one entry on two devices at nearly the same moment, one edit is lost (the later one wins; there is no field-level merge). The whole entry is replaced, so a workout edited on two phones keeps one phone's version of the whole workout. Restoring a backup or undoing a clear counts as a new edit of every row.
- **Tested** against the real server with a scripted two-device run (`scripts/sync-e2e.ts`) and 15 server tests. **Not tested in a real browser or on a phone yet.**

## Not built

- **AI chat and "Explain", plus AI photo, label and menu food logging.** These need a server. You decided against AI image features, and AI chat is deferred.
- **Groups, leaderboards and duels** (social, server-side).
- **Not matched to the science page yet:** routine effort cues by goal (more reps in reserve for size, heavier for strength); live record alerts during a workout; the Macrotrophy Score (server-side). Not checked line by line against the page: the adaptive plan's set-change rules and the food-day checks.
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
