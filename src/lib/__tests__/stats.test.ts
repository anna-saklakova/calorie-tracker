import { beforeEach, describe, expect, it } from 'vitest';
import { shift } from '../dates';
import { kcalWeekTag, proteinWeekTag, weekStats } from '../stats';
import { getData, setData, setWaist, setWeighIn } from '../store';
import { emptyData } from '../types';
import type { Data, Day } from '../types';
import { daysSinceWeighIn, maintenance, waistTrend, weightTrend } from '../weight';

const day = (kcal: number, p = 0, weight?: number): Day => ({
  meals: kcal ? [{ id: 'm', type: 'Lunch', items: [{ id: 'i', name: 'x', amount: 100, kcal, p, f: 0, c: 0 }] }] : [],
  ...(weight ? { weight } : {}),
  updatedAt: 1
});

const WS = '2026-10-05'; // a Monday

function withDays(days: Record<string, Day>, settings: Partial<Data['settings']> = {}): Data {
  const d = emptyData();
  return { ...d, days, settings: { ...d.settings, ...settings } };
}

describe('week stats', () => {
  it('averages the logged finished days and counts the coverage', () => {
    const data = withDays({ [WS]: day(2000), [shift(WS, 1)]: day(2400), [shift(WS, 3)]: day(1600) }, { goal: 2100 });
    const w = weekStats(data, WS, shift(WS, 7));
    expect(w).toMatchObject({ past: 7, days: 3, complete: false, kcal: 2000, kcalSum: 6000, budget: 6300 });
  });

  it('leaves today out and calls a week with one gap complete', () => {
    const days: Record<string, Day> = {};
    for (let i = 0; i < 6; i++) if (i !== 2) days[shift(WS, i)] = day(2000);
    days[shift(WS, 6)] = day(5000);
    const w = weekStats(withDays(days), WS, shift(WS, 6));
    expect(w).toMatchObject({ past: 6, days: 5, complete: true, kcal: 2000 });
  });

  it('judges protein by days, not by the average', () => {
    // reached from 115 g, almost from 95 g. Three big days and four poor ones average above the target.
    const days: Record<string, Day> = {};
    [200, 200, 200, 60, 60, 60, 100].forEach((p, i) => (days[shift(WS, i)] = day(2000, p)));
    const w = weekStats(withDays(days, { proteinMet: 115, proteinClose: 95 }), WS, shift(WS, 7));
    expect(w.protein).toBeGreaterThan(115);
    expect(w).toMatchObject({ proteinMet: 3, proteinClose: 1, proteinShort: 3, proteinDays: 7 });
    expect(proteinWeekTag(w)).toEqual({ tag: 'off', label: '4 of 7 days' });
  });
});

describe('protein week by the 80 / 20 rule', () => {
  const w = (met: number, close: number, short: number) => ({ proteinMet: met, proteinClose: close, proteinShort: short, proteinDays: met + close + short });

  it('is on track with at most one day below almost, however few were reached', () => {
    expect(proteinWeekTag(w(7, 0, 0))).toEqual({ tag: 'on', label: '7 of 7 days' });
    expect(proteinWeekTag(w(1, 5, 1))).toEqual({ tag: 'on', label: '6 of 7 days' });
  });

  it('is acceptable with two such days and off with three', () => {
    expect(proteinWeekTag(w(3, 2, 2)).tag).toBe('ok');
    expect(proteinWeekTag(w(4, 0, 3)).tag).toBe('off');
  });
});

describe('calorie week', () => {
  it('counts the days by colour and those over 130 %', () => {
    // goal 2000: green 1900–2100, yellow 1700–2300, over 130 % above 2600
    const days: Record<string, Day> = {};
    [2000, 1900, 2100, 1899, 2300, 2700, 1600].forEach((k, i) => (days[shift(WS, i)] = day(k)));
    const w = weekStats(withDays(days, { goal: 2000 }), WS, shift(WS, 7));
    expect(w).toMatchObject({ kcalGreen: 3, kcalYellow: 2, kcalRed: 2, kcalBinge: 1, goalDays: 7 });
    expect(kcalWeekTag(w)).toEqual({ tag: 'ok', label: '3 of 7 days' });
  });

  it('is on track with half the days green, at most 2 red and no binge', () => {
    const w = (green: number, red: number, binge = 0, days = 7) => kcalWeekTag({ kcalGreen: green, kcalRed: red, kcalBinge: binge, goalDays: days }).tag;
    expect(w(7, 0)).toBe('on');
    expect(w(4, 2)).toBe('on');
    expect(w(2, 1, 0, 4)).toBe('on'); // half of a partial week
    expect(w(3, 0)).toBe('ok'); // mostly yellow: almost
    expect(w(4, 3)).toBe('ok');
    expect(w(5, 1, 1)).toBe('ok');
    expect(w(3, 4)).toBe('off');
    expect(w(5, 2, 2)).toBe('off');
  });
});

