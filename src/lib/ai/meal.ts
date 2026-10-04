import { GENERIC_BY_ID } from './genericFoods.js';
import { AMOUNT_SOURCES } from './types.js';
import type { FinalFood, FinalMeal, IntermediateFood, IntermediateMeal, LibraryEntry, Nutrients, NutritionSource, PackageData, Per100 } from './types.js';

// Deterministic part of the pipeline (spec §11, §13): pick a nutrition source per food,
// then do the arithmetic. No model involved.

const MAX_AMOUNT_G = 5000;
const r2 = (n: number) => Math.round(n * 100) / 100;
const finite = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);

/** Energy the macros account for (Atwater factors). Fiber contributes ~2 kcal/g in the EU convention. */
export const atwaterKcal = (protein: number, fat: number, carbs: number, fiber: number | null = null) => 4 * protein + 9 * fat + 4 * carbs + 2 * (fiber ?? 0);

const KJ_PER_KCAL = 4.184;
const ENERGY_TOLERANCE = 0.3;

/**
 * Label data is usable only when kcal and all three macros were read and look like real per-100 g values.
 * The energy value is cross-checked against the macros: labels list kJ next to kcal and the model may
 * pick the wrong one, so a value that fits as kJ is converted; a value that fits neither is replaced by
 * the energy the macros imply (the macro rows are harder to misread than the two-number energy row).
 */
export function packagePer100(p: PackageData | null): { per100: Per100; energyFix: 'kj' | 'macros' | null } | null {
  if (!p) return null;
  const { kcal_per_100g: kcal, protein_g_per_100g: protein, fat_g_per_100g: fat, carbs_g_per_100g: carbs, fiber_g_per_100g: fiber } = p;
  if (![kcal, protein, fat, carbs].every(finite)) return null;
  const [k, pr, f, c] = [kcal, protein, fat, carbs] as number[];
  if (k < 0 || [pr, f, c].some(x => x < 0 || x > 100) || pr + f + c > 105) return null;
  const fib = finite(fiber) && fiber >= 0 && fiber <= 100 ? fiber : null;
  const expected = atwaterKcal(pr, f, c, fib);
  const fits = (value: number) => expected < 20 ? value <= 60 : Math.abs(value - expected) / expected <= ENERGY_TOLERANCE;
  let energy = k;
  let energyFix: 'kj' | 'macros' | null = null;
  if (!fits(k)) {
    if (fits(k / KJ_PER_KCAL)) {
      energy = Math.round(k / KJ_PER_KCAL);
      energyFix = 'kj';
    } else {
      energy = Math.round(expected);
      energyFix = 'macros';
    }
  }
  if (energy > 900) return null;
  return { per100: { kcal: energy, protein_g: pr, fat_g: f, carbs_g: c, fiber_g: fib }, energyFix };
}

/** The model's own estimate, clamped to sane ranges. */
function estimatePer100(e: Per100 | null | undefined): Per100 {
  const clamp = (n: unknown, max: number) => (finite(n) ? Math.min(Math.max(n, 0), max) : 0);
  return {
    kcal: clamp(e?.kcal, 900),
    protein_g: clamp(e?.protein_g, 100),
    fat_g: clamp(e?.fat_g, 100),
    carbs_g: clamp(e?.carbs_g, 100),
    fiber_g: finite(e?.fiber_g) ? clamp(e?.fiber_g, 100) : null
  };
}

/** Priority: package → user's library (product_db) → generic DB → model estimate. */
export function chooseNutrition(food: IntermediateFood, library: Map<string, LibraryEntry>): { source: NutritionSource; per100: Per100; matchedName: string | null; energyFix: 'kj' | 'macros' | null } {
  const label = packagePer100(food.package_data);
  if (label) return { source: 'package', per100: label.per100, matchedName: null, energyFix: label.energyFix };
  const own = food.library_product_id ? library.get(food.library_product_id) : undefined;
  if (own) return { source: 'product_db', per100: own.per100, matchedName: own.name, energyFix: null };
  const generic = food.generic_food_id ? GENERIC_BY_ID.get(food.generic_food_id) : undefined;
  if (generic) return { source: 'generic_db', per100: generic.per100, matchedName: generic.name, energyFix: null };
  return { source: 'llm_estimate', per100: estimatePer100(food.estimate_per_100g), matchedName: null, energyFix: null };
}

export function nutrientsFor(per100: Per100, amountG: number): Nutrients {
  const k = amountG / 100;
  return {
    kcal: r2(per100.kcal * k),
    protein_g: r2(per100.protein_g * k),
    fat_g: r2(per100.fat_g * k),
    carbs_g: r2(per100.carbs_g * k),
    fiber_g: per100.fiber_g === null ? null : r2(per100.fiber_g * k)
  };
}

export function sumNutrients(list: Nutrients[]): Nutrients {
  const fiberKnown = list.some(n => n.fiber_g !== null);
  return {
    kcal: r2(list.reduce((s, n) => s + n.kcal, 0)),
    protein_g: r2(list.reduce((s, n) => s + n.protein_g, 0)),
    fat_g: r2(list.reduce((s, n) => s + n.fat_g, 0)),
    carbs_g: r2(list.reduce((s, n) => s + n.carbs_g, 0)),
    fiber_g: fiberKnown ? r2(list.reduce((s, n) => s + (n.fiber_g ?? 0), 0)) : null
  };
}

/** Turns the model's intermediate JSON into the final meal: sources chosen, nutrients calculated, totals summed. */
export function buildMeal(meal: IntermediateMeal, libraryEntries: LibraryEntry[]): FinalMeal {
  const library = new Map(libraryEntries.map(p => [p.id, p]));
  const foods: FinalFood[] = (meal.foods ?? [])
    .filter(f => f && typeof f.name === 'string' && f.name.trim())
    .map((f, i) => {
      // The amount is the model's reading of the user's words or the photo; it is never re-estimated here.
      const amount = finite(f.amount_g) ? r2(Math.min(Math.max(f.amount_g, 0), MAX_AMOUNT_G)) : 0;
      const amountSource = AMOUNT_SOURCES.includes(f.amount_source) ? f.amount_source : 'visual_estimate';
      const { source, per100, matchedName, energyFix } = chooseNutrition(f, library);
      return {
        id: `food_${i + 1}`,
        name: f.name.trim(),
        brand: f.brand ?? f.package_data?.brand ?? null,
        product_name: f.product_name ?? f.package_data?.product_name ?? null,
        amount_g: amount,
        amount_source: amountSource,
        nutrition: nutrientsFor(per100, amount),
        nutrition_source: source,
        per100,
        matched_name: matchedName,
        energy_fix: energyFix
      };
    });
  return { foods, total: sumNutrients(foods.map(f => f.nutrition)), unmatched_package_image_ids: meal.unmatched_package_image_ids ?? [] };
}
