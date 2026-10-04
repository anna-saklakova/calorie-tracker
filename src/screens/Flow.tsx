import { useEffect, useState } from 'react';
import { Exclaim } from '../components/icons';
import { MealChips, NumInput, SubHeader, Switch } from '../components/ui';
import { ANALYZE_CONTEXT, ANALYZE_STEPS } from '../lib/recognize';
import { fmt, sumMacros } from '../lib/nutrition';
import type { MealType, ReviewItem } from '../lib/types';

// ── Recognizing ─────────────────────────────────────────────

export function Analyzing({ onCancel }: { onCancel: () => void }) {
  const [step, setStep] = useState(0);
  useEffect(() => {
    const iv = setInterval(() => setStep(s => (s + 1) % ANALYZE_STEPS.length), 900);
    return () => clearInterval(iv);
  }, []);
  return (
    <div className="center-state" role="status" aria-live="polite">
      <div style={{ position: 'relative', width: 96, height: 96, display: 'grid', placeItems: 'center' }}>
        <div style={{ position: 'absolute', inset: 0, borderRadius: '50%', background: 'var(--rose)', animation: 'ctPulse 1.6s ease-in-out infinite' }} />
        <div style={{ position: 'absolute', inset: 14, borderRadius: '50%', border: '3px solid transparent', borderTopColor: 'var(--accent)', animation: 'ctSpin 1.1s linear infinite' }} />
      </div>
      <div className="state-title" style={{ marginTop: 32 }}>Looking at your meal</div>
      <div className="state-body" style={{ minHeight: 44 }}>{ANALYZE_STEPS[step]}</div>
      <div style={{ fontSize: 13, color: 'var(--faint)', marginTop: 28, textWrap: 'pretty' }}>{ANALYZE_CONTEXT}</div>
      <button onClick={onCancel} style={{ marginTop: 40, height: 44, padding: '0 20px', borderRadius: 999, border: 'none', background: 'transparent', fontSize: 15, color: 'var(--muted)' }}>
        Cancel
      </button>
    </div>
  );
}

// ── Failed ──────────────────────────────────────────────────

export function Failed({ message, onRetry, onManual }: { message: string; onRetry: () => void; onManual: () => void }) {
  return (
    <div className="center-state" style={{ padding: '0 36px' }}>
      <div style={{ width: 72, height: 72, borderRadius: '50%', background: 'var(--surface-2)', display: 'grid', placeItems: 'center' }}>
        <Exclaim />
      </div>
      <div className="state-title" style={{ marginTop: 28 }}>Couldn't make out the food</div>
      <div className="state-body">{message}</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, width: '100%', marginTop: 36 }}>
        <button className="btn-primary" onClick={onRetry}>Retake or add a note</button>
        <button className="btn-ghost" onClick={onManual}>Add by hand instead</button>
      </div>
    </div>
  );
}

// ── Review & confirm ────────────────────────────────────────

const HINT_STYLE: Record<ReviewItem['src'], [string, string]> = {
  estimated: ['var(--est-soft)', 'var(--est-ink)'],
  label: ['var(--rose)', 'var(--rose-ink)'],
  library: ['var(--surface-2)', '#5E584F'],
  note: ['var(--sage)', 'var(--accent-ink)']
};

interface ReviewProps {
  subtitle: string;
  items: ReviewItem[];
  notes: string[];
  onBack: () => void;
  onChange: (id: string, patch: (it: ReviewItem) => ReviewItem) => void;
  onAmount: (id: string, v: string) => void;
  onRemove: (id: string) => void;
  onConfirm: () => void;
  onReRun: (note: string) => void;
}

