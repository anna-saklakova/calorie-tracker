import { parse, shift } from './dates';
import { dayTotals } from './nutrition';
import type { Data } from './types';

// Weekly weigh-ins, their trend, and what they say about the calories that keep the weight steady.
//
// One weigh-in is noisy (water, the weekend-to-weekday swing), so the trend is a least-squares line
// through several of them, not the difference between two. Weekly weighing works as well as daily
// for weight control, as long as it's the same day of the week and the same conditions.

export interface WeighIn { date: string; kg: number }

/** kcal per kg of body weight change: a rough rule (it overstates it for lean people), fine for a hint. */
export const KCAL_PER_KG = 7700;
/** A weigh-in is due once the last one is this many days old. */
export const WEIGH_EVERY = 7;
/** The trend uses the weigh-ins of the last this many days. */
export const TREND_DAYS = 42;
/** The maintenance estimate needs weigh-ins spanning at least this many days, and this many of them. */
export const CALIBRATE_DAYS = 28;
export const CALIBRATE_MIN_WEIGH_INS = 4;
/** …and food logged on at least this share of the days in between (6 of 7). */
export const CALIBRATE_LOGGED = 6 / 7;

const dayNo = (d: string) => Math.round(parse(d).getTime() / 86400000);

/** All weigh-ins up to `upTo` (inclusive), oldest first. */
export function weighIns(data: Data, upTo = '9999-12-31'): WeighIn[] {
  return Object.entries(data.days)
    .filter(([d, day]) => d <= upTo && (day.weight ?? 0) > 0)
    .map(([date, day]) => ({ date, kg: day.weight! }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

/** Days since the last weigh-in on or before `today`; null when there is none. */
export function daysSinceWeighIn(data: Data, today: string): number | null {
  const last = weighIns(data, today).pop();
  return last ? dayNo(today) - dayNo(last.date) : null;
}

export interface Trend {
  /** kg per week; negative = losing */
  perWeek: number;
  /** standard error of perWeek */
  se: number;
  /** the line's value at the last weigh-in, kg */
  now: number;
  n: number;
  /** days from the first to the last weigh-in used */
  span: number;
  from: string;
  to: string;
}

/**
 * The weight trend over the last TREND_DAYS up to `upTo`: a least-squares line through the weigh-ins.
 * Needs at least 3 weigh-ins at least 14 days apart, otherwise null.
 */
export function weightTrend(data: Data, upTo: string, days = TREND_DAYS): Trend | null {
  const pts = weighIns(data, upTo).filter(w => w.date > shift(upTo, -days));
  if (pts.length < 3) return null;
  const x = pts.map(p => dayNo(p.date));
  const span = x[x.length - 1] - x[0];
  if (span < 14) return null;
  const n = pts.length;
  const mx = x.reduce((a, b) => a + b, 0) / n;
  const my = pts.reduce((a, p) => a + p.kg, 0) / n;
  const sxx = x.reduce((a, v) => a + (v - mx) ** 2, 0);
  const slope = x.reduce((a, v, i) => a + (v - mx) * (pts[i].kg - my), 0) / sxx;
  const resid = pts.reduce((a, p, i) => a + (p.kg - (my + slope * (x[i] - mx))) ** 2, 0);
  const se = n > 2 ? Math.sqrt(resid / (n - 2) / sxx) : 0;
  return { perWeek: slope * 7, se: se * 7, now: my + slope * (x[n - 1] - mx), n, span, from: pts[0].date, to: pts[n - 1].date };
}

export type Maintenance =
  | { status: 'ok'; kcal: number; range: number; intake: number; trend: Trend; logged: number; days: number }
  | { status: 'weigh_ins'; have: number; span: number }
  | { status: 'logging'; logged: number; days: number };

/**
 * The calories that keep the weight steady, by the user's own log: the average logged intake between
 * the first and the last weigh-in of the trend, minus what the weight change accounts for. Because it
 * compares the log with the scale, it also absorbs whatever the log misses or overstates.
 * The range is the 95 % interval from the trend's uncertainty alone.
 */
export function maintenance(data: Data, upTo: string): Maintenance {
  const trend = weightTrend(data, upTo);
  if (!trend || trend.n < CALIBRATE_MIN_WEIGH_INS || trend.span < CALIBRATE_DAYS) {
    const pts = weighIns(data, upTo).filter(w => w.date > shift(upTo, -TREND_DAYS));
    return { status: 'weigh_ins', have: pts.length, span: pts.length ? dayNo(pts[pts.length - 1].date) - dayNo(pts[0].date) : 0 };
  }
  // the food eaten from the first weigh-in up to the day before the last one moved the weight between them
  const days = Array.from({ length: trend.span }, (_, i) => shift(trend.from, i));
  const kcal = days.map(d => dayTotals(data.days[d]).kcal).filter(k => k > 0);
  if (kcal.length < days.length * CALIBRATE_LOGGED) return { status: 'logging', logged: kcal.length, days: days.length };
  const intake = kcal.reduce((a, b) => a + b, 0) / kcal.length;
  const perDay = trend.perWeek / 7;
  return {
    status: 'ok',
    kcal: intake - perDay * KCAL_PER_KG,
    range: (1.96 * trend.se * KCAL_PER_KG) / 7,
    intake,
    trend,
    logged: kcal.length,
    days: days.length
  };
}

/** Rounded to 50 kcal, the precision this estimate deserves. */
export const round50 = (n: number) => Math.round(n / 50) * 50;
