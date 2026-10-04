import type { AmountSource, NutritionSource } from './ai/types';

export type MealType = 'Breakfast' | 'Lunch' | 'Dinner' | 'Snack';
export const MEAL_ORDER: MealType[] = ['Breakfast', 'Lunch', 'Dinner', 'Snack'];

export interface Macros {
  kcal: number;
  p: number;
  f: number;
  c: number;
}

export interface Item extends Macros {
  id: string;
  name: string;
  /** grams */
  amount: number;
  /** set when the item was added in portions from a portion-based product */
  portions?: number;
  /** where the amount came from, when the item was recognized (kept to measure quality later) */
  amountSource?: AmountSource;
  /** where the nutrients came from, when the item was recognized */
  nutritionSource?: NutritionSource;
}

export interface Meal {
  id: string;
  type: MealType;
  items: Item[];
}

export interface Day {
  meals: Meal[];
  updatedAt: number;
}

export interface Product extends Macros {
  id: string;
  name: string;
  /** macros are per 100 g, or per portion of `portion` grams */
  basis: '100' | 'portion';
  portion: number;
  fav: boolean;
  updatedAt: number;
  /** tombstone so a delete survives sync merges */
  deleted?: boolean;
}

export type MacroMode = 'pct' | 'g';

export interface Settings {
  /** 0 = no goal */
  goal: number;
  macroMode: MacroMode;
  macroGoal: { p: number | ''; f: number | ''; c: number | '' };
  units: 'g' | 'portion';
  updatedAt: number;
}

/** Everything that is persisted locally and synced to the cloud. */
export interface Data {
  days: Record<string, Day>;
  library: Product[];
  settings: Settings;
}

export const defaultSettings = (): Settings => ({
  goal: 2100,
  macroMode: 'pct',
  macroGoal: { p: 30, f: 30, c: 40 },
  units: 'g',
  updatedAt: 0
});

export const emptyData = (): Data => ({ days: {}, library: [], settings: defaultSettings() });

export type Source = 'label' | 'library' | 'estimated' | 'note';

/** An item proposed by recognition, shown on the Review screen. */
export interface ReviewItem extends Item {
  src: Source;
  hint: string;
  save: boolean;
  low?: boolean;
  lowNote?: string;
  /** how the grams were obtained, shown under the source chip */
  amountNote?: string;
  /** per-gram values so editing the amount rescales the macros */
  per: Macros;
}

export type PhotoKind = 'plate' | 'label';
export interface Photo {
  id: string;
  kind: PhotoKind;
  file: File;
  url: string;
}

export const uid = (): string =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2) + Date.now().toString(36);
