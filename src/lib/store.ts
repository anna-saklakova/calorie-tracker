import { useSyncExternalStore } from 'react';
import { emptyData, MEAL_ORDER, uid } from './types';
import { todayIso } from './dates';
import type { Data, Day, Goals, Item, MealType, Product, Settings } from './types';

// Nothing is kept on the device: the data lives in Supabase (see sync.ts) and only in memory here.
let data: Data = emptyData();
const listeners = new Set<() => void>();
const editListeners = new Set<() => void>();

export const getData = () => data;

/** Replace everything with what came from the cloud. Not an edit, so it doesn't trigger a save. */
export function setData(next: Data) {
  data = next;
  listeners.forEach(l => l());
}

/** Forget the signed-out user's data. */
export const clearData = () => setData(emptyData());

function update(fn: (d: Data) => Data) {
  data = fn(data);
  listeners.forEach(l => l());
  editListeners.forEach(l => l());
}

export function subscribe(l: () => void) {
  listeners.add(l);
  return () => listeners.delete(l);
}

/** Called after every user edit, so the cloud copy gets saved. */
export function onEdit(l: () => void) {
  editListeners.add(l);
  return () => editListeners.delete(l);
}

export const useData = () => useSyncExternalStore(subscribe, getData, getData);

/** Earlier versions kept a copy of the data on the device. Remove it so it can't come back. */
export function clearLegacyStorage() {
  try {
    localStorage.removeItem('ct.data.v1');
    localStorage.removeItem('ct.prefs.v1');
  } catch {
    /* storage unavailable: nothing to clear */
  }
}

// ── Mutations ───────────────────────────────────────────────

function touchDay(d: Data, date: string, fn: (day: Day) => Day): Data {
  const day = d.days[date] ?? { meals: [], updatedAt: 0 };
  return { ...d, days: { ...d.days, [date]: { ...fn(day), updatedAt: Date.now() } } };
}

/**
 * Adds items to the day's meal of that type. Breakfast, lunch and dinner are one meal each; snacks are
 * separate meals: the items go to the snack `mealId` names, or start a new snack when it's not given.
 */
function addTo(day: Day, type: MealType, items: Item[], mealId?: string): Day {
  const existing = type !== 'Snack' ? day.meals.find(m => m.type === type) : mealId ? day.meals.find(m => m.id === mealId && m.type === 'Snack') : undefined;
  const meals = existing
    ? day.meals.map(m => (m === existing ? { ...m, items: [...m.items, ...items] } : m))
    : [...day.meals, { id: uid(), type, items }];
  meals.sort((a, b) => MEAL_ORDER.indexOf(a.type) - MEAL_ORDER.indexOf(b.type));
  return { ...day, meals };
}

export function addItems(date: string, type: MealType, items: Item[], mealId?: string) {
  update(d => touchDay(d, date, day => addTo(day, type, items, mealId)));
}

/** Whether saving an item into `type` / `mealId` keeps it in the meal it's in now. */
export function staysInMeal(day: Day | undefined, fromMealId: string, type: MealType, mealId?: string) {
  const from = day?.meals.find(m => m.id === fromMealId);
  if (!from || from.type !== type) return false;
  // a snack that is alone in its meal moved to a new snack would just be the same snack again
  return type !== 'Snack' || mealId === fromMealId || (!mealId && from.items.length === 1);
}

/** Saves an edited item, moving it to another meal (or snack) when that was changed too. */
export function saveItem(date: string, fromMealId: string, item: Item, type: MealType, mealId?: string) {
  if (staysInMeal(data.days[date], fromMealId, type, mealId)) return updateItem(date, fromMealId, item);
  update(d =>
    touchDay(d, date, day => {
      const rest = day.meals.map(m => (m.id !== fromMealId ? m : { ...m, items: m.items.filter(i => i.id !== item.id) })).filter(m => m.items.length);
      return addTo({ ...day, meals: rest }, type, [item], mealId);
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

const pickGoals = (s: Goals): Goals => ({ goal: s.goal, macroMode: s.macroMode, macroGoal: { ...s.macroGoal } });

/**
 * Applies a settings change. A change to the goals is recorded as starting today,
 * so past days keep being judged against the goals they had.
 */
export function updateSettings(patch: Partial<Settings>, today = todayIso()) {
  update(d => {
    const next: Settings = { ...d.settings, ...patch, updatedAt: Date.now() };
    if ('goal' in patch || 'macroMode' in patch || 'macroGoal' in patch) {
      // first change ever: the goals so far covered every earlier day
      const history = d.settings.goalHistory?.length ? d.settings.goalHistory : [{ from: '0000-01-01', ...pickGoals(d.settings) }];
      next.goalHistory = [...history.filter(h => h.from < today), { from: today, ...pickGoals(next) }];
    }
    return { ...d, settings: next };
  });
}

export const liveLibrary = (d: Data) => d.library.filter(p => !p.deleted);

/** Downloads the given data (fetched fresh from the cloud) as a JSON file. */
export function exportJson(d: Data) {
  const blob = new Blob([JSON.stringify({ ...d, library: liveLibrary(d), exportedAt: new Date().toISOString() }, null, 2)], {
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
