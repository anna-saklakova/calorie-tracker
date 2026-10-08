import { describe, expect, it } from 'vitest';
import { GENERIC_FOODS } from '../ai/genericFoods';
import { buildMeal, packagePer100 } from '../ai/meal';
import { mealSchema, userContent } from '../ai/prompt';
import type { IntermediateFood, LibraryEntry, PackageData } from '../ai/types';
import { checkedItem, httpFailure, keepUserNutrients, libraryEntries, newReviewItem, toReviewItem } from '../recognize';
import type { ReviewItem } from '../types';

const est = { kcal: 100, protein_g: 5, fat_g: 5, carbs_g: 10, fiber_g: null };
const food = (over: Partial<IntermediateFood>): IntermediateFood => ({
  name: 'x',
  brand: null,
  product_name: null,
  amount_g: 100,
  amount_source: 'visual_estimate',
  amount_basis: null,
  package_data: null,
  library_product_id: null,
  generic_food_id: null,
  estimate_per_100g: est,
  checked_item: null,
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
    expect(packagePer100(label({ kcal_per_100g: 8000 }))).toMatchObject({ per100: { kcal: 183 }, energyFix: 'macros' });
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
  it('only lets the model pick generic food and image ids that exist', () => {
    const s = mealSchema(['img_1']) as any;
    const item = s.properties.foods.items.properties;
    expect(item.library_product_id).toEqual({ type: ['string', 'null'] });
    expect(item.package_data.anyOf[1].properties.source_image_ids.items.enum).toEqual(['img_1']);
    expect(item.generic_food_id.enum).toHaveLength(GENERIC_FOODS.length + 1);
    expect(new Set(GENERIC_FOODS.map(f => f.id)).size).toBe(GENERIC_FOODS.length);
  });

  it('converts portion-based library products to per 100 g', () => {
    const [e] = libraryEntries([{ id: 'b', name: 'Bar', basis: 'portion', portion: 40, kcal: 180, p: 8, f: 6, c: 20, updatedAt: 0 }]);
    expect(e.per100).toMatchObject({ kcal: 450, protein_g: 20, fat_g: 15, carbs_g: 50 });
  });

  it('turns a recognized food into a review row that rescales with the amount', () => {
    const meal = buildMeal({ foods: [food({ name: 'Beef', amount_g: 120, amount_source: 'user_exact', package_data: label() })], unmatched_package_image_ids: [], failure_reason: null }, []);
    const row = toReviewItem(meal.foods[0]);
    expect(row).toMatchObject({ name: 'Rinderhack (REWE Bio)', amount: 120, kcal: 224, p: 25.2, src: 'label', save: true, amountSource: 'user_exact', nutritionSource: 'package' });
    expect(row.per.kcal * 200).toBeCloseTo(374);
    expect(row.hint).toBe('Label · 187 kcal/100 g · your weight');
  });
});

describe('label energy check', () => {
  // a German protein powder label: 1570 kJ / 375 kcal, 75 g protein, 5 g fat, 7 g carbs
  const powder = { protein_g_per_100g: 75, fat_g_per_100g: 5, carbs_g_per_100g: 7 };

  it('keeps a kcal value that matches the macros', () => {
    expect(packagePer100(label({ ...powder, kcal_per_100g: 375 }))).toMatchObject({ per100: { kcal: 375, protein_g: 75 }, energyFix: null });
  });

  it('converts when the model picked the kJ value', () => {
    expect(packagePer100(label({ ...powder, kcal_per_100g: 1570 }))).toMatchObject({ per100: { kcal: 375 }, energyFix: 'kj' });
  });

  it('recalculates energy from the macros when it fits neither kcal nor kJ', () => {
    // e.g. the per-portion column (30 g) was read for energy: 112 kcal
    expect(packagePer100(label({ ...powder, kcal_per_100g: 112 }))).toMatchObject({ per100: { kcal: 373 }, energyFix: 'macros' });
  });

  it('accepts low-energy foods with rounding noise', () => {
    expect(packagePer100(label({ protein_g_per_100g: 0.7, fat_g_per_100g: 0.1, carbs_g_per_100g: 3.6, kcal_per_100g: 15 }))).toMatchObject({ per100: { kcal: 15 }, energyFix: null });
  });

  it('surfaces the fix on the review screen', () => {
    const meal = buildMeal({ foods: [food({ name: 'Protein', amount_g: 30, amount_source: 'user_estimate', package_data: label({ ...powder, kcal_per_100g: 1570 }) })], unmatched_package_image_ids: [], failure_reason: null }, []);
    expect(meal.foods[0]).toMatchObject({ energy_fix: 'kj', nutrition: { kcal: 112.5, protein_g: 22.5 } });
    expect(toReviewItem(meal.foods[0]).hint).toBe('Label · 375 kcal/100 g · ≈ your weight');
  });
});

