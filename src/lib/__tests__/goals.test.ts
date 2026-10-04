import { beforeEach, describe, expect, it } from 'vitest';
import { switchBasis } from '../../components/Sheet';
import { goalsOn, kcalStatus, proteinStatus } from '../nutrition';
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

  it('marks protein met, close or short', () => {
    expect(proteinStatus(135, 150, true)).toBe('met');
    expect(proteinStatus(113, 150, true)).toBe('close');
    expect(proteinStatus(100, 150, true)).toBe('short');
    expect(proteinStatus(0, 150, false)).toBe('none');
    expect(proteinStatus(50, 0, true)).toBe('none');
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
});
