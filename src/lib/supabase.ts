import { createClient, type SupabaseClient } from '@supabase/supabase-js';

// VITE_* when set by hand; NEXT_PUBLIC_* when added by the Vercel ↔ Supabase integration.
const env = import.meta.env as Record<string, string | undefined>;
const url = env.VITE_SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL;
const key = env.VITE_SUPABASE_ANON_KEY || env.NEXT_PUBLIC_SUPABASE_ANON_KEY || env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

/**
 * An error Supabase put in the URL when it sent the user back here,
 * e.g. an expired confirmation or reset link. Read before the client consumes the URL.
 */
export const urlAuthError: string | null = (() => {
  if (typeof window === 'undefined') return null;
  const params = new URLSearchParams(window.location.hash.slice(1) || window.location.search);
  const code = params.get('error_code');
  if (!params.get('error') && !code) return null;
  if (code === 'otp_expired') return 'This link has expired or was already used. Request a new one.';
  return params.get('error_description')?.replace(/\+/g, ' ') || 'Couldn’t sign in with that link. Try again.';
})();

/** null when the app is built without Supabase settings: the app then shows a setup error and nothing else. */
export const supabase: SupabaseClient | null =
  url && key ? createClient(url, key, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } }) : null;

export const authAvailable = !!supabase;
const redirectTo = () => window.location.origin + window.location.pathname;

function client() {
  if (!supabase) throw new Error('Sign-in is not configured');
  return supabase;
}

export async function signInWithGoogle() {
  const { error } = await client().auth.signInWithOAuth({ provider: 'google', options: { redirectTo: redirectTo() } });
  if (error) throw error;
}

export async function signInWithPassword(email: string, password: string) {
  const { error } = await client().auth.signInWithPassword({ email, password });
  if (error) throw error;
}

/**
 * Creates an account and sends the confirmation email.
 * Returns 'confirm' when the email has to be confirmed first, 'signed-in' when confirmation is off,
 * and 'exists' when the email already has an account (Supabase answers with a user that has no identities).
 */
export async function signUp(email: string, password: string): Promise<'confirm' | 'signed-in' | 'exists'> {
  const { data, error } = await client().auth.signUp({ email, password, options: { emailRedirectTo: redirectTo() } });
  if (error) throw error;
  if (data.session) return 'signed-in';
  if (data.user && data.user.identities?.length === 0) return 'exists';
  return 'confirm';
}

export async function resendConfirmation(email: string) {
  const { error } = await client().auth.resend({ type: 'signup', email, options: { emailRedirectTo: redirectTo() } });
  if (error) throw error;
}

export async function sendPasswordReset(email: string) {
  const { error } = await client().auth.resetPasswordForEmail(email, { redirectTo: redirectTo() });
  if (error) throw error;
}

/** Sets a new password for the signed-in user (after a reset link, or to add one to a Google account). */
export async function setNewPassword(password: string) {
  const { error } = await client().auth.updateUser({ password });
  if (error) throw error;
}

export async function signOut() {
  await supabase?.auth.signOut();
}

/** Turns a Supabase auth error into a short message for the user. */
export function authErrorText(e: unknown): string {
  const err = e as { code?: string; message?: string; status?: number } | undefined;
  const code = err?.code ?? '';
  const msg = err?.message ?? '';
  if (code === 'invalid_credentials' || /invalid login credentials/i.test(msg)) return 'Wrong email or password';
  if (code === 'email_not_confirmed' || /not confirmed/i.test(msg)) return 'Confirm your email first. Check your inbox';
  if (code === 'weak_password' || /password should/i.test(msg)) return 'Password is too weak. Use at least 8 characters';
  if (code === 'same_password') return 'That’s already your password';
  if (code === 'user_already_exists') return 'This email already has an account';
  if (code === 'email_address_invalid' || /invalid.*email/i.test(msg)) return 'Check the email address';
  if (code.startsWith('over_') || err?.status === 429 || /rate|too many/i.test(msg)) return 'Too many tries. Wait a minute and try again';
  if (code === 'session_not_found' || code === 'session_expired') return 'Your session expired. Sign in again';
  return 'Something went wrong. Check your connection and try again';
}
