import { supabase } from './supabase';
import type { Attempt } from './recognize';
import type { MealType, ReviewItem } from './types';

// Training examples for improving recognition: what went in (photos, note, library), what the model
// proposed, and what the user accepted after their edits. They go to a private Storage bucket, not the
// database, and the app never reads them back. Saving starts only after the meal is saved and runs in
// the background, so it adds no waiting; if it fails, the example is simply skipped.

export const DATASET_BUCKET = 'training-data';
/** Bump when the shape of example.json changes. */
const SCHEMA = 1;

export interface Accepted {
  date: string;
  meal: MealType;
  /** the Review rows as saved, keeping their ids so each one can be matched to its proposal */
  items: ReviewItem[];
  /** the ids the items got in the log */
  savedIds: string[];
}

const strip = (it: ReviewItem) => ({
  id: it.id,
  name: it.name,
  amount_g: +it.amount || 0,
  kcal: +it.kcal || 0,
  protein_g: +it.p || 0,
  fat_g: +it.f || 0,
  carbs_g: +it.c || 0,
  source: it.src,
  amount_source: it.amountSource ?? null,
  nutrition_source: it.nutritionSource ?? null,
  save_to_library: it.save
});

const blobOf = (dataUrl: string) => {
  const [head, b64] = dataUrl.split(',');
  const bytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
  return new Blob([bytes], { type: head.match(/^data:([^;]+)/)?.[1] ?? 'image/jpeg' });
};

/**
 * Builds the example: the photos once each (re-runs usually send the same ones) as files next to
 * example.json, which refers to them by file name.
 */
export function buildExample(id: string, attempts: Attempt[], accepted: Accepted) {
  const files = new Map<string, string>(); // dataUrl → file name
  const ref = (dataUrl: string) => {
    if (!files.has(dataUrl)) files.set(dataUrl, `photo_${files.size + 1}.${dataUrl.startsWith('data:image/png') ? 'png' : dataUrl.startsWith('data:image/webp') ? 'webp' : 'jpg'}`);
    return files.get(dataUrl)!;
  };
  const example = {
    schema: SCHEMA,
    id,
    app_version: __APP_VERSION__,
    saved_at: new Date().toISOString(),
    tz_offset_min: -new Date().getTimezoneOffset(),
    attempts: attempts.map(a => ({
      at: a.at,
      correction: a.correction,
      input: { text: a.text, images: a.images.map(i => ({ id: i.id, kind: i.kind, file: ref(i.dataUrl) })), library: a.library },
      model: a.trace && { name: a.trace.model, prompt_sha256: a.trace.prompt_sha256, commit: a.trace.commit, input_text: a.trace.input_text, output: a.trace.model_output },
      proposed: a.proposed.map(strip)
    })),
    accepted: {
      date: accepted.date,
      meal: accepted.meal,
      items: accepted.items.map((it, i) => ({ ...strip(it), log_id: accepted.savedIds[i] ?? null }))
    }
  };
  return { example, files: [...files].map(([dataUrl, name]) => ({ name, dataUrl })) };
}

/** Uploads one example under <user id>/<date>/<example id>/. Never throws. */
export async function saveExample(id: string, attempts: Attempt[], accepted: Accepted): Promise<void> {
  try {
    if (!supabase || !attempts.length) return;
    const user = (await supabase.auth.getSession()).data.session?.user;
    if (!user) return;
    const { example, files } = buildExample(id, attempts, accepted);
    const dir = `${user.id}/${accepted.date}/${id}`;
    const bucket = supabase.storage.from(DATASET_BUCKET);
    // photos first: an example.json in the folder means the example is complete
    for (const f of files) {
      const { error } = await bucket.upload(`${dir}/${f.name}`, blobOf(f.dataUrl), { upsert: false });
      if (error) throw error;
    }
    const { error } = await bucket.upload(`${dir}/example.json`, new Blob([JSON.stringify(example)], { type: 'application/json' }), { upsert: false });
    if (error) throw error;
  } catch (e) {
    console.warn('training example not saved', e);
  }
}
