import { buildMeal } from '../src/lib/ai/meal.js';
import { mealSchema, SYSTEM_PROMPT, userContent } from '../src/lib/ai/prompt.js';
import type { IntermediateMeal, RecognizeRequest } from '../src/lib/ai/types.js';
import { authorize, config, fail, json, openai, tooBig } from './_lib/server.js';

// POST /api/recognize — photos + note + transcript of one meal → foods, grams, nutrients, total.
// Flow (spec §3): the model reads the meal into intermediate JSON; nutrition sources are picked
// and the arithmetic is done in code (src/lib/ai/meal.ts).

const MAX_IMAGES = 6;
const MAX_LIBRARY = 400;

export async function POST(req: Request): Promise<Response> {
  if (tooBig(req)) return fail(413, 'The photos are too large. Try fewer photos');
  const denied = await authorize(req, 'recognize');
  if (denied) return denied;

  let body: RecognizeRequest;
  try {
    body = await req.json();
  } catch {
    return fail(400, 'Bad request');
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
  if (!images.length && !text.trim() && !voice.trim()) return fail(400, 'Add a photo or a note first');

  const content: unknown[] = [{ type: 'input_text', text: userContent(text, voice, library, images) }];
  for (const img of images) {
    content.push({ type: 'input_text', text: `Image ${img.id}:` });
    // always high: people rarely tag label photos, and the small print on packaging needs it
    content.push({ type: 'input_image', image_url: img.dataUrl, detail: 'high' });
  }

  let out: { status?: string; output?: { type: string; content?: { type: string; text?: string; refusal?: string }[] }[] };
  try {
    out = await openai('responses', {
      json: {
        model: config.model(),
        instructions: SYSTEM_PROMPT,
        input: [{ role: 'user', content }],
        reasoning: { effort: 'medium' },
        text: { format: { type: 'json_schema', name: 'meal', strict: true, schema: mealSchema(library.map(p => p.id), images.map(i => i.id)) } },
        store: false
      },
      signal: AbortSignal.timeout(55_000)
    });
  } catch (e) {
    const status = (e as { status?: number }).status;
    if (status === 429) return fail(503, 'Recognition is busy right now. Try again in a minute');
    return fail(502, 'Recognition didn’t answer. Try again, or add by hand');
  }

  const parts = (out.output ?? []).flatMap(o => (o.type === 'message' ? o.content ?? [] : []));
  if (parts.some(p => p.type === 'refusal')) return json({ status: 'failed', message: 'This doesn’t look like a meal we can read. Try another photo or a note' });
  const raw = parts.find(p => p.type === 'output_text')?.text;
  if (out.status !== 'completed' || !raw) return fail(502, 'Recognition didn’t finish. Try again');

  let meal: IntermediateMeal;
  try {
    meal = JSON.parse(raw);
  } catch {
    return fail(502, 'Recognition gave an unreadable answer. Try again');
  }
  const final = buildMeal(meal, library);
  if (!final.foods.length) {
    return json({ status: 'failed', message: meal.failure_reason?.trim() || 'Couldn’t find any food here. A clearer photo or a few words about the meal usually helps' });
  }
  return json({ status: 'ok', meal: final });
}
