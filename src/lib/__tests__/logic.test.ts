import { describe, expect, it } from 'vitest';
import { balanceTag, macroPct, macroTargets, scaleItem, fmt, sumMacros } from '../nutrition';
import { dayLabel, shift, weekStartOf, weekLabel } from '../dates';
import { mergeData } from '../merge';
import { authErrorText } from '../supabase';
import { productPortion } from '../../components/Sheet';
import { defaultSettings } from '../types';
import type { Data, Product } from '../types';

describe('nutrition', () => {
  it('formats with a thin space', () => {
    expect(fmt(1293)).toBe('1 293');
    expect(fmt(980.6)).toBe('981');
  });

  it('computes calorie share per macro', () => {
    // 100 g protein = 400, 50 g fat = 450, 150 g carbs = 600 → 1450 kcal
    expect(macroPct({ p: 100, f: 50, c: 150 })).toMatchObject({ p: 28, f: 31, c: 41, kcal: 1450 });
    expect(macroPct({ p: 0, f: 0, c: 0 })).toMatchObject({ p: 0, f: 0, c: 0 });
  });

  it('tags balance by deviation from target', () => {
    expect(balanceTag(31, 30, true)).toBe('on');
    expect(balanceTag(36, 30, true)).toBe('ok');
    expect(balanceTag(45, 30, true)).toBe('off');
    expect(balanceTag(0, 30, false)).toBe('none');
  });

  it('derives targets in % and grams mode', () => {
    const pct = macroTargets({ macroMode: 'pct', macroGoal: { p: 30, f: 30, c: 40 }, goal: 2000 });
    expect(pct.has).toBe(true);
    expect(pct.g).toEqual({ p: 150, f: 67, c: 200 });
    expect(macroTargets({ macroMode: 'pct', macroGoal: { p: 30, f: 30, c: 30 }, goal: 2000 }).has).toBe(false);
    const g = macroTargets({ macroMode: 'g', macroGoal: { p: 150, f: 70, c: 200 }, goal: 0 });
    expect(g.gramsKcal).toBe(2030);
    expect(g.pct).toEqual({ p: 30, f: 31, c: 39 });
  });

  it('rescales an item by amount', () => {
    const it = scaleItem({ amount: 100, kcal: 200, p: 10, f: 5, c: 30 }, 150);
    expect(it).toMatchObject({ amount: 150, kcal: 300, p: 15, f: 7.5, c: 45 });
    expect(sumMacros([it, it]).kcal).toBe(600);
  });

  it('converts product amounts for 100 g and portion bases', () => {
    const base = { id: 'x', name: 'x', updatedAt: 0, kcal: 200, p: 10, f: 5, c: 30 };
    expect(productPortion({ ...base, basis: '100', portion: 100 } as Product, 50)).toMatchObject({ grams: 50, kcal: 100, portions: undefined });
    expect(productPortion({ ...base, basis: 'portion', portion: 120 } as Product, 2)).toMatchObject({ grams: 240, kcal: 400, portions: 2 });
  });
});

describe('dates', () => {
  it('labels days and weeks', () => {
    expect(dayLabel('2026-10-01', '2026-10-01')).toBe('Today');
    expect(dayLabel('2026-09-30', '2026-10-01')).toBe('Yesterday');
    expect(dayLabel('2026-09-28', '2026-10-01')).toBe('Mon, 28 Sep');
    expect(weekStartOf('2026-10-04')).toBe('2026-09-28'); // Sunday → Monday before
    expect(weekStartOf('2026-09-28')).toBe('2026-09-28');
    expect(weekLabel('2026-09-28')).toBe('28 Sep – 4 Oct');
    expect(shift('2026-12-31', 1)).toBe('2027-01-01');
  });
});

describe('sync merge', () => {
  const p = (id: string, updatedAt: number, extra: Partial<Product> = {}): Product => ({ id, name: id, basis: '100', portion: 100, kcal: 1, p: 0, f: 0, c: 0, updatedAt, ...extra });
  const d = (days: Data['days'], library: Product[], at = 0): Data => ({ days, library, settings: { ...defaultSettings(), updatedAt: at } });

  it('keeps the newer day and product, and tombstones win when newer', () => {
    const local = d({ '2026-10-01': { meals: [], updatedAt: 5 }, '2026-09-30': { meals: [], updatedAt: 9 } }, [p('a', 1), p('b', 5)], 3);
    const remote = d({ '2026-10-01': { meals: [{ id: 'm', type: 'Lunch', items: [] }], updatedAt: 7 }, '2026-09-29': { meals: [], updatedAt: 1 } }, [p('a', 2, { deleted: true }), p('c', 1)], 1);
    const m = mergeData(local, remote);
    expect(Object.keys(m.days).sort()).toEqual(['2026-09-29', '2026-09-30', '2026-10-01']);
    expect(m.days['2026-10-01'].meals).toHaveLength(1);
    expect(m.library.map(x => [x.id, !!x.deleted])).toEqual([['a', true], ['b', false], ['c', false]]);
    expect(m.settings.updatedAt).toBe(3);
  });
});

describe('auth errors', () => {
  it('explains common sign-in problems', () => {
    expect(authErrorText({ code: 'invalid_credentials', message: 'Invalid login credentials' })).toBe('Wrong email or password');
    expect(authErrorText({ code: 'email_not_confirmed' })).toMatch(/Confirm your email/);
    expect(authErrorText({ code: 'weak_password' })).toMatch(/at least 8/);
    expect(authErrorText({ code: 'over_email_send_rate_limit' })).toMatch(/Too many tries/);
    expect(authErrorText(new Error('Failed to fetch'))).toMatch(/connection/);
  });
});
