import { toJpegDataUrl } from './images';
import { r1 } from './nutrition';
import { supabase } from './supabase';
import { uid } from './types';
import type { Photo, Product, ReviewItem, Source } from './types';
import type { FinalFood, LibraryEntry, RecognizeRequest, RecognizeResponse, RecognizeTrace } from './ai/types';

export interface RecognizeInput {
  photos: Pick<Photo, 'kind' | 'file'>[];
  text: string;
  library: Product[];
  /** a correction added on the Review screen ("the meat was 200 g, not 110"); already appended to text */
  correction?: string;
  /** the current review items when re-running with a correction */
  previous?: ReviewItem[];
}

/** One recognition as it went: kept to become a training example once the meal is saved (see dataset.ts). */
export interface Attempt {
  at: string;
  /** the correction typed on the Review screen, for a re-run */
  correction: string | null;
  /** the photos exactly as the model saw them */
  images: RecognizeRequest['images'];
  text: string;
  library: LibraryEntry[];
  trace: RecognizeTrace | null;
  /** what the Review screen proposed */
  proposed: ReviewItem[];
}

export type RecognizeResult =
  | { status: 'ok'; items: ReviewItem[]; notes: string[]; attempt: Attempt }
  | { status: 'failed'; message: string };

/** The recognizer the app calls: sends the meal to /api/recognize, which talks to the model. */
export type Recognizer = (input: RecognizeInput, signal: AbortSignal) => Promise<RecognizeResult>;

export const ANALYZE_STEPS = [
  'Reading the photos and your note…',
  'Checking labels for nutrition facts…',
  'Matching with your library…',
  'Working out the amounts…'
];
export const ANALYZE_CONTEXT = 'Uses your photos, your note and your saved products. Anything it can’t read is estimated and marked.';

/** Long side in px. Labels keep more detail for the small print. */
const SIZES: [plate: number, label: number][] = [[1600, 2048], [1280, 1600], [1024, 1280]];
const BUDGET = 3_800_000; // the server accepts ~4.2 MB per request

/** Library products as per-100 g entries for the model and the nutrition lookup. */
export function libraryEntries(library: Product[]): LibraryEntry[] {
  return library.map(p => {
    const k = p.basis === 'portion' ? 100 / (p.portion || 100) : 1;
    return { id: p.id, name: p.name, per100: { kcal: r1(+p.kcal * k), protein_g: r1(+p.p * k), fat_g: r1(+p.f * k), carbs_g: r1(+p.c * k), fiber_g: null } };
  });
}

const NUTRITION_HINT: Record<FinalFood['nutrition_source'], string> = {
  package: 'Label',
  product_db: 'Your library',
  generic_db: 'Common values',
  llm_estimate: 'AI estimate'
};
const AMOUNT_HINT: Record<FinalFood['amount_source'], string> = {
  user_exact: 'your weight',
  user_estimate: '≈ your weight',
  visual_estimate: 'portion from photo'
};

/** One recognized food → an editable row on the Review screen. */
export function toReviewItem(f: FinalFood): ReviewItem {
  const src: Source =
    f.nutrition_source === 'package' ? 'label'
    : f.nutrition_source === 'product_db' ? 'library'
    : f.nutrition_source === 'generic_db' && f.amount_source !== 'visual_estimate' ? 'note'
    : 'estimated';
  const llm = f.nutrition_source === 'llm_estimate';
  return {
    id: uid(),
    name: f.brand && f.product_name ? `${f.product_name} (${f.brand})` : f.name,
    amount: Math.round(f.amount_g),
    kcal: Math.round(f.nutrition.kcal),
    p: r1(f.nutrition.protein_g),
    f: r1(f.nutrition.fat_g),
    c: r1(f.nutrition.carbs_g),
    per: { kcal: f.per100.kcal / 100, p: f.per100.protein_g / 100, f: f.per100.fat_g / 100, c: f.per100.carbs_g / 100 },
    src,
    // what the nutrients are based on (per 100 g), so a misread label is visible at a glance
    hint: `${NUTRITION_HINT[f.nutrition_source]}${f.nutrition_source === 'product_db' && f.matched_name ? ` · ${f.matched_name}` : ''} · ${Math.round(f.per100.kcal)} kcal/100 g · ${AMOUNT_HINT[f.amount_source]}`,
    // label data is worth keeping in the library for next time
    save: f.nutrition_source === 'package',
    low: llm,
    lowNote: llm ? 'No label or match found · nutrients are an AI estimate' : undefined,
    amountNote: f.amount_basis ?? undefined,
    amountSource: f.amount_source,
    nutritionSource: f.nutrition_source
  };
}

async function encodePhotos(photos: RecognizeInput['photos']) {
  for (const [plate, label] of SIZES) {
    const images = await Promise.all(
      photos.map(async (p, i) => ({ id: `img_${i + 1}`, kind: p.kind, dataUrl: await toJpegDataUrl(p.file, p.kind === 'label' ? label : plate) }))
    );
    if (images.reduce((s, i) => s + i.dataUrl.length, 0) <= BUDGET) return images;
  }
  throw new Error('too-big');
}

export const recognize: Recognizer = async (input, signal) => {
  const token = (await supabase?.auth.getSession())?.data.session?.access_token;
  if (!token) return { status: 'failed', message: 'Your session expired. Sign in again' };

  let images: RecognizeRequest['images'];
  try {
    images = await encodePhotos(input.photos.slice(0, 6));
  } catch (e) {
    return { status: 'failed', message: (e as Error).message === 'too-big' ? 'The photos are too large together. Remove one and try again' : (e as Error).message };
  }
  if (signal.aborted) throw new DOMException('Aborted', 'AbortError');

  const body: RecognizeRequest = { images, text: input.text, voiceTranscript: '', library: libraryEntries(input.library) };
  const at = new Date().toISOString();
  const res = await fetch('/api/recognize', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
    signal
  });
  const data = (await res.json().catch(() => null)) as RecognizeResponse | null;
  if (!data) return { status: 'failed', message: 'Something went wrong on our side. Check your connection and try again.' };
  if (data.status === 'failed') return data;

  const items = data.meal.foods.map(toReviewItem);
  const notes: string[] = [];
  if (items.some(i => i.low)) notes.push('Some nutrients are AI estimates (marked). Check them before saving.');
  if (data.meal.foods.some(f => f.amount_source === 'visual_estimate')) notes.push('Amounts marked ~ are judged from the photo.');
  if (data.meal.unmatched_package_image_ids.length) notes.push('A label photo couldn’t be tied to a food, so it wasn’t used.');
  if (data.meal.foods.some(f => f.energy_fix === 'kj')) notes.push('A label listed energy in kJ; it was converted to kcal.');
  if (data.meal.foods.some(f => f.energy_fix === 'macros')) notes.push('A label’s calories didn’t match its protein, fat and carbs, so they were recalculated from those. Check the label values.');
  const attempt: Attempt = { at, correction: input.correction ?? null, images, text: body.text, library: body.library, trace: data.trace ?? null, proposed: items };
  return { status: 'ok', items, notes, attempt };
};
