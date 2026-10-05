import type { Day, Goals, Item, Macros, MealType, Settings } from './types';

/** Thin-space thousands separator, as in the design ("1 293"). */
export const fmt = (n: number) => Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
export const r1 = (n: number) => Math.round(n * 10) / 10;

export function defaultMeal(now = new Date()): MealType {
  const h = now.getHours();
  return h < 11 ? 'Breakfast' : h < 15 ? 'Lunch' : h < 21 ? 'Dinner' : 'Snack';
}

export const sumMacros = (items: Macros[]): Macros =>
  items.reduce(
    (a, i) => ({ kcal: a.kcal + (+i.kcal || 0), p: a.p + (+i.p || 0), f: a.f + (+i.f || 0), c: a.c + (+i.c || 0) }),
    { kcal: 0, p: 0, f: 0, c: 0 }
  );

export const dayTotals = (d?: Day): Macros => sumMacros((d?.meals ?? []).flatMap(m => m.items));

export const perGram = (it: Macros & { amount: number }): Macros => {
  const a = it.amount || 1;
  return { kcal: it.kcal / a, p: it.p / a, f: it.f / a, c: it.c / a };
};

/** Rescale an item to a new amount in grams, keeping its per-gram macros. */
export function scaleItem<T extends Macros & { amount: number; per?: Macros }>(it: T, amount: number | string): T & { per: Macros } {
  const a = +amount || 0;
  const per = it.per ?? perGram(it);
  return { ...it, per, amount: a, kcal: Math.round(per.kcal * a), p: r1(per.p * a), f: r1(per.f * a), c: r1(per.c * a) };
}

export function amountLabel(it: Item, units: Settings['units']) {
  if (units === 'portion' && it.portions) {
    return `${it.portions} ${it.portions === 1 ? 'portion' : 'portions'} · ${it.amount} g`;
  }
  return `${it.amount} g`;
}

// ── Macro goals ─────────────────────────────────────────────

export const KCAL_PER_G = { p: 4, f: 9, c: 4 } as const;
export type MacroKey = keyof typeof KCAL_PER_G;
export const MACRO_KEYS: MacroKey[] = ['p', 'f', 'c'];

/** Share of calories from each macro, rounded; 0s when nothing eaten. */
export function macroPct(t: Pick<Macros, 'p' | 'f' | 'c'>): Record<MacroKey, number> & { kcal: number } {
  const kcal = t.p * 4 + t.f * 9 + t.c * 4;
  const pct = (k: MacroKey) => (kcal ? Math.round((t[k] * KCAL_PER_G[k]) / kcal * 100) : 0);
  return { p: pct('p'), f: pct('f'), c: pct('c'), kcal };
}

export interface MacroTargets {
  has: boolean;
  pct: Record<MacroKey, number>;
  /** target grams, 0 if unknown */
  g: Record<MacroKey, number>;
  /** pct mode: the entered sum; grams mode: the kcal those grams make */
  pctSum: number;
  gramsKcal: number;
}

export function macroTargets(s: Goals): MacroTargets {
  const mg = { p: +s.macroGoal.p || 0, f: +s.macroGoal.f || 0, c: +s.macroGoal.c || 0 };
  const pctSum = mg.p + mg.f + mg.c;
  const gramsKcal = Math.round(mg.p * 4 + mg.f * 9 + mg.c * 4);
  if (s.macroMode === 'pct') {
    const g = (k: MacroKey) => (s.goal > 0 ? Math.round((s.goal * mg[k]) / 100 / KCAL_PER_G[k]) : 0);
    return { has: pctSum === 100, pct: mg, g: { p: g('p'), f: g('f'), c: g('c') }, pctSum, gramsKcal };
  }
  const pct = macroPct(mg);
  return { has: gramsKcal > 0, pct: { p: pct.p, f: pct.f, c: pct.c }, g: mg, pctSum, gramsKcal };
}

/**
 * The macro goal re-expressed in the other mode, so switching % ⇄ grams keeps the same targets.
 * % → grams uses the daily calorie goal (no calorie goal: the grams can't be known, so they're left empty).
 * Grams → % uses the share of calories those grams make, rounded so the three add up to 100.
 */
