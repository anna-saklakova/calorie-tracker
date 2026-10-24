import { parse, shift } from './dates';
import { dayGoals, dayTotals, fmt, proteinGoal, proteinStatus } from './nutrition';
import type { Data } from './types';
import { KCAL_PER_KG, maintenance, measures, round50, WEIGH_EVERY, weighIns, weightTrend } from './weight';

// The Body screen: weekly check-ins (weight, waist) and how their changes line up with the food log.
//
// The reading of a change rests on a few well-established findings, kept deliberately short:
// - Energy balance: about 7 700 kcal per kg of body weight (Hall 2008; a rough rule, fine for a hint).
// - Day-to-day weight is mostly water: glycogen is stored with about 3 g of water per gram
//   (Olsson & Saltin 1970), and salt and carbs the day before move the scale by a kilo or more.
//   So a change is only read week to week (two check-ins at least 6 days apart), never over a day or
//   two, it's compared with what the food explains, and a trend needs three check-ins over two weeks.
// - Losing 0.5–1 % of body weight a week keeps more lean mass than faster loss (Helms 2014, Garthe 2011).
// - Protein is judged against the user's own target from Settings, day by day, as on Today and Week.
// - The waist tracks abdominal fat better than weight does (Ashwell 2012): waist down with weight
//   steady reads as fat lost and muscle kept.
// - Weekends: intake rises and the weight with it, and the weekdays rarely make up for it (Racette 2008).

const dayNo = (d: string) => Math.round(parse(d).getTime() / 86400000);

export interface CheckIn { date: string; weight?: number; waist?: number }

/** Days with a weight or a waist on or before `upTo`, newest first. */
export function checkIns(data: Data, upTo = '9999-12-31'): CheckIn[] {
  return Object.entries(data.days)
    .filter(([d, day]) => d <= upTo && ((day.weight ?? 0) > 0 || (day.waist ?? 0) > 0))
    .map(([date, day]) => ({ date, ...(day.weight ? { weight: day.weight } : {}), ...(day.waist ? { waist: day.waist } : {}) }))
    .sort((a, b) => b.date.localeCompare(a.date));
}

/** How long since the last check-in, and whether the weekly one is due (none yet counts as due). */
export function checkInDue(data: Data, today: string): { due: boolean; since: number | null } {
  const last = checkIns(data, today)[0];
  const since = last ? dayNo(today) - dayNo(last.date) : null;
  return { due: since === null || since >= WEIGH_EVERY, since };
}

export interface Intake {
  /** days in the stretch */
  days: number;
  /** days with food logged */
  logged: number;
  kcal: number;
  protein: number;
  carbs: number;
  /** logged days by protein against each day's own target; target is the latest day's, 0 when there is none */
  proteinMet: number;
  proteinClose: number;
  proteinShort: number;
  proteinTarget: number;
  /** the calorie goals of the logged days, averaged; 0 when none had one */
  goal: number;
  /** average kcal on logged Saturdays and Sundays, and on the other days; 0 when there are none */
  weekend: number;
  weekday: number;
}

/** What was logged from `from` up to the day before `to` (the food that moved the scale between two weigh-ins). */
export function intake(data: Data, from: string, to: string): Intake {
  const all = Array.from({ length: Math.max(0, dayNo(to) - dayNo(from)) }, (_, i) => shift(from, i));
  const rows = all
    .map(d => {
      const goals = dayGoals(data, d);
      return { d, t: dayTotals(data.days[d]), g: goals.goal, pg: proteinGoal(goals) };
    })
    .filter(x => x.t.kcal > 0);
  const pst = rows.map(x => proteinStatus(x.t.p, x.pg, true));
  const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
  const we = (d: string) => [0, 6].includes(parse(d).getDay());
  const goals = rows.filter(x => x.g > 0);
  return {
    days: all.length,
    logged: rows.length,
    kcal: avg(rows.map(x => x.t.kcal)),
    protein: avg(rows.map(x => x.t.p)),
    carbs: avg(rows.map(x => x.t.c)),
    proteinMet: pst.filter(x => x === 'met').length,
    proteinClose: pst.filter(x => x === 'close').length,
    proteinShort: pst.filter(x => x === 'short').length,
    proteinTarget: rows.length ? rows[rows.length - 1].pg.target : 0,
    goal: goals.length === rows.length ? avg(goals.map(x => x.g)) : 0,
    weekend: avg(rows.filter(x => we(x.d)).map(x => x.t.kcal)),
    weekday: avg(rows.filter(x => !we(x.d)).map(x => x.t.kcal))
  };
}

