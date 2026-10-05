import { useRef } from 'react';
import { ChevronLeft, ChevronRight, SettingsIcon } from '../components/icons';
import { DateStrip, MacroCards } from '../components/ui';
import type { MacroCardData } from '../components/ui';
import { dayLabel, shift } from '../lib/dates';
import { amountLabel, balanceTag, dayTotals, fmt, goalsOn, kcalParts, MACRO_KEYS, macroPct, macroTargets } from '../lib/nutrition';
import type { MacroKey } from '../lib/nutrition';
import type { Data, Item, Meal } from '../lib/types';

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
  const targets = macroTargets(s);
  const actual = macroPct(tot);
  const cards = Object.fromEntries(
    MACRO_KEYS.map(k => [
      k,
      {
        pct: actual[k],
        sub: targets.has ? `goal ${targets.pct[k]}%` : `${Math.round(tot[k])} g`,
        tag: balanceTag(k, actual[k], targets.pct[k], actual.kcal > 0)
      }
    ])
  ) as Record<MacroKey, MacroCardData>;

  const goalLine = hasGoal
    ? tot.kcal <= s.goal
      ? `${fmt(s.goal - tot.kcal)} left of ${fmt(s.goal)}`
      : `${fmt(tot.kcal - s.goal)} over ${fmt(s.goal)}`
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
              <span className="hero">{fmt(tot.kcal)}</span>
              <span className="hero-unit">kcal</span>
            </div>
            <div className="secondary" style={{ marginTop: 8 }}>{goalLine}</div>
          </div>
          {hasGoal && (
            <svg width="84" height="84" viewBox="0 0 84 84" style={{ transform: 'rotate(-90deg)' }} role="img" aria-label={`${Math.round((tot.kcal / s.goal) * 100)}% of daily goal`}>
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
          <MacroCards data={cards} showTags={targets.has} />
        </div>

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
              <h2 className="label" style={{ margin: 0, padding: 0 }}>{m.type}</h2>
              <span className="num" style={{ fontSize: 13, color: 'var(--muted)' }}>{fmt(m.items.reduce((a, i) => a + (+i.kcal || 0), 0))} kcal</span>
            </div>
            <div className="card">
              {m.items.map(it => (
                <ItemRow key={it.id} item={it} units={data.settings.units} onOpen={() => openItem(m, it)} onLong={() => deleteItem(m, it)} />
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
