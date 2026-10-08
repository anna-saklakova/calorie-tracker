import { createHash } from 'node:crypto';
import { buildMeal, coveredWithoutSearch } from '../src/lib/ai/meal.js';
import { mealSchema, SYSTEM_PROMPT, userContent } from '../src/lib/ai/prompt.js';
import { SEARCH_PROMPT, searchedUrls, searchInput, searchSchema, webFinds } from '../src/lib/ai/search.js';
import type { SearchAnswer } from '../src/lib/ai/search.js';
import type { CheckedItem, IntermediateMeal, LibraryEntry, RecognizeRequest, RecognizeTrace, WebFind } from '../src/lib/ai/types.js';
import { authorize, config, fail, json, openai, tooBig } from './_lib/server.js';
import type { OpenAIError } from './_lib/server.js';

// POST /api/recognize — photos + note + transcript of one meal → foods, grams, nutrients, total.
// Flow (spec §3): the model reads the meal into intermediate JSON; nutrition sources are picked
// and the arithmetic is done in code (src/lib/ai/meal.ts).
//
// Every failure carries a short `code` (shown in small print on the Failed screen and logged here),
// so "it didn't work" can be traced: openai_timeout, openai_400_invalid_json_schema, no_food, …

const MAX_IMAGES = 6;
/** Structured Outputs allows at most 250 values in one enum; the library list is also sent as text */
const MAX_LIBRARY = 250;
/** The model gets this long; vercel.json gives the function a little more (maxDuration). */
const MODEL_TIMEOUT_MS = 110_000;
/** The web lookup gets at most this long, and only what is left before the function's own limit. */
const SEARCH_TIMEOUT_MS = 45_000;
const FUNCTION_BUDGET_MS = 114_000;
/** Below this there's no point starting a lookup: the model's estimate stays. */
const SEARCH_MIN_MS = 12_000;

/**
 * Looks up on the web the nutrients of the foods that have no label and no library match. Never throws:
 * a lookup that fails or runs out of time leaves those foods on the model's estimate.
 */
async function searchNutrition(meal: IntermediateMeal, library: LibraryEntry[], started: number) {
  const byId = new Map(library.map(p => [p.id, p]));
  const foods = meal.foods ?? [];
  const todo = foods.map((f, i) => (f?.search_query?.trim() && !coveredWithoutSearch(f, byId) ? i : -1)).filter(i => i >= 0);
  const none = { finds: new Map<number, WebFind>(), failed: false, output: null as unknown };
  if (!todo.length || !config.webSearch()) return none;
  const budget = Math.min(SEARCH_TIMEOUT_MS, FUNCTION_BUDGET_MS - (Date.now() - started));
  if (budget < SEARCH_MIN_MS) {
    console.error(`recognize: no time left for the web lookup (${todo.length} foods)`);
    return { ...none, failed: true };
  }
  const t0 = Date.now();
  try {
    const out = (await openai('responses', {
      json: {
        model: config.searchModel(),
        instructions: SEARCH_PROMPT,
        input: [{ role: 'user', content: [{ type: 'input_text', text: searchInput(foods, todo) }] }],
        tools: [{ type: 'web_search' }],
        include: ['web_search_call.action.sources'],
        reasoning: { effort: config.reasoning() },
        text: { format: { type: 'json_schema', name: 'nutrition', strict: true, schema: searchSchema } },
        store: false
      },
      signal: AbortSignal.timeout(budget)
    })) as { status?: string; output?: { type: string; content?: { type: string; text?: string }[] }[] };
    const raw = (out.output ?? []).flatMap(o => (o.type === 'message' ? o.content ?? [] : [])).find(p => p.type === 'output_text')?.text;
    const answer = raw ? (JSON.parse(raw) as SearchAnswer) : null;
    const finds = webFinds(answer, searchedUrls(out.output), foods.length);
    console.log(`recognize: web lookup in ${Math.round((Date.now() - t0) / 1000)} s, ${finds.size} of ${todo.length} foods found`);
    return { finds, failed: !answer, output: answer };
  } catch (e) {
    console.error(`recognize: web lookup failed after ${Math.round((Date.now() - t0) / 1000)} s: ${(e as OpenAIError).reason ?? (e as Error).message}`);
    return { ...none, failed: true };
  }
}