/** Thresholds for the insights, in one place. */
export const BODY = {
  /** two check-ins at least this many days apart make a change worth reading; closer ones are water */
  minSpan: 6,
  /** weekly loss, as a share of body weight, above which muscle is at risk; and the lower end of the useful range */
  fastLoss: 0.01,
  steadyLoss: 0.005,
  /** the scale may differ from what the food explains by this share of body weight (at least waterKg) before water is the likelier reason */
  waterShare: 0.01,
  waterKg: 0.6,
  /** carbs in the 2 days before a weigh-in this much above the stretch's average count as a carb load */
  carbLoad: 0.3,
  /** weekends this much above weekdays are worth a word */
  weekendShare: 0.2,
  /** a waist change of at least this many cm counts */
  waistCm: 0.5,
  /** a weight change of at most this many kg a week counts as steady */
  steadyKg: 0.15
} as const;

export type Tone = 'good' | 'warn' | 'info';
export interface Insight { key: string; tone: Tone; title: string; text: string; ref?: string }

const signed = (n: number, digits = 1) => `${n > 0 ? '+' : n < 0 ? '−' : ''}${Math.abs(n).toFixed(digits)}`;

/**
 * A handful of short readings of the latest change against the food log, most telling first.
 * Each one says what happened and the likely reason, with the finding it rests on.
 */
