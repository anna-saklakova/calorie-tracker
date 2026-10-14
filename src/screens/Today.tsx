import { useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, SettingsIcon } from '../components/icons';
import { DateStrip, NumInput } from '../components/ui';
import { dayLabel, shift } from '../lib/dates';
import { amountLabel, dayTotals, fmt, goalsOn, kcalParts, mealLabels, PACE_LABEL, proteinGoal, proteinPace } from '../lib/nutrition';
import type { PaceStatus, ProteinGoal } from '../lib/nutrition';
import { setWaist, setWeighIn } from '../lib/store';
import type { Data, Item, Meal } from '../lib/types';
import { daysSinceWeighIn, measures, WEIGH_EVERY, weighIns } from '../lib/weight';

interface Props {
  data: Data;
  date: string;
  today: string;
  datePick: boolean;
  setDate: (d: string) => void;
  toggleDatePick: () => void;
  openSettings: () => void;
  openItem: (meal: Meal, item: Item) => void;
  deleteItem: (meal: Meal, item: Item) => void;
}

/** Long-press (≈½ s without moving) fires `onLong` and swallows the click that follows. */
function useLongPress(onLong: () => void) {
  const st = useRef<{ t?: ReturnType<typeof setTimeout>; x: number; y: number; fired: boolean }>({ x: 0, y: 0, fired: false });
  const clear = () => clearTimeout(st.current.t);
  return {
    onPointerDown: (e: React.PointerEvent) => {
      st.current = { x: e.clientX, y: e.clientY, fired: false, t: setTimeout(() => { st.current.fired = true; navigator.vibrate?.(15); onLong(); }, 520) };
    },
    onPointerMove: (e: React.PointerEvent) => {
      if (Math.abs(e.clientX - st.current.x) > 8 || Math.abs(e.clientY - st.current.y) > 8) clear();
    },
    onPointerUp: clear,
    onPointerCancel: clear,
    onContextMenu: (e: React.MouseEvent) => e.preventDefault(),
    onClickCapture: (e: React.MouseEvent) => {
      if (st.current.fired) { e.stopPropagation(); e.preventDefault(); st.current.fired = false; }
    }
  };
}

function ItemRow({ item, units, onOpen, onLong }: { item: Item; units: Data['settings']['units']; onOpen: () => void; onLong: () => void }) {
  const lp = useLongPress(onLong);
  return (
    <button className="row" onClick={onOpen} {...lp}>
      <div style={{ minWidth: 0 }}>
        <div className="row-name">{item.name}</div>
        <div className="row-sub">{amountLabel(item, units)}</div>
      </div>
      <div className="row-kcal">{fmt(item.kcal)}</div>
    </button>
  );
}

const PACE_INK: Record<PaceStatus, string> = { none: 'var(--faint)', met: 'var(--accent)', on: 'var(--accent)', close: 'var(--est)', behind: 'var(--danger)' };

/**
 * Today's protein against its target, coloured by whether it keeps up with the calories eaten so far.
 * The bar is the target; the fill is what's eaten; the tick is where the fill "should" be by now.
 */
function ProteinPanel({ protein, pg, kcal, goal }: { protein: number; pg: ProteinGoal; kcal: number; goal: number }) {
  const pace = proteinPace(protein, pg, kcal, goal);
  const target = pg.target;
  const fill = target > 0 ? Math.min(1, protein / target) : 0;
  const tick = pace.status === 'none' || pace.status === 'met' || goal <= 0 ? null : pace.eatenShare;
  // the numbers and the bar say it all; a note only when there is nothing to measure against
  const note = target > 0 ? '' : 'No protein target set';
  return (
    <section className={`pace ${pace.status}`} aria-label={`Protein ${Math.round(protein)} of ${target} g${PACE_LABEL[pace.status] ? `, ${PACE_LABEL[pace.status].toLowerCase()}` : ''}`}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <span className="pace-name">Protein</span>
        {PACE_LABEL[pace.status] && <span className="pace-tag" style={{ color: PACE_INK[pace.status] }}>{PACE_LABEL[pace.status]}</span>}
      </div>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8, marginTop: 6 }}>
        <span style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
          <span className="pace-val">{Math.round(protein)}</span>
          <span className="pace-unit">{target > 0 ? `of ${target} g` : 'g'}</span>
        </span>
        {target > 0 && <span className="pace-left num">{pace.status !== 'met' && pace.left > 0 ? `${Math.round(pace.left)} g to go` : 'done'}</span>}
      </div>
      {target > 0 && (
        <div className="pace-track" role="progressbar" aria-valuemin={0} aria-valuemax={target} aria-valuenow={Math.round(Math.min(protein, target))}>
          <div className="pace-fill" style={{ width: `${fill * 100}%`, background: PACE_INK[pace.status] }} />
          {tick !== null && <div className="pace-tick" style={{ left: `${tick * 100}%` }} aria-hidden />}
        </div>
      )}
      {note && <div className="pace-note">{note}</div>}
    </section>
  );
}

