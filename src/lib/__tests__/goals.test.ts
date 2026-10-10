import { beforeEach, describe, expect, it } from 'vitest';
import { switchBasis } from '../../components/Sheet';
import { goalsOn, KCAL_COLOR, kcalParts, kcalStatus, macroTargets, proteinGoal, proteinPace, proteinStatus, proteinTag } from '../nutrition';
import type { Goals } from '../types';
import { getData, setData, updateSettings } from '../store';
import { emptyData } from '../types';
import type { Product } from '../types';

describe('goal history', () => {
  beforeEach(() => setData(emptyData()));

  it('applies the current goals to every day until they are first changed', () => {
    expect(goalsOn(getData().settings, '2020-01-01').goal).toBe(2100);
  });

  it('keeps past days on the old goal after a change', () => {
    updateSettings({ goal: 1800 }, '2026-10-10');
    const s = getData().settings;
    expect(s.goal).toBe(1800);
    expect(goalsOn(s, '2026-10-09').goal).toBe(2100);
    expect(goalsOn(s, '2026-10-10').goal).toBe(1800);
    expect(goalsOn(s, '2026-12-31').goal).toBe(1800);
  });

  it('keeps one snapshot per day and tracks macro goals too', () => {
    updateSettings({ goal: 1800 }, '2026-10-10');
    updateSettings({ goal: 1850 }, '2026-10-10');
    updateSettings({ macroGoal: { p: 35, f: 25, c: 40 } }, '2026-10-12');
    const s = getData().settings;
    expect(s.goalHistory?.map(h => h.from)).toEqual(['0000-01-01', '2026-10-10', '2026-10-12']);
    expect(goalsOn(s, '2026-10-11')).toMatchObject({ goal: 1850, macroGoal: { p: 30 } });
    expect(goalsOn(s, '2026-10-12')).toMatchObject({ goal: 1850, macroGoal: { p: 35 } });
  });

  it('doesn’t record history for other settings', () => {
    updateSettings({ units: 'portion' }, '2026-10-10');
    expect(getData().settings.goalHistory).toBeUndefined();
  });
});

describe('day status', () => {
  it('colours calories within, up to 10 % over and more', () => {
    expect(kcalStatus(0, 2000)).toBe('none');
    expect(kcalStatus(1500, 0)).toBe('none');
    expect(kcalStatus(2000, 2000)).toBe('within');
    expect(kcalStatus(2200, 2000)).toBe('over');
    expect(kcalStatus(2201, 2000)).toBe('way_over');
  });

  // a goal without a weight: the macro goal's grams, almost from 85 %
  const g = (target: number) => ({ target, met: target, close: target * 0.85, critical: 0 });

  it('marks protein met by grams, close or short', () => {
    expect(proteinStatus(150, g(150), true)).toBe('met');
    expect(proteinStatus(149.6, g(150), true)).toBe('met');
    expect(proteinStatus(149, g(150), true)).toBe('close');
    expect(proteinStatus(128, g(150), true)).toBe('close');
    expect(proteinStatus(127, g(150), true)).toBe('short');
    expect(proteinStatus(0, g(150), false)).toBe('none');
    expect(proteinStatus(50, g(0), true)).toBe('none');
  });

  it('keeps the protein tag neutral while the day is still going', () => {
    expect(proteinTag(80, g(120), true, false)).toEqual({ tag: 'none', label: '40 g to go' });
    expect(proteinTag(120, g(120), true, false)).toEqual({ tag: 'on', label: 'Reached' });
    expect(proteinTag(80, g(120), true, true)).toEqual({ tag: 'off', label: 'Short' });
    expect(proteinTag(110, g(120), true, true)).toEqual({ tag: 'ok', label: 'Almost' });
  });
});

describe('protein from body weight', () => {
  const goals = (weight: number, over: Partial<Goals> = {}): Goals => ({ goal: 2000, macroMode: 'pct', macroGoal: { p: 30, f: 30, c: 40 }, weight, ...over });

  it('sets 1.6 g per kg, reached from 1.55, almost from 1.45, critical below 1.2, in whole grams', () => {
    expect(proteinGoal(goals(70))).toEqual({ target: 112, met: 109, close: 102, critical: 84 });
    expect(proteinGoal(goals(63))).toEqual({ target: 101, met: 98, close: 91, critical: 76 });
  });

  it('judges the day by those bands', () => {
    const pg = proteinGoal(goals(70));
    expect(proteinStatus(108.6, pg, true)).toBe('met'); // rounds to 109 = 1.55 g/kg
    expect(proteinStatus(108, pg, true)).toBe('close');
    expect(proteinStatus(102, pg, true)).toBe('close');
    expect(proteinStatus(101, pg, true)).toBe('short');
    expect(proteinStatus(84, pg, true)).toBe('short');
    expect(proteinStatus(83, pg, true)).toBe('critical');
    expect(proteinTag(83, pg, true, true)).toEqual({ tag: 'off', label: 'Critical' });
    expect(proteinTag(83, pg, true, false)).toEqual({ tag: 'none', label: '29 g to go' });
  });

  it('falls back to the macro goal without a weight', () => {
    expect(proteinGoal(goals(0)).target).toBe(150);
  });

  it('puts the weight-based protein into the macro targets', () => {
    const pct = macroTargets(goals(70));
    expect(pct.g.p).toBe(112);
    expect(pct.pct.p).toBe(22); // 448 kcal of 2000
    expect(pct.has).toBe(false); // 22 + 30 + 40
    expect(macroTargets(goals(70, { macroGoal: { p: '', f: 30, c: 48 } })).has).toBe(true);
    expect(macroTargets(goals(70, { macroMode: 'g', macroGoal: { p: 150, f: 70, c: 200 } })).g).toEqual({ p: 112, f: 70, c: 200 });
  });

  it('records the weight in the goal history', () => {
    setData(emptyData());
    updateSettings({ weight: 70 }, '2026-10-10');
    expect(goalsOn(getData().settings, '2026-10-09').weight).toBe(0);
    expect(goalsOn(getData().settings, '2026-10-10').weight).toBe(70);
  });
});

