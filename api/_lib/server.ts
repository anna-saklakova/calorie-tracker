// Server-only helpers for the /api functions (Vercel). Files under api/_lib are not routes.
// The OpenAI key is read here from the server environment and never sent to the browser.

export type QuotaKind = 'recognize' | 'transcribe';

const env = (...names: string[]) => names.map(n => process.env[n]).find(v => v && v.trim())?.trim();

export const config = {
  openaiKey: () => env('OPENAI_API_KEY'),
  model: () => env('OPENAI_MODEL') ?? 'gpt-5.4-mini',
  transcribeModel: () => env('OPENAI_TRANSCRIBE_MODEL') ?? 'gpt-transcribe',
  supabaseUrl: () => env('SUPABASE_URL', 'VITE_SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_URL'),
  supabaseAnonKey: () => env('SUPABASE_ANON_KEY', 'VITE_SUPABASE_ANON_KEY', 'NEXT_PUBLIC_SUPABASE_ANON_KEY', 'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY')
};

export const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });

export const fail = (status: number, message: string) => json({ status: 'failed', message }, status);

/**
 * Lets the request through only for a signed-in user with quota left.
 * The user's Supabase session token is sent to a database function that checks it,
 * counts this call and returns how many are left today. Fails closed on any problem.
 */
export async function authorize(req: Request, kind: QuotaKind): Promise<Response | null> {
  const token = req.headers.get('authorization')?.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!token) return fail(401, 'Sign in to use recognition');
  const url = config.supabaseUrl();
  const anon = config.supabaseAnonKey();
  if (!url || !anon || !config.openaiKey()) {
    console.error('recognition is not configured: missing', [!url && 'SUPABASE_URL', !anon && 'SUPABASE_ANON_KEY', !config.openaiKey() && 'OPENAI_API_KEY'].filter(Boolean).join(', '));
    return fail(503, 'Recognition isn’t set up yet');
  }
  let res: Response;
  try {
    res = await fetch(`${url}/rest/v1/rpc/consume_ai_quota`, {
      method: 'POST',
      headers: { apikey: anon, authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ p_kind: kind })
    });
  } catch {
    return fail(502, 'Couldn’t reach your account. Try again');
  }
  if (res.status === 401 || res.status === 403) return fail(401, 'Your session expired. Sign in again');
  if (res.status === 404) {
    console.error('consume_ai_quota is missing: run supabase/migrations/20261005000000_ai_quota.sql');
    return fail(503, 'Recognition isn’t set up yet');
  }
  if (!res.ok) {
    console.error('quota check failed', res.status);
    return fail(502, 'Couldn’t check your account. Try again');
  }
  // left today for this email; -1 = this email's daily limit, -2 = the app-wide daily limit
  const left = Number(await res.json());
  if (left === -2) {
    console.error(`app-wide daily ${kind} limit reached`);
    return fail(429, kind === 'recognize' ? 'Recognition is paused for today. Add by hand, or try again tomorrow' : 'Voice notes are paused for today. Type the note instead');
  }
  if (!(left >= 0)) {
    return fail(429, kind === 'recognize' ? 'You’ve reached today’s limit for recognition. Add by hand, or try again tomorrow' : 'You’ve reached today’s limit for voice notes. Type the note instead');
  }
  return null;
}

/** Calls OpenAI with the server key. Returns the parsed JSON or throws with the HTTP status. */
export async function openai(path: string, init: { json?: unknown; form?: FormData; signal?: AbortSignal }) {
  const res = await fetch(`https://api.openai.com/v1/${path}`, {
    method: 'POST',
    headers: { authorization: `Bearer ${config.openaiKey()}`, ...(init.json ? { 'content-type': 'application/json' } : {}) },
    body: init.json ? JSON.stringify(init.json) : init.form,
    signal: init.signal
  });
  if (!res.ok) {
    // log only the status and error type, never the request (photos, notes)
    const err = (await res.json().catch(() => null)) as { error?: { type?: string; code?: string } } | null;
    console.error(`openai ${path} failed`, res.status, err?.error?.type, err?.error?.code);
    throw Object.assign(new Error(`OpenAI ${res.status}`), { status: res.status });
  }
  return res.json();
}

export const MAX_BODY_BYTES = 4_200_000; // Vercel rejects request bodies over 4.5 MB

export function tooBig(req: Request) {
  const len = Number(req.headers.get('content-length') ?? 0);
  return len > MAX_BODY_BYTES;
}
