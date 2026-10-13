import { shift } from './dates';
import { dayTotals, goalsOn, kcalBound, kcalZone, proteinGoal, proteinStatus } from './nutrition';
import type { BalanceTag, KcalZone, ProteinStatus } from './nutrition';
import type { Data } from './types';

/**
 * A week's numbers, of the finished days only (today counts once it's over).
 *
 * Calories add up over days (energy balance is cumulative), so the week shows its arithmetic mean and
 * its sum against the goals of the same days, and is judged by the colours of its days (kcalWeekTag). Protein is judged by days (the 80 / 20 rule,
 * see proteinWeekTag): how many fell below the almost level.
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
  const zones: KcalZone[] = withGoal.map(x => kcalZone(x.t.kcal, x.goals.goal));
  const withProtein = days.filter(x => x.pg.target > 0);
  const statuses = withProtein.map(x => proteinStatus(x.t.p, x.pg, true));
  const count = (st: ProteinStatus) => statuses.filter(s => s === st).length;
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
    /** days by calorie zone (kcalZone), of the days that had a goal: green, yellow, red */
    kcalGreen: zones.filter(z => z === 'ideal').length,
    kcalYellow: zones.filter(z => z === 'low' || z === 'high').length,
    kcalRed: zones.filter(z => z === 'too_low' || z === 'too_high').length,
    /** days more than 30 % over their goal: a binge, which undoes the week's deficit */
    kcalBinge: withGoal.filter(x => x.t.kcal > kcalBound(x.goals.goal, KCAL_WEEK.binge)).length,
    goalDays: withGoal.length,
    /** days the protein target was reached, of the days that had one */
    proteinMet: count('met'),
    proteinClose: count('close'),
    /** days below the almost level */
    proteinShort: count('short'),
    proteinDays: withProtein.length
  };
}
export type WeekStats = ReturnType<typeof weekStats>;

/** The week's calorie rule: at least half the days green, at most 2 red, no binge over 130 %. */
export const KCAL_WEEK = { greenShare: 0.5, redOn: 2, redOk: 3, binge: 0.3 } as const;

/**
 * The week's calorie verdict, from the colours of its days (calories add up over the week, so one or two
 * days off the goal don't spoil it). On track: at least half the days green, at most 2 red, none over 130 %.
 * Acceptable: at most 3 red and at most one day over 130 %. Off balance otherwise.
 */
export function kcalWeekTag(w: Pick<WeekStats, 'kcalGreen' | 'kcalRed' | 'kcalBinge' | 'goalDays'>): { tag: BalanceTag; label: string } {
  const label = `${w.kcalGreen} of ${w.goalDays} ${w.goalDays === 1 ? 'day' : 'days'}`;
  if (w.kcalGreen >= w.goalDays * KCAL_WEEK.greenShare && w.kcalRed <= KCAL_WEEK.redOn && w.kcalBinge === 0) return { tag: 'on', label };
  return { tag: w.kcalRed <= KCAL_WEEK.redOk && w.kcalBinge <= 1 ? 'ok' : 'off', label };
}

/** Days below the almost level a week can have and still be on track, or acceptable. */
export const PROTEIN_LOW_DAYS = { on: 1, ok: 2 } as const;

/**
 * The week's protein verdict, by the 80 / 20 rule: what counts is how often protein fell below the
 * almost level, not whether every day was reached. At most one such day is on track, two are
 * acceptable as a rare exception, more is off balance. The label counts the days at least almost.
 */
export function proteinWeekTag(w: Pick<WeekStats, 'proteinMet' | 'proteinClose' | 'proteinShort' | 'proteinDays'>): { tag: BalanceTag; label: string } {
  const label = `${w.proteinMet + w.proteinClose} of ${w.proteinDays} ${w.proteinDays === 1 ? 'day' : 'days'}`;
  return { tag: w.proteinShort <= PROTEIN_LOW_DAYS.on ? 'on' : w.proteinShort <= PROTEIN_LOW_DAYS.ok ? 'ok' : 'off', label };
}