export function convertMacroGoal(s: Goals, to: Goals['macroMode']): Goals['macroGoal'] {
  if (to === s.macroMode) return s.macroGoal;
  if (to === 'g') {
    const t = macroTargets(s);
    if (!(s.goal > 0) || !t.pctSum) return { p: '', f: '', c: '' };
    return t.g;
  }
  const kcal = MACRO_KEYS.map(k => (+s.macroGoal[k] || 0) * KCAL_PER_G[k]);
  const total = kcal.reduce((a, b) => a + b, 0);
  if (!total) return { p: '', f: '', c: '' };
  const raw = kcal.map(v => (v * 100) / total);
  const pct = raw.map(Math.floor);
  // hand the points lost to rounding down to the largest remainders
  const order = raw.map((v, i) => [v - pct[i], i] as const).sort((a, b) => b[0] - a[0]);
  for (let n = 100 - pct.reduce((a, b) => a + b, 0), j = 0; n > 0; n--, j++) pct[order[j % 3][1]]++;
  return { p: pct[0], f: pct[1], c: pct[2] };
}

export type BalanceTag = 'none' | 'on' | 'ok' | 'off';
/**
 * How the share of calories from a macro compares with its goal. Protein is a floor: more is fine,
 * falling short is the problem. Fat and carbs are ceilings: less is fine, going over is the problem.
 * On track within 3 points on the wrong side, acceptable within 8, otherwise off balance.
 */
export function balanceTag(k: MacroKey, actualPct: number, targetPct: number, anyEaten: boolean): BalanceTag {
  if (!anyEaten) return 'none';
  const miss = k === 'p' ? targetPct - actualPct : actualPct - targetPct;
  return miss <= 3 ? 'on' : miss <= 8 ? 'ok' : 'off';
}
export const TAG_LABEL: Record<BalanceTag, string> = { none: '—', on: 'On track', ok: 'Acceptable', off: 'Off balance' };

// ── Goals by date and day status ────────────────────────────

/** The goals that applied on `date`: the latest snapshot starting on or before it. */
export function goalsOn(s: Settings, date: string): Goals {
  if (!s.goalHistory?.length) return s;
  const h = [...s.goalHistory].sort((a, b) => a.from.localeCompare(b.from));
  // before the first snapshot (shouldn't happen: the first starts at 0000-01-01), use the oldest goals
  return h.filter(x => x.from <= date).pop() ?? h[0];
}

export type KcalStatus = 'none' | 'within' | 'over' | 'way_over';
/** Within the goal, up to 10 % over, or more than 10 % over. */
export function kcalStatus(kcal: number, goal: number): KcalStatus {
  if (goal <= 0 || kcal <= 0) return 'none';
  if (kcal <= goal) return 'within';
  return kcal <= goal * 1.1 ? 'over' : 'way_over';
}
export const KCAL_COLOR: Record<KcalStatus, string> = { none: '#F3E6DF', within: 'var(--accent)', over: 'var(--est)', way_over: 'var(--danger)' };

/**
 * Calories split for drawing: the part up to the goal is always green; only the part over it
 * takes the over colour (yellow up to 10 % over, red beyond). Without a goal it's all `within`.
 */
export function kcalParts(kcal: number, goal: number): { within: number; over: number; overColor: string } {
  const status = kcalStatus(kcal, goal);
  if (status === 'none' || status === 'within') return { within: Math.max(0, kcal), over: 0, overColor: KCAL_COLOR.within };
  return { within: goal, over: kcal - goal, overColor: KCAL_COLOR[status] };
}

export type ProteinStatus = 'none' | 'met' | 'close' | 'short';
/** Protein reached (≥ 90 % of target), close (≥ 75 %) or short. 'none' without a target or food. */
export function proteinStatus(protein: number, target: number, anyEaten: boolean): ProteinStatus {
  if (target <= 0 || !anyEaten) return 'none';
  const r = protein / target;
  return r >= 0.9 ? 'met' : r >= 0.75 ? 'close' : 'short';
}
