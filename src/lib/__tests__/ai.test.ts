import { describe, expect, it } from 'vitest';
import { GENERIC_FOODS } from '../ai/genericFoods';
import { buildMeal, packagePer100 } from '../ai/meal';
import { mealSchema } from '../ai/prompt';
import type { IntermediateFood, LibraryEntry, PackageData } from '../ai/types';
import { libraryEntries, toReviewItem } from '../recognize';

const est = { kcal: 100, protein_g: 5, fat_g: 5, carbs_g: 10, fiber_g: null };
const food = (over: Partial<IntermediateFood>): IntermediateFood => ({
  name: 'x',
  brand: null,
  product_name: null,
  amount_g: 100,
  amount_source: 'visual_estimate',
  package_data: null,
  library_product_id: null,
  generic_food_id: null,
  estimate_per_100g: est,
  ...over
});
const label = (over: Partial<PackageData> = {}): PackageData => ({
  source_image_ids: ['img_2'],
  brand: 'REWE Bio',
  product_name: 'Rinderhack',
  package_size_g: 400,
  serving_size_g: null,
  kcal_per_100g: 187,
  protein_g_per_100g: 21,
  fat_g_per_100g: 11,
  carbs_g_per_100g: 0,
  fiber_g_per_100g: null,
  ...over
});
const lib: LibraryEntry[] = [{ id: 'p1', name: 'Barilla spaghetti, dry', per100: { kcal: 359, protein_g: 13, fat_g: 1.5, carbs_g: 72, fiber_g: null } }];

describe('meal pipeline', () => {
  it('uses the label only for the food it belongs to and does the maths in code (spec example)', () => {
    const meal = buildMeal(
      {
        foods: [
          food({ name: 'Beef', amount_g: 120, amount_source: 'user_estimate', package_data: label(), generic_food_id: 'ground_beef_cooked' }),
          food({ name: 'Cucumber', amount_g: 90, generic_food_id: 'cucumber' })
        ],
        unmatched_package_image_ids: [],
        failure_reason: null
      },
      []
    );
    const [beef, cucumber] = meal.foods;
    expect(beef).toMatchObject({ nutrition_source: 'package', amount_g: 120, amount_source: 'user_estimate', brand: 'REWE Bio' });
    expect(beef.nutrition).toEqual({ kcal: 224.4, protein_g: 25.2, fat_g: 13.2, carbs_g: 0, fiber_g: null });
    expect(cucumber).toMatchObject({ nutrition_source: 'generic_db', matched_name: 'Cucumber' });
    expect(cucumber.nutrition).toMatchObject({ kcal: 13.5, protein_g: 0.63, fiber_g: 0.45 });
    expect(meal.total).toMatchObject({ kcal: 237.9, protein_g: 25.83, fiber_g: 0.45 });
  });

  it('picks package → library → generic → estimate in that order', () => {
    const pick = (f: Partial<IntermediateFood>) => buildMeal({ foods: [food(f)], unmatched_package_image_ids: [], failure_reason: null }, lib).foods[0].nutrition_source;
    expect(pick({ package_data: label(), library_product_id: 'p1', generic_food_id: 'pasta_dry' })).toBe('package');
    expect(pick({ library_product_id: 'p1', generic_food_id: 'pasta_dry' })).toBe('product_db');
    expect(pick({ generic_food_id: 'pasta_dry' })).toBe('generic_db');
    expect(pick({})).toBe('llm_estimate');
  });

  it('ignores unreadable labels and unknown ids instead of guessing', () => {
    expect(packagePer100(label({ fat_g_per_100g: null }))).toBeNull();
    expect(packagePer100(label({ kcal_per_100g: 2000 }))).toBeNull();
    expect(packagePer100(label({ protein_g_per_100g: 60, carbs_g_per_100g: 60 }))).toBeNull();
    const meal = buildMeal({ foods: [food({ library_product_id: 'nope', generic_food_id: 'made_up' })], unmatched_package_image_ids: [], failure_reason: null }, lib);
    expect(meal.foods[0].nutrition_source).toBe('llm_estimate');
  });

  it('never changes the amount the user gave', () => {
    const meal = buildMeal({ foods: [food({ amount_g: 175, amount_source: 'user_exact', generic_food_id: 'rice_basmati_cooked' })], unmatched_package_image_ids: [], failure_reason: null }, []);
    expect(meal.foods[0]).toMatchObject({ amount_g: 175, amount_source: 'user_exact' });
    expect(meal.foods[0].nutrition.kcal).toBe(211.75);
  });

  it('clamps nonsense from the model', () => {
    const meal = buildMeal(
      { foods: [food({ amount_g: -5, amount_source: 'bogus' as never, estimate_per_100g: { kcal: 5000, protein_g: -1, fat_g: 3, carbs_g: NaN, fiber_g: null } }), food({ name: '  ' })], unmatched_package_image_ids: ['img_3'], failure_reason: null },
      []
    );
    expect(meal.foods).toHaveLength(1);
    expect(meal.foods[0]).toMatchObject({ amount_g: 0, amount_source: 'visual_estimate', per100: { kcal: 900, protein_g: 0, carbs_g: 0 } });
    expect(meal.unmatched_package_image_ids).toEqual(['img_3']);
  });
});

describe('schema and mapping', () => {
  it('only lets the model pick ids that exist', () => {
    const s = mealSchema(['p1'], ['img_1']) as any;
    const item = s.properties.foods.items.properties;
    expect(item.library_product_id.enum).toEqual(['p1', null]);
    expect(item.generic_food_id.enum).toHaveLength(GENERIC_FOODS.length + 1);
    expect(new Set(GENERIC_FOODS.map(f => f.id)).size).toBe(GENERIC_FOODS.length);
  });

  it('converts portion-based library products to per 100 g', () => {
    const [e] = libraryEntries([{ id: 'b', name: 'Bar', basis: 'portion', portion: 40, kcal: 180, p: 8, f: 6, c: 20, fav: false, updatedAt: 0 }]);
    expect(e.per100).toMatchObject({ kcal: 450, protein_g: 20, fat_g: 15, carbs_g: 50 });
  });

  it('turns a recognized food into a review row that rescales with the amount', () => {
    const meal = buildMeal({ foods: [food({ name: 'Beef', amount_g: 120, amount_source: 'user_exact', package_data: label() })], unmatched_package_image_ids: [], failure_reason: null }, []);
    const row = toReviewItem(meal.foods[0]);
    expect(row).toMatchObject({ name: 'Rinderhack (REWE Bio)', amount: 120, kcal: 224, p: 25.2, src: 'label', save: true, amountSource: 'user_exact', nutritionSource: 'package' });
    expect(row.per.kcal * 200).toBeCloseTo(374);
    expect(row.hint).toBe('Label · your weight');
  });
});
