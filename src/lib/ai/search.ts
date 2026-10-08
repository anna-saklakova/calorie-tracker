import { packagePer100 } from './meal.js';
import type { IntermediateFood, WebFind } from './types.js';

// Second step of recognition: nutrients from the web for the foods that have no label and no library
// match, the way a person would look them up. The model searches (OpenAI web_search tool) and reports
// per-100 g values with the page they came from. A value is used only if that page really came up in
// the search and the numbers add up (same check as a label); otherwise the model's estimate stays.

export const SEARCH_PROMPT = `You look up nutrition facts on the web for a calorie tracker. For each numbered food, search the web and report its nutrients per 100 g of the food as eaten.

Rules:
1. Search for every food. Use the query given, and refine it if the results don't match.
2. The page must be about exactly this food: same product and brand if one is given, same variety, same fat percentage, raw vs cooked, dry vs cooked. A similar but different food is not a match.
3. Prefer, in this order: the manufacturer's own page or a shop page with the nutrition table (branded products); nutrition databases (fddb.info, Open Food Facts, USDA FoodData Central, fatsecret, calorizator.ru); a recipe page that states nutrition per 100 g (dishes).
4. Values per 100 g. If the page gives them per serving with the serving's grams, convert. Energy in kcal, not kJ.
5. found = false and all values null when no page gives reliable numbers for this exact food. Never fill values from memory: every number must come from the page in source_url.
6. source_url: the exact address of the page the numbers came from; source_name: the site's short name (e.g. "fddb.info").`;

const nullableNumber = { type: ['number', 'null'] };

export const searchSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['foods'],
  properties: {
    foods: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['n', 'found', 'kcal', 'protein_g', 'fat_g', 'carbs_g', 'fiber_g', 'source_name', 'source_url'],
        properties: {
          n: { type: 'integer' },
          found: { type: 'boolean' },
          kcal: nullableNumber,
          protein_g: nullableNumber,
          fat_g: nullableNumber,
          carbs_g: nullableNumber,
          fiber_g: nullableNumber,
          source_name: { type: ['string', 'null'] },
          source_url: { type: ['string', 'null'] }
        }
      }
    }
  }
};

export interface SearchAnswer {
  foods: { n: number; found: boolean; kcal: number | null; protein_g: number | null; fat_g: number | null; carbs_g: number | null; fiber_g: number | null; source_name: string | null; source_url: string | null }[];
}

/** The foods to look up, as numbered lines: n is the food's index + 1 in the model's list. */
export function searchInput(foods: IntermediateFood[], indexes: number[]): string {
  return indexes
    .map(i => {
      const f = foods[i];
      const brand = [f.brand, f.product_name].filter(Boolean).join(' ');
      return `${i + 1}. ${f.name}${brand ? ` (${brand})` : ''} · search: ${f.search_query}`;
    })
    .join('\n');
}

const host = (url: string) => {
  try {
    return new URL(url).hostname.replace(/^www\./, '').toLowerCase();
  } catch {
    return '';
  }
};

/** Every page address the search turned up: the sources of each search call and the citations in the answer. */
export function searchedUrls(output: unknown): string[] {
  const urls: string[] = [];
  for (const o of (output as { type?: string; action?: { sources?: { url?: string }[] }; content?: { annotations?: { url?: string }[] }[] }[]) ?? []) {
    if (o.type === 'web_search_call') for (const s of o.action?.sources ?? []) if (s.url) urls.push(s.url);
    if (o.type === 'message') for (const c of o.content ?? []) for (const a of c.annotations ?? []) if (a.url) urls.push(a.url);
  }
  return urls;
}

/**
 * The usable finds by food index. A find counts only if its page's site came up in the search (so the
 * numbers weren't made up) and the values pass the label check (macros add up, kJ caught).
 */
export function webFinds(answer: SearchAnswer | null, urls: string[], foodCount: number): Map<number, WebFind> {
  const seen = new Set(urls.map(host).filter(Boolean));
  const finds = new Map<number, WebFind>();
  for (const f of answer?.foods ?? []) {
    const i = f.n - 1;
    if (!f.found || !Number.isInteger(f.n) || i < 0 || i >= foodCount || !f.source_url) continue;
    const site = host(f.source_url);
    if (!site || !seen.has(site)) continue;
    const checked = packagePer100({
      source_image_ids: [],
      brand: null,
      product_name: null,
      package_size_g: null,
      serving_size_g: null,
      kcal_per_100g: f.kcal,
      protein_g_per_100g: f.protein_g,
      fat_g_per_100g: f.fat_g,
      carbs_g_per_100g: f.carbs_g,
      fiber_g_per_100g: f.fiber_g
    });
    if (!checked) continue;
    finds.set(i, { per100: checked.per100, source_name: (f.source_name || site).slice(0, 40), source_url: f.source_url.slice(0, 500) });
  }
  return finds;
}
