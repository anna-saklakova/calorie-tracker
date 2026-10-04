import { GENERIC_FOODS } from './genericFoods.js';
import { AMOUNT_SOURCES } from './types.js';
import type { LibraryEntry } from './types.js';

/** System prompt for the multimodal model (spec §6, §7, §16). */
export const SYSTEM_PROMPT = `You analyse ONE meal for a calorie tracker. You get photos of the plate and/or of packaging and nutrition labels, plus an optional text note and an optional voice transcript from the user. Treat everything together as one meal.

Return ONLY data that matches the JSON schema. Rules:
1. Analyse all photos, the note and the transcript together as one meal.
2. List only foods that were actually eaten. One entry = one food or ingredient (e.g. pasta, sauce, minced beef, broccoli — not "pasta dish").
3. Packaging, cutlery, objects in the background and anything not eaten are NOT foods.
4. A package or nutrition label belongs only to the food it is for. Put its data in package_data of that food only, with the image ids in source_image_ids. If you can't tell which food a package belongs to (and the note doesn't say), don't attach it; list its image id in unmatched_package_image_ids instead.
5. Amount priority: if the user states an exact weight ("rice 175 g"), use it unchanged with amount_source "user_exact". Never replace it with your own visual estimate.
6. If the user gives an approximate weight ("about 175 g rice", "~120 g"), use that number with amount_source "user_estimate".
7. If the user gives a count or portion ("half a cucumber", "2 eggs", "a spoon of oil"), convert it to grams and use "user_estimate".
8. Scoops, spoons, cups, ml of a powder or dry product: FIRST look for the conversion on the package ("1 Messlöffel = 15 g", "2 scoops (30 g)", serving size). If it is there, use it (amount_source "user_estimate", e.g. "2 scoops" → 30 g). Only without it use typical densities (a level scoop of protein powder ≈ 30 g; dry powder ≈ 0.5 g per ml, so 80 ml ≈ 40 g). The amount is always grams of the dry product as eaten, never the volume of the drink. Put the conversion you found into serving_size_g.
9. Only if the user says nothing about the amount, estimate grams from the photo: "visual_estimate". Without a photo, assume a typical portion and use "visual_estimate".
10. Reading nutrition labels — be exact, this is where mistakes cost most:
   - Use the "per 100 g" column (German: "pro 100 g", "je 100 g"; French "pour 100 g"; Italian "per 100 g"). Labels usually have a second column per serving/portion ("pro Portion", "per serving", "pro 30 g") — do NOT take values from it. For powders and drink mixes the per-portion column is often "prepared with milk/water" and includes the milk: never use it.
   - Energy: use the kcal value, NOT the kJ value. Labels show both, often as "1570 kJ / 372 kcal" or in two lines (German "Brennwert"). kJ is about 4.2 times bigger than kcal — if the only energy number you see is far above what the macros allow (protein and carbs give 4 kcal/g, fat 9 kcal/g), it is kJ: divide by 4.184.
   - Rows: German "Eiweiß" = protein, "Fett" = fat, "Kohlenhydrate" = carbs, "davon Zucker" = of which sugars (not carbs), "Ballaststoffe" = fiber, "Salz" = salt. Spanish "Proteínas/Grasas/Hidratos de carbono", French "Protéines/Matières grasses/Glucides", Italian "Proteine/Grassi/Carboidrati".
   - Protein powders have ~70–85 g protein per 100 g; whole foods never above ~35. If your reading is wildly off for the kind of product, re-read the table.
   - If the label is only per serving and the serving size in grams is visible, convert to per 100 g. If a value is not visible or not readable, use null. Never guess label values.
   - Only the nutrition table matters for package_data; ignore recipes and serving suggestions on the package except for the scoop/serving-size conversion in rule 8.
11. library_product_id: the id of the user's own product only if it is clearly the same product (same item/brand). Otherwise null.
12. generic_food_id: the id of the closest generic food in the list below, matching the food AND its preparation (cooked vs raw). If none fits, null. Never pick a random one.
13. estimate_per_100g: always give your best estimate of the nutrients per 100 g of the food as eaten. It is used only when there is no label, library or generic match.
14. Do not calculate meal totals or nutrients for the eaten amount. The app does the arithmetic.
15. Names: short and plain, in the language of the user's note (English if there is no note). brand and product_name only if visible on a package or said by the user.
16. If no food can be identified at all (blurry, dark, not food), return an empty foods list and explain briefly in failure_reason. Otherwise failure_reason is null.

amount_source values: ${AMOUNT_SOURCES.join(', ')}.

Generic foods (id: name, per 100 g as listed):
${GENERIC_FOODS.map(f => `${f.id}: ${f.name}`).join('\n')}`;

