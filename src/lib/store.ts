import { useSyncExternalStore } from 'react';
import { emptyData, defaultSettings, MEAL_ORDER, uid } from './types';
import type { Data, Day, Item, MealType, Product, Settings } from './types';

const KEY = 'ct.data.v1';
const PREFS_KEY = 'ct.prefs.v1';

function load(): Data {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return emptyData();
    const d = JSON.parse(raw) as Partial<Data>;
    return { days: d.days ?? {}, library: d.library ?? [], settings: { ...defaultSettings(), ...d.settings } };
  } catch {
    return emptyData();
  }
}

let data: Data = typeof localStorage !== 'undefined' ? load() : emptyData();
const listeners = new Set<() => void>();

export const getData = () => data;

/** Replace everything (used by sync). Does not bump timestamps. */
export function replaceData(next: Data) {
  data = next;
  persist();
}

function persist() {
  try {
    localStorage.setItem(KEY, JSON.stringify(data));
  } catch {
    /* storage full or unavailable: keep in memory */
  }
  listeners.forEach(l => l());
}

function update(fn: (d: Data) => Data) {
  data = fn(data);
  persist();
}

export function subscribe(l: () => void) {
  listeners.add(l);
  return () => listeners.delete(l);
}

export const useData = () => useSyncExternalStore(subscribe, getData, getData);

// ── Mutations ───────────────────────────────────────────────

function touchDay(d: Data, date: string, fn: (day: Day) => Day): Data {
  const day = d.days[date] ?? { meals: [], updatedAt: 0 };
  return { ...d, days: { ...d.days, [date]: { ...fn(day), updatedAt: Date.now() } } };
}

/** Adds items to the day's meal of that type; snacks always start a new meal. */
export function addItems(date: string, type: MealType, items: Item[]) {
  update(d =>
    touchDay(d, date, day => {
      const existing = type !== 'Snack' ? day.meals.find(m => m.type === type) : undefined;
      const meals = existing
        ? day.meals.map(m => (m === existing ? { ...m, items: [...m.items, ...items] } : m))
        : [...day.meals, { id: uid(), type, items }];
      meals.sort((a, b) => MEAL_ORDER.indexOf(a.type) - MEAL_ORDER.indexOf(b.type));
      return { ...day, meals };
    })
  );
}

export function updateItem(date: string, mealId: string, item: Item) {
  update(d =>
    touchDay(d, date, day => ({
      ...day,
      meals: day.meals.map(m => (m.id !== mealId ? m : { ...m, items: m.items.map(i => (i.id === item.id ? item : i)) }))
    }))
  );
}

export function deleteItem(date: string, mealId: string, itemId: string) {
  update(d =>
    touchDay(d, date, day => ({
      ...day,
      meals: day.meals
        .map(m => (m.id !== mealId ? m : { ...m, items: m.items.filter(i => i.id !== itemId) }))
        .filter(m => m.items.length)
    }))
  );
}

/** Puts a day back as it was (undo). */
export function restoreDay(date: string, day: Day) {
  update(d => touchDay(d, date, () => day));
}

export function upsertProduct(p: Product) {
  update(d => {
    const next = { ...p, updatedAt: Date.now() };
    const exists = d.library.some(x => x.id === p.id);
    return { ...d, library: exists ? d.library.map(x => (x.id === p.id ? next : x)) : [...d.library, next] };
  });
}

export function deleteProduct(id: string) {
  update(d => ({ ...d, library: d.library.map(x => (x.id === id ? { ...x, deleted: true, updatedAt: Date.now() } : x)) }));
}

export function updateSettings(patch: Partial<Settings>) {
  update(d => ({ ...d, settings: { ...d.settings, ...patch, updatedAt: Date.now() } }));
}

export const liveLibrary = (d: Data) => d.library.filter(p => !p.deleted);

// ── Device-only preferences (not synced) ────────────────────

interface Prefs {
  /** the sign-in screen was answered once (signed in or skipped) */
  onboarded: boolean;
}

export function getPrefs(): Prefs {
  try {
    return { onboarded: false, ...JSON.parse(localStorage.getItem(PREFS_KEY) || '{}') };
  } catch {
    return { onboarded: false };
  }
}

export function setPrefs(p: Partial<Prefs>) {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify({ ...getPrefs(), ...p }));
  } catch {
    /* ignore */
  }
}

export function exportJson() {
  const blob = new Blob([JSON.stringify({ ...data, library: liveLibrary(data), exportedAt: new Date().toISOString() }, null, 2)], {
    type: 'application/json'
  });
  const name = `calories-${new Date().toISOString().slice(0, 10)}.json`;
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  return name;
}
