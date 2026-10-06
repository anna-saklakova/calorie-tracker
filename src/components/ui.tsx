import type { ReactNode } from 'react';
import { ChevronLeft } from './icons';
import { MEAL_ORDER } from '../lib/types';
import type { Day, MealType } from '../lib/types';
import { parse, shift, WD } from '../lib/dates';
import { fmt, MACRO_KEYS, sumMacros, TAG_LABEL } from '../lib/nutrition';
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

export interface SnackOption {
  id: string;
  label: string;
  kcal: number;
}

/** The snacks already logged on a day, numbered in the order they were logged. */
export const snackOptions = (day?: Day): SnackOption[] =>
  (day?.meals ?? []).filter(m => m.type === 'Snack').map((m, i) => ({ id: m.id, label: `Snack ${i + 1}`, kcal: sumMacros(m.items).kcal }));

/** How a meal pick reads in a button or toast: "Lunch", "Snack 2", "a new snack". */
export function targetName(type: MealType, snackId: string | undefined, snacks: SnackOption[]) {
  if (type !== 'Snack' || !snacks.length) return type;
  return snacks.find(s => s.id === snackId)?.label ?? 'a new snack';
}

/**
 * The meal chips, plus, when Snack is picked and the day has snacks already, a row to add to one of them
 * or start a new one. The row only appears once there's a snack to choose from.
 */
export function MealPicker({ value, snackId, snacks, onChange, small }: {
  value: MealType;
  snackId?: string;
  snacks: SnackOption[];
  onChange: (m: MealType, snackId?: string) => void;
  small?: boolean;
}) {
  const current = snacks.some(s => s.id === snackId) ? snackId : undefined;
  return (
    <>
      <MealChips small={small} value={value} onChange={m => onChange(m, m === 'Snack' ? current : undefined)} />
      {value === 'Snack' && snacks.length > 0 && (
        <div className="chips snack-chips" role="radiogroup" aria-label="Which snack">
          {snacks.map(s => (
            <button key={s.id} role="radio" aria-checked={s.id === current} className={`chip sm${s.id === current ? ' on' : ''}`} onClick={() => onChange('Snack', s.id)}>
              {s.label}
              <span className="chip-sub">{fmt(s.kcal)} kcal</span>
            </button>
          ))}
          <button role="radio" aria-checked={!current} className={`chip sm${!current ? ' on' : ''}`} onClick={() => onChange('Snack', undefined)}>
            + New snack
          </button>
        </div>
      )}
    </>
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
  /** the goal on its own lines, under the actual values (Week) */
  goal?: string;
  tag: BalanceTag;
  /** replaces the tag's standard wording */
  tagLabel?: string;
  /** the other side of a card that flips over: grams eaten and the goal in grams */
  back?: { g: number; sub: string };
}

export type MacroSide = 'pct' | 'g';

function MacroFace({ k, d, side, showTags, className = '' }: { k: MacroKey; d: MacroCardData; side: MacroSide; showTags: boolean; className?: string }) {
  const g = side === 'g' && d.back;
  return (
    <div className={`macro ${showTags ? d.tag : 'none'} ${className}`}>
      <div className="macro-name">{MACRO_NAME[k]}</div>
      <div className="macro-val">
        {g ? d.back!.g : d.pct}
        <small>{g ? ' g' : '%'}</small>
      </div>
      <div className="macro-sub">{g ? d.back!.sub : d.sub}</div>
      {d.goal && (
        <div className="macro-goal">
          <span>Goal</span>
          {d.goal}
        </div>
      )}
      {showTags && <div className={`tag ${d.tag}`}>{d.tagLabel ?? TAG_LABEL[d.tag]}</div>}
    </div>
  );
}

/**
 * The three macro cards. With `sides` and `onFlip`, a card turns over on tap between the share of
 * calories (%) and the grams, each against its goal.
 */
export function MacroCards({ data, showTags, sides, onFlip }: {
  data: Record<MacroKey, MacroCardData>;
  showTags: boolean;
  sides?: Record<MacroKey, MacroSide>;
  onFlip?: (k: MacroKey) => void;
}) {
  return (
    <div className="macros">
      {MACRO_KEYS.map(k => {
        const d = data[k];
        if (!sides || !onFlip || !d.back) return <MacroFace key={k} k={k} d={d} side="pct" showTags={showTags} />;
        const side = sides[k];
        return (
          <button
            key={k}
            className={`macro-flip${side === 'g' ? ' flipped' : ''}`}
            onClick={() => onFlip(k)}
            aria-label={`${MACRO_NAME[k]}: ${side === 'g' ? `${d.back.g} g, ${d.back.sub}` : `${d.pct}%, ${d.sub}`}. Tap to show ${side === 'g' ? 'percent' : 'grams'}`}
          >
            <span className="macro-inner">
              <MacroFace k={k} d={d} side="pct" showTags={showTags} className="face" />
              <MacroFace k={k} d={d} side="g" showTags={showTags} className="face face-g" />
            </span>
          </button>
        );
      })}
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
