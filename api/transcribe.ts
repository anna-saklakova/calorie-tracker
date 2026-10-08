import { authorize, config, fail, json, openai, tooBig } from './_lib/server.js';
import type { OpenAIError } from './_lib/server.js';

// POST /api/transcribe — a recorded voice note (audio body) → text for the meal note (spec §2.2).

const TYPES: Record<string, string> = { 'audio/webm': 'webm', 'audio/ogg': 'ogg', 'audio/mp4': 'm4a', 'audio/mpeg': 'mp3', 'audio/wav': 'wav', 'audio/x-m4a': 'm4a' };

export async function POST(req: Request): Promise<Response> {
  if (tooBig(req)) return fail(413, 'The voice note is too long. Keep it under a few minutes', 'request_too_large');
  const denied = await authorize(req, 'transcribe');
  if (denied) return denied;

  const type = (req.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
  const ext = TYPES[type];
  if (!ext) return fail(415, 'This recording format isn’t supported', 'unsupported_audio');
  const audio = await req.arrayBuffer();
  if (audio.byteLength < 800) return fail(400, 'The recording is empty. Hold the mic a bit longer', 'empty_audio');

  const form = new FormData();
  form.append('model', config.transcribeModel());
  form.append('file', new Blob([audio], { type }), `note.${ext}`);
  form.append('language', config.transcribeLanguage());
  // the prompt is in the speaker's language and lists the kind of English words that come up in it
  form.append('prompt', 'Заметка в дневник питания: что я съела и выпила и сколько (граммы, ложки, штуки, мл). Бывают английские слова и названия брендов: cookie, protein, skyr.');
  try {
    const out = (await openai('audio/transcriptions', { form, signal: AbortSignal.timeout(55_000) })) as { text?: string };
    return json({ status: 'ok', text: (out.text ?? '').trim() });
  } catch (e) {
    return fail(502, 'Couldn’t transcribe that. Try again or type the note', `openai_${(e as OpenAIError).reason || 'error'}`);
  }
}
