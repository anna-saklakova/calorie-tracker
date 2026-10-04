import { useEffect, useState } from 'react';
import type { User } from '@supabase/supabase-js';
import { supabase } from './supabase';
import { clearData, getData, onEdit, setData } from './store';
import { fetchDays, fetchProducts, fetchSettings, saveRecords } from './remote';
import type { DayRow, LegacyDoc, ProductRow } from './remote';
import { emptyBase, takeRemote, unsavedRecords } from './merge';
import type { Base } from './merge';
import { defaultSettings, emptyData } from './types';
import type { Data, Settings } from './types';

/**
 * The user's data lives only in Supabase: one row per day and per library product, plus a settings row.
 * After sign-in everything is loaded into memory. Each edit is saved shortly after, sending only the
 * records that changed; the database keeps the newer version of each record, so two open devices don't
 * overwrite each other. After saving, and when the app comes back to the foreground, only rows changed
 * since the last pull are fetched.
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
  /** what went wrong when loading failed, shown on the error screen */
  loadError: string;
}

let state: SyncState = { user: null, authLoading: !!supabase, recovery: false, data: 'idle', save: 'saved', lastSaved: null, loadError: '' };
const listeners = new Set<(s: SyncState) => void>();
const set = (patch: Partial<SyncState>) => {
  state = { ...state, ...patch };
  listeners.forEach(l => l(state));
};

export const endRecovery = () => set({ recovery: false });

/** bumps on every sign-in/out so results of an older request are dropped */
let generation = 0;
let dirty = false;
let saving = false;
let timer: ReturnType<typeof setTimeout> | undefined;

let base: Base = emptyBase();
/** server time of the newest change seen; the next pull asks only for changes after it */
let cursor: string | null = null;
/** re-read a little before the cursor, in case a change committed slightly out of order */
const OVERLAP_MS = 5000;

const resetBase = () => {
  base = emptyBase();
  cursor = null;
};

const hasUnsaved = (d: Data) => {
  const u = unsavedRecords(d, base);
  return u.days.length > 0 || u.products.length > 0 || !!u.settings;
};

function applyRemote(days: DayRow[], products: ProductRow[], settings: Settings | null) {
  const before = getData();
  const { data, latest } = takeRemote(before, base, days, products, settings);
  if (latest && (!cursor || latest > cursor)) cursor = latest;
  if (data !== before) setData(data);
}

/**
 * Data saved by an older app version as one document: write its records into the tables
 * (the database keeps whichever copy of each is newer) and reduce the document to settings.
 */
async function migrateLegacy(legacy: LegacyDoc, settings: Settings) {
  await saveRecords(Object.entries(legacy.days), legacy.library, settings);
  cursor = null; // re-read everything once
}

/** Fetches what changed in the cloud since the last pull and takes it in. */
async function pull(userId: string, gen: number) {
  const s = await fetchSettings(userId);
  if (gen !== generation) return;
  if (s.legacy) await migrateLegacy(s.legacy, s.settings ?? defaultSettings());
  const since = cursor ? new Date(Date.parse(cursor) - OVERLAP_MS).toISOString() : null;
  const [days, products] = await Promise.all([fetchDays(userId, since), fetchProducts(userId, since)]);
  if (gen !== generation) return;
  applyRemote(days, products, s.settings);
}

async function load() {
  const user = state.user;
  if (!user) return;
  const gen = ++generation;
  clearTimeout(timer);
  dirty = false;
  resetBase();
  set({ data: 'loading', save: 'saved', loadError: '' });
  try {
    const remote = await fetchSettings(user.id);
    if (gen !== generation) return;
    const settings = remote.settings ?? defaultSettings();
    // older app versions kept everything in one document; a brand-new account has no settings row yet
    if (remote.legacy) await migrateLegacy(remote.legacy, settings);
    else if (!remote.settings) await saveRecords([], [], settings);
    const [days, products] = await Promise.all([fetchDays(user.id, null), fetchProducts(user.id, null)]);
    if (gen !== generation) return;
    setData({ ...emptyData(), settings });
    base.settings = settings.updatedAt;
    applyRemote(days, products, null);
    set({ data: 'ready', lastSaved: Date.now() });
  } catch (e) {
    if (gen !== generation) return;
    console.error('load failed', e);
    set({ data: 'error', loadError: (e as { message?: string })?.message ?? String(e) });
  }
}

/** Retry after a failed load. */
export const reload = () => load();

/** Saves records changed here, then takes in what changed elsewhere. */
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
    const u = unsavedRecords(getData(), base);
    await saveRecords(u.days, u.products, u.settings);
    if (gen !== generation) return;
    // the cloud now has these versions (or newer ones, which the pull brings in)
    for (const [date, day] of u.days) base.days.set(date, Math.max(base.days.get(date) ?? -1, day.updatedAt));
    for (const p of u.products) base.products.set(p.id, Math.max(base.products.get(p.id) ?? -1, p.updatedAt));
    if (u.settings) base.settings = Math.max(base.settings, u.settings.updatedAt);
    await pull(user.id, gen);
    if (gen !== generation) return;
    dirty = dirty || hasUnsaved(getData());
    set({ save: dirty ? 'pending' : 'saved', lastSaved: Date.now() });
    if (dirty) schedule();
  } catch (e) {
    if (gen !== generation) return;
    console.error('save failed', e);
    dirty = dirty || hadEdits || hasUnsaved(getData());
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
  return !dirty && !hasUnsaved(getData());
}

/** Everything, up to date with the cloud. Throws if the cloud can't be reached. */
export async function fetchLatest(): Promise<Data> {
  if (!state.user) throw new Error('Not signed in');
  if (!(await flush())) throw new Error('Not saved');
  return getData();
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
