import { BODY, intake } from './body';
import type { Tone } from './body';
import { MON, parse, shift } from './dates';
import { dayGoals, dayTotals, fmt, kcalBound, kcalZone, proteinGoal, proteinStatus, TAG_LABEL } from './nutrition';
import type { BalanceTag } from './nutrition';
import { KCAL_WEEK, kcalWeekTag, proteinWeekTag } from './stats';
import type { Data } from './types';
import { CALIBRATE_DAYS, CALIBRATE_MIN_WEIGH_INS, KCAL_PER_KG, measures, round50, weighIns, weightTrend } from './weight';

// The last seven days, read out in full: what the log and the scale say, and what they can't.
//
// It's always there, with whatever data exists. Each block lists what is known from the data (with the
// numbers) and what is not (what's missing, what the data is too coarse to tell), so a quiet week says
// "not enough to tell" rather than nothing. The findings it leans on:
// - Self-reported intake runs below real intake, by a lot in some people (Lichtman 1992).
// - Energy balance, about 7 700 kcal per kg (Hall 2008), and the scale's water noise (Olsson & Saltin 1970):
//   one week's weight change can't pin the balance down, so the interval is stated with its error.
// - Protein: in resistance-training trials, gains in muscle level off around 1.6 g per kg a day (Morton 2018).
// - The waist tracks abdominal fat better than weight does (Ashwell 2012), but moves slowly.

export interface ReviewBlock {
  key: 'food' | 'protein' | 'training' | 'weight' | 'waist';
  title: string;
  tone: Tone;
  headline: string;
  /** what the data says, with numbers */
  known: string[];
  /** what it doesn't say, and why */
  unknown: string[];
  ref?: string;
}

export interface Review {
  /** first day and the day after the last (today, which isn't over yet and so isn't counted) */
  from: string;
  to: string;
  /** days with food logged, of 7 */
  logged: number;
  summary: string;
  blocks: ReviewBlock[];
}

const dayNo = (d: string) => Math.round(parse(d).getTime() / 86400000);
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const signed = (n: number, digits = 1) => `${n > 0 ? '+' : n < 0 ? '−' : ''}${Math.abs(n).toFixed(digits)}`;
const date = (d: string) => `${parse(d).getDate()} ${MON[parse(d).getMonth()]}`;
const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const tone = (t: BalanceTag): Tone => (t === 'on' ? 'good' : t === 'off' ? 'warn' : 'info');

/** Days in the review window: the seven finished days before `today`. */
export const REVIEW_DAYS = 7;

