// Shared between the browser and the /api functions. No secrets here.

export const AMOUNT_SOURCES = ['user_exact', 'user_estimate', 'visual_estimate'] as const;
export type AmountSource = (typeof AMOUNT_SOURCES)[number];

export const NUTRITION_SOURCES = ['package', 'product_db', 'web', 'llm_estimate'] as const;
/** 'generic_db' only on items saved before the generic food list was dropped (0.10) */
export type NutritionSource = (typeof NUTRITION_SOURCES)[number] | 'generic_db';

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

/**
 * One row of the Review screen as the user left it, sent with a re-run so their edits are kept.
 * Nutrients are for the whole amount; null where the user left the field empty (a food added by hand).
 */
export interface CheckedItem {
  name: string;
  amount_g: number | null;
  kcal: number | null;
  protein_g: number | null;
  fat_g: number | null;
  carbs_g: number | null;
}

export interface RecognizeRequest {
  images: MealImage[];
  text: string;
  voiceTranscript: string;
  library: LibraryEntry[];
  /** a re-run from the Review screen: the list as the user checked and edited it */
  checked?: CheckedItem[];
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
  /** what to look up on the web for the nutrients; null when a label or a library product covers the food */
  search_query: string | null;
  /** model's own per-100 g guess; used only when nothing better exists (llm_estimate) */
  estimate_per_100g: Per100;
  /** on a re-run: the number (1-based) of the checked-list row this food is, null for a new food */
  checked_item: number | null;
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
  /** library product the nutrients came from */
  matched_name: string | null;
  /** web page the nutrients came from (nutrition_source 'web') */
  source_name: string | null;
  source_url: string | null;
  /** set when the label's energy value didn't match its macros: 'kj' = it was kJ and got converted, 'macros' = replaced by the energy the macros imply */
  energy_fix: 'kj' | 'macros' | null;
  /** on a re-run: index (0-based) of the checked-list row this food is, null for a new one */
  checked_index: number | null;
}

export interface FinalMeal {
  foods: FinalFood[];
  total: Nutrients;
  unmatched_package_image_ids: string[];
  /** the web lookup was needed but didn't answer: those foods fell back to the model's estimate */
  search_failed?: boolean;
}

/** Nutrients found on the web for one food (the index into the model's foods list). */
export interface WebFind {
  per100: Per100;
  source_name: string;
  source_url: string;
}

/** Why recognition failed: `message` for the user, `code` a short reason for reports and logs. */
export interface RecognizeFailure {
  status: 'failed';
  message: string;
  code: string;
}

/** What the model was given and answered, sent back so the app can keep it as a training example. */
export interface RecognizeTrace {
  model: string;
  /** sha256 of the system prompt, so examples can be tied to the prompt they were made with */
  prompt_sha256: string;
  /** the deployed commit, when known */
  commit: string | null;
  /** the text part of the user message (note, transcript, library, photo list); the photos follow it */
  input_text: string;
  /** the model's own JSON answer, before nutrition sources were picked and the arithmetic done in code */
  model_output: IntermediateMeal;
  /** what the web lookup answered (null when it wasn't needed or failed) */
  search_output?: unknown;
}

export type RecognizeResponse = { status: 'ok'; meal: FinalMeal; trace?: RecognizeTrace; seconds?: number } | RecognizeFailure;
