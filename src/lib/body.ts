import { parse, shift } from './dates';
import { dayTotals, fmt, goalsOn } from './nutrition';
import type { Data } from './types';
import { KCAL_PER_KG, maintenance, measures, round50, WEIGH_EVERY, weighIns, weightTrend } from './weight';

// The Body screen: weekly check-ins (weight, waist) and how their changes line up with the food log.
//
// The reading of a change rests on a few well-established findings, kept deliberately short:
// - Energy balance: about 7 700 kcal per kg of body weight (Hall 2008; a rough rule, fine for a hint).
// - Day-to-day weight is mostly water: glycogen is stored with about 3 g of water per gram
//   (Olsson & Saltin 1970), and salt and carbs the day before move the scale by a kilo or more.
//   So two weigh-ins are compared with what the food explains, and a trend needs three over two weeks.
// - Losing 0.5–1 % of body weight a week keeps more lean mass than faster loss (Helms 2014, Garthe 2011).
// - In a deficit, protein of at least 1.6 g per kg a day keeps muscle (Morton 2018 meta-analysis).
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
  /** the calorie goals of the logged days, averaged; 0 when none had one */
  goal: number;
  /** average kcal on logged Saturdays and Sundays, and on the other days; 0 when there are none */
  weekend: number;
  weekday: number;
}

/** What was logged from `from` up to the day before `to` (the food that moved the scale between two weigh-ins). */
export function intake(data: Data, from: string, to: string): Intake {
  const all = Array.from({ length: Math.max(0, dayNo(to) - dayNo(from)) }, (_, i) => shift(from, i));
  const rows = all.map(d => ({ d, t: dayTotals(data.days[d]), g: goalsOn(data.settings, d).goal })).filter(x => x.t.kcal > 0);
  const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
  const we = (d: string) => [0, 6].includes(parse(d).getDay());
  const goals = rows.filter(x => x.g > 0);
  return {
    days: all.length,
    logged: rows.length,
    kcal: avg(rows.map(x => x.t.kcal)),
    protein: avg(rows.map(x => x.t.p)),
    carbs: avg(rows.map(x => x.t.c)),
    goal: goals.length === rows.length ? avg(goals.map(x => x.g)) : 0,
    weekend: avg(rows.filter(x => we(x.d)).map(x => x.t.kcal)),
    weekday: avg(rows.filter(x => !we(x.d)).map(x => x.t.kcal))
  };
}

/** Thresholds for the insights, in one place. */
export const BODY = {
  /** g protein per kg body weight a day that keeps muscle in a deficit */
  proteinPerKg: 1.6,
  /** weekly loss, as a share of body weight, above which muscle is at risk; and the lower end of the useful range */
  fastLoss: 0.01,
  steadyLoss: 0.005,
  /** kg the scale may differ from what the food explains before water is the likelier reason */
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
  const prev = w[w.length - 2];
  const trend = weightTrend(data, today);
  const m = maintenance(data, today);

  if (!last) return [];
  if (!prev) {
    out.push({ key: 'start', tone: 'info', title: 'First check-in saved', text: 'Next one in a week, same morning routine. A trend needs three check-ins over two weeks: single weigh-ins swing with water.' });
    return out;
  }

  // the last change against what the food between the two weigh-ins explains
  const span = dayNo(last.date) - dayNo(prev.date);
  const food = intake(data, prev.date, last.date);
  const delta = last.kg - prev.kg;
  const enoughLog = food.logged >= Math.max(1, Math.round(food.days * 0.7));
  if (enoughLog && m.status === 'ok') {
    const expected = ((food.kcal - m.kcal) * span) / KCAL_PER_KG;
    const gap = delta - expected;
    // a carb or calorie load in the two days before the weigh-in refills glycogen, and water with it
    const before = intake(data, shift(last.date, -2), last.date);
    const load = before.logged > 0 && food.carbs > 0 && before.carbs > food.carbs * (1 + BODY.carbLoad);
    if (Math.abs(gap) <= BODY.waterKg) {
      out.push({ key: 'balance', tone: 'good', title: `${signed(delta)} kg, as your food predicts`, text: `You averaged ${fmt(food.kcal)} kcal against a maintenance of ≈ ${fmt(round50(m.kcal))}: about ${signed(expected)} kg over ${span} days.`, ref: 'Energy balance, ≈ 7 700 kcal per kg (Hall 2008)' });
    } else if (gap > 0) {
      out.push({
        key: 'water',
        tone: 'info',
        title: `${signed(gap)} kg more than the food explains`,
        text: load
          ? `Carbs ran ${Math.round((before.carbs / food.carbs - 1) * 100)} % above your average in the 2 days before. Each gram of glycogen holds ≈ 3 g of water: this is water and should come off within days.`
          : 'Most likely water: salt, a late or big meal, hormones, a hard workout. Read the trend, not one weigh-in.',
        ref: 'Glycogen and water (Olsson & Saltin 1970)'
      });
    } else {
      out.push({ key: 'whoosh', tone: 'info', title: `${signed(gap)} kg more than the food explains`, text: 'Water leaving: after a high-salt or high-carb stretch, or the last weigh-in was a heavy one. The trend smooths it out.', ref: 'Glycogen and water (Olsson & Saltin 1970)' });
    }
  } else if (enoughLog && food.goal > 0) {
    const diff = food.kcal - food.goal;
    out.push({
      key: 'vs_goal',
      tone: 'info',
      title: `${signed(delta)} kg in ${span} days`,
      text: `You averaged ${fmt(food.kcal)} kcal, ${diff >= 0 ? `${fmt(diff)} over` : `${fmt(-diff)} under`} your goal. Four check-ins over four weeks with food logged give your own maintenance, and then each change is checked against it.`
    });
  }

  // gaps in the log make the food side a guess
  if (!enoughLog) out.push({ key: 'gaps', tone: 'info', title: `${food.logged} of ${food.days} days logged`, text: 'Too few to say what the food did between the last two check-ins.' });

  // the pace, as a share of body weight
  if (trend && trend.perWeek < 0) {
    const share = -trend.perWeek / trend.now;
    if (share > BODY.fastLoss)
      out.push({ key: 'fast', tone: 'warn', title: `Losing ${(share * 100).toFixed(1)} % a week`, text: 'Faster than 1 % a week costs more muscle. Eating ≈ 200–300 kcal more slows it to the range that keeps it.', ref: 'Helms 2014, Garthe 2011' });
    else if (share >= BODY.steadyLoss)
      out.push({ key: 'pace', tone: 'good', title: `Losing ${(share * 100).toFixed(1)} % a week`, text: 'In the 0.5–1 % range that loses fat and keeps muscle.', ref: 'Helms 2014, Garthe 2011' });
  }

  // protein for the body weight, while losing (or not known yet)
  if (enoughLog && food.protein > 0 && (!trend || trend.perWeek < 0)) {
    const perKg = food.protein / last.kg;
    if (perKg < BODY.proteinPerKg)
      out.push({ key: 'protein', tone: 'warn', title: `Protein ${perKg.toFixed(1)} g per kg`, text: `Below ${BODY.proteinPerKg} g/kg (≈ ${Math.round(last.kg * BODY.proteinPerKg)} g a day for you). In a deficit, more of the loss is then muscle.`, ref: 'Morton 2018 meta-analysis' });
    else out.push({ key: 'protein', tone: 'good', title: `Protein ${perKg.toFixed(1)} g per kg`, text: `At or above ${BODY.proteinPerKg} g/kg: enough to keep muscle while losing.`, ref: 'Morton 2018 meta-analysis' });
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
