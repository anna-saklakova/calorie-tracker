import { toJpegDataUrl } from './images';
import { r1 } from './nutrition';
import { supabase } from './supabase';
import { uid } from './types';
import type { Photo, Product, ReviewItem, Source } from './types';
import type { CheckedItem, FinalFood, LibraryEntry, RecognizeRequest, RecognizeResponse, RecognizeTrace } from './ai/types';

export interface RecognizeInput {
  photos: Pick<Photo, 'kind' | 'file'>[];
  text: string;
  library: Product[];
  /** a correction added on the Review screen ("the meat was 200 g, not 110"); already appended to text */
  correction?: string;
  /** the Review rows as the user left them, when re-running with a correction: their edits are kept */
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
  | { status: 'failed'; message: string; code: string; seconds?: number };

/** No answer from the server at all after this long (the server itself gives the model ~110 s). */
export const CLIENT_TIMEOUT_MS = 130_000;

/** The recognizer the app calls: sends the meal to /api/recognize, which talks to the model. */
export type Recognizer = (input: RecognizeInput, signal: AbortSignal) => Promise<RecognizeResult>;

export const ANALYZE_STEPS = [
  'Reading the photos and your note…',
  'Checking labels for nutrition facts…',
  'Matching with your library…',
  'Looking up nutrition online…',
  'Working out the amounts…'
];
export const ANALYZE_CONTEXT = 'Uses your photos, your note and your saved products, then looks up the rest online. Anything it can’t find is estimated and marked.';

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
  web: 'Web',
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
    : f.nutrition_source === 'web' ? 'web'
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
    hint: `${NUTRITION_HINT[f.nutrition_source]}${f.nutrition_source === 'product_db' && f.matched_name ? ` · ${f.matched_name}` : ''}${f.source_name ? ` · ${f.source_name}` : ''} · ${Math.round(f.per100.kcal)} kcal/100 g · ${AMOUNT_HINT[f.amount_source]}`,
    sourceUrl: f.source_url ?? undefined,
    // label data is worth keeping in the library for next time
    save: f.nutrition_source === 'package',
    low: llm,
    lowNote: llm ? 'No label, library match or web result · nutrients are an AI estimate' : undefined,
    amountNote: f.amount_basis ?? undefined,
    amountSource: f.amount_source,
    nutritionSource: f.nutrition_source
  };
}

const given = (v: number | string) => (v === '' || v === null || v === undefined || !Number.isFinite(+v) ? null : +v);

/** A Review row as the model sees it on a re-run. Empty fields stay null, so the model knows to find them. */
export function checkedItem(it: ReviewItem): CheckedItem {
  return { name: it.name.trim(), amount_g: given(it.amount), kcal: given(it.kcal), protein_g: given(it.p), fat_g: given(it.f), carbs_g: given(it.c) };
}

/**
 * After a re-run, a row the user had typed nutrients into keeps those numbers (rescaled if the amount
 * changed); the model's values fill only the fields the user left empty.
 */
export function keepUserNutrients(item: ReviewItem, prev: ReviewItem | undefined): ReviewItem {
  if (!prev) return item;
  const set = (prev.userSet ?? []).filter(k => given(prev[k]) !== null);
  const out: ReviewItem = { ...item, manual: prev.manual, save: prev.save || item.save };
  if (!set.length) return out;
  const prevAmount = +prev.amount || 0;
  for (const k of set) {
    const v = prevAmount > 0 ? (+prev[k] / prevAmount) * out.amount : +prev[k];
    out[k] = k === 'kcal' ? Math.round(v) : r1(v);
    out.per = { ...out.per, [k]: out.amount ? out[k] / out.amount : 0 };
  }
  out.userSet = set;
  out.src = 'note';
  out.low = false;
  out.lowNote = undefined;
  out.hint = set.length === 4 ? `Your numbers · ${Math.round(out.per.kcal * 100)} kcal/100 g` : `Partly your numbers · ${item.hint}`;
  return out;
}

