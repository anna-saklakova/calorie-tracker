import type { Data, Product } from './types';

/**
 * Merge two copies of the user's data (this device vs. cloud).
 * Days and products are merged per record by `updatedAt` (newer wins);
 * deleted products are kept as tombstones so a delete isn't undone by the other side.
 */
export function mergeData(a: Data, b: Data): Data {
  const days = { ...a.days };
  for (const [date, day] of Object.entries(b.days)) {
    const mine = days[date];
    if (!mine || day.updatedAt > mine.updatedAt) days[date] = day;
  }

  const byId = new Map<string, Product>();
  for (const p of [...a.library, ...b.library]) {
    const cur = byId.get(p.id);
    if (!cur || p.updatedAt > cur.updatedAt) byId.set(p.id, p);
  }
  // keep a's order, then append b-only products
  const order = [...a.library.map(p => p.id), ...b.library.map(p => p.id)];
  const library = [...new Set(order)].map(id => byId.get(id)!);

  const settings = b.settings.updatedAt > a.settings.updatedAt ? b.settings : a.settings;
  return { days, library, settings };
}

export const sameData = (a: Data, b: Data) => JSON.stringify(a) === JSON.stringify(b);