export async function POST(req: Request): Promise<Response> {
  if (tooBig(req)) return fail(413, 'The photos are too large. Try fewer photos', 'request_too_large');
  const denied = await authorize(req, 'recognize');
  if (denied) return denied;

  let body: RecognizeRequest;
  try {
    body = await req.json();
  } catch {
    return fail(400, 'Bad request', 'bad_request');
  }
  const images = (Array.isArray(body.images) ? body.images : [])
    .filter(i => typeof i?.dataUrl === 'string' && /^data:image\/(jpeg|png|webp);base64,/.test(i.dataUrl))
    .slice(0, MAX_IMAGES)
    .map((i, n) => ({ id: `img_${n + 1}`, kind: i.kind === 'label' ? ('label' as const) : ('plate' as const), dataUrl: i.dataUrl }));
  const text = typeof body.text === 'string' ? body.text.slice(0, 2000) : '';
  const voice = typeof body.voiceTranscript === 'string' ? body.voiceTranscript.slice(0, 4000) : '';
  const library = (Array.isArray(body.library) ? body.library : [])
    .filter(p => typeof p?.id === 'string' && typeof p?.name === 'string' && p.per100)
    .slice(0, MAX_LIBRARY);
  const num = (n: unknown) => (typeof n === 'number' && Number.isFinite(n) && n >= 0 ? n : null);
  const checked: CheckedItem[] = (Array.isArray(body.checked) ? body.checked : []).slice(0, 40).map(c => ({
    name: typeof c?.name === 'string' ? c.name.slice(0, 120) : '',
    amount_g: num(c?.amount_g),
    kcal: num(c?.kcal),
    protein_g: num(c?.protein_g),
    fat_g: num(c?.fat_g),
    carbs_g: num(c?.carbs_g)
  }));
  if (!images.length && !text.trim() && !voice.trim() && !checked.length) return fail(400, 'Add a photo or a note first', 'empty');

  const inputText = userContent(text, voice, library, images, checked);
  const content: unknown[] = [{ type: 'input_text', text: inputText }];
  for (const img of images) {
    content.push({ type: 'input_text', text: `Image ${img.id}:` });
    // always high: people rarely tag label photos, and the small print on packaging needs it
    content.push({ type: 'input_image', image_url: img.dataUrl, detail: 'high' });
  }

  const model = config.model();
  const started = Date.now();
  const imageBytes = images.reduce((s, i) => s + i.dataUrl.length, 0);
  let out: {
    status?: string;
    incomplete_details?: { reason?: string };
    output?: { type: string; content?: { type: string; text?: string; refusal?: string }[] }[];
    usage?: { input_tokens?: number; output_tokens?: number };
  };
  try {
    out = await openai('responses', {
      json: {
        model,
        instructions: SYSTEM_PROMPT,
        input: [{ role: 'user', content }],
        reasoning: { effort: config.reasoning() },
        text: { format: { type: 'json_schema', name: 'meal', strict: true, schema: mealSchema(images.map(i => i.id)) } },
        store: false
      },
      signal: AbortSignal.timeout(MODEL_TIMEOUT_MS)
    });
  } catch (e) {
    const err = e as OpenAIError;
    const secs = Math.round((Date.now() - started) / 1000);
    console.error(`recognize failed after ${secs} s: ${err.reason}; ${images.length} photos, ${Math.round(imageBytes / 1024)} KB`);
    if (err.reason === 'timeout') {
      return fail(504, `Reading took longer than ${Math.round(MODEL_TIMEOUT_MS / 1000)} s and was stopped. Try one photo at a time, or add by hand`, 'openai_timeout');
    }
    if (err.reason === 'unreachable') return fail(502, 'Couldn’t reach the recognition service. Try again', 'openai_unreachable');
    if (err.status === 429) {
      return err.code === 'insufficient_quota'
        ? fail(503, 'The recognition budget is used up. Add by hand for now', 'openai_insufficient_quota')
        : fail(503, 'Recognition is busy right now. Try again in a minute', `openai_${err.reason}`);
    }
    if (err.status === 401 || err.status === 403) return fail(503, 'Recognition isn’t set up correctly (API key)', `openai_${err.reason}`);
    if (err.status === 400 || err.status === 413) return fail(502, 'The recognition service rejected the request. Try fewer or smaller photos', `openai_${err.reason}`);
    return fail(502, 'Recognition didn’t answer. Try again, or add by hand', `openai_${err.reason || 'error'}`);
  }

  const secs = Math.round((Date.now() - started) / 1000);
  const parts = (out.output ?? []).flatMap(o => (o.type === 'message' ? o.content ?? [] : []));
  if (parts.some(p => p.type === 'refusal')) {
    return json({ status: 'failed', message: 'This doesn’t look like a meal we can read. Try another photo or a note', code: 'model_refusal' });
  }
  const raw = parts.find(p => p.type === 'output_text')?.text;
  if (out.status !== 'completed' || !raw) {
    const reason = out.incomplete_details?.reason ?? out.status ?? 'no_output';
    console.error(`recognize: model answer ${reason} after ${secs} s`);
    return fail(502, 'Recognition didn’t finish. Try again', `openai_${reason}`);
  }

  let meal: IntermediateMeal;
  try {
    meal = JSON.parse(raw);
  } catch {
    return fail(502, 'Recognition gave an unreadable answer. Try again', 'openai_bad_json');
  }
  // the first answer is label → library → the model's estimate; a re-run (the user didn't like it) adds the web
  const search = body.web === true ? await searchNutrition(meal, library, started) : { finds: new Map<number, WebFind>(), failed: false, output: null };
  const final = { ...buildMeal(meal, library, checked.length, search.finds), search_failed: search.failed || undefined };
  const total = Math.round((Date.now() - started) / 1000);
  console.log(`recognize ok in ${total} s (reading ${secs} s): ${final.foods.length} foods, ${images.length} photos, ${Math.round(imageBytes / 1024)} KB, tokens ${out.usage?.input_tokens ?? '?'}/${out.usage?.output_tokens ?? '?'}`);
  if (!final.foods.length) {
    return json({
      status: 'failed',
      message: meal.failure_reason?.trim() || 'Couldn’t find any food here. A clearer photo or a few words about the meal usually helps',
      code: 'no_food'
    });
  }
  // what went in and what the model answered, for the training examples the app keeps after the meal is saved
  const trace: RecognizeTrace = {
    model,
    prompt_sha256: createHash('sha256').update(SYSTEM_PROMPT).digest('hex'),
    commit: process.env.VERCEL_GIT_COMMIT_SHA ?? null,
    input_text: inputText,
    model_output: meal,
    search_output: search.output
  };
  return json({ status: 'ok', meal: final, trace, seconds: total });
}
