import { perGram, scaleItem } from './nutrition';
import { uid } from './types';
import type { Photo, Product, ReviewItem } from './types';

export interface RecognizeInput {
  photos: Pick<Photo, 'kind' | 'file'>[];
  text: string;
  library: Product[];
  /** a correction added on the Review screen ("the meat was 200 g, not 110") */
  correction?: string;
  /** the current review items when re-running with a correction */
  previous?: ReviewItem[];
}

export type RecognizeResult =
  | { status: 'ok'; items: ReviewItem[]; lowConfidence: boolean }
  | { status: 'failed'; message: string };

/**
 * The recognizer the app calls. Swap `mockRecognizer` for a real implementation
 * (e.g. a server route that sends the photos and note to a vision model) without touching the UI.
 */
export type Recognizer = (input: RecognizeInput, signal: AbortSignal) => Promise<RecognizeResult>;

export const ANALYZE_STEPS = [
  'Reading the nutrition label…',
  'Estimating the portion from the plate…',
  'Matching with your library…',
  'Filling the rest from common values…'
];
export const ANALYZE_CONTEXT = 'Uses your photos, your note and your saved products. Anything it can’t read is estimated and marked.';
export const FAILED_MESSAGE =
  'The plate photo is too dark to tell the dish or the portion. A brighter shot from above, or a word or two about what it is, usually fixes this.';

const wait = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal.addEventListener('abort', () => {
      clearTimeout(t);
      reject(new DOMException('Aborted', 'AbortError'));
    });
  });

const item = (name: string, amount: number, kcal: number, p: number, f: number, c: number, rest: Partial<ReviewItem>): ReviewItem => {
  const base = { id: uid(), name, amount, kcal, p, f, c };
  return { ...base, src: 'estimated', hint: 'estimated', save: false, per: perGram(base), ...rest };
};

/** Demo result: pasta with jar sauce, minced beef and broccoli. */
export function sampleItems(input: Pick<RecognizeInput, 'photos' | 'library'>, low: boolean): ReviewItem[] {
  const hasLabel = input.photos.some(p => p.kind === 'label');
  const pasta = input.library.find(p => /spaghetti|pasta/i.test(p.name));
  return [
    item('Spaghetti, cooked', 330, 539, 19.5, 2.3, 108,
      pasta ? { src: 'library', hint: `from your library · ${pasta.name}` } : {}),
    item('Tomato & basil sauce', 120, 72, 1.8, 3.4, 8.4,
      hasLabel ? { src: 'label', hint: 'from label photo', save: true } : {}),
    item('Minced beef, pan-fried', 110, 248, 28.6, 14.3, 0,
      low ? { low: true, lowNote: 'Portion hard to judge · no hand or cutlery in frame for scale' } : {}),
    item('Broccoli, steamed', 90, 32, 2.5, 0.4, 6.3, {})
  ];
}

/**
 * Applies a correction like "the meat was 200 g": the first number becomes the amount
 * of the item the note names, or else of the first estimated item.
 */
export function applyCorrection(items: ReviewItem[], note: string): ReviewItem[] {
  const n = parseInt((note.match(/\d+/) || [])[0] ?? '', 10);
  if (!n) return items;
  const words = note.toLowerCase().match(/[a-zа-яё]{3,}/gi) ?? [];
  const named = items.find(it => words.some(w => it.name.toLowerCase().includes(w.toLowerCase())));
  const meat = /meat|beef|chicken|pork|мяс/i.test(note) ? items.find(it => /beef|chicken|pork|meat|salmon/i.test(it.name)) : undefined;
  const target = named ?? meat ?? items.find(it => it.src === 'estimated');
  if (!target) return items;
  return items.map(it =>
    it.id === target.id ? { ...scaleItem(it, n), src: 'note', hint: 'from your note', low: false } : it
  );
}

export const mockRecognizer: Recognizer = async (input, signal) => {
  if (input.correction !== undefined && input.previous) {
    await wait(2600, signal);
    return { status: 'ok', items: applyCorrection(input.previous.map(i => ({ ...i, low: false })), input.correction), lowConfidence: false };
  }
  await wait(3400, signal);
  const r = Math.random();
  if (r >= 0.6 && Math.random() >= 0.65) return { status: 'failed', message: FAILED_MESSAGE };
  const low = r >= 0.6;
  return { status: 'ok', items: sampleItems(input, low), lowConfidence: low };
};

export const recognize: Recognizer = mockRecognizer;