export function userContent(text: string, voiceTranscript: string, library: LibraryEntry[], imageIds: { id: string; kind: string }[]) {
  const lines: string[] = [];
  lines.push(imageIds.length ? `Photos: ${imageIds.map(i => `${i.id} (user tagged it as ${i.kind === 'label' ? 'package/label' : 'plate'})`).join(', ')}.` : 'No photos.');
  lines.push(text.trim() ? `User note: """${text.trim()}"""` : 'User note: none.');
  if (voiceTranscript.trim()) lines.push(`Voice transcript: """${voiceTranscript.trim()}"""`);
  lines.push(
    library.length
      ? `User's own products (id: name · kcal/protein/fat/carbs per 100 g):\n${library.map(p => `${p.id}: ${p.name} · ${p.per100.kcal}/${p.per100.protein_g}/${p.per100.fat_g}/${p.per100.carbs_g}`).join('\n')}`
      : "User's own products: none."
  );
  return lines.join('\n\n');
}

const nullableNumber = { type: ['number', 'null'] };

const per100Schema = {
  type: 'object',
  additionalProperties: false,
  required: ['kcal', 'protein_g', 'fat_g', 'carbs_g', 'fiber_g'],
  properties: { kcal: { type: 'number' }, protein_g: { type: 'number' }, fat_g: { type: 'number' }, carbs_g: { type: 'number' }, fiber_g: nullableNumber }
};

/** Strict JSON Schema for Structured Outputs. Ids are enums so the model can't invent a DB record. */
export function mealSchema(libraryIds: string[], imageIds: string[]) {
  const imageId = imageIds.length ? { type: 'string', enum: imageIds } : { type: 'string' };
  return {
    type: 'object',
    additionalProperties: false,
    required: ['foods', 'unmatched_package_image_ids', 'failure_reason'],
    properties: {
      foods: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['name', 'brand', 'product_name', 'amount_g', 'amount_source', 'package_data', 'library_product_id', 'generic_food_id', 'estimate_per_100g'],
          properties: {
            name: { type: 'string' },
            brand: { type: ['string', 'null'] },
            product_name: { type: ['string', 'null'] },
            amount_g: { type: 'number' },
            amount_source: { type: 'string', enum: [...AMOUNT_SOURCES] },
            package_data: {
              anyOf: [
                { type: 'null' },
                {
                  type: 'object',
                  additionalProperties: false,
                  required: ['source_image_ids', 'brand', 'product_name', 'package_size_g', 'serving_size_g', 'kcal_per_100g', 'protein_g_per_100g', 'fat_g_per_100g', 'carbs_g_per_100g', 'fiber_g_per_100g'],
                  properties: {
                    source_image_ids: { type: 'array', items: imageId },
                    brand: { type: ['string', 'null'] },
                    product_name: { type: ['string', 'null'] },
                    package_size_g: nullableNumber,
                    serving_size_g: nullableNumber,
                    kcal_per_100g: nullableNumber,
                    protein_g_per_100g: nullableNumber,
                    fat_g_per_100g: nullableNumber,
                    carbs_g_per_100g: nullableNumber,
                    fiber_g_per_100g: nullableNumber
                  }
                }
              ]
            },
            library_product_id: { type: ['string', 'null'], enum: [...libraryIds, null] },
            generic_food_id: { type: ['string', 'null'], enum: [...GENERIC_FOODS.map(f => f.id), null] },
            estimate_per_100g: per100Schema
          }
        }
      },
      unmatched_package_image_ids: { type: 'array', items: imageId },
      failure_reason: { type: ['string', 'null'] }
    }
  };
}