describe('weight trend and maintenance', () => {
  /** weigh-ins every 7 days from WS, and food every day in between */
  function weeks(kgs: number[], kcal = 2000, skip: (i: number) => boolean = () => false): Data {
    const days: Record<string, Day> = {};
    const span = (kgs.length - 1) * 7;
    for (let i = 0; i <= span; i++) days[shift(WS, i)] = day(skip(i) ? 0 : kcal, 0, i % 7 === 0 ? kgs[i / 7] : undefined);
    return withDays(days);
  }
  const last = (n: number) => shift(WS, (n - 1) * 7);

  it('needs 3 weigh-ins over 2 weeks for a trend', () => {
    expect(weightTrend(weeks([80, 79.5]), last(2))).toBeNull();
    expect(weightTrend(weeks([80, 79.5, 79]), last(3))?.perWeek).toBeCloseTo(-0.5);
  });

  it('fits a line through noisy weigh-ins rather than taking two ends', () => {
    const t = weightTrend(weeks([80, 80.6, 79.4, 79.6, 79]), last(5))!;
    expect(t.perWeek).toBeLessThan(0);
    expect(t.perWeek).toBeGreaterThan(-0.4);
    expect(t.se).toBeGreaterThan(0);
  });

  it('asks for 4 weigh-ins over 4 weeks before estimating maintenance', () => {
    expect(maintenance(weeks([80, 79.5, 79]), last(3))).toMatchObject({ status: 'weigh_ins', have: 3, span: 14 });
  });

  it('works out maintenance from the log and the weight change', () => {
    // losing 0.5 kg a week on 2000 kcal: maintenance = 2000 + 0.5 × 7700 / 7 = 2550
    const m = maintenance(weeks([80, 79.5, 79, 78.5, 78]), last(5));
    expect(m.status).toBe('ok');
    if (m.status === 'ok') {
      expect(m.kcal).toBeCloseTo(2550);
      expect(m.range).toBeCloseTo(0);
      expect(m).toMatchObject({ logged: 28, days: 28 });
    }
  });

  it('refuses when too many days are missing from the log', () => {
    const m = maintenance(weeks([80, 79.5, 79, 78.5, 78], 2000, i => i % 7 === 3 || i % 7 === 5), last(5));
    expect(m).toMatchObject({ status: 'logging', logged: 20, days: 28 });
  });
});

describe('weigh-ins in the store', () => {
  beforeEach(() => setData(emptyData()));

  it('records and removes a weigh-in without touching the meals', () => {
    setWeighIn('2026-10-10', 71.4);
    expect(getData().days['2026-10-10']).toMatchObject({ meals: [], weight: 71.4 });
    expect(daysSinceWeighIn(getData(), '2026-10-17')).toBe(7);
    setWeighIn('2026-10-10', 0);
    expect(getData().days['2026-10-10'].weight).toBeUndefined();
    expect(daysSinceWeighIn(getData(), '2026-10-17')).toBeNull();
  });

  it('keeps the waist apart from the weight, with its own trend in cm', () => {
    setWeighIn('2026-10-01', 71.4);
    ['2026-09-24', '2026-10-01', '2026-10-08'].forEach((d, i) => setWaist(d, 80 - i * 0.5));
    expect(getData().days['2026-10-01']).toMatchObject({ weight: 71.4, waist: 79.5 });
    expect(waistTrend(getData(), '2026-10-08')?.perWeek).toBeCloseTo(-0.5);
    expect(weightTrend(getData(), '2026-10-08')).toBeNull();
    setWaist('2026-10-01', 0);
    expect(getData().days['2026-10-01']).toMatchObject({ weight: 71.4 });
    expect(getData().days['2026-10-01'].waist).toBeUndefined();
  });

});
