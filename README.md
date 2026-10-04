# Calorie tracker

A mobile-first web app (PWA) for logging food by photo and a short note. It is built from the Claude Design handoff in `design/project/Calorie Tracker v2.dc.html` (the "v2 warm" design) and targets a Galaxy A53 viewport (412 × 915).

Stack: Vite, React 19, TypeScript, Supabase (auth and storage), vite-plugin-pwa.

## Run

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # unit tests for nutrition, dates, sync merge, recognizer, auth errors
npm run build      # typecheck + production build to dist/
```

To try it on the phone, run `npm run dev -- --host` and open the LAN address in Chrome. The camera and microphone only work over HTTPS (or on localhost), so for real use, deploy it.

## What's real and what's mocked

| Area | Status |
| --- | --- |
| Account | Required. Nothing opens until you sign in or create an account: email + password (confirmed by email, with password reset) or Google. One email is one account, whichever way you sign in |
| Today, Week, Library, Settings, Add by hand, item and product sheets | Real. Data is saved to your account in Supabase, nothing is kept on the device |
| Photos | Real camera (`capture`) and gallery pickers. Each photo is tagged plate or label; tap the tag to switch |
| Voice note | Real, via the Web Speech API (Chrome on Android). The transcript goes into the note, where you can edit it |
| **Recognize** | **Mocked.** Returns the demo pasta dish after about 3 s. The outcome is random: clean, low-confidence or failed. Sources depend on your input: "from label photo" only when a label photo is attached, "from your library" only when a pasta product is in your library |
| Export | Real. Settings → Export data downloads your data from the cloud as a JSON file |

### Plugging in real recognition

`src/lib/recognize.ts` defines the `Recognizer` type: it takes the photos, note, library and an optional correction, and returns either items or a failure. Replace `export const recognize = mockRecognizer` with a call to your own server route (for example one that sends the images to a vision model). Keep the API key on the server, never in this bundle. The UI doesn't need any change.

## Supabase setup

1. Create a project at supabase.com.
2. In the **SQL editor**, run `supabase/migrations/20261003000000_user_data.sql`. It creates one `user_data` row per user, protected by row-level security.
3. Follow [docs/supabase-setup.md](docs/supabase-setup.md) for email + password sign-in, Google, redirect URLs, branded emails (templates in `supabase/email-templates/`) and custom SMTP.
4. On Vercel, the Supabase integration adds `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` itself, and the app reads those too. Otherwise, copy `.env.example` to `.env.local` and fill in `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` (Project Settings → API). Without them the app shows a "Sign-in isn't set up" screen.

### How data is stored

- The cloud is the only copy: one `user_data` row per account. After sign-in the app loads it into memory and shows nothing until it has arrived.
- Each edit is saved about 0.8 s later. Before writing, the app reads the cloud copy and merges per record (each day, each product and the settings keep the newer `updatedAt`; deleted products stay as tombstones), so two open devices don't overwrite each other. It also pulls fresh data when the app comes back to the foreground or back online.
- With no connection, Settings shows "Not saved · no connection, retrying" and the browser warns before closing the tab with unsaved edits.
- The browser keeps only the Supabase sign-in session. Signing out clears the data from memory. Older versions kept a local copy (`ct.data.v1`); it is deleted on start.

## Deploy

`dist/` is a static site, so any static host works (Vercel, Netlify, Cloudflare Pages, GitHub Pages). Use HTTPS, because the camera, microphone and service worker need it. On the phone, open the site in Chrome, then use ⋮ → **Add to Home screen**.

## Where things are

```
src/
  App.tsx              screen state, navigation, Android back button, toasts
  styles.css           design tokens (colours, radii, type) and components
  components/          icons, chips, switches, macro cards, bottom sheet
  screens/             SignIn, Today, AddMeal, Flow (Recognizing/Review/Failed/Manual), Library, Week, Settings
  lib/
    store.ts           in-memory data and mutations (no device storage)
    sync.ts, merge.ts  loading and saving to Supabase
    supabase.ts        client and auth (password, Google, reset)
    nutrition.ts       totals, macro % of calories, goal tags (On track ≤3 pts, Acceptable ≤8, else Off balance)
    recognize.ts       recognizer interface + mock
    voice.ts           Web Speech API hook
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