export function weekReview(data: Data, today: string): Review {
  const from = shift(today, -REVIEW_DAYS);
  const rows = Array.from({ length: REVIEW_DAYS }, (_, i) => shift(from, i)).map(d => {
    const goals = dayGoals(data, d);
    return { d, t: dayTotals(data.days[d]), goals, pg: proteinGoal(goals), strength: !!data.days[d]?.strength };
  });
  const logged = rows.filter(x => x.t.kcal > 0);
  const missing = REVIEW_DAYS - logged.length;
  const gaps = missing > 0 ? `${plural(missing, 'day')} without a log. A day without a log is not a day of zero: the figures cover the logged days only, and what was eaten on the others isn't known.` : null;
  const weights = weighIns(data, today);
  const lastW = weights[weights.length - 1];
  const blocks: ReviewBlock[] = [];

  // ── food ────────────────────────────────────────────────────
  if (!logged.length) {
    blocks.push({ key: 'food', title: 'Food', tone: 'info', headline: 'Nothing logged', known: [], unknown: ['What you ate: there is no log for these 7 days, so there is nothing to average or to judge against the goal.'] });
  } else {
    const known = [`${fmt(avg(logged.map(x => x.t.kcal)))} kcal a day on average over the ${plural(logged.length, 'logged day')}.`];
    let t: Tone = 'info';
    const withGoal = logged.filter(x => x.goals.goal > 0);
    if (withGoal.length) {
      const eaten = avg(withGoal.map(x => x.t.kcal));
      const goal = avg(withGoal.map(x => x.goals.goal));
      const off = Math.round((Math.abs(eaten - goal) / goal) * 100);
      const nStrength = withGoal.filter(x => x.strength).length;
      known.push(`The goals of those days averaged ${fmt(goal)} kcal${nStrength ? `, with ${plural(nStrength, 'strength day')} at their own goal` : ''}; you ate ${off === 0 ? 'on' : `${off} % ${eaten > goal ? 'above' : 'below'}`} it.`);
      const zones = withGoal.map(x => kcalZone(x.t.kcal, x.goals.goal));
      const stat = {
        kcalGreen: zones.filter(z => z === 'ideal').length,
        kcalYellow: zones.filter(z => z === 'low' || z === 'high').length,
        kcalRed: zones.filter(z => z === 'too_low' || z === 'too_high').length,
        kcalBinge: withGoal.filter(x => x.t.kcal > kcalBound(x.goals.goal, KCAL_WEEK.binge)).length,
        goalDays: withGoal.length
      };
      known.push(`${stat.kcalGreen} on goal (within 5 %), ${stat.kcalYellow} almost (within 10 %), ${stat.kcalRed} off${stat.kcalBinge ? `, ${plural(stat.kcalBinge, 'day')} more than 30 % over` : ''}.`);
      const tag = kcalWeekTag(stat);
      known.push(`By the weekly rule (at least half the days on goal, at most 2 off, none far over): ${TAG_LABEL[tag.tag].toLowerCase()}.`);
      t = tone(tag.tag);
    } else known.push('No calorie goal is set for these days, so they aren’t judged.');
    const unknown = ['How complete each log is: food eaten and not entered doesn’t show here, and people tend to under-report what they eat.'];
    if (gaps) unknown.unshift(gaps);
    blocks.push({ key: 'food', title: 'Food', tone: t, headline: `${fmt(avg(logged.map(x => x.t.kcal)))} kcal a day · ${logged.length} of ${REVIEW_DAYS} days logged`, known, unknown, ref: 'Under-reporting: Lichtman 1992' });
  }

  // ── protein ─────────────────────────────────────────────────
  if (logged.length) {
    const p = avg(logged.map(x => x.t.p));
    const judged = logged.filter(x => x.pg.target > 0);
    const known: string[] = [];
    const unknown: string[] = [];
    let t: Tone = 'info';
    if (judged.length) {
      const st = judged.map(x => proteinStatus(x.t.p, x.pg, true));
      const count = (s: string) => st.filter(x => x === s).length;
      const w = { proteinMet: count('met'), proteinClose: count('close'), proteinShort: count('short'), proteinDays: judged.length };
      known.push(`${Math.round(p)} g a day on average, against a target of ${judged[judged.length - 1].pg.target} g.`);
      known.push(`${w.proteinMet} reached, ${w.proteinClose} almost, ${w.proteinShort} below the almost level.`);
      const tag = proteinWeekTag(w);
      known.push(`By the 80 / 20 rule (what counts is how often it fell short, at most one day): ${TAG_LABEL[tag.tag].toLowerCase()}.`);
      t = tone(tag.tag);
    } else {
      known.push(`${Math.round(p)} g a day on average.`);
      unknown.push('Whether that is enough: no protein target is set in Settings.');
    }
    if (lastW) known.push(`That is ${(p / lastW.kg).toFixed(1)} g per kg of your latest weigh-in (${lastW.kg.toFixed(1)} kg). In trials of resistance training, extra protein stopped adding muscle beyond roughly 1.6 g per kg a day.`);
    else unknown.push('Protein per kg of body weight: there is no weigh-in yet.');
    if (gaps) unknown.push('Protein on the days without a log.');
    blocks.push({ key: 'protein', title: 'Protein', tone: t, headline: `${Math.round(p)} g a day`, known, unknown, ref: 'Morton 2018' });
  }

  // ── strength days ───────────────────────────────────────────
  const nStrength = rows.filter(x => x.strength).length;
  if (nStrength > 0 || rows.some(x => (x.goals.strengthGoal ?? 0) > 0)) {
    const known: string[] = [];
    const unknown: string[] = [];
    const s = logged.filter(x => x.strength);
    const r = logged.filter(x => !x.strength);
    if (nStrength === 0) {
      unknown.push('Whether you trained: no day is marked as a strength day. Days you trained and didn’t switch it on were judged against the regular goal.');
    } else {
      if (s.length && r.length) {
        const eatenDiff = avg(s.map(x => x.t.kcal)) - avg(r.map(x => x.t.kcal));
        const goalDiff = avg(s.map(x => x.goals.goal)) - avg(r.map(x => x.goals.goal));
        known.push(`On strength days you averaged ${fmt(avg(s.map(x => x.t.kcal)))} kcal, on the other days ${fmt(avg(r.map(x => x.t.kcal)))}: ${signed(eatenDiff, 0)} kcal${goalDiff ? `, against ${signed(goalDiff, 0)} kcal in the goals` : ''}.`);
      } else if (s.length) known.push(`On strength days you averaged ${fmt(avg(s.map(x => x.t.kcal)))} kcal.`);
      else known.push('No food is logged on the strength days.');
      unknown.push('The training itself (exercises, load, effort) isn’t recorded, so whether the extra food matched the extra work can’t be judged.');
    }
    blocks.push({ key: 'training', title: 'Strength days', tone: 'info', headline: nStrength ? `${plural(nStrength, 'strength day')} of ${REVIEW_DAYS}` : 'No strength day marked', known, unknown });
  }

  // ── weight ──────────────────────────────────────────────────
  {
    const known: string[] = [];
    const unknown: string[] = [];
    let headline: string;
    const inWindow = weights.filter(x => x.date >= from);
    if (!lastW) {
      headline = 'No weigh-in yet';
      unknown.push('Which way your weight is going. Food only means something against the scale: without weigh-ins it can’t say whether you gain or lose.');
    } else if (!inWindow.length) {
      headline = `Last weigh-in ${lastW.kg.toFixed(1)} kg`;
      known.push(`It was ${plural(dayNo(today) - dayNo(lastW.date), 'day')} ago (${date(lastW.date)}).`);
      unknown.push('What the weight did in these 7 days: there is no weigh-in in them.');
    } else {
      headline = `${lastW.kg.toFixed(1)} kg on ${date(lastW.date)}`;
      // like Body's readings: the change is read against a weigh-in at least 6 days before, never over a day or two
      const prev = [...weights].reverse().find(x => dayNo(lastW.date) - dayNo(x.date) >= BODY.minSpan);
      if (prev) {
        const span = dayNo(lastW.date) - dayNo(prev.date);
        const delta = lastW.kg - prev.kg;
        known.push(`${signed(delta)} kg since ${date(prev.date)} (${plural(span, 'day')}).`);
        const food = intake(data, prev.date, lastW.date);
        if (food.logged >= Math.max(1, Math.round(food.days * 0.7))) {
          const maintenance = food.kcal - (delta * KCAL_PER_KG) / span;
          known.push(`Eating ${fmt(food.kcal)} kcal a day over those days, that reads as a maintenance near ${fmt(round50(maintenance))} kcal.`);
          unknown.push(`How far to trust that: the scale moves ± ${BODY.waterKg} kg with water alone (glycogen holds about 3 g of water per gram), which over ${plural(span, 'day')} is ± ${fmt(round50((BODY.waterKg * KCAL_PER_KG) / span))} kcal a day. One interval can’t pin your maintenance down; Body gives an estimate once there are ${CALIBRATE_MIN_WEIGH_INS} weigh-ins over ${CALIBRATE_DAYS} days.`);
        } else unknown.push(`What the food did between the weigh-ins: only ${food.logged} of ${food.days} days are logged.`);
      } else {
        known.push('One reading, with no weigh-in at least a week before it.');
        unknown.push('Whether the weight is going up, down or nowhere. One weigh-in shows where you are, not where you’re going, and over a few days the scale moves 1–2 kg with water, salt and food in the gut.');
      }
      const trend = weightTrend(data, today);
      if (trend) {
        const range = 1.96 * trend.se;
        known.push(`Trend over ${plural(trend.span, 'day')} (${trend.n} weigh-ins): ${signed(trend.perWeek, 2)} kg a week, give or take ${range.toFixed(2)}.`);
        if (Math.abs(trend.perWeek) <= range) unknown.push('Whether it is moving at all: that range includes no change.');
      } else unknown.push('A trend: it needs three weigh-ins over at least two weeks.');
    }
    blocks.push({ key: 'weight', title: 'Weight', tone: 'info', headline, known, unknown, ref: 'Hall 2008 · Olsson & Saltin 1970' });
  }

  // ── waist ───────────────────────────────────────────────────
  const waist = measures(data, 'waist', today).filter(x => x.date > shift(today, -42));
  if (waist.length) {
    const a = waist[0];
    const b = waist[waist.length - 1];
    const known: string[] = [];
    const unknown: string[] = [];
    if (waist.length >= 2 && dayNo(b.date) - dayNo(a.date) >= BODY.minSpan) {
      const d = b.value - a.value;
      known.push(`${signed(d)} cm since ${date(a.date)}${Math.abs(d) < BODY.waistCm ? ', which is within measurement noise' : ''}.`);
    } else unknown.push('Any change: one measurement shows none, and the waist moves slowly, over weeks.');
    unknown.push(`Anything smaller than ${BODY.waistCm} cm: it can come from where the tape sits.`);
    blocks.push({ key: 'waist', title: 'Waist', tone: 'info', headline: `${b.value.toFixed(1)} cm on ${date(b.date)}`, known, unknown, ref: 'Ashwell 2012' });
  }

  const marked = rows.some(x => x.strength) ? `${plural(nStrength, 'strength day')} · ` : '';
  const weighed = weights.filter(x => x.date >= from).length;
  return { from, to: today, logged: logged.length, summary: `${logged.length} of ${REVIEW_DAYS} days logged · ${marked}${plural(weighed, 'weigh-in')}`, blocks };
}
