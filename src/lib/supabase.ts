import { createClient, type SupabaseClient } from '@supabase/supabase-js';

// VITE_* when set by hand; NEXT_PUBLIC_* when added by the Vercel ↔ Supabase integration.
const env = import.meta.env as Record<string, string | undefined>;
const url = env.VITE_SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL;
const key = env.VITE_SUPABASE_ANON_KEY || env.NEXT_PUBLIC_SUPABASE_ANON_KEY || env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

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
