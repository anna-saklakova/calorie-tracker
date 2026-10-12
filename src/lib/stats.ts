import { shift } from './dates';
import { dayTotals, goalsOn, kcalStatus, proteinGoal, proteinStatus } from './nutrition';
import type { BalanceTag, ProteinStatus } from './nutrition';
import type { Data } from './types';

/**
 * A week's numbers, of the finished days only (today counts once it's over).
 *
 * Calories add up over days (energy balance is cumulative), so the week is judged by its arithmetic
 * mean and its sum against the goals of the same days. Protein is judged by days (the 80 / 20 rule,
 * see proteinWeekTag): how many fell below the almost level, and the lowest day.
 */
export function weekStats(data: Data, weekStart: string, today: string) {
  const past = Array.from({ length: 7 }, (_, i) => shift(weekStart, i)).filter(d => d < today);
  const days = past
    .map(d => {
      const goals = goalsOn(data.settings, d);
      return { d, t: dayTotals(data.days[d]), goals, pg: proteinGoal(goals) };
    })
    .filter(x => x.t.kcal > 0);
  const n = days.length;
  const sum = days.reduce((a, x) => a + x.t.kcal, 0);
  const withGoal = days.filter(x => x.goals.goal > 0);
  const withProtein = days.filter(x => x.pg.target > 0);
  const statuses = withProtein.map(x => proteinStatus(x.t.p, x.pg, true));
  const count = (st: ProteinStatus) => statuses.filter(s => s === st).length;
  // the lowest day, as a share of its target
  const lowest = withProtein.length
    ? withProtein.reduce((lo, x) => (x.t.p / x.pg.target < lo.t.p / lo.pg.target ? x : lo))
    : null;
  return {
    /** finished days of the week so far (7 for a past week) */
    past: past.length,
    /** finished days with food logged */
    days: n,
    /** at most one finished day without a log: averages of fewer days can't be trusted */
    complete: n > 0 && n >= past.length - 1,
    kcal: n ? sum / n : 0,
    kcalSum: sum,
    /** the calorie goals of the logged days added up, 0 when none had one */
    budget: withGoal.length === n ? withGoal.reduce((a, x) => a + x.goals.goal, 0) : 0,
    protein: n ? days.reduce((a, x) => a + x.t.p, 0) / n : 0,
    /** days that ended within the calorie goal (and not under the minimum), of the days that had a goal */
    onGoal: withGoal.filter(x => kcalStatus(x.t.kcal, x.goals.goal, x.goals.min ?? 0) === 'within').length,
    goalDays: withGoal.length,
    /** days the protein target was reached, of the days that had one */
    proteinMet: count('met'),
    proteinClose: count('close'),
    /** days below the almost level */
    proteinShort: count('short'),
    proteinDays: withProtein.length,
    proteinLowest: lowest ? { g: lowest.t.p, share: lowest.t.p / lowest.pg.target, status: proteinStatus(lowest.t.p, lowest.pg, true) } : null
  };
}
export type WeekStats = ReturnType<typeof weekStats>;

/** Days below the almost level a week can have and still be on track, or acceptable. */
export const PROTEIN_LOW_DAYS = { on: 1, ok: 2 } as const;

/**
 * The week's protein verdict, by the 80 / 20 rule: what counts is how often protein fell below the
 * almost level, not whether every day was reached. At most one such day is on track, two are
 * acceptable as a rare exception, more is off balance. The label counts the days at least almost.
 */
export function proteinWeekTag(w: Pick<WeekStats, 'proteinMet' | 'proteinClose' | 'proteinShort' | 'proteinDays'>): { tag: BalanceTag; label: string } {
  const label = `${w.proteinMet + w.proteinClose} of ${w.proteinDays} days`;
  return { tag: w.proteinShort <= PROTEIN_LOW_DAYS.on ? 'on' : w.proteinShort <= PROTEIN_LOW_DAYS.ok ? 'ok' : 'off', label };
}