/**
 * The weekly weigh-in. Shown on a day that has one, and on today when the last one is a week old or
 * there is none. The waist goes underneath as a quieter, optional line: same day, same conditions.
 */
function WeighInRow({ data, date }: { data: Data; date: string }) {
  const [text, setText] = useState(data.days[date]?.weight ? String(data.days[date]!.weight) : '');
  const [waist, setWaistText] = useState(data.days[date]?.waist ? String(data.days[date]!.waist) : '');
  const before = weighIns(data, date).filter(w => w.date < date).pop();
  const waistBefore = measures(data, 'waist', date).filter(w => w.date < date).pop();
  return (
    <div className="card" style={{ marginTop: 12 }}>
      <div className="row" style={{ cursor: 'default' }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 16, fontWeight: 600 }}>Weigh-in</div>
          <div className="row-sub">{before ? `Last ${before.kg.toFixed(1)} kg · same day and conditions` : 'Once a week · morning, before eating'}</div>
        </div>
        <div className="input-wrap">
          <NumInput
            value={text}
            ariaLabel="Weight in kg"
            placeholder="—"
            onChange={v => {
              setText(v);
              const kg = Math.max(0, Math.round((+v || 0) * 10) / 10);
              setWeighIn(date, kg);
            }}
            className="num"
            style={{ width: 64, fontSize: 16, fontWeight: 600, textAlign: 'right' }}
          />
          <span className="unit">kg</span>
        </div>
      </div>
      <div className="row" style={{ cursor: 'default', paddingTop: 10, paddingBottom: 10 }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--ink-2)' }}>Waist</div>
          <div className="row-sub">{waistBefore ? `Last ${waistBefore.value.toFixed(1)} cm` : 'Optional · at the navel, relaxed'}</div>
        </div>
        <div className="input-wrap" style={{ height: 36 }}>
          <NumInput
            value={waist}
            ariaLabel="Waist in cm"
            placeholder="—"
            onChange={v => {
              setWaistText(v);
              const cm = Math.max(0, Math.round((+v || 0) * 10) / 10);
              setWaist(date, cm);
            }}
            className="num"
            style={{ width: 64, fontSize: 15, fontWeight: 600, textAlign: 'right' }}
          />
          <span className="unit">cm</span>
        </div>
      </div>
    </div>
  );
}

