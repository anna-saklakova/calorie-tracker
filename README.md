# Calorie tracker

A mobile-first web app (PWA) for logging food by photo and a short note. It is built from the Claude Design handoff in `design/project/Calorie Tracker v2.dc.html` (the "v2 warm" design) and targets a Galaxy A53 viewport (412 × 915).

Stack: Vite, React 19, TypeScript, Supabase (auth and storage), vite-plugin-pwa.

## Run

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # unit tests for nutrition, dates, sync merge, auth errors, the recognition pipeline
npm run build      # typecheck + production build to dist/
```

To try it on the phone, run `npm run dev -- --host` and open the LAN address in Chrome. The camera and microphone only work over HTTPS (or on localhost), so for real use, deploy it.

## What's real and what's mocked

| Area | Status |
| --- | --- |
| Account | Required. Nothing opens until you sign in or create an account: email + password (confirmed by email, with password reset) or Google. One email is one account, whichever way you sign in |
| Today, Week, Body, Library, Settings, Add by hand, item and product sheets | Real. Data is saved to your account in Supabase, nothing is kept on the device |
| Photos | Real camera (`capture`) and gallery pickers. Each photo is copied into memory and scaled to 2048 px as soon as it's picked, so a photo that can't be read or opened is reported right away. Each photo is tagged plate or label; tap the tag to switch |
| Voice note | Real. Recorded in the browser, transcribed by `gpt-transcribe` on the server. The text goes into the note, where you can edit it. Recognize can be pressed while the note is still recording or transcribing (or photos are still loading): it finishes those first |
| Recognize | Real. Photos + note → foods, grams and nutrients with their sources, see below |
| Export | Real. Settings → Export data downloads your data from the cloud as a JSON file |

### How recognition works

Follows the AI module spec: `api/recognize.ts` (a Vercel function) sends all photos, the note and the user's library to `gpt-5.4-mini` (Responses API, strict JSON Schema). The model only reads the meal: which foods, how many grams and where that number came from (`user_exact`, `user_estimate`, `visual_estimate`), which label belongs to which food, which library product it matches, and a web search query for the rest. On the first run, foods with no label and no library match get the model's own estimate. When the user re-runs from Review (with or without a note), those foods are looked up online in a second call (`src/lib/ai/search.ts`, OpenAI `web_search` tool): a value is used only if its page really came up in the search and the macros add up, and the Review row links to that page. `src/lib/ai/meal.ts` picks the nutrient source per food in a fixed order (label → your library → model estimate; on a re-run label → library → web → estimate) and does the arithmetic in code. The lookup gets at most 45 s within the function's limit; if it fails or runs out of time, those foods keep the model's estimate and the Review screen says so. (A built-in list of 179 generic foods was dropped in 0.10: the model matched dishes to whatever entry was nearest.) Voice notes are recorded in the browser and transcribed by `gpt-transcribe` via `api/transcribe.ts`, in Russian by default (`OPENAI_TRANSCRIBE_LANGUAGE`). Recognize can be pressed at any moment: a recording still running is stopped and transcribed first, and a voice note whose transcription failed is kept and retried rather than dropped (`src/lib/voice.ts`). Photos and words describe one meal: a food named in the note that a photo shows is one entry, and every food or drink named is listed.

On the Review screen items can be added as well as removed, with any nutrient fields left empty. "Re-run" sends the list as the user left it (`checked` in the request): the model keeps its rows, names and amounts, does not bring back removed foods, and fills in what is missing; nutrients the user typed stay. A failed re-run leaves the list, the edits and the note in place.

The OpenAI key lives only in the Vercel environment (`OPENAI_API_KEY`, Sensitive). Both functions require a signed-in Supabase session and a daily quota (`consume_ai_quota`: 50 recognitions / 100 voice notes per email, 500 / 1000 app-wide; counted per email so deleting and re-creating an account doesn't reset it). Setup: [docs/openai-setup.md](docs/openai-setup.md).

The model gets up to 110 s (the function 120 s, the app waits 130 s); the Analyzing screen shows the seconds. Reasoning effort is `low` by default (`OPENAI_REASONING` env var to change): the model only reads the meal, the maths and the label checks are in code. When recognition fails, the Failed screen shows a short code under the message (`openai_timeout · 112 s`, `http_504_timeout`, `no_food`, `openai_400_invalid_json_schema`, …); the same code and the time taken are in Vercel → Logs, without any photo or note content.

### Goals on Today and Week

- Today shows the calories **left** to the goal as the big number, with "eaten of goal" underneath. Settings has a **Minimum** too: the least to eat on a full day. Today shows how far it is; on Week a finished day that stayed below it is a hollow bar, and the minimum is a second dashed line.
- Today has one protein panel instead of three macro cards. It compares the protein eaten with the calories eaten: the missing grams must still fit into the calories left. Green when the rest of the day needs no more protein per kcal than the day's average (up to 1.2×), yellow up to 1.6× (protein-rich meals will catch up), red above that. The tick on the bar is where the protein "should" be by now. Reached and almost follow the same rule as the weekly marks, so from "almost" the panel is never worse than yellow (`src/lib/nutrition.ts`, `proteinPace`).
- **Protein range.** Settings has **Protein reached** (from how many grams a day counts as reached) and **Almost reached** (its lower bound); below that the day is not reached. The default is 115 g / 95 g, and goals saved before the range existed use it too. "Reached" is also the protein target on Today, and the protein field of the macro goal is locked to it (in % mode it shows the share those grams make of the calorie goal; fat and carbs fill the rest). The range is part of the goal history, so past days keep the range they had. Clearing "Protein reached" falls back to the macro goal: reached at the target, almost from 85 % (`proteinGoal`).
- Week keeps the three macro cards (averages) and marks each day's protein with a filled ✓ / ~ / ✕ circle: reached, almost, not reached.

### Week: how the numbers are counted

Based on the evidence summarised below (`src/lib/stats.ts`, `src/lib/weight.ts`).

- **Calorie zones of a day** (`kcalZone`): within ±5 % of the goal it's reached (green ✓), within ±10 % almost (yellow ↓ / ↑), beyond that not reached (red ↓ / ↑). Week marks each day with these under the chart, next to the protein marks; today gets a mark only once it is already more than 10 % over. The bars and the ring on Today follow the same bands: green up to 5 % over the goal, yellow up to 10 %, red beyond.
- **Strength-day goal**: Settings has a second calorie goal for strength-training days. Today shows a "Strength training" switch once a strength-day goal is in force for that date; the day is stored with `strength: true` and judged by that goal (`dayGoals`). Without the switch a day is a regular day, so every earlier day keeps being judged by the daily goal. The switch can be set on past days too, to fix a mistake. Week draws each day's own goal (dark marks for strength days); later days have no goal yet. Macro percentages follow the goal of the day; protein range and minimum are the same on every day.
- **Calorie week** (`kcalWeekTag`), from the colours of its days: green when at least half the days are green, at most 2 are red and none goes over 130 % (a binge that undoes the week's deficit); yellow with at most 3 red days and at most one over 130 %; red otherwise.
- **Week result**: once a week is over, a card at the top gives its calorie and protein verdict (✓ / ~ / ✕) with the days by colour.
- **Calories add up over days**, so the week shows the arithmetic mean of the finished, logged days, plus their sum against the goals of the same days ("7 of 7 days logged · 15 340 of 14 700 kcal"). Not the median: it would hide the days over. Days without a log are left out; with more than one such day the line turns yellow, since the average may be off.
- **Protein by the 80 / 20 rule.** The body repairs tissue over the week, so a day or two below the range doesn't spoil it; what matters is how often protein falls below the almost level. The protein card is green with at most one day below it, yellow with two (a rare exception), red with three or more (`proteinWeekTag`).
- **Body tab: weekly check-in.** Weight and waist live on their own tab, not on Today. The check-in form takes today by default; a month calendar above it fills the days that have a check-in (with the weight under the date), so past check-ins are seen at a glance, and any past day can be picked; a day with a check-in opens prefilled (also from History). Once the last check-in is 7 days old the Body tab gets a red dot and Today shows a single **Weekly check-in** line that opens Body; nothing else of it is on Today or Week. Stored on the day (`Day.weight`, `Day.waist`).
- **Waist, optional**, next to the weight in the same form (cm, at the navel, relaxed). Body shows the latest weight and waist with their trends a week, a chart of each over 12 weeks or all time (the trend line dashed, tap a point for its value), and the history.
- **Trend**: a least-squares line through the weigh-ins of the last 6 weeks (at least 3, at least 2 weeks apart), in kg a week; not the difference between two weigh-ins, which are noisy.
- **Maintenance by your log**: average logged intake between the first and last weigh-in minus the weight change × 7 700 kcal/kg, with a ± range from the trend's uncertainty. Only with at least 4 weigh-ins over 4 weeks and food logged on 6 of 7 days in between. It compares the log with the scale, so it also absorbs what the log misses. Shown on Body once there is enough data (with what the current goal means in kg a week) and under the daily goal in Settings; the goal itself is never changed automatically.
- **Last 7 days** (`src/lib/review.ts`, top of Body): always shown, from the 7 finished days before today. Each block (food, protein, strength days, weight, waist) lists what the data says and, under "Not known", what it can't say and why: days without a log, the log's own blind spots, a single weigh-in that shows no direction, the scale's water noise as kcal a day over the interval, a trend whose range includes zero. With no data it says that instead of staying empty.
- **Longer view** (`src/lib/body.ts`, below the review; protein and log gaps are left to it): at most four short readings of the latest change against the food log. A change is only read week to week: the latest check-in against the last one at least 6 days before it (check-ins a day or two apart get a "too soon to read" note, and History shows no change for them). That change vs what the food explains at your maintenance (a gap of more than 1 % of body weight, at least 0.6 kg, is read as water, with a carb load in the 2 days before named when there was one: glycogen holds ≈ 3 g of water per gram, Olsson & Saltin 1970); the pace as a share of body weight (0.5–1 % a week keeps muscle, faster costs more: Helms 2014, Garthe 2011); protein against your own target from Settings, day by day (reached, almost, below), judged like the week's protein; waist against weight (waist down at a steady weight = fat lost, muscle kept; waist tracks abdominal fat, Ashwell 2012); weekends well above weekdays (Racette 2008); too few days logged to judge.

Sources: Trommelen 2023 (Cell Rep Med, a large protein dose within a day is used); Areta 2013 and Schoenfeld & Aragon 2018 (distribution is second order); meta-analyses of intermittent vs continuous energy restriction (Cioffi 2018 and others: same weight loss); weekly vs daily self-weighing (meta-analysis 2015: no difference); Orsama 2014 (weekly weight rhythm); Hall 2008 and Hall's energy-balance work (7 700 kcal/kg is rough, estimates need ≥ 4 weeks); doubly labelled water reviews (self-reported intake is under-reported).

## Supabase setup

1. Create a project at supabase.com.
2. In the **SQL editor**, run `supabase/migrations/20261003000000_user_data.sql`. It creates one `user_data` row per user, protected by row-level security.
3. Follow [docs/supabase-setup.md](docs/supabase-setup.md) for email + password sign-in, Google, redirect URLs, branded emails (templates in `supabase/email-templates/`) and custom SMTP.
4. On Vercel, the Supabase integration adds `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` itself, and the app reads those too. Otherwise, copy `.env.example` to `.env.local` and fill in `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` (Project Settings → API). Without them the app shows a "Sign-in isn't set up" screen.

### How data is stored

- The cloud is the only copy: one row per day (`user_days`) and per library product (`user_products`), plus the settings in `user_data` (`supabase/migrations/20261006000000_per_record_storage.sql`). After sign-in the app loads everything into memory and shows nothing until it has arrived.
- Each edit is saved about 0.8 s later, sending only the records that changed, in one call to `save_records`. The database keeps the newer version of each record (by the app's `updatedAt`; deleted products stay as tombstones), so two open devices don't overwrite each other. After saving, and when the app comes back to the foreground or online, it fetches only rows changed since the last pull. Data saved by older versions as one document in `user_data` is moved into the tables automatically.
- With no connection, Settings shows "Not saved · no connection, retrying" and the browser warns before closing the tab with unsaved edits.
- The browser keeps only the Supabase sign-in session. Signing out clears the data from memory. Older versions kept a local copy (`ct.data.v1`); it is deleted on start.

## Deploy

`dist/` is a static site, so any static host works (Vercel, Netlify, Cloudflare Pages, GitHub Pages). Use HTTPS, because the camera, microphone and service worker need it. On the phone, open the site in Chrome, then use ⋮ → **Add to Home screen**.

## Where things are

```
api/                   Vercel functions: recognize.ts, transcribe.ts (hold the OpenAI key)
src/
  App.tsx              screen state, navigation, Android back button, toasts
  styles.css           design tokens (colours, radii, type) and components
  components/          icons, chips, switches, macro cards, bottom sheet
  screens/             SignIn, Today, AddMeal, Flow (Recognizing/Review/Failed/Manual), Library, Week, Body, Settings
  lib/
    store.ts           in-memory data and mutations (no device storage)
    sync.ts            loading, saving and pulling changes
    remote.ts          database calls (rows, save_records)
    merge.ts           per-record conflict rules (newer wins), unsaved-record tracking
    supabase.ts        client and auth (password, Google, reset)
    stats.ts           the week's numbers: coverage, sum against the goals, protein by days
    weight.ts          weigh-ins and waist, their trends, maintenance by the log
    body.ts            check-ins, when one is due, the food between them and the readings on Body
    nutrition.ts       totals, macro % of calories, goal tags (protein may go over, fat and carbs may stay under; On track ≤3 pts the wrong way, Acceptable ≤8, else Off balance), day status with the minimum, protein pace
    recognize.ts       calls /api/recognize, maps the result to Review rows
    ai/                shared with the server: schema, prompts, web lookup, nutrient maths
    voice.ts           voice note recording → /api/transcribe
```

## Changes from the prototype

- The app starts empty: no sample days and no sample library.
- Long-press on a Today item deletes it, with **Undo** in the toast. Tapping an item still opens the edit sheet with Delete.
- Deleting a library product also offers Undo. The product sheet adds **Save changes only**, so you can edit a product without adding it to a meal.
- The next-day arrow stops at today.
- A product saved per portion has a "One portion is … g" field.
- Sign-in is required; there is no local-only mode. Settings has Sign out and Set / Change password.
- The Android back button closes the sheet or steps back through the flow instead of leaving the app.
- On desktop, the app is shown in a 412 × 915 rounded frame, like the prototype.
