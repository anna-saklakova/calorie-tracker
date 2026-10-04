import { authorize, config, fail, json, openai, tooBig } from './_lib/server.js';

// POST /api/transcribe — a recorded voice note (audio body) → text for the meal note (spec §2.2).

const TYPES: Record<string, string> = { 'audio/webm': 'webm', 'audio/ogg': 'ogg', 'audio/mp4': 'm4a', 'audio/mpeg': 'mp3', 'audio/wav': 'wav', 'audio/x-m4a': 'm4a' };

export async function POST(req: Request): Promise<Response> {
  if (tooBig(req)) return fail(413, 'The voice note is too long. Keep it under a few minutes');
  const denied = await authorize(req, 'transcribe');
  if (denied) return denied;

  const type = (req.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
  const ext = TYPES[type];
  if (!ext) return fail(415, 'This recording format isn’t supported');
  const audio = await req.arrayBuffer();
  if (audio.byteLength < 800) return fail(400, 'The recording is empty. Hold the mic a bit longer');

  const form = new FormData();
  form.append('model', config.transcribeModel());
  form.append('file', new Blob([audio], { type }), `note.${ext}`);
  form.append('prompt', 'A short food diary note: what was eaten and how much (grams, spoons, pieces), possibly brand names.');
  try {
    const out = (await openai('audio/transcriptions', { form, signal: AbortSignal.timeout(55_000) })) as { text?: string };
    return json({ status: 'ok', text: (out.text ?? '').trim() });
  } catch {
    return fail(502, 'Couldn’t transcribe that. Try again or type the note');
  }
}
