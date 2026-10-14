import { describe, expect, it } from 'vitest';
import { bodyInsights, checkInDue, checkIns, intake } from '../body';
import { parse, shift } from '../dates';
import { emptyData } from '../types';
import type { Data, Day } from '../types';

const WS = '2026-09-07'; // a Monday

interface Food { kcal: number; p?: number; c?: number }
const day = ({ kcal, p = 0, c = 0 }: Food, weight?: number, waist?: number): Day => ({
  meals: kcal ? [{ id: 'm', type: 'Lunch', items: [{ id: 'i', name: 'x', amount: 100, kcal, p, f: 0, c }] }] : [],
  ...(weight ? { weight } : {}),
  ...(waist ? { waist } : {}),
  updatedAt: 1
});

/** a weigh-in every 7 days from WS, and food every day in between */
function weeks(kgs: number[], food: (i: number) => Food = () => ({ kcal: 2000, p: 140, c: 200 }), waists: number[] = []): Data {
  const days: Record<string, Day> = {};
  const span = (kgs.length - 1) * 7;
  for (let i = 0; i <= span; i++) days[shift(WS, i)] = day(food(i), i % 7 === 0 ? kgs[i / 7] : undefined, i % 7 === 0 ? waists[i / 7] : undefined);
  return { ...emptyData(), days };
}
const last = (n: number) => shift(WS, (n - 1) * 7);
const keys = (data: Data, today: string) => bodyInsights(data, today, 10).map(i => i.key);

describe('check-ins', () => {
  it('lists days with a weight or a waist, newest first, and says when the next is due', () => {
    const data = { ...emptyData(), days: { '2026-10-01': day({ kcal: 0 }, 70), '2026-10-05': day({ kcal: 0 }, undefined, 80), '2026-10-06': day({ kcal: 1800 }) } };
    expect(checkIns(data).map(c => c.date)).toEqual(['2026-10-05', '2026-10-01']);
    expect(checkInDue(data, '2026-10-11')).toEqual({ due: false, since: 6 });
    expect(checkInDue(data, '2026-10-12')).toEqual({ due: true, since: 7 });
    expect(checkInDue(emptyData(), '2026-10-12')).toEqual({ due: true, since: null });
  });

  it('averages the food between two weigh-ins and splits weekends from weekdays', () => {
    const data = weeks([80, 79.5], i => ({ kcal: [5, 6].includes(i) ? 3000 : 2000 }));
    const t = intake(data, WS, shift(WS, 7));
    expect(t).toMatchObject({ days: 7, logged: 7, weekend: 3000, weekday: 2000 });
    expect(parse(shift(WS, 5)).getDay()).toBe(6);
  });
});

describe('body insights', () => {
  it('says the first check-in is in and what comes next', () => {
    expect(keys(weeks([80]), WS)).toEqual(['start']);
  });

  it('confirms a change that the food explains, and a steady pace', () => {
    // 0.5 kg a week on 2000 kcal: maintenance ≈ 2550, and the last week lost what it should
    const k = keys(weeks([80, 79.5, 79, 78.5, 78]), last(5));
    expect(k).toContain('balance');
    expect(k).toContain('pace');
  });

  it('reads a jump after a carb load as water', () => {
    const data = weeks([80, 79.5, 79, 78.5, 78, 78.9], i => ({ kcal: 2000, p: 140, c: i >= 33 ? 400 : 200 }));
    const ins = bodyInsights(data, last(6), 10);
    const water = ins.find(i => i.key === 'water');
    expect(water?.text).toMatch(/Carbs ran \d+ % above/);
  });

  it('does not read a change over a day or two, only week to week', () => {
    // two check-ins a day apart: nothing to read yet
    const two = weeks([80]);
    two.days[shift(WS, 1)] = day({ kcal: 2000, p: 140 }, 79);
    const ins = bodyInsights(two, shift(WS, 1), 10);
    expect(ins.find(i => i.key === 'too_soon')?.title).toMatch(/1 day: too soon to read/);
    expect(ins.map(i => i.key)).not.toContain('vs_goal');
    // a day after a weekly series: read against the check-in 8 days before, not the one of yesterday
    const data = weeks([80, 79.5, 79, 78.5, 78]);
    const next = shift(last(5), 1);
    data.days[next] = day({ kcal: 2000, p: 140 }, 77);
    const b = bodyInsights(data, next, 10).find(i => ['balance', 'water', 'whoosh'].includes(i.key));
    expect(b?.title).toMatch(/over 8 days/);
  });

  it('compares the latest check-in with the one at least 6 days earlier, skipping closer ones', () => {
    const data = weeks([80, 79.5, 79, 78.5, 78]);
    data.days[shift(last(5), -2)] = { ...data.days[shift(last(5), -2)], weight: 76.5 };
    const b = bodyInsights(data, last(5), 10).find(i => i.key === 'balance' || i.key === 'water' || i.key === 'whoosh');
    expect(b?.title).toMatch(/over 7 days/);
  });

  it('judges protein against the target set in Settings', () => {
    const data = weeks([80, 79.5, 79], () => ({ kcal: 2000, p: 140 }));
    const ok = bodyInsights({ ...data, settings: { ...data.settings, proteinMet: 130, proteinClose: 110 } }, last(3), 10).find(i => i.key === 'protein')!;
    expect(ok).toMatchObject({ tone: 'good', title: 'Protein 140 g a day, target 130 g' });
    const low = bodyInsights({ ...data, settings: { ...data.settings, proteinMet: 170, proteinClose: 150 } }, last(3), 10).find(i => i.key === 'protein')!;
    expect(low).toMatchObject({ tone: 'warn', title: 'Protein 140 g a day, target 170 g' });
  });

  it('warns about fast loss and low protein', () => {
    const k = keys(weeks([80, 78.8, 77.6, 76.4], () => ({ kcal: 1500, p: 80 })), last(4));
    expect(k).toContain('fast');
    expect(k).toContain('protein');
    const p = bodyInsights(weeks([80, 78.8, 77.6, 76.4], () => ({ kcal: 1500, p: 80 })), last(4), 10).find(i => i.key === 'protein')!;
    expect(p.tone).toBe('warn');
  });

  it('sees a shrinking waist at a steady weight as fat lost, muscle kept', () => {
    expect(keys(weeks([70, 70.1, 69.9, 70], undefined, [80, 79.5, 79, 78.5]), last(4))).toContain('recomp');
  });

  it('points out weekends well above weekdays', () => {
    const data = weeks([80, 80, 80, 80, 80], i => ({ kcal: [5, 6].includes(i % 7) ? 3200 : 2000, p: 140 }));
    const w = bodyInsights(data, last(5), 10).find(i => i.key === 'weekend');
    expect(w?.title).toMatch(/^Weekends \+1.200 kcal a day$/);
  });

  it('says when too few days are logged to judge the food', () => {
    expect(keys(weeks([80, 79.5], i => ({ kcal: i < 2 ? 2000 : 0 })), last(2))).toContain('gaps');
  });
});