describe('amount basis', () => {
  it('passes the conversion explanation through to the review row', () => {
    const meal = buildMeal({ foods: [food({ name: 'Protein', amount_g: 30, amount_source: 'user_exact', amount_basis: '  2 scoops × 15 g (package)  ', generic_food_id: null })], unmatched_package_image_ids: [], failure_reason: null }, []);
    expect(meal.foods[0].amount_basis).toBe('2 scoops × 15 g (package)');
    expect(toReviewItem(meal.foods[0]).amountNote).toBe('2 scoops × 15 g (package)');
    expect(buildMeal({ foods: [food({ amount_basis: '' })], unmatched_package_image_ids: [], failure_reason: null }, []).foods[0].amount_basis).toBeNull();
  });
});

describe('failure reporting', () => {
  it('explains platform errors that come without our JSON', () => {
    expect(httpFailure(504)).toMatchObject({ code: 'http_504_timeout' });
    expect(httpFailure(413)).toMatchObject({ code: 'http_413_too_large' });
    expect(httpFailure(500).message).toContain('500');
    expect(httpFailure(401).message).toContain('Sign in');
  });
});

describe('re-run keeps what the user checked', () => {
  const row = (over: Partial<ReviewItem>): ReviewItem => ({ ...newReviewItem(), manual: false, ...over });

  it('sends the edited list, empty fields as unknown', () => {
    const text = userContent('печенье', '', [], [], [
      checkedItem(row({ name: 'Протеиновое печенье', amount: 50, kcal: 210, p: 15, f: 9, c: 17 })),
      checkedItem(newReviewItem())
    ]);
    expect(text).toContain('Checked list (rule 17):\n1. Протеиновое печенье · 50 g · 210 kcal, protein 15 g, fat 9 g, carbs 17 g\n2. unnamed · amount not given · nutrients not given');
    expect(userContent('x', '', [], [])).not.toContain('Checked list');
  });

  it('ties each food to its checked row and ignores numbers out of range', () => {
    const meal = buildMeal({ foods: [food({ checked_item: 2 }), food({ checked_item: 7 }), food({})], unmatched_package_image_ids: [], failure_reason: null }, [], 2);
    expect(meal.foods.map(f => f.checked_index)).toEqual([1, null, null]);
  });

  it('keeps nutrients the user typed, rescaled to the new amount; the model fills the rest', () => {
    const recognized = toReviewItem(buildMeal({ foods: [food({ name: 'Cream', amount_g: 60, amount_source: 'user_exact' })], unmatched_package_image_ids: [], failure_reason: null }, []).foods[0]);
    const typed = row({ name: 'Cream', amount: 30, kcal: 90, p: '' as unknown as number, f: 9, c: '' as unknown as number, userSet: ['kcal', 'f'] });
    const kept = keepUserNutrients(recognized, typed);
    expect(kept).toMatchObject({ amount: 60, kcal: 180, f: 18, p: recognized.p, c: recognized.c, userSet: ['kcal', 'f'] });
    expect(kept.hint).toMatch(/^Partly your numbers/);
    expect(keepUserNutrients(recognized, undefined)).toBe(recognized);
  });
});
