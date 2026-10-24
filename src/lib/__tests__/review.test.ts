import { describe, expect, it } from 'vitest';
import { shift } from '../dates';
import { dayGoals, goalsOn } from '../nutrition';
import { weekReview } from '../review';
import { weekStats } from '../stats';
import { defaultSettings, emptyData } from '../types';
import type { Data, Day } from '../types';

const TODAY = '2026-10-21'; // a Wednesday; the review covers 14–20 Oct
const day = (kcal: number, extra: Partial<Day> = {}): Day => ({
  meals: kcal ? [{ id: 'm', type: 'Lunch', items: [{ id: 'i', name: 'x', amount: 100, kcal, p: 100, f: 0, c: 0 }] }] : [],
  updatedAt: 1,
  ...extra
});
const withDays = (days: Record<string, Day>, settings: Partial<Data['settings']> = {}): Data => ({ ...emptyData(), days, settings: { ...defaultSettings(), goal: 2000, ...settings } });
/** fmt separates thousands with a thin space: compare with a plain one */
const plain = (s: string) => s.replace(/\u2009/g, ' ');
const block = (r: ReturnType<typeof weekReview>, key: string) => {
  const b = r.blocks.find(x => x.key === key)!;
  return { ...b, headline: plain(b.headline), known: b.known.map(plain), unknown: b.unknown.map(plain) };
};

describe('goals on strength days', () => {
  const settings = { goal: 2000, strengthGoal: 2400 };
  it('uses the strength-day goal only on a marked day, and only where a goal for it is in force', () => {
    const data = withDays({ '2026-10-20': day(2000, { strength: true }), '2026-10-19': day(2000) }, settings);
    expect(dayGoals(data, '2026-10-20').goal).toBe(2400);
    expect(dayGoals(data, '2026-10-19').goal).toBe(2000);
    expect(goalsOn(data.settings, '2026-10-20', true).goal).toBe(2400);
    // no strength goal set: the mark changes nothing
    expect(dayGoals({ ...data, settings: { ...data.settings, strengthGoal: 0 } }, '2026-10-20').goal).toBe(2000);
  });

  it('judges a week by each day’s own goal', () => {
    const data = withDays({ '2026-10-19': day(2400, { strength: true }), '2026-10-20': day(2000) }, settings);
    expect(weekStats(data, '2026-10-19', TODAY)).toMatchObject({ kcalGreen: 2, budget: 4400 });
  });
});

describe('review of the last 7 days', () => {
  it('says what is not known when nothing is logged', () => {
    const r = weekReview(emptyData(), TODAY);
    expect(r.logged).toBe(0);
    expect(block(r, 'food')).toMatchObject({ headline: 'Nothing logged', known: [] });
    expect(block(r, 'weight').headline).toBe('No weigh-in yet');
    expect(block(r, 'weight').unknown.length).toBeGreaterThan(0);
    expect(r.blocks.map(b => b.key)).toEqual(['food', 'weight']);
  });

  it('counts the finished days only, and names the days without a log', () => {
    const days: Record<string, Day> = { [TODAY]: day(5000) };
    for (let i = 1; i <= 4; i++) days[shift(TODAY, -i)] = day(2000);
    const r = weekReview(withDays(days), TODAY);
    expect(r.logged).toBe(4);
    const food = block(r, 'food');
    expect(food.headline).toBe('2 000 kcal a day · 4 of 7 days logged');
    expect(food.unknown[0]).toMatch(/3 days without a log/);
    expect(food.known.join(' ')).toMatch(/4 on goal/);
  });

  it('reads a single weigh-in as a position, not a direction, and a pair against the food with its error', () => {
    const days: Record<string, Day> = {};
    for (let i = 1; i <= 14; i++) days[shift(TODAY, -i)] = day(2000);
    days[shift(TODAY, -1)] = day(2000, { weight: 70 });
    const one = block(weekReview(withDays(days), TODAY), 'weight');
    expect(one.headline).toBe('70.0 kg on 20 Oct');
    expect(one.unknown.join(' ')).toMatch(/Whether the weight is going up, down or nowhere/);

    days[shift(TODAY, -8)] = day(2000, { weight: 70.7 });
    const two = block(weekReview(withDays(days), TODAY), 'weight');
    expect(two.known[0]).toBe('−0.7 kg since 13 Oct (7 days).');
    expect(two.known[1]).toMatch(/maintenance near 2 750 kcal/);
    expect(two.unknown.join(' ')).toMatch(/± 650 kcal a day/);
  });

  it('shows the strength-day block only when the feature is in use', () => {
    const days: Record<string, Day> = { '2026-10-20': day(2400, { strength: true }), '2026-10-19': day(2000) };
    expect(weekReview(withDays(days), TODAY).blocks.map(b => b.key)).toContain('training');
    expect(weekReview(withDays({ '2026-10-19': day(2000) }), TODAY).blocks.map(b => b.key)).not.toContain('training');
    const r = weekReview(withDays(days, { strengthGoal: 2400 }), TODAY);
    expect(block(r, 'training').known[0]).toMatch(/On strength days you averaged 2 400 kcal, on the other days 2 000/);
  });
});