describe('library basis switch', () => {
  const p: Product = { id: 'x', name: 'Bar', basis: 'portion', portion: 25, kcal: 50, p: 2.5, f: 1, c: 7, updatedAt: 0 };

  it('re-expresses per-portion values per 100 g and back', () => {
    const per100 = switchBasis(p, '100');
    expect(per100).toMatchObject({ basis: '100', kcal: 200, p: 10, f: 4, c: 28 });
    expect(switchBasis(per100, 'portion')).toMatchObject({ basis: 'portion', kcal: 50, p: 2.5, f: 1, c: 7 });
  });

  it('leaves empty fields empty', () => {
    expect(switchBasis({ ...p, kcal: '' as unknown as number }, '100').kcal).toBe('');
  });

  it('colours only the calories over the goal', () => {
    expect(kcalParts(1800, 2000)).toEqual({ within: 1800, over: 0, overColor: KCAL_COLOR.within });
    expect(kcalParts(2100, 2000)).toEqual({ within: 2000, over: 100, overColor: KCAL_COLOR.over });
    expect(kcalParts(2500, 2000)).toEqual({ within: 2000, over: 500, overColor: KCAL_COLOR.way_over });
    expect(kcalParts(1500, 0)).toEqual({ within: 1500, over: 0, overColor: KCAL_COLOR.within });
  });
});

describe('minimum calories', () => {
  it('records the minimum in the goal history', () => {
    setData(emptyData());
    updateSettings({ min: 1600 }, '2026-10-10');
    expect(goalsOn(getData().settings, '2026-10-09').min).toBe(0);
    expect(goalsOn(getData().settings, '2026-10-10').min).toBe(1600);
  });

  it('marks a finished day under the minimum, never the current one', () => {
    expect(kcalStatus(1200, 2000, 1600, true)).toBe('under');
    expect(kcalStatus(1200, 2000, 1600, false)).toBe('within');
    expect(kcalStatus(1700, 2000, 1600, true)).toBe('within');
    expect(kcalStatus(1200, 0, 1600, true)).toBe('under');
    expect(kcalStatus(0, 2000, 1600, true)).toBe('none');
  });
});

describe('protein pace', () => {
  const pg = { target: 120, met: 120, close: 102, critical: 0 };
  const pace = (p: number, kcal: number) => proteinPace(p, pg, kcal, 2000).status;

  it('judges by whether the missing grams still fit into the calories left', () => {
    expect(pace(50, 1000)).toBe('on'); // 70 g in 1000 kcal: 1.17× the day's density
    expect(pace(40, 1000)).toBe('close'); // 80 g in 1000 kcal: 1.33×
    expect(pace(20, 1000)).toBe('behind'); // 100 g in 1000 kcal: 1.67×
    expect(pace(0, 50)).toBe('on'); // a coffee first thing is not a problem yet
    expect(pace(0, 400)).toBe('close'); // a protein-free breakfast is
  });

  it('is reached at the target grams, and never worse than close from 85 % of them', () => {
    expect(pace(120, 1900)).toBe('met');
    expect(pace(119.6, 1900)).toBe('met');
    expect(pace(110, 1950)).toBe('close'); // 10 g in 50 kcal is a stretch, but 92 % is there
    expect(pace(105, 2100)).toBe('close');
    expect(pace(60, 2100)).toBe('behind');
  });

  it('says nothing without a target or food, and reports the expected grams', () => {
    expect(pace(0, 0)).toBe('none');
    expect(proteinPace(30, { target: 0, met: 0, close: 0, critical: 0 }, 800, 2000).status).toBe('none');
    expect(proteinPace(30, pg, 1000, 0).status).toBe('none');
    expect(proteinPace(50, pg, 1000, 2000)).toMatchObject({ expected: 60, left: 70, eatenShare: 0.5 });
  });
});