export function bodyInsights(data: Data, today: string, max = 4): Insight[] {
  const out: Insight[] = [];
  const w = weighIns(data, today);
  const last = w[w.length - 1];
  const trend = weightTrend(data, today);
  const m = maintenance(data, today);
  if (!last) return [];

  // the change is read week to week: the latest check-in against the last one at least 6 days before it.
  // Over a day or two the scale moves by a kilo or more with water and food, so closer ones say nothing.
  const prev = [...w].reverse().find(x => dayNo(last.date) - dayNo(x.date) >= BODY.minSpan);
  const close = w.length > 1 ? w[w.length - 2] : null;
  if (!prev) {
    if (!close) out.push({ key: 'start', tone: 'info', title: 'First check-in saved', text: 'Next one in a week, same morning routine. A trend needs three check-ins over two weeks: single weigh-ins swing with water.' });
    else
      out.push({
        key: 'too_soon',
        tone: 'info',
        title: `${signed(last.kg - close.kg)} kg in ${dayNo(last.date) - dayNo(close.date)} ${dayNo(last.date) - dayNo(close.date) === 1 ? 'day' : 'days'}: too soon to read`,
        text: 'Over a few days the scale moves 1–2 kg with water, salt and food in the gut. The change is read against a check-in at least a week earlier.',
        ref: 'Glycogen and water (Olsson & Saltin 1970)'
      });
  }

  // the food behind the change: between the two check-ins, or the last week when there is no pair yet
  const from = prev ? prev.date : shift(last.date, -7);
  const span = dayNo(last.date) - dayNo(from);
  const food = intake(data, from, last.date);
  const enoughLog = food.logged >= Math.max(1, Math.round(food.days * 0.7));
  if (prev) {
    const delta = last.kg - prev.kg;
    const when = `over ${span} days`;
    if (enoughLog && m.status === 'ok') {
      const expected = ((food.kcal - m.kcal) * span) / KCAL_PER_KG;
      const gap = delta - expected;
      const noise = Math.max(BODY.waterKg, last.kg * BODY.waterShare);
      // a carb load in the two days before the weigh-in refills glycogen, and water with it
      const before = intake(data, shift(last.date, -2), last.date);
      const load = before.logged > 0 && food.carbs > 0 && before.carbs > food.carbs * (1 + BODY.carbLoad);
      if (Math.abs(gap) <= noise) {
        out.push({ key: 'balance', tone: 'good', title: `${signed(delta)} kg ${when}, as your food predicts`, text: `You averaged ${fmt(food.kcal)} kcal against a maintenance of ≈ ${fmt(round50(m.kcal))}: about ${signed(expected)} kg.`, ref: 'Energy balance, ≈ 7 700 kcal per kg (Hall 2008)' });
      } else if (gap > 0) {
        out.push({
          key: 'water',
          tone: 'info',
          title: `${signed(delta)} kg ${when}, food explains ${signed(expected)}`,
          text: load
            ? `Carbs ran ${Math.round((before.carbs / food.carbs - 1) * 100)} % above your average in the 2 days before. Each gram of glycogen holds ≈ 3 g of water: the rest is water and should come off within days.`
            : 'The rest is most likely water: salt, a big late meal, the cycle, a hard workout. The trend will tell.',
          ref: 'Glycogen and water (Olsson & Saltin 1970)'
        });
      } else {
        out.push({ key: 'whoosh', tone: 'info', title: `${signed(delta)} kg ${when}, food explains ${signed(expected)}`, text: 'The extra is water leaving, or the earlier check-in was a heavy one. The trend smooths it out.', ref: 'Glycogen and water (Olsson & Saltin 1970)' });
      }
    } else if (enoughLog && food.goal > 0) {
      const diff = food.kcal - food.goal;
      out.push({
        key: 'vs_goal',
        tone: 'info',
        title: `${signed(delta)} kg ${when}`,
        text: `You averaged ${fmt(food.kcal)} kcal, ${diff >= 0 ? `${fmt(diff)} over` : `${fmt(-diff)} under`} your goal. After four weekly check-ins with food logged, each change is checked against your own maintenance.`
      });
    }
  }

  // gaps in the log make the food side a guess
  if (!enoughLog && w.length > 1) out.push({ key: 'gaps', tone: 'info', title: `${food.logged} of ${food.days} days logged`, text: prev ? 'Too few to say what the food did between the check-ins.' : 'Too few to say much about the last week’s food.' });

  // the pace, as a share of body weight
  if (trend && trend.perWeek < 0) {
    const share = -trend.perWeek / trend.now;
    if (share > BODY.fastLoss)
      out.push({ key: 'fast', tone: 'warn', title: `Losing ${(share * 100).toFixed(1)} % a week`, text: 'Faster than 1 % a week costs more muscle. Eating ≈ 200–300 kcal more slows it to the range that keeps it.', ref: 'Helms 2014, Garthe 2011' });
    else if (share >= BODY.steadyLoss)
      out.push({ key: 'pace', tone: 'good', title: `Losing ${(share * 100).toFixed(1)} % a week`, text: 'In the 0.5–1 % range that loses fat and keeps muscle.', ref: 'Helms 2014, Garthe 2011' });
  }

  // protein against the user's own target, day by day over the same days
  if (enoughLog && food.proteinTarget > 0) {
    const n = food.proteinMet + food.proteinClose + food.proteinShort;
    const avg = Math.round(food.protein);
    const title = `Protein ${avg} g a day, target ${food.proteinTarget} g`;
    const days = `${food.proteinMet} of ${n} days reached${food.proteinClose ? `, ${food.proteinClose} almost` : ''}`;
    if (food.proteinShort <= 1) out.push({ key: 'protein', tone: 'good', title, text: `${days}. Enough protein keeps muscle while the weight goes down.` });
    else out.push({ key: 'protein', tone: food.proteinShort > 2 ? 'warn' : 'info', title, text: `${days}, ${food.proteinShort} below it. In a deficit, low-protein days let more of the loss come from muscle.` });
  }

  // the waist against the weight, over the trend window
  const waist = measures(data, 'waist', today).filter(x => x.date > shift(today, -42));
  if (waist.length >= 2) {
    const a = waist[0];
    const b = waist[waist.length - 1];
    const weeks = (dayNo(b.date) - dayNo(a.date)) / 7;
    const kgA = w.filter(x => x.date <= a.date).pop();
    const kgB = w.filter(x => x.date <= b.date).pop();
    if (weeks >= 2 && kgA && kgB && kgA !== kgB) {
      const dw = b.value - a.value;
      const dkg = kgB.kg - kgA.kg;
      const steady = Math.abs(dkg) / weeks <= BODY.steadyKg;
      if (dw <= -BODY.waistCm && steady)
        out.push({ key: 'recomp', tone: 'good', title: `Waist ${signed(dw)} cm, weight steady`, text: 'Fat is going and muscle is staying. The scale undersells this.', ref: 'Waist tracks abdominal fat (Ashwell 2012)' });
      else if (dw <= -BODY.waistCm && dkg < 0)
        out.push({ key: 'waist', tone: 'good', title: `Waist ${signed(dw)} cm, weight ${signed(dkg)} kg`, text: 'Both down: the loss is mostly fat.', ref: 'Waist tracks abdominal fat (Ashwell 2012)' });
      else if (Math.abs(dw) < BODY.waistCm && dkg < -BODY.steadyKg * weeks)
        out.push({ key: 'waist', tone: 'info', title: `Weight ${signed(dkg)} kg, waist unchanged`, text: 'Early loss is mostly water and glycogen; the waist usually follows within a few weeks.' });
      else if (dw >= BODY.waistCm && dkg > 0)
        out.push({ key: 'waist', tone: 'warn', title: `Waist ${signed(dw)} cm, weight ${signed(dkg)} kg`, text: 'Both up: a surplus going to fat rather than muscle.', ref: 'Waist tracks abdominal fat (Ashwell 2012)' });
    }
  }

  // weekends against weekdays, over the last four weeks
  const month = intake(data, shift(today, -28), today);
  if (month.weekend > 0 && month.weekday > 0 && month.weekend > month.weekday * (1 + BODY.weekendShare)) {
    const extra = (month.weekend - month.weekday) * 2;
    out.push({ key: 'weekend', tone: 'warn', title: `Weekends +${fmt(month.weekend - month.weekday)} kcal a day`, text: `≈ ${fmt(round50(extra))} kcal a week, ${((extra * 52) / 12 / KCAL_PER_KG).toFixed(1)} kg a month if nothing makes up for it.`, ref: 'Racette 2008' });
  }

  return out.slice(0, max);
}
