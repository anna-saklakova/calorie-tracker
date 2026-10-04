import { useEffect } from 'react';
import { MealChips, NumInput, Segmented } from './ui';
import { fmt, r1, scaleItem } from '../lib/nutrition';
import type { Item, MealType, Product } from '../lib/types';

export type SheetState =
  | { type: 'item'; date: string; mealId: string; mealType: MealType; draft: Item }
  | { type: 'product'; isNew: boolean; draft: Product; addAmount: string; addMeal: MealType };

interface Props {
  sheet: SheetState;
  setSheet: (s: SheetState) => void;
  onClose: () => void;
  onSaveItem: (s: Extract<SheetState, { type: 'item' }>) => void;
  onDeleteItem: (s: Extract<SheetState, { type: 'item' }>) => void;
  onSaveProduct: (p: Product) => void;
  onAddProduct: (p: Product, item: Item, meal: MealType) => void;
  onDeleteProduct: (p: Product) => void;
  /** for a logged item: whether a library product with its name exists, and how to add one */
  inLibrary: (name: string) => boolean;
  onAddToLibrary: (item: Item) => void;
}

type Num = number | '';
const toNum = (v: string): Num => (v === '' ? '' : +v);

/**
 * Re-expresses a product's values for the other basis, so the same food keeps the same nutrition:
 * 50 kcal per 25 g portion ⇄ 200 kcal per 100 g.
 */
export function switchBasis(p: Product, basis: Product['basis']): Product {
  const portion = +p.portion || 100;
  const k = basis === 'portion' ? portion / 100 : 100 / portion;
  const conv = (v: number | '', round: (n: number) => number) => ((v as unknown) === '' ? v : round((+v || 0) * k));
  return { ...p, basis, kcal: conv(p.kcal, Math.round) as number, p: conv(p.p, r1) as number, f: conv(p.f, r1) as number, c: conv(p.c, r1) as number };
}

/** What `amount` of a product adds up to: grams, kcal and macros. */
export function productPortion(p: Product, amount: number) {
  const per100 = p.basis === '100';
  const factor = per100 ? amount / 100 : amount;
  const grams = per100 ? amount : amount * (+p.portion || 100);
  return {
    grams: Math.round(grams),
    kcal: Math.round((+p.kcal || 0) * factor),
    p: r1((+p.p || 0) * factor),
    f: r1((+p.f || 0) * factor),
    c: r1((+p.c || 0) * factor),
    portions: per100 ? undefined : amount
  };
}

