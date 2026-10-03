import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

/** null when the app is built without Supabase settings: it then runs local-only. */
export const supabase: SupabaseClient | null =
  url && key ? createClient(url, key, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } }) : null;

export const syncAvailable = !!supabase;
const redirectTo = () => window.location.origin + window.location.pathname;

export async function signInWithGoogle() {
  if (!supabase) throw new Error('Sync is not configured');
  const { error } = await supabase.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: redirectTo() } });
  if (error) throw error;
}

export async function sendEmailLink(email: string) {
  if (!supabase) throw new Error('Sync is not configured');
  const { error } = await supabase.auth.signInWithOtp({ email, options: { emailRedirectTo: redirectTo() } });
  if (error) throw error;
}

export async function signOut() {
  await supabase?.auth.signOut();
}