/** An empty row the user adds on the Review screen; whatever they leave blank a re-run can find. */
export function newReviewItem(): ReviewItem {
  const e = '' as unknown as number;
  return { id: uid(), name: '', amount: e, kcal: e, p: e, f: e, c: e, per: { kcal: 0, p: 0, f: 0, c: 0 }, src: 'note', hint: 'Added by you', save: false, manual: true, userSet: [] };
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

/**
 * What to tell the user when the server answered with something other than our JSON: the hosting
 * platform's own errors (timeout, body too large, crash) come as plain text or HTML.
 */
export function httpFailure(status: number): { message: string; code: string } {
  if (status === 504 || status === 408) return { message: 'The server stopped waiting for the answer. Try one photo at a time, or add by hand', code: `http_${status}_timeout` };
  if (status === 413) return { message: 'The photos are too large for the server. Remove one and try again', code: 'http_413_too_large' };
  if (status === 401 || status === 403) return { message: 'Your session expired. Sign in again', code: `http_${status}` };
  if (status === 404) return { message: 'Recognition isn’t available in this build', code: 'http_404' };
  if (status >= 500) return { message: `The recognition service failed (error ${status}). Try again in a minute`, code: `http_${status}` };
  return { message: `Unexpected answer from the server (${status}). Try again`, code: `http_${status}` };
}

/** `signal`, but also aborted after `ms` (older browsers without AbortSignal.any keep only the timeout). */
function withTimeout(signal: AbortSignal, ms: number): AbortSignal {
  const timeout = AbortSignal.timeout(ms);
  return 'any' in AbortSignal ? AbortSignal.any([signal, timeout]) : timeout;
}

export const recognize: Recognizer = async (input, signal) => {
  const token = (await supabase?.auth.getSession())?.data.session?.access_token;
  if (!token) return { status: 'failed', message: 'Your session expired. Sign in again', code: 'no_session' };

  let images: RecognizeRequest['images'];
  try {
    images = await encodePhotos(input.photos.slice(0, 6));
  } catch (e) {
    const err = e as Error;
    if (err.message === 'too-big') return { status: 'failed', message: 'The photos are too large together. Remove one and try again', code: 'photos_too_large' };
    return { status: 'failed', message: err.message || 'Couldn’t prepare the photos', code: `photo_${err.name || 'error'}` };
  }
  if (signal.aborted) throw new DOMException('Aborted', 'AbortError');

  const body: RecognizeRequest = { images, text: input.text, voiceTranscript: '', library: libraryEntries(input.library), checked: input.previous?.map(checkedItem) };
  const at = new Date().toISOString();
  const started = Date.now();
  const seconds = () => Math.round((Date.now() - started) / 1000);
  let res: Response;
  try {
    res = await fetch('/api/recognize', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
      signal: withTimeout(signal, CLIENT_TIMEOUT_MS)
    });
  } catch (e) {
    if (signal.aborted) throw e; // the user cancelled
    const name = (e as Error).name;
    if (name === 'TimeoutError' || name === 'AbortError') {
      return { status: 'failed', message: 'No answer from the server in two minutes. Try one photo at a time, or add by hand', code: 'client_timeout', seconds: seconds() };
    }
    return { status: 'failed', message: 'Couldn’t reach the server. Check the connection and try again', code: `network_${name || 'error'}`, seconds: seconds() };
  }
  const data = (await res.json().catch(() => null)) as RecognizeResponse | null;
  if (!data) return { status: 'failed', ...httpFailure(res.status), seconds: seconds() };
  if (data.status === 'failed') return { ...data, code: data.code || `http_${res.status}`, seconds: seconds() };

  const items = data.meal.foods.map(f => keepUserNutrients(toReviewItem(f), f.checked_index !== null && f.checked_index !== undefined ? input.previous?.[f.checked_index] : undefined));
  const notes: string[] = [];
  if (items.some(i => i.low)) notes.push('Some nutrients are AI estimates (marked). Check them before saving.');
  if (data.meal.foods.some(f => f.amount_source === 'visual_estimate')) notes.push('Amounts marked ~ are judged from the photo.');
  if (data.meal.search_failed) notes.push('The online lookup didn’t answer in time, so some nutrients are AI estimates (marked). Re-run to try again.');
  if (data.meal.unmatched_package_image_ids.length) notes.push('A label photo couldn’t be tied to a food, so it wasn’t used.');
  if (data.meal.foods.some(f => f.energy_fix === 'kj')) notes.push('A label listed energy in kJ; it was converted to kcal.');
  if (data.meal.foods.some(f => f.energy_fix === 'macros')) notes.push('A label’s calories didn’t match its protein, fat and carbs, so they were recalculated from those. Check the label values.');
  const attempt: Attempt = { at, correction: input.correction ?? null, images, text: body.text, library: body.library, trace: data.trace ?? null, proposed: items };
  return { status: 'ok', items, notes, attempt };
};
