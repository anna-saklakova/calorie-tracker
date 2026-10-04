import { supabase } from './supabase';
import { defaultSettings } from './types';
import type { Day, Product, Settings } from './types';

// Database access for the user's data (see supabase/migrations/20261006000000_per_record_storage.sql):
// one row per day (user_days) and per library product (user_products); user_data holds the settings.

const PAGE = 1000; // Supabase returns at most 1000 rows per request

export interface DayRow { date: string; data: Day; updated_at: number; changed_at: string }
export interface ProductRow { id: string; data: Product; updated_at: number; changed_at: string }

/** What the old one-document format held, if the settings row still has it. */
export interface LegacyDoc { days: Record<string, Day>; library: Product[] }

const db = () => {
  if (!supabase) throw new Error('Sign-in is not configured');
  return supabase;
};

/** All rows of a table for this user, changed after `since` (all when null), page by page. */
async function fetchRows<T>(table: 'user_days' | 'user_products', key: 'date' | 'id', userId: string, since: string | null): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; ; from += PAGE) {
    let q = db().from(table).select(`${key}, data, updated_at, changed_at`).eq('user_id', userId);
    if (since) q = q.gt('changed_at', since);
    const { data, error } = await q.order(key).range(from, from + PAGE - 1);
    if (error) throw error;
    rows.push(...((data ?? []) as T[]));
    if (!data || data.length < PAGE) return rows;
  }
}

export const fetchDays = (userId: string, since: string | null) => fetchRows<DayRow>('user_days', 'date', userId, since);
export const fetchProducts = (userId: string, since: string | null) => fetchRows<ProductRow>('user_products', 'id', userId, since);

/** The settings row; also returns old-format days/library if they are still in it. */
export async function fetchSettings(userId: string): Promise<{ settings: Settings | null; legacy: LegacyDoc | null }> {
  const { data: row, error } = await db().from('user_data').select('data').eq('user_id', userId).maybeSingle();
  if (error) throw error;
  const d = row?.data as { settings?: Partial<Settings>; days?: Record<string, Day>; library?: Product[] } | undefined;
  if (!d) return { settings: null, legacy: null };
  const settings = d.settings ? { ...defaultSettings(), ...d.settings } : null;
  const legacy = d.days || d.library ? { days: d.days ?? {}, library: d.library ?? [] } : null;
  return { settings, legacy };
}

/** Writes changed records; the database keeps whichever version of each record is newer. */
export async function saveRecords(days: [string, Day][], products: Product[], settings: Settings | null) {
  if (!days.length && !products.length && !settings) return;
  const { error } = await db().rpc('save_records', {
    p_days: days.map(([date, day]) => ({ date, data: day, updated_at: Math.round(day.updatedAt) })),
    p_products: products.map(p => ({ id: p.id, data: p, updated_at: Math.round(p.updatedAt) })),
    p_settings: settings
  });
  if (error) throw error;
}
