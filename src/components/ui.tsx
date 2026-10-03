import type { ReactNode } from 'react';
import { ChevronLeft } from './icons';
import { MEAL_ORDER } from '../lib/types';
import type { MealType } from '../lib/types';
import { parse, shift, WD } from '../lib/dates';
import { MACRO_KEYS, TAG_LABEL } from '../lib/nutrition';
import type { BalanceTag, MacroKey } from '../lib/nutrition';

export function SubHeader({ title, onBack }: { title: string; onBack: () => void }) {
  return (
    <div className="head sub">
      <button className="back" onClick={onBack}>
        <ChevronLeft small />
        Back
      </button>
      <span className="head-title">{title}</span>
      <span className="head-spacer" />
    </div>
  );
}

export function MealChips({ value, onChange, small }: { value: MealType; onChange: (m: MealType) => void; small?: boolean }) {
  return (
    <div className="chips" role="radiogroup" aria-label="Meal">
      {MEAL_ORDER.map(t => (
        <button key={t} role="radio" aria-checked={t === value} className={`chip${small ? ' sm' : ''}${t === value ? ' on' : ''}`} onClick={() => onChange(t)}>
          {t}
        </button>
      ))}
    </div>
  );
}

/** Last 7 days ending today. */
export function DateStrip({ today, value, onPick, style }: { today: string; value: string; onPick: (d: string) => void; style?: React.CSSProperties }) {
  const days = Array.from({ length: 7 }, (_, i) => shift(today, i - 6));
  return (
    <div className="strip" style={style}>
      {days.map(d => {
        const x = parse(d);
        return (
          <button key={d} className={`strip-day${d === value ? ' on' : ''}`} onClick={() => onPick(d)}>
            <span>{WD[x.getDay()]}</span>
            <span>{x.getDate()}</span>
          </button>
        );
      })}
    </div>
  );
}

export function Switch({ on, onToggle, children }: { on: boolean; onToggle: () => void; children: ReactNode }) {
  return (
    <button className="switch-row" role="switch" aria-checked={on} onClick={onToggle}>
      <span className={`switch${on ? ' on' : ''}`} />
      {children}
    </button>
  );
}

export function Segmented<T extends string>({ value, options, onChange, small }: { value: T; options: [T, string][]; onChange: (v: T) => void; small?: boolean }) {
  return (
    <div className={`seg${small ? ' sm' : ''}`}>
      {options.map(([v, label]) => (
        <button key={v} className={v === value ? 'on' : ''} aria-pressed={v === value} onClick={() => onChange(v)}>
          {label}
        </button>
      ))}
    </div>
  );
}

const MACRO_NAME: Record<MacroKey, string> = { p: 'Protein', f: 'Fat', c: 'Carbs' };

export interface MacroCardData {
  pct: number;
  sub: string;
  tag: BalanceTag;
}

export function MacroCards({ data, showTags }: { data: Record<MacroKey, MacroCardData>; showTags: boolean }) {
  return (
    <div className="macros">
      {MACRO_KEYS.map(k => (
        <div key={k} className={`macro ${k}`}>
          <div className="macro-name">{MACRO_NAME[k]}</div>
          <div className="macro-val">
            {data[k].pct}
            <small>%</small>
          </div>
          <div className="macro-sub">{data[k].sub}</div>
          {showTags && <div className={`tag ${data[k].tag}`}>{TAG_LABEL[data[k].tag]}</div>}
        </div>
      ))}
    </div>
  );
}

/** Number input that keeps '' while the field is being edited. */
export function NumInput({ value, onChange, className, style, ariaLabel, placeholder }: {
  value: number | string;
  onChange: (v: string) => void;
  className?: string;
  style?: React.CSSProperties;
  ariaLabel?: string;
  placeholder?: string;
}) {
  return (
    <input
      type="number"
      inputMode="decimal"
      className={className}
      style={style}
      aria-label={ariaLabel}
      placeholder={placeholder}
      value={value}
      onChange={e => onChange(e.target.value)}
      onFocus={e => e.target.select()}
    />
  );
}