export function Today({ data, date, today, datePick, setDate, toggleDatePick, openSettings, openItem, deleteItem }: Props) {
  // the goals that applied on this day (goal changes don't rewrite the past)
  const s = goalsOn(data.settings, date);
  const day = data.days[date];
  const meals = day?.meals ?? [];
  const tot = dayTotals(day);
  const hasGoal = s.goal > 0;
  // over the goal the ring stands for everything eaten: green up to the goal, the rest in the over colour
  const parts = kcalParts(tot.kcal, s.goal);
  const ringScale = Math.max(tot.kcal, s.goal, 1);
  const RING = 2 * Math.PI * 36;
  const greenLen = (RING * parts.within) / ringScale;
  const overLen = (RING * parts.over) / ringScale;
  const labels = mealLabels(meals);
  const since = daysSinceWeighIn(data, today);
  const due = date === today && (since === null || since >= WEIGH_EVERY);
  // a weigh-in that was missed can be added on its own day later, or today ahead of time
  const [weighOpenOn, setWeighOpenOn] = useState<string | null>(null);
  const showWeighIn = (day?.weight ?? 0) > 0 || (day?.waist ?? 0) > 0 || due || weighOpenOn === date;

  // the big number is what's left to the goal; the total goes underneath
  const left = s.goal - tot.kcal;
  const hero = hasGoal ? fmt(Math.abs(left)) : fmt(tot.kcal);
  const heroUnit = hasGoal ? (left >= 0 ? 'kcal left' : 'kcal over') : 'kcal';
  const sub = hasGoal
    ? `${left >= 0 ? 'of' : 'goal'} ${fmt(s.goal)}`
    : meals.length
      ? `${meals.length} ${meals.length === 1 ? 'meal' : 'meals'} logged`
      : '';

  return (
    <div className="screen fade">
      <div className="head">
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <button className="icon-btn" aria-label="Previous day" onClick={() => setDate(shift(date, -1))}>
            <ChevronLeft />
          </button>
          <button className="date-btn" onClick={toggleDatePick} aria-expanded={datePick}>
            {dayLabel(date, today)}
          </button>
          <button className="icon-btn" aria-label="Next day" disabled={date >= today} onClick={() => setDate(shift(date, 1))}>
            <ChevronRight />
          </button>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          {date !== today && (
            <button className="pill-btn" onClick={() => setDate(today)}>
              Today
            </button>
          )}
          <button className="icon-btn" aria-label="Settings" onClick={openSettings}>
            <SettingsIcon />
          </button>
        </div>
      </div>
      {datePick && <DateStrip today={today} value={date} onPick={setDate} style={{ padding: '12px 20px 0' }} />}

      <div className="scroll pad-tab">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '26px 0 8px' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
              <span className="hero" style={{ color: hasGoal && left < 0 ? parts.overColor : undefined }}>{hero}</span>
              <span className="hero-unit">{heroUnit}</span>
            </div>
            <div className="secondary" style={{ marginTop: 8 }}>{sub}</div>
          </div>
          {hasGoal && (
            <svg width="84" height="84" viewBox="0 0 84 84" style={{ transform: 'rotate(-90deg)', flex: 'none' }} role="img" aria-label={`${Math.round((tot.kcal / s.goal) * 100)}% of daily goal`}>
              <circle cx="42" cy="42" r="36" fill="none" stroke="var(--rose)" strokeWidth="7" />
              <circle
                cx="42" cy="42" r="36" fill="none"
                stroke="var(--accent)"
                strokeWidth="7"
                strokeLinecap="round"
                strokeDasharray={`${greenLen.toFixed(1)} 999`}
                style={{ transition: 'stroke-dasharray .6s' }}
              />
              {parts.over > 0 && (
                <circle
                  cx="42" cy="42" r="36" fill="none"
                  stroke={parts.overColor}
                  strokeWidth="7"
                  strokeLinecap="round"
                  strokeDasharray={`${overLen.toFixed(1)} 999`}
                  strokeDashoffset={(-greenLen).toFixed(1)}
                  style={{ transition: 'stroke-dasharray .6s, stroke-dashoffset .6s' }}
                />
              )}
            </svg>
          )}
        </div>

        <div style={{ marginTop: 14 }}>
          <ProteinPanel protein={tot.p} pg={proteinGoal(s)} kcal={tot.kcal} goal={s.goal} />
        </div>
        {showWeighIn && <WeighInRow key={date} data={data} date={date} />}

        {!meals.length && (
          <div style={{ marginTop: 72, textAlign: 'center', padding: '0 24px' }}>
            <div style={{ width: 56, height: 56, borderRadius: '50%', background: 'var(--surface-2)', margin: '0 auto 18px' }} />
            <div style={{ fontSize: 18, fontWeight: 600 }}>Nothing logged yet</div>
            <div className="secondary" style={{ marginTop: 6, textWrap: 'pretty' }}>Add a meal with a photo and a short note. The numbers will fill in here.</div>
          </div>
        )}

        {meals.map(m => (
          <section key={m.id} style={{ marginTop: 28 }}>
            <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', padding: '0 4px 10px' }}>
              <h2 className="label" style={{ margin: 0, padding: 0 }}>{labels[m.id]}</h2>
              <span className="num" style={{ fontSize: 13, color: 'var(--muted)' }}>{fmt(m.items.reduce((a, i) => a + (+i.kcal || 0), 0))} kcal</span>
            </div>
            <div className="card">
              {m.items.map(it => (
                <ItemRow key={it.id} item={it} units={data.settings.units} onOpen={() => openItem(m, it)} onLong={() => deleteItem(m, it)} />
              ))}
            </div>
          </section>
        ))}

        {/* not due: out of the way, under the meals */}
        {!showWeighIn && date <= today && (
          <div style={{ marginTop: 24, display: 'flex', justifyContent: 'center' }}>
            <button className="pill-btn" onClick={() => setWeighOpenOn(date)}>
              + Weigh-in
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
