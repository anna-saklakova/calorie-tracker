import { describe, expect, it } from 'vitest';
import { emptyBase, takeRemote, unsavedRecords } from '../merge';
import type { DayRow, ProductRow } from '../remote';
import { defaultSettings, emptyData } from '../types';
import type { Data, Day, Product } from '../types';

const day = (at: number, n = 0): Day => ({ meals: Array.from({ length: n }, (_, i) => ({ id: `m${i}`, type: 'Lunch' as const, items: [] })), updatedAt: at });
const prod = (id: string, at: number, extra: Partial<Product> = {}): Product => ({ id, name: id, basis: '100', portion: 100, kcal: 1, p: 0, f: 0, c: 0, updatedAt: at, ...extra });
const dayRow = (date: string, at: number, n = 0, changed = '2026-10-06T10:00:00Z'): DayRow => ({ date, data: day(at, n), updated_at: at, changed_at: changed });
const prodRow = (id: string, at: number, extra: Partial<Product> = {}, changed = '2026-10-06T10:00:00Z'): ProductRow => ({ id, data: prod(id, at, extra), updated_at: at, changed_at: changed });

describe('per-record sync', () => {
  it('loads rows into empty data and marks them saved', () => {
    const base = emptyBase();
    base.settings = 0; // load() records the settings it read
    const { data, latest } = takeRemote(emptyData(), base, [dayRow('2026-10-05', 5, 1), dayRow('2026-10-06', 7, 2, '2026-10-06T11:00:00Z')], [prodRow('a', 3)], null);
    expect(Object.keys(data.days).sort()).toEqual(['2026-10-05', '2026-10-06']);
    expect(data.library.map(p => p.id)).toEqual(['a']);
    expect(latest).toBe('2026-10-06T11:00:00Z');
    expect(unsavedRecords(data, base)).toMatchObject({ days: [], products: [], settings: null });
  });

  it('keeps a newer unsaved local edit and takes newer remote ones', () => {
    const base = emptyBase();
    const local: Data = { ...emptyData(), days: { '2026-10-05': day(9, 3), '2026-10-06': day(4, 1) }, library: [prod('a', 9), prod('b', 2)] };
    const { data } = takeRemote(local, base, [dayRow('2026-10-05', 6, 1), dayRow('2026-10-06', 8, 2)], [prodRow('a', 5), prodRow('b', 7, { deleted: true }), prodRow('c', 1)], null);
    expect(data.days['2026-10-05'].meals).toHaveLength(3); // local newer, kept
    expect(data.days['2026-10-06'].meals).toHaveLength(2); // remote newer, taken
    expect(data.library.map(p => [p.id, !!p.deleted])).toEqual([['a', false], ['b', true], ['c', false]]);
    const u = unsavedRecords(data, base);
    expect(u.days.map(([d]) => d)).toEqual(['2026-10-05']);
    expect(u.products.map(p => p.id)).toEqual(['a']);
  });

  it('returns the same object when nothing changed', () => {
    const local: Data = { ...emptyData(), days: { '2026-10-05': day(9) } };
    expect(takeRemote(local, emptyBase(), [dayRow('2026-10-05', 9)], [], null).data).toBe(local);
  });

  it('takes newer settings only', () => {
    const base = emptyBase();
    const local: Data = { ...emptyData(), settings: { ...defaultSettings(), goal: 1800, updatedAt: 10 } };
    expect(takeRemote(local, base, [], [], { ...defaultSettings(), goal: 2000, updatedAt: 5 }).data.settings.goal).toBe(1800);
    expect(unsavedRecords(local, base).settings?.goal).toBe(1800);
    expect(takeRemote(local, base, [], [], { ...defaultSettings(), goal: 2000, updatedAt: 20 }).data.settings.goal).toBe(2000);
  });

  it('only reports edits made after the last save', () => {
    const base = emptyBase();
    const { data } = takeRemote(emptyData(), base, [dayRow('2026-10-05', 5)], [], null);
    const edited: Data = { ...data, days: { ...data.days, '2026-10-05': day(6, 1), '2026-10-07': day(6, 1) } };
    expect(unsavedRecords(edited, base).days.map(([d]) => d)).toEqual(['2026-10-05', '2026-10-07']);
  });
});
