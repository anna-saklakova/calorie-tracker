# Calorie tracker

A mobile-first web app (PWA) for logging food by photo and a short note. It is built from the Claude Design handoff in `design/project/Calorie Tracker v2.dc.html` (the "v2 warm" design) and targets a Galaxy A53 viewport (412 × 915).

Stack: Vite, React 19, TypeScript, Supabase (auth and sync), vite-plugin-pwa.

## Run

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # unit tests for nutrition, dates, sync merge, recognizer
npm run build      # typecheck + production build to dist/
```

To try it on the phone, run `npm run dev -- --host` and open the LAN address in Chrome. The camera and microphone only work over HTTPS (or on localhost), so for real use, deploy it.

## What's real and what's mocked

| Area | Status |
| --- | --- |
| Today, Week, Library, Settings, Add by hand, item and product sheets | Real. Data is saved on the device (localStorage) |
| Photos | Real camera (`capture`) and gallery pickers. Each photo is tagged plate or label; tap the tag to switch |
| Voice note | Real, via the Web Speech API (Chrome on Android). The transcript goes into the note, where you can edit it |
| Sign-in and sync | Real, through Supabase (Google and email magic link) once configured, see below. Without config the app runs local-only and skips the sign-in screen |
| **Recognize** | **Mocked.** Returns the demo pasta dish after about 3 s. The outcome is random: clean, low-confidence or failed. Sources depend on your input: "from label photo" only when a label photo is attached, "from your library" only when a pasta product is in your library |
| Export | Real. Downloads a JSON file |

### Plugging in real recognition

`src/lib/recognize.ts` defines the `Recognizer` type: it takes the photos, note, library and an optional correction, and returns either items or a failure. Replace `export const recognize = mockRecognizer` with a call to your own server route (for example one that sends the images to a vision model). Keep the API key on the server, never in this bundle. The UI doesn't need any change.

## Supabase setup (auth + sync)

1. Create a project at supabase.com.
2. In the **SQL editor**, run `supabase/migrations/0001_user_data.sql`. It creates one `user_data` row per user, protected by row-level security.
3. **Authentication → URL configuration**: set the Site URL to the deployed URL, and add both it and `http://localhost:5173` to the redirect URLs.
4. **Authentication → Providers**:
   - Email: on by default (magic link).
   - Google: enable it, then paste the client ID and secret from a Google Cloud OAuth client. That client's authorized redirect URI must be `https://<project>.supabase.co/auth/v1/callback`.
5. Copy `.env.example` to `.env.local` and fill in `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` (Project Settings → API). Set the same two variables on the host you deploy to.

### How sync works

- The device copy is always the working copy, so the app works offline.
- After signing in, the app pulls the cloud copy, merges it with the device and writes the result back to both. It does this again about 1.5 s after any edit, whenever the app comes back to the foreground, and when the device comes back online.
- The merge is per record: each day, each product and the settings keep whichever version has the newer `updatedAt`. Deleted products are kept as tombstones, so a delete on one device isn't undone by another.
- Signing out keeps the data on the phone.

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
    store.ts           local data store and mutations
    sync.ts, merge.ts  Supabase sync
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
- The sign-in screen shows only until it's answered once (signed in or skipped). After that it's reachable from Settings → Sign in.
- The Android back button closes the sheet or steps back through the flow instead of leaving the app.
- On desktop, the app is shown in a 412 × 915 rounded frame, like the prototype.
