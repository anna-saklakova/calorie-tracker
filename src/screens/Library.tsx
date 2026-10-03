import { ChevronLeft, SearchIcon, Star } from '../components/icons';
import type { Product } from '../lib/types';

interface Props {
  library: Product[];
  query: string;
  setQuery: (q: string) => void;
  picking: boolean;
  onBack: () => void;
  onNew: () => void;
  onOpen: (p: Product) => void;
  onToggleFav: (p: Product) => void;
}

export const productMeta = (p: Product) =>
  `${p.basis === '100' ? 'per 100 g' : `per portion · ${p.portion} g`} · ${p.kcal} kcal · P ${p.p} F ${p.f} C ${p.c}`;

export function Library({ library, query, setQuery, picking, onBack, onNew, onOpen, onToggleFav }: Props) {
  const q = query.trim().toLowerCase();
  const rows = [...library].sort((a, b) => +b.fav - +a.fav || a.name.localeCompare(b.name)).filter(p => !q || p.name.toLowerCase().includes(q));

  return (
    <div className="screen fade">
      <div className="head">
        {picking && (
          <button className="back" style={{ padding: '0 2px' }} onClick={onBack}>
            <ChevronLeft small />
            Back
          </button>
        )}
        <span className="screen-title">{picking ? 'Pick a product' : 'Library'}</span>
        <button onClick={onNew} style={{ height: 36, padding: '0 14px', borderRadius: 999, border: 'none', background: 'var(--ink)', color: '#fff', fontSize: 13, fontWeight: 600 }}>
          New
        </button>
      </div>
      <div style={{ padding: '16px 20px 0' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, background: '#fff', borderRadius: 14, height: 48, padding: '0 14px' }}>
          <SearchIcon />
          <input type="search" value={query} onChange={e => setQuery(e.target.value)} placeholder="Search your products" aria-label="Search your products" style={{ flex: 1, minWidth: 0, border: 'none', background: 'transparent', fontSize: 16 }} />
        </div>
      </div>
      <div className={`scroll ${picking ? 'pad-sub' : 'pad-tab'}`} style={{ paddingTop: 16 }}>
        {!library.length ? (
          <div style={{ textAlign: 'center', padding: '56px 24px' }}>
            <div style={{ fontSize: 18, fontWeight: 600 }}>No saved products yet</div>
            <div className="secondary" style={{ marginTop: 6, textWrap: 'pretty' }}>
              Add your usual foods with New, or switch on “Save to library” when you confirm a meal.
            </div>
          </div>
        ) : !rows.length ? (
          <div className="secondary" style={{ textAlign: 'center', padding: '48px 24px' }}>Nothing matches “{query}”. Add it with New.</div>
        ) : (
          <div className="card">
            {rows.map((p, i) => (
              <div key={p.id} style={{ display: 'flex', alignItems: 'center', borderTop: i ? '1px solid var(--line-soft)' : 'none' }}>
                <button className="row-btn" onClick={() => onOpen(p)} style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 3, padding: '14px 0 14px 16px', border: 'none', background: 'transparent', textAlign: 'left' }}>
                  <span className="row-name" style={{ maxWidth: '100%' }}>{p.name}</span>
                  <span className="num" style={{ fontSize: 13, color: 'var(--muted)' }}>{productMeta(p)}</span>
                </button>
                <button onClick={() => onToggleFav(p)} aria-label={p.fav ? 'Remove from favourites' : 'Mark as favourite'} aria-pressed={p.fav} style={{ width: 48, height: 56, border: 'none', background: 'transparent', display: 'grid', placeItems: 'center', flex: 'none' }}>
                  <Star on={p.fav} />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
