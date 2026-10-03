import type { Day, Item, Macros, MealType, Settings } from './types';

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

export function macroTargets(s: Pick<Settings, 'macroMode' | 'macroGoal' | 'goal'>): MacroTargets {
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

export type BalanceTag = 'none' | 'on' | 'ok' | 'off';
/** On track within 3 points, acceptable within 8, otherwise off balance. */
export function balanceTag(actualPct: number, targetPct: number, anyEaten: boolean): BalanceTag {
  if (!anyEaten) return 'none';
  const dev = Math.abs(actualPct - targetPct);
  return dev <= 3 ? 'on' : dev <= 8 ? 'ok' : 'off';
}
export const TAG_LABEL: Record<BalanceTag, string> = { none: '—', on: 'On track', ok: 'Acceptable', off: 'Off balance' };
