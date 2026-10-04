// Shared between the browser and the /api functions. No secrets here.

export const AMOUNT_SOURCES = ['user_exact', 'user_estimate', 'visual_estimate'] as const;
export type AmountSource = (typeof AMOUNT_SOURCES)[number];

export const NUTRITION_SOURCES = ['package', 'product_db', 'generic_db', 'llm_estimate'] as const;
export type NutritionSource = (typeof NUTRITION_SOURCES)[number];

/** Nutrients per 100 g. fiber is null when unknown. */
export interface Per100 {
  kcal: number;
  protein_g: number;
  fat_g: number;
  carbs_g: number;
  fiber_g: number | null;
}

export interface Nutrients extends Per100 {}

// ── Request: browser → /api/recognize ───────────────────────

export interface MealImage {
  id: string;
  /** what the user tagged it as; the model decides the real role */
  kind: 'plate' | 'label';
  /** data:image/jpeg;base64,... (resized in the browser) */
  dataUrl: string;
}

/** A product from the user's own library, already converted to per 100 g. */
export interface LibraryEntry {
  id: string;
  name: string;
  per100: Per100;
}

export interface RecognizeRequest {
  images: MealImage[];
  text: string;
  voiceTranscript: string;
  library: LibraryEntry[];
}

// ── Model output (intermediate JSON, §9 of the spec) ────────

export interface PackageData {
  source_image_ids: string[];
  brand: string | null;
  product_name: string | null;
  package_size_g: number | null;
  serving_size_g: number | null;
  kcal_per_100g: number | null;
  protein_g_per_100g: number | null;
  fat_g_per_100g: number | null;
  carbs_g_per_100g: number | null;
  fiber_g_per_100g: number | null;
}

export interface IntermediateFood {
  name: string;
  brand: string | null;
  product_name: string | null;
  amount_g: number;
  amount_source: AmountSource;
  /** how the grams were obtained, e.g. "2 scoops × 15 g (package)" */
  amount_basis: string | null;
  package_data: PackageData | null;
  library_product_id: string | null;
  generic_food_id: string | null;
  /** model's own per-100 g guess; used only when nothing better exists (llm_estimate) */
  estimate_per_100g: Per100;
}

export interface IntermediateMeal {
  foods: IntermediateFood[];
  unmatched_package_image_ids: string[];
  /** set when nothing edible could be identified; foods is then empty */
  failure_reason: string | null;
}

// ── Final output (§14) ──────────────────────────────────────

export interface FinalFood {
  id: string;
  name: string;
  brand: string | null;
  product_name: string | null;
  amount_g: number;
  amount_source: AmountSource;
  amount_basis: string | null;
  nutrition: Nutrients;
  nutrition_source: NutritionSource;
  per100: Per100;
  /** library product or generic food the nutrients came from */
  matched_name: string | null;
  /** set when the label's energy value didn't match its macros: 'kj' = it was kJ and got converted, 'macros' = replaced by the energy the macros imply */
  energy_fix: 'kj' | 'macros' | null;
}

export interface FinalMeal {
  foods: FinalFood[];
  total: Nutrients;
  unmatched_package_image_ids: string[];
}

export type RecognizeResponse =
  | { status: 'ok'; meal: FinalMeal }
  | { status: 'failed'; message: string };
