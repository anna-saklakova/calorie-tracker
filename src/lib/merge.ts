import type { Data, Settings } from './types';
import type { DayRow, ProductRow } from './remote';

/** updatedAt of each record as the cloud last had it; a record newer than this in memory is unsaved. */
export interface Base {
  days: Map<string, number>;
  products: Map<string, number>;
  settings: number;
}

export const emptyBase = (): Base => ({ days: new Map(), products: new Map(), settings: -1 });

/** Records in memory that are newer than the cloud's copy. */
export function unsavedRecords(d: Data, base: Base) {
  return {
    days: Object.entries(d.days).filter(([date, day]) => (base.days.get(date) ?? -1) < day.updatedAt),
    products: d.library.filter(p => (base.products.get(p.id) ?? -1) < p.updatedAt),
    settings: base.settings < d.settings.updatedAt ? d.settings : null
  };
}

/**
 * Takes rows from the cloud into memory, record by record: the newer updatedAt wins, so an edit made
 * here and not saved yet stays if it is newer. Updates `base` in place and returns the new data
 * (the same object when nothing changed) and the newest changed_at seen.
 */
export function takeRemote(d: Data, base: Base, days: DayRow[], products: ProductRow[], settings: Settings | null): { data: Data; latest: string | null } {
  let latest: string | null = null;
  const seen = (at: string) => {
    if (!latest || at > latest) latest = at;
  };
  let changed = false;

  const nextDays = { ...d.days };
  for (const r of days) {
    seen(r.changed_at);
    base.days.set(r.date, Math.max(base.days.get(r.date) ?? -1, r.updated_at));
    if (!nextDays[r.date] || r.updated_at > nextDays[r.date].updatedAt) {
      nextDays[r.date] = { ...r.data, updatedAt: r.updated_at };
      changed = true;
    }
  }

  const library = [...d.library];
  for (const r of products) {
    seen(r.changed_at);
    base.products.set(r.id, Math.max(base.products.get(r.id) ?? -1, r.updated_at));
    const i = library.findIndex(p => p.id === r.id);
    if (i >= 0 && r.updated_at <= library[i].updatedAt) continue;
    const p = { ...r.data, updatedAt: r.updated_at };
    if (i < 0) library.push(p);
    else library[i] = p;
    changed = true;
  }

  let nextSettings = d.settings;
  if (settings) {
    base.settings = Math.max(base.settings, settings.updatedAt);
    if (settings.updatedAt > d.settings.updatedAt) {
      nextSettings = settings;
      changed = true;
    }
  }

  return { data: changed ? { days: nextDays, library, settings: nextSettings } : d, latest };
}
