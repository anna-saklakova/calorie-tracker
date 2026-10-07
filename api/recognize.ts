import { buildMeal } from '../src/lib/ai/meal.js';
import { mealSchema, SYSTEM_PROMPT, userContent } from '../src/lib/ai/prompt.js';
import type { IntermediateMeal, RecognizeRequest } from '../src/lib/ai/types.js';
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
  if (!images.length && !text.trim() && !voice.trim()) return fail(400, 'Add a photo or a note first', 'empty');

  const content: unknown[] = [{ type: 'input_text', text: userContent(text, voice, library, images) }];
  for (const img of images) {
    content.push({ type: 'input_text', text: `Image ${img.id}:` });
    // always high: people rarely tag label photos, and the small print on packaging needs it
    content.push({ type: 'input_image', image_url: img.dataUrl, detail: 'high' });
  }

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
        model: config.model(),
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
  const final = buildMeal(meal, library);
  console.log(`recognize ok in ${secs} s: ${final.foods.length} foods, ${images.length} photos, ${Math.round(imageBytes / 1024)} KB, tokens ${out.usage?.input_tokens ?? '?'}/${out.usage?.output_tokens ?? '?'}`);
  if (!final.foods.length) {
    return json({
      status: 'failed',
      message: meal.failure_reason?.trim() || 'Couldn’t find any food here. A clearer photo or a few words about the meal usually helps',
      code: 'no_food'
    });
  }
  return json({ status: 'ok', meal: final, seconds: secs });
}