export function Sheet({ sheet, setSheet, onClose, onSaveItem, onDeleteItem, onSaveProduct, onAddProduct, onDeleteProduct, inLibrary, onAddToLibrary }: Props) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const isItem = sheet.type === 'item';
  const d = sheet.draft;
  const setDraft = (patch: Partial<Item & Product>) => setSheet({ ...sheet, draft: { ...sheet.draft, ...patch } } as SheetState);

  const macroFields: ['kcal' | 'p' | 'f' | 'c', string, boolean][] = [['kcal', 'kcal', true], ['p', 'Protein', false], ['f', 'Fat', false], ['c', 'Carbs', false]];

  let product: { per100: boolean; addAmt: number; add: ReturnType<typeof productPortion> } | null = null;
  if (sheet.type === 'product') {
    const addAmt = +sheet.addAmount || 0;
    product = { per100: sheet.draft.basis === '100', addAmt, add: productPortion(sheet.draft, addAmt) };
  }

  const title = isItem ? sheet.mealType : sheet.isNew ? 'New product' : 'Product';
  const canDelete = isItem || !sheet.isNew;

  const primary = () => {
    if (sheet.type === 'item') return onSaveItem(sheet);
    const p = sheet.draft;
    if (!p.name.trim()) return;
    const clean: Product = { ...p, name: p.name.trim(), kcal: +p.kcal || 0, p: +p.p || 0, f: +p.f || 0, c: +p.c || 0, portion: +p.portion || 100 };
    if (sheet.isNew) return onSaveProduct(clean);
    const a = productPortion(clean, +sheet.addAmount || 0);
    onAddProduct(clean, { id: '', name: clean.name, amount: a.grams, kcal: a.kcal, p: a.p, f: a.f, c: a.c, portions: a.portions }, sheet.addMeal);
  };

  return (
    <>
      <div className="scrim" onClick={onClose} />
      <div className="sheet" role="dialog" aria-modal="true" aria-label={title}>
        <div className="grabber" />
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span className="label" style={{ padding: 0 }}>{title}</span>
          {canDelete && (
            <button className="btn-delete" onClick={() => (sheet.type === 'item' ? onDeleteItem(sheet) : onDeleteProduct(sheet.draft))}>
              Delete
            </button>
          )}
        </div>
        <div style={{ marginTop: 10, background: '#fff', borderRadius: 20, padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 12 }}>
          <input value={d.name} onChange={e => setDraft({ name: e.target.value })} placeholder="Name" aria-label="Name" className="input lg" style={{ fontWeight: 600 }} />
          {sheet.type === 'product' && (
            <>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                <span style={{ fontSize: 13, color: 'var(--muted)' }}>Values per</span>
                <Segmented
                  small
                  value={sheet.draft.basis}
                  options={[['100', '100 g'], ['portion', 'Portion']]}
                  onChange={b => b !== sheet.draft.basis && setSheet({ ...sheet, draft: switchBasis(sheet.draft, b), addAmount: b === '100' ? '100' : '1' })}
                />
              </div>
              {sheet.draft.basis === 'portion' && (
                <label style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                  <span style={{ fontSize: 13, color: 'var(--muted)' }}>One portion is</span>
                  <span className="input-wrap" style={{ height: 40 }}>
                    <NumInput value={sheet.draft.portion} onChange={v => setDraft({ portion: toNum(v) as number })} style={{ width: 56, fontSize: 15, fontWeight: 600, textAlign: 'right' }} />
                    <span className="unit">g</span>
                  </span>
                </label>
              )}
            </>
          )}
          <div style={{ display: 'grid', gridTemplateColumns: `repeat(${isItem ? 5 : 4},1fr)`, gap: 6 }}>
            {sheet.type === 'item' && (
              <label className="field">
                <span>Amount g</span>
                <NumInput
                  value={sheet.draft.amount}
                  onChange={v => setSheet({ ...sheet, draft: scaleItem(sheet.draft, v) })}
                  className="input strong"
                />
              </label>
            )}
            {macroFields.map(([k, label, strong]) => (
              <label key={k} className="field">
                <span>{label}</span>
                <NumInput value={d[k]} onChange={v => setDraft({ [k]: toNum(v) } as Partial<Item>)} className={`input${strong ? ' strong' : ''}`} />
              </label>
            ))}
          </div>
        </div>

        {sheet.type === 'product' && !sheet.isNew && product && (
          <>
            <div className="label" style={{ marginTop: 18 }}>Add to a meal</div>
            <div style={{ marginTop: 10, background: '#fff', borderRadius: 20, padding: '14px 16px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <div className="input-wrap">
                  <NumInput value={sheet.addAmount} onChange={v => setSheet({ ...sheet, addAmount: v })} ariaLabel="Amount to add" style={{ width: 56, fontSize: 16, fontWeight: 600, textAlign: 'right' }} />
                  <span className="unit">{product.per100 ? 'g' : product.addAmt === 1 ? 'portion' : 'portions'}</span>
                </div>
                <span className="num" style={{ fontSize: 14, color: 'var(--muted)' }}>= {fmt(product.add.kcal)} kcal</span>
              </div>
              <div style={{ marginTop: 12 }}>
                <MealChips small value={sheet.addMeal} onChange={m => setSheet({ ...sheet, addMeal: m })} />
              </div>
            </div>
          </>
        )}
        <button className="btn-primary" style={{ marginTop: 14 }} onClick={primary} disabled={!d.name.trim()}>
          {isItem ? 'Save changes' : sheet.isNew ? 'Save product' : `Add to ${sheet.addMeal}`}
        </button>
        {sheet.type === 'item' &&
          (inLibrary(sheet.draft.name) ? (
            <div style={{ marginTop: 8, height: 48, display: 'grid', placeItems: 'center', fontSize: 14, color: 'var(--muted)' }}>In your library</div>
          ) : (
            <button className="btn-ghost" style={{ marginTop: 8 }} disabled={!d.name.trim() || !(+sheet.draft.amount > 0)} onClick={() => onAddToLibrary(sheet.draft)}>
              Add to library
            </button>
          ))}
        {sheet.type === 'product' && !sheet.isNew && (
          <button
            className="btn-ghost"
            style={{ marginTop: 8 }}
            disabled={!d.name.trim()}
            onClick={() => onSaveProduct({ ...sheet.draft, name: sheet.draft.name.trim(), kcal: +sheet.draft.kcal || 0, p: +sheet.draft.p || 0, f: +sheet.draft.f || 0, c: +sheet.draft.c || 0, portion: +sheet.draft.portion || 100 })}
          >
            Save changes only
          </button>
        )}
      </div>
    </>
  );
}