export function Review({ subtitle, items, notes, onBack, onChange, onAmount, onRemove, onConfirm, onReRun }: ReviewProps) {
  const [noteOpen, setNoteOpen] = useState(false);
  const [note, setNote] = useState('');
  const tot = sumMacros(items);
  const setMacro = (it: ReviewItem, k: 'kcal' | 'p' | 'f' | 'c', v: string) =>
    onChange(it.id, x => ({ ...x, [k]: v === '' ? ('' as unknown as number) : +v, per: { ...x.per, [k]: (+v || 0) / (x.amount || 1) } }));

  return (
    <div className="screen rise">
      <SubHeader title="Review" onBack={onBack} />
      <div className="scroll pad-sub">
        <div className="secondary" style={{ padding: '0 4px' }}>{subtitle}</div>
        {notes.length > 0 && (
          <div style={{ marginTop: 14, background: 'var(--est-soft)', borderRadius: 16, padding: '12px 14px', fontSize: 14, color: 'var(--est-text)', textWrap: 'pretty', display: 'flex', flexDirection: 'column', gap: 4 }}>
            {notes.map(n => <div key={n}>{n}</div>)}
          </div>
        )}
        {!items.length && <div className="secondary" style={{ textAlign: 'center', padding: '40px 24px' }}>All items removed. Go back to add a photo or a note.</div>}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 14 }}>
          {items.map(it => {
            const est = it.amountSource ? it.amountSource === 'visual_estimate' : it.src === 'estimated';
            const [hintBg, hintInk] = HINT_STYLE[it.src];
            const amtInk = it.low ? 'var(--est)' : 'var(--ink)';
            return (
              <div key={it.id} style={{ background: '#fff', borderRadius: 20, padding: '14px 16px 12px', border: `1px solid ${it.low ? 'var(--est-border)' : 'transparent'}` }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
                  <input
                    value={it.name}
                    aria-label="Item name"
                    onChange={e => onChange(it.id, x => ({ ...x, name: e.target.value }))}
                    className="review-name"
                    style={{ flex: 1, minWidth: 0, border: 'none', background: 'transparent', fontSize: 17, fontWeight: 600, padding: 0, borderBottom: '1px dashed transparent' }}
                  />
                  <button onClick={() => onRemove(it.id)} aria-label={`Remove ${it.name}`} style={{ width: 32, height: 32, borderRadius: '50%', border: 'none', background: 'var(--bg)', color: 'var(--muted)', fontSize: 16, lineHeight: 1, display: 'grid', placeItems: 'center', flex: 'none' }}>
                    ×
                  </button>
                </div>
                <div style={{ display: 'inline-block', maxWidth: '100%', marginTop: 6, height: 22, lineHeight: '22px', padding: '0 9px', borderRadius: 999, background: hintBg, color: hintInk, fontSize: 12, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{it.hint}</div>
                {it.amountNote && <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 6 }}>Amount: {it.amountNote}</div>}
                {it.low && <div style={{ fontSize: 12, color: 'var(--est)', marginTop: 6 }}>{it.lowNote}</div>}
                <div style={{ display: 'grid', gridTemplateColumns: '1.15fr 1fr 1fr 1fr 1fr', gap: 4, marginTop: 12 }}>
                  <label className="field" style={{ gap: 3 }}>
                    <span>Amount</span>
                    <div style={{ display: 'flex', alignItems: 'center', background: 'var(--bg)', borderRadius: 10, height: 40, padding: '0 5px' }}>
                      {est && <span style={{ fontSize: 14, color: amtInk, fontWeight: 600 }}>~</span>}
                      <NumInput value={it.amount} onChange={v => onAmount(it.id, v)} style={{ width: '100%', minWidth: 0, border: 'none', background: 'transparent', fontSize: 14, fontWeight: 600, color: amtInk, padding: 0 }} className="num" />
                      <span style={{ fontSize: 12, color: 'var(--muted)' }}>g</span>
                    </div>
                  </label>
                  {(['kcal', 'p', 'f', 'c'] as const).map(k => (
                    <label key={k} className="field" style={{ gap: 3 }}>
                      <span>{k === 'kcal' ? 'kcal' : k === 'p' ? 'Protein' : k === 'f' ? 'Fat' : 'Carbs'}</span>
                      <NumInput
                        value={it[k]}
                        onChange={v => setMacro(it, k, v)}
                        className="input num"
                        style={{ borderRadius: 10, height: 40, padding: '0 4px', fontSize: 14, fontWeight: k === 'kcal' ? 600 : 400 }}
                      />
                    </label>
                  ))}
                </div>
                <div style={{ marginTop: 12 }}>
                  <Switch on={it.save} onToggle={() => onChange(it.id, x => ({ ...x, save: !x.save }))}>
                    {it.save ? 'Will be saved to library' : 'Save to library'}
                  </Switch>
                </div>
              </div>
            );
          })}
        </div>
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', padding: '22px 4px 4px' }}>
          <span style={{ fontSize: 15, fontWeight: 600 }}>Meal total</span>
          <span className="num" style={{ fontSize: 22, fontWeight: 600 }}>
            {fmt(tot.kcal)} <span style={{ fontSize: 13, color: 'var(--muted)', fontWeight: 500 }}>kcal</span>
          </span>
        </div>
        <div style={{ fontSize: 13, color: 'var(--muted)', textAlign: 'right', padding: '0 4px' }}>
          Protein {Math.round(tot.p)} g · Fat {Math.round(tot.f)} g · Carbs {Math.round(tot.c)} g
        </div>
        {noteOpen && (
          <div style={{ marginTop: 18, background: '#fff', borderRadius: 20, padding: 14 }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--muted)' }}>Correction</div>
            <textarea
              value={note}
              autoFocus
              onChange={e => setNote(e.target.value)}
              rows={2}
              aria-label="Correction"
              placeholder="e.g. the meat was 200 g, not 110"
              style={{ marginTop: 6, width: '100%', border: 'none', background: 'transparent', resize: 'none', fontSize: 16, lineHeight: 1.45, display: 'block' }}
            />
            <button className="btn-small-dark" style={{ marginTop: 8 }} disabled={!note.trim()} onClick={() => onReRun(note.trim())}>
              Re-run with note
            </button>
          </div>
        )}
      </div>
      <div className="footer">
        <button className="btn-primary" disabled={!items.length} onClick={onConfirm}>Confirm & save</button>
        <button className="btn-ghost" onClick={() => setNoteOpen(o => !o)}>{noteOpen ? 'Cancel note' : 'Add a note & re-run'}</button>
      </div>
    </div>
  );
}

