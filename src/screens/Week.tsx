import { ChevronLeft, ChevronRight } from '../components/icons';
import { MacroCards } from '../components/ui';
import type { MacroCardData } from '../components/ui';
import { parse, shift, WD, weekLabel } from '../lib/dates';
import { balanceTag, dayTotals, fmt, MACRO_KEYS, macroPct, macroTargets } from '../lib/nutrition';
import type { MacroKey } from '../lib/nutrition';
import type { Data } from '../lib/types';

interface Props {
  data: Data;
  weekStart: string;
  currentWeekStart: string;
  today: string;
  setWeekStart: (ws: string) => void;
  openDay: (d: string) => void;
}

const H = 120;

export function Week({ data, weekStart, currentWeekStart, today, setWeekStart, openDay }: Props) {
  const s = data.settings;
  const hasGoal = s.goal > 0;
  const days = Array.from({ length: 7 }, (_, i) => shift(weekStart, i));
  const totals = days.map(d => ({ d, t: dayTotals(data.days[d]) }));
  const logged = totals.filter(x => x.d <= today && x.t.kcal > 0);
  const avg = (k: 'kcal' | 'p' | 'f' | 'c') => (logged.length ? logged.reduce((a, x) => a + x.t[k], 0) / logged.length : 0);
  const avgM = { p: avg('p'), f: avg('f'), c: avg('c') };
  const maxK = Math.max(s.goal || 0, ...totals.map(x => x.t.kcal), 1);
  const goalTop = hasGoal ? Math.round(H * (1 - Math.min(1, s.goal / maxK))) : 0;
  const isCurrent = weekStart >= currentWeekStart;

  const targets = macroTargets(s);
  const actual = macroPct(avgM);
  const cards = Object.fromEntries(
    MACRO_KEYS.map(k => [
      k,
      {
        pct: actual[k],
        sub: `${Math.round(avgM[k])} g` + (targets.has ? ` · goal ${targets.pct[k]}%` + (targets.g[k] ? ` · ${targets.g[k]} g` : '') : ''),
        tag: balanceTag(actual[k], targets.pct[k], actual.kcal > 0)
      }
    ])
  ) as Record<MacroKey, MacroCardData>;

  return (
    <div className="screen fade">
      <div className="head">
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <button className="icon-btn" aria-label="Previous week" onClick={() => setWeekStart(shift(weekStart, -7))}>
            <ChevronLeft />
          </button>
          <span style={{ fontSize: 17, fontWeight: 600, padding: '0 6px' }}>{weekLabel(weekStart)}</span>
          <button className="icon-btn" aria-label="Next week" disabled={isCurrent} onClick={() => setWeekStart(shift(weekStart, 7))}>
            <ChevronRight />
          </button>
        </div>
        {!isCurrent && (
          <button className="pill-btn" onClick={() => setWeekStart(currentWeekStart)}>
            This week
          </button>
        )}
      </div>
      <div className="scroll pad-tab">
        <div style={{ padding: '26px 0 0' }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
            <span className="hero">{logged.length ? fmt(avg('kcal')) : '—'}</span>
            <span className="hero-unit">kcal / day</span>
          </div>
          <div className="secondary" style={{ marginTop: 8 }}>
            {logged.length ? `${logged.length} of 7 days logged${hasGoal ? ` · goal ${fmt(s.goal)}` : ''}` : 'No meals logged this week'}
          </div>
        </div>
        <div className="label" style={{ marginTop: 24 }}>Average per day</div>
        <div style={{ marginTop: 10 }}>
          <MacroCards data={cards} showTags={targets.has} />
        </div>

        <div style={{ marginTop: 28, background: '#fff', borderRadius: 20, padding: '20px 16px 14px', position: 'relative' }}>
          {hasGoal && (
            <>
              <div style={{ position: 'absolute', left: 16, right: 16, top: 60 + goalTop, borderTop: '1px dashed var(--dash)' }} />
              <div style={{ position: 'absolute', right: 16, top: 60 + goalTop - 15, fontSize: 11, color: 'var(--faint)' }}>goal {fmt(s.goal)}</div>
            </>
          )}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7,1fr)', gap: 8, alignItems: 'end', height: 160 }}>
            {totals.map(x => {
              const has = x.d <= today && x.t.kcal > 0;
              const isT = x.d === today;
              const h = has ? Math.max(6, Math.round((H * x.t.kcal) / maxK)) : 3;
              return (
                <button
                  key={x.d}
                  disabled={x.d > today}
                  onClick={() => openDay(x.d)}
                  aria-label={`${WD[parse(x.d).getDay()]}: ${has ? fmt(x.t.kcal) + ' kcal' : 'nothing logged'}`}
                  style={{ height: '100%', border: 'none', background: 'transparent', padding: 0, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', alignItems: 'center' }}
                >
                  <span className="num" style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 6 }}>{has ? fmt(x.t.kcal) : ''}</span>
                  <span style={{ width: '100%', height: h, borderRadius: 8, background: isT ? 'var(--accent)' : has ? '#E8D3CA' : '#F3E6DF', transition: 'height .4s' }} />
                </button>
              );
            })}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7,1fr)', gap: 8, marginTop: 10 }}>
            {days.map(d => (
              <span key={d} style={{ textAlign: 'center', fontSize: 12, fontWeight: d === today ? 700 : 500, color: d === today ? 'var(--ink)' : 'var(--muted)' }}>
                {WD[parse(d).getDay()]}
              </span>
            ))}
          </div>
        </div>
        <div style={{ fontSize: 12, color: 'var(--faint)', marginTop: 12, padding: '0 4px' }}>Tap a bar to open that day.</div>
      </div>
    </div>
  );
}
