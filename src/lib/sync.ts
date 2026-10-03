import { useEffect, useState } from 'react';
import type { User } from '@supabase/supabase-js';
import { supabase } from './supabase';
import { getData, replaceData, subscribe } from './store';
import { mergeData, sameData } from './merge';
import { defaultSettings } from './types';
import type { Data } from './types';

export type SyncStatus = 'off' | 'syncing' | 'synced' | 'error';

export interface SyncState {
  user: User | null;
  /** true until the stored session has been checked */
  loading: boolean;
  status: SyncStatus;
  lastSynced: number | null;
}

let state: SyncState = { user: null, loading: !!supabase, status: 'off', lastSynced: null };
const listeners = new Set<(s: SyncState) => void>();
const set = (patch: Partial<SyncState>) => {
  state = { ...state, ...patch };
  listeners.forEach(l => l(state));
};

/** Pulls the cloud copy, merges it with this device and writes the result to both. */
async function syncNow() {
  const user = state.user;
  if (!supabase || !user) return;
  set({ status: 'syncing' });
  try {
    const { data: row, error } = await supabase.from('user_data').select('data').eq('user_id', user.id).maybeSingle();
    if (error) throw error;
    const local = getData();
    const remote = row?.data as Data | undefined;
    const merged = remote
      ? mergeData(local, { days: remote.days ?? {}, library: remote.library ?? [], settings: { ...defaultSettings(), ...remote.settings } })
      : local;
    if (!sameData(merged, local)) replaceData(merged);
    if (!remote || !sameData(merged, remote)) {
      const { error: upErr } = await supabase
        .from('user_data')
        .upsert({ user_id: user.id, data: merged, updated_at: new Date().toISOString() });
      if (upErr) throw upErr;
    }
    set({ status: 'synced', lastSynced: Date.now() });
  } catch (e) {
    console.error('sync failed', e);
    set({ status: 'error' });
    schedule(30000);
  }
}

let timer: ReturnType<typeof setTimeout> | undefined;
let applying = false;
const schedule = (ms = 1500) => {
  clearTimeout(timer);
  timer = setTimeout(async () => {
    applying = true;
    try {
      await syncNow();
    } finally {
      applying = false;
    }
  }, ms);
};

let started = false;
export function startSync() {
  if (started || !supabase) return;
  started = true;
  supabase.auth.getSession().then(({ data }) => {
    set({ user: data.session?.user ?? null, loading: false, status: data.session ? 'syncing' : 'off' });
    if (data.session) schedule(0);
  });
  supabase.auth.onAuthStateChange((event, session) => {
    const user = session?.user ?? null;
    const changed = user?.id !== state.user?.id;
    set({ user, loading: false, status: user ? state.status : 'off' });
    if (user && (changed || event === 'SIGNED_IN')) schedule(0);
  });
  // push local edits shortly after they happen
  subscribe(() => {
    if (state.user && !applying) schedule();
  });
  // pick up edits made on other devices
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && state.user) schedule(0);
  });
  window.addEventListener('online', () => state.user && schedule(0));
}

export function useSync(): SyncState {
  const [s, setS] = useState(state);
  useEffect(() => {
    listeners.add(setS);
    setS(state);
    return () => {
      listeners.delete(setS);
    };
  }, []);
  return s;
}

export function syncLabel(s: SyncState, now = Date.now()) {
  if (s.status === 'syncing') return 'Syncing…';
  if (s.status === 'error') return 'Sync paused · will retry';
  if (!s.lastSynced) return 'Synced';
  const min = Math.floor((now - s.lastSynced) / 60000);
  return min < 1 ? 'Synced · just now' : min < 60 ? `Synced · ${min} min ago` : 'Synced · ' + new Date(s.lastSynced).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}