// ── Add by hand ─────────────────────────────────────────────

export interface ManualForm {
  name: string;
  amount: string;
  kcal: string;
  p: string;
  f: string;
  c: string;
}
export const emptyManual = (): ManualForm => ({ name: '', amount: '', kcal: '', p: '', f: '', c: '' });

interface ManualProps {
  form: ManualForm;
  setForm: (f: ManualForm) => void;
  meal: MealType;
  setMeal: (m: MealType) => void;
  libCount: number;
  onBack: () => void;
  onPickLibrary: () => void;
  onSave: () => void;
}

export function Manual({ form, setForm, meal, setMeal, libCount, onBack, onPickLibrary, onSave }: ManualProps) {
  const invalid = !form.name.trim() || form.kcal === '' || !(+form.kcal >= 0);
  const set = (k: keyof ManualForm) => (v: string) => setForm({ ...form, [k]: v });
  const fields: [keyof ManualForm, string, boolean][] = [['amount', 'Amount g', true], ['kcal', 'kcal', true], ['p', 'Protein', false], ['f', 'Fat', false], ['c', 'Carbs', false]];
  return (
    <div className="screen rise">
      <SubHeader title="Add by hand" onBack={onBack} />
      <div className="scroll pad-sub">
        <button onClick={onPickLibrary} style={{ width: '100%', height: 52, borderRadius: 16, border: '1px solid var(--line)', background: '#fff', fontSize: 15, fontWeight: 600, color: 'var(--ink)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 16px' }}>
          <span>Pick from library</span>
          <span style={{ fontSize: 13, color: 'var(--muted)', fontWeight: 500 }}>{libCount} saved</span>
        </button>
        <div className="label" style={{ marginTop: 22 }}>Or type the numbers</div>
        <div style={{ marginTop: 10, background: '#fff', borderRadius: 20, padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 12 }}>
          <label className="field">
            <span style={{ fontSize: 12 }}>Name</span>
            <input value={form.name} onChange={e => set('name')(e.target.value)} placeholder="e.g. Rye bread, 2 slices" className="input lg" />
          </label>
          <div className="grid5">
            {fields.map(([k, label, strong]) => (
              <label key={k} className="field">
                <span>{label}</span>
                <NumInput value={form[k]} onChange={set(k)} className={`input${strong ? ' strong' : ''}`} />
              </label>
            ))}
          </div>
        </div>
        <div className="label" style={{ marginTop: 22 }}>Meal</div>
        <div style={{ marginTop: 10 }}>
          <MealChips value={meal} onChange={setMeal} />
        </div>
      </div>
      <div className="footer">
        <button className="btn-primary" disabled={invalid} onClick={onSave}>Add to {meal}</button>
      </div>
    </div>
  );
}
