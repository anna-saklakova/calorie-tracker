// Downloads the training examples from the Supabase Storage bucket `training-data`.
//
//   SUPABASE_URL=https://<project>.supabase.co SUPABASE_SERVICE_ROLE_KEY=... \
//     node scripts/download-training-data.mjs [out-dir] [since YYYY-MM-DD]
//
// The service role key (Project Settings → API) bypasses the bucket's policies: keep it on your own
// machine, never in the app or in Vercel. Files already downloaded are skipped, so running it again
// only fetches what's new. Layout: <out-dir>/<user id>/<date>/<example id>/{example.json, photo_N.jpg}
import { createClient } from '@supabase/supabase-js';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}
const out = process.argv[2] ?? 'training-data';
const since = process.argv[3] ?? '';
const bucket = createClient(url, key, { auth: { persistSession: false } }).storage.from('training-data');

/** Every file path under `prefix`. Folders come back as entries without an id. */
async function list(prefix) {
  const paths = [];
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await bucket.list(prefix, { limit: 1000, offset });
    if (error) throw error;
    for (const e of data) {
      const path = prefix ? `${prefix}/${e.name}` : e.name;
      if (e.id) paths.push(path);
      // second level is the date: skip days before `since`
      else if (!(since && prefix.split('/').length === 1 && prefix && e.name < since)) paths.push(...(await list(path)));
    }
    if (data.length < 1000) return paths;
  }
}

let fetched = 0;
let examples = 0;
for (const path of await list('')) {
  if (path.endsWith('/example.json')) examples++;
  const file = join(out, path);
  if (existsSync(file)) continue;
  const { data, error } = await bucket.download(path);
  if (error) throw error;
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, Buffer.from(await data.arrayBuffer()));
  fetched++;
}
console.log(`${examples} examples in ${out}/ · ${fetched} new files downloaded`);
