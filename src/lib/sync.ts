import { useEffect, useState } from 'react';
import type { User } from '@supabase/supabase-js';
import { supabase } from './supabase';
import { clearData, getData, onEdit, setData } from './store';
import { mergeData, sameData } from './merge';
import { defaultSettings, emptyData } from './types';
import type { Data } from './types';

/**
 * The user's data lives only in Supabase (one `user_data` row per account).
 * After sign-in it is loaded into memory; every edit is saved back shortly after.
 * Before each save the cloud copy is read and merged record by record (newer updatedAt wins),
 * so two open devices don't overwrite each other.
 */

/** idle: signed out · loading: fetching the cloud copy · ready: loaded · error: couldn't load */
export type DataStatus = 'idle' | 'loading' | 'ready' | 'error';
/** saved: cloud is up to date · pending/saving: an edit is on its way · offline/error: not saved yet, retrying */
export type SaveStatus = 'saved' | 'pending' | 'saving' | 'offline' | 'error';

export interface SyncState {
  user: User | null;
  /** true until the stored session has been checked */
  authLoading: boolean;
  /** true after the user came back from a password reset link and has to set a new password */
  recovery: boolean;
  data: DataStatus;
  save: SaveStatus;
  lastSaved: number | null;
}

let state: SyncState = { user: null, authLoading: !!supabase, recovery: false, data: 'idle', save: 'saved', lastSaved: null };
const listeners = new Set<(s: SyncState) => void>();
const set = (patch: Partial<SyncState>) => {
  state = { ...state, ...patch };
  listeners.forEach(l => l(state));
};

export const endRecovery = () => set({ recovery: false });

const normalize = (d: Partial<Data> | null | undefined): Data | null =>
  d ? { days: d.days ?? {}, library: d.library ?? [], settings: { ...defaultSettings(), ...d.settings } } : null;

async function fetchRemote(userId: string): Promise<Data | null> {
  const { data: row, error } = await supabase!.from('user_data').select('data').eq('user_id', userId).maybeSingle();
  if (error) throw error;
  return normalize(row?.data as Partial<Data> | undefined);
}

async function writeRemote(userId: string, d: Data) {
  const { error } = await supabase!.from('user_data').upsert({ user_id: userId, data: d, updated_at: new Date().toISOString() });
  if (error) throw error;
}

/** bumps on every sign-in/out so results of an older request are dropped */
let generation = 0;
let dirty = false;
let saving = false;
let timer: ReturnType<typeof setTimeout> | undefined;

async function load() {
  const user = state.user;
  if (!user) return;
  const gen = ++generation;
  clearTimeout(timer);
  dirty = false;
  set({ data: 'loading', save: 'saved' });
  try {
    let remote = await fetchRemote(user.id);
    if (gen !== generation) return;
    if (!remote) {
      remote = emptyData();
      await writeRemote(user.id, remote);
      if (gen !== generation) return;
    }
    setData(remote);
    set({ data: 'ready', lastSaved: Date.now() });
  } catch (e) {
    if (gen !== generation) return;
    console.error('load failed', e);
    set({ data: 'error' });
  }
}

/** Retry after a failed load. */
export const reload = () => load();

/** Merges the cloud copy into memory and, if there are unsaved edits, writes the result back. */
async function syncNow(): Promise<void> {
  const user = state.user;
  if (!user || state.data !== 'ready') return;
  if (saving) return schedule(400);
  const gen = generation;
  const hadEdits = dirty;
  saving = true;
  dirty = false;
  if (hadEdits) set({ save: 'saving' });
  try {
    const remote = await fetchRemote(user.id);
    if (gen !== generation) return;
    // merge with what's in memory now, so edits made while we waited are kept
    const merged = remote ? mergeData(getData(), remote) : getData();
    if (!sameData(merged, getData())) setData(merged);
    if (!remote || !sameData(merged, remote)) await writeRemote(user.id, merged);
    if (gen !== generation) return;
    set({ save: dirty ? 'pending' : 'saved', lastSaved: Date.now() });
  } catch (e) {
    if (gen !== generation) return;
    console.error('save failed', e);
    dirty = dirty || hadEdits;
    set({ save: dirty ? (navigator.onLine ? 'error' : 'offline') : state.save });
    if (dirty) schedule(navigator.onLine ? 10000 : 5000);
  } finally {
    if (gen === generation) saving = false;
  }
}

function schedule(ms = 800) {
  clearTimeout(timer);
  timer = setTimeout(syncNow, ms);
}

/** Saves pending edits right away (before sign-out or export). Resolves false if they couldn't be saved. */
export async function flush(): Promise<boolean> {
  clearTimeout(timer);
  while (saving) await new Promise(r => setTimeout(r, 100));
  await syncNow();
  return !dirty;
}

/** The latest cloud copy, merged with anything not yet saved. Throws if the cloud can't be reached. */
export async function fetchLatest(): Promise<Data> {
  const user = state.user;
  if (!user) throw new Error('Not signed in');
  if (!(await flush())) throw new Error('Not saved');
  const remote = await fetchRemote(user.id);
  const merged = remote ? mergeData(getData(), remote) : getData();
  if (!sameData(merged, getData())) setData(merged);
  return merged;
}

function onUser(user: User | null) {
  const changed = user?.id !== state.user?.id;
  set({ user, authLoading: false });
  if (!changed) return;
  generation++;
  clearTimeout(timer);
  dirty = false;
  saving = false;
  clearData();
  if (user) load();
  else set({ data: 'idle', save: 'saved', lastSaved: null, recovery: false });
}

let started = false;
export function startSync() {
  if (started || !supabase) return;
  started = true;
  supabase.auth.getSession().then(({ data }) => {
    onUser(data.session?.user ?? null);
    // drop tokens or errors Supabase left in the address bar after a redirect
    if (/(access_token|error)=/.test(window.location.hash + window.location.search)) {
      history.replaceState(history.state, '', window.location.pathname);
    }
  });
  supabase.auth.onAuthStateChange((event, session) => {
    if (event === 'PASSWORD_RECOVERY') set({ recovery: true });
    // defer: calling Supabase from inside this callback can deadlock its auth lock
    setTimeout(() => onUser(session?.user ?? null), 0);
  });
  onEdit(() => {
    if (!state.user || state.data !== 'ready') return;
    dirty = true;
    if (state.save === 'saved') set({ save: 'pending' });
    schedule();
  });
  // pick up edits made on other devices
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') schedule(0);
    else if (dirty) syncNow();
  });
  window.addEventListener('online', () => schedule(0));
  window.addEventListener('beforeunload', e => {
    if (dirty || saving) e.preventDefault();
  });
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
  if (s.save === 'pending' || s.save === 'saving') return 'Saving…';
  if (s.save === 'offline') return 'Not saved · no connection, retrying';
  if (s.save === 'error') return 'Not saved · retrying';
  if (!s.lastSaved) return 'Saved to your account';
  const min = Math.floor((now - s.lastSaved) / 60000);
  return min < 1 ? 'Saved · just now' : min < 60 ? `Saved · ${min} min ago` : 'Saved · ' + new Date(s.lastSaved).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}
