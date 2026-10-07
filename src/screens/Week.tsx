import { ChevronLeft, ChevronRight } from '../components/icons';
import { MacroCards } from '../components/ui';
import type { MacroCardData } from '../components/ui';
import { parse, shift, WD, weekLabel } from '../lib/dates';
import { balanceTag, dayTotals, fmt, goalsOn, KCAL_COLOR, kcalStatus, MACRO_KEYS, macroPct, macroTargets, proteinStatus } from '../lib/nutrition';
import type { MacroKey, ProteinStatus } from '../lib/nutrition';
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

/** glyph, background, description: a filled circle so the mark reads at a glance */
const PROTEIN_MARK: Record<Exclude<ProteinStatus, 'none'>, [string, string, string]> = {
  met: ['✓', 'var(--accent)', 'protein reached'],
  close: ['~', 'var(--est)', 'protein almost reached'],
  short: ['✕', 'var(--danger)', 'protein short']
};

function ProteinMark({ status }: { status: Exclude<ProteinStatus, 'none'> }) {
  const [glyph, bg] = PROTEIN_MARK[status];
  return (
    <span style={{ display: 'inline-grid', placeItems: 'center', width: 22, height: 22, borderRadius: '50%', background: bg, color: '#fff', fontSize: 13, fontWeight: 800, lineHeight: 1 }} aria-hidden>
      {glyph}
    </span>
  );
}

export function Week({ data, weekStart, currentWeekStart, today, setWeekStart, openDay }: Props) {
  const days = Array.from({ length: 7 }, (_, i) => shift(weekStart, i));
  // each day is judged against the goals it had; the summary uses the latest day shown
  const totals = days.map(d => {
    const goals = goalsOn(data.settings, d);
    return { d, t: dayTotals(data.days[d]), goals, targets: macroTargets(goals) };
  });
  const lastDay = days[6] <= today ? days[6] : today;
  const s = goalsOn(data.settings, lastDay);
  const hasGoal = s.goal > 0;
  const min = s.min ?? 0;
  const logged = totals.filter(x => x.d <= today && x.t.kcal > 0);
  const avg = (k: 'kcal' | 'p' | 'f' | 'c') => (logged.length ? logged.reduce((a, x) => a + x.t[k], 0) / logged.length : 0);
  const avgM = { p: avg('p'), f: avg('f'), c: avg('c') };
  const maxK = Math.max(s.goal || 0, ...totals.map(x => x.t.kcal), 1);
  const goalTop = hasGoal ? Math.round(H * (1 - Math.min(1, s.goal / maxK))) : 0;
  const minTop = min > 0 ? Math.round(H * (1 - Math.min(1, min / maxK))) : 0;
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
  const showProtein = totals.some(x => x.targets.g.p > 0);

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
        <div className="label" style={{ marginTop: 26 }}>Average per day</div>
        <div style={{ padding: '10px 0 0' }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
            <span className="hero">{logged.length ? fmt(avg('kcal')) : '—'}</span>
            <span className="hero-unit">kcal</span>
          </div>
          <div className="secondary" style={{ marginTop: 8 }}>
            {logged.length ? `${logged.length} of 7 days logged${hasGoal ? ` · goal ${fmt(s.goal)}` : ''}${min > 0 ? ` · min ${fmt(min)}` : ''}` : 'No meals logged this week'}
          </div>
        </div>
        <div style={{ marginTop: 14 }}>
          <MacroCards data={cards} showTags={targets.has} />
        </div>

        <div style={{ marginTop: 28, background: '#fff', borderRadius: 20, padding: '20px 16px 14px', position: 'relative' }}>
          {hasGoal && (
            <>
              <div style={{ position: 'absolute', left: 16, right: 16, top: 60 + goalTop, borderTop: '1px dashed var(--dash)' }} />
              <div style={{ position: 'absolute', right: 16, top: 60 + goalTop - 15, fontSize: 11, color: 'var(--faint)' }}>goal {fmt(s.goal)}</div>
            </>
          )}
          {min > 0 && (
            <>
              <div style={{ position: 'absolute', left: 16, right: 16, top: 60 + minTop, borderTop: '1px dashed var(--dash)' }} />
              {/* under its line, so it never meets the goal label, which sits above the goal line */}
              <div style={{ position: 'absolute', right: 16, top: 60 + minTop + 2, fontSize: 11, color: 'var(--faint)' }}>min {fmt(min)}</div>
            </>
          )}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7,1fr)', gap: 8, alignItems: 'end', height: 160 }}>
            {totals.map(x => {
              const has = x.d <= today && x.t.kcal > 0;
              const h = has ? Math.max(6, Math.round((H * x.t.kcal) / maxK)) : 3;
              // only a finished day can be "under" the minimum; today is still being filled
              const status = kcalStatus(x.t.kcal, x.goals.goal, x.goals.min ?? 0, x.d < today);
              // without a goal, logged days use the neutral bar colour; under the minimum is a hollow bar
              const color = !has ? '#F3E6DF' : status === 'none' ? '#E8D3CA' : KCAL_COLOR[status];
              const bar: React.CSSProperties =
                status === 'under'
                  ? { background: 'transparent', boxShadow: `inset 0 0 0 2px ${KCAL_COLOR.within}` }
                  : { background: color };
              return (
                <button
                  key={x.d}
                  disabled={x.d > today}
                  onClick={() => openDay(x.d)}
                  aria-label={`${WD[parse(x.d).getDay()]}: ${has ? fmt(x.t.kcal) + ' kcal' + (status === 'under' ? ', below the minimum' : '') : 'nothing logged'}`}
                  style={{ height: '100%', border: 'none', background: 'transparent', padding: 0, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', alignItems: 'center' }}
                >
                  <span className="num" style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 6 }}>{has ? fmt(x.t.kcal) : ''}</span>
                  <span style={{ width: '100%', height: h, borderRadius: 8, transition: 'height .4s', ...bar }} />
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
          {showProtein && (
            <>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7,1fr)', gap: 8, marginTop: 10, borderTop: '1px solid var(--line-soft)', paddingTop: 10 }}>
                {totals.map(x => {
                  const st = x.d <= today ? proteinStatus(x.t.p, x.targets.g.p, x.t.kcal > 0) : 'none';
                  return (
                    <span key={x.d} role={st === 'none' ? undefined : 'img'} aria-label={st === 'none' ? undefined : `${WD[parse(x.d).getDay()]}: ${PROTEIN_MARK[st][2]}, ${Math.round(x.t.p)} of ${x.targets.g.p} g`} style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: 22, color: 'var(--faint)', fontSize: 14 }}>
                      {st === 'none' ? '·' : <ProteinMark status={st} />}
                    </span>
                  );
                })}
              </div>
              <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 10, fontSize: 11, color: 'var(--muted)', marginTop: 8, flexWrap: 'wrap' }}>
                <span style={{ fontWeight: 600 }}>Protein</span>
                <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}><ProteinMark status="met" /> 90 %+</span>
                <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}><ProteinMark status="close" /> 75–90 %</span>
                <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}><ProteinMark status="short" /> less</span>
              </div>
            </>
          )}
        </div>
        <div style={{ fontSize: 12, color: 'var(--faint)', marginTop: 12, padding: '0 4px' }}>
          Tap a bar to open that day.{hasGoal ? ' Green within the goal, yellow up to 10 % over, red more than 10 % over.' : ''}{min > 0 ? ' A hollow bar stayed below the minimum.' : ''}
        </div>
      </div>
    </div>
  );
}
