import { ChevronLeft, ChevronRight } from '../components/icons';
import { MacroCards } from '../components/ui';
import type { MacroCardData } from '../components/ui';
import { parse, shift, WD, weekLabel } from '../lib/dates';
import { balanceTag, dayTotals, fmt, goalsOn, KCAL_COLOR, kcalParts, kcalStatus, MACRO_KEYS, macroPct, macroTargets, proteinStatus, proteinTag } from '../lib/nutrition';
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

/** A finished week's main numbers, for comparing with the week before. Today is left out until it's over. */
export function weekSummary(data: Data, weekStart: string, today: string) {
  const days = Array.from({ length: 7 }, (_, i) => shift(weekStart, i))
    .filter(d => d < today)
    .map(d => {
      const goals = goalsOn(data.settings, d);
      return { t: dayTotals(data.days[d]), goals, protein: macroTargets(goals).g.p };
    })
    .filter(x => x.t.kcal > 0);
  const n = days.length;
  const withGoal = days.filter(x => x.goals.goal > 0);
  const withProtein = days.filter(x => x.protein > 0);
  return {
    days: n,
    kcal: n ? days.reduce((a, x) => a + x.t.kcal, 0) / n : 0,
    protein: n ? days.reduce((a, x) => a + x.t.p, 0) / n : 0,
    /** days that ended within the calorie goal (and not under the minimum), of the days that had a goal */
    onGoal: withGoal.filter(x => kcalStatus(x.t.kcal, x.goals.goal, x.goals.min ?? 0) === 'within').length,
    goalDays: withGoal.length,
    /** days the protein target was reached, of the days that had one */
    proteinMet: withProtein.filter(x => proteinStatus(x.t.p, x.protein, true) === 'met').length,
    proteinDays: withProtein.length
  };
}
type Summary = ReturnType<typeof weekSummary>;

const GOOD = 'var(--accent-ink)';
const BAD = 'var(--danger)';

/** This week next to the week before: average calories and protein, days on the calorie goal, days protein was reached. */
function Compare({ now, prev, goal, isCurrent }: { now: Summary; prev: Summary; goal: number; isCurrent: boolean }) {
  const arrow = (d: number) => (d > 0 ? '↑' : d < 0 ? '↓' : '');
  // calories: better is closer to the goal (without a goal, no verdict); everything else: more is better
  const kcalTone = goal > 0 ? (Math.abs(now.kcal - goal) < Math.abs(prev.kcal - goal) ? GOOD : Math.abs(now.kcal - goal) > Math.abs(prev.kcal - goal) ? BAD : undefined) : undefined;
  const tone = (d: number) => (d > 0 ? GOOD : d < 0 ? BAD : undefined);
  const rows: { label: string; value: string; change: string; color?: string; before: string }[] = [
    { label: 'Average', value: `${fmt(now.kcal)} kcal`, change: `${arrow(Math.round(now.kcal - prev.kcal))} ${fmt(Math.abs(now.kcal - prev.kcal))}`, color: kcalTone, before: fmt(prev.kcal) },
    { label: 'Protein', value: `${Math.round(now.protein)} g`, change: `${arrow(Math.round(now.protein - prev.protein))} ${Math.abs(Math.round(now.protein - prev.protein))} g`, color: tone(Math.round(now.protein - prev.protein)), before: `${Math.round(prev.protein)} g` }
  ];
  if (now.goalDays && prev.goalDays) rows.push({ label: 'On calorie goal', value: `${now.onGoal} of ${now.goalDays} days`, change: '', color: tone(now.onGoal / now.goalDays - prev.onGoal / prev.goalDays), before: `${prev.onGoal} of ${prev.goalDays}` });
  if (now.proteinDays && prev.proteinDays) rows.push({ label: 'Protein reached', value: `${now.proteinMet} of ${now.proteinDays} days`, change: '', color: tone(now.proteinMet / now.proteinDays - prev.proteinMet / prev.proteinDays), before: `${prev.proteinMet} of ${prev.proteinDays}` });
  return (
    <section style={{ marginTop: 28 }}>
      <div className="label" style={{ padding: '0 4px 10px' }}>{isCurrent ? 'Compared with last week' : 'Compared with the week before'}</div>
      <div className="card">
        {rows.map(r => (
          <div key={r.label} className="row" style={{ cursor: 'default' }}>
            <div style={{ minWidth: 0 }}>
              <div className="row-name">{r.label}</div>
              <div className="row-sub">before {r.before}</div>
            </div>
            <div style={{ textAlign: 'right' }}>
              <div className="num" style={{ fontSize: 16, fontWeight: 600, color: r.color }}>{r.value}</div>
              {r.change.trim() && <div className="num" style={{ fontSize: 12, color: r.color ?? 'var(--muted)', marginTop: 2 }}>{r.change.trim()}</div>}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

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
  // today isn't over yet, so the averages are of the finished days only
  const logged = totals.filter(x => x.d < today && x.t.kcal > 0);
  const todayPending = days.includes(today) && dayTotals(data.days[today]).kcal > 0;
  const avg = (k: 'kcal' | 'p' | 'f' | 'c') => (logged.length ? logged.reduce((a, x) => a + x.t[k], 0) / logged.length : 0);
  const avgM = { p: avg('p'), f: avg('f'), c: avg('c') };
  const maxK = Math.max(s.goal || 0, ...totals.map(x => x.t.kcal), 1);
  const goalTop = hasGoal ? Math.round(H * (1 - Math.min(1, s.goal / maxK))) : 0;
  const minTop = min > 0 ? Math.round(H * (1 - Math.min(1, min / maxK))) : 0;
  const isCurrent = weekStart >= currentWeekStart;

  const targets = macroTargets(s);
  const actual = macroPct(avgM);
  const cards = Object.fromEntries(
    MACRO_KEYS.map(k => {
      // protein: the average grams against the goal in grams
      const pt = k === 'p' && targets.g.p > 0 ? proteinTag(avgM.p, targets.g.p, actual.kcal > 0, true) : null;
      return [
        k,
        {
          pct: actual[k],
          // actual average under the big %, the goal apart below it
          sub: `${Math.round(avgM[k])} g`,
          goal: targets.has ? `${targets.pct[k]}%` + (targets.g[k] ? ` · ${targets.g[k]} g` : '') : undefined,
          tag: pt ? pt.tag : balanceTag(k, actual[k], targets.pct[k], actual.kcal > 0),
          tagLabel: pt?.label
        }
      ];
    })
  ) as Record<MacroKey, MacroCardData>;
  const showProtein = totals.some(x => x.targets.g.p > 0);
  const now = weekSummary(data, weekStart, today);
  const prev = weekSummary(data, shift(weekStart, -7), today);

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
            {logged.length ? `${logged.length} ${logged.length === 1 ? 'day' : 'days'} logged` : todayPending ? 'Today counts once it’s over' : 'No meals logged this week'}
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
              // green up to the day's goal, only the part over it in yellow or red; without a goal, the neutral colour
              const parts = kcalParts(x.t.kcal, x.goals.goal);
              const color = !has ? '#F3E6DF' : x.goals.goal > 0 ? 'var(--accent)' : '#E8D3CA';
              const overH = has && parts.over ? Math.max(3, Math.round((h * parts.over) / x.t.kcal)) : 0;
              // only a finished day can be under the minimum; today is still being filled. Shown as a hollow bar
              const under = has && kcalStatus(x.t.kcal, x.goals.goal, x.goals.min ?? 0, x.d < today) === 'under';
              return (
                <button
                  key={x.d}
                  disabled={x.d > today}
                  onClick={() => openDay(x.d)}
                  aria-label={`${WD[parse(x.d).getDay()]}: ${has ? fmt(x.t.kcal) + ' kcal' + (under ? ', below the minimum' : '') : 'nothing logged'}`}
                  style={{ height: '100%', border: 'none', background: 'transparent', padding: 0, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', alignItems: 'center' }}
                >
                  <span className="num" style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 6 }}>{has ? fmt(x.t.kcal) : ''}</span>
                  <span
                    style={
                      under
                        ? { width: '100%', height: h, borderRadius: 8, background: 'transparent', boxShadow: `inset 0 0 0 2px ${KCAL_COLOR.within}`, transition: 'height .4s' }
                        : { width: '100%', height: h, borderRadius: 8, background: color, transition: 'height .4s', overflow: 'hidden', display: 'flex', flexDirection: 'column' }
                    }
                  >
                    {!under && overH > 0 && <span style={{ height: overH, flex: 'none', background: parts.overColor }} />}
                  </span>
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
              <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--muted)', marginTop: 10, borderTop: '1px solid var(--line-soft)', paddingTop: 8 }}>Protein</div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7,1fr)', gap: 8, marginTop: 6 }}>
                {totals.map(x => {
                  // today gets its tick once the goal is reached; short or not isn't known before the day is over
                  const raw = x.d <= today ? proteinStatus(x.t.p, x.targets.g.p, x.t.kcal > 0) : 'none';
                  const st = x.d === today && raw !== 'met' ? 'none' : raw;
                  return (
                    <span key={x.d} role={st === 'none' ? undefined : 'img'} aria-label={st === 'none' ? undefined : `${WD[parse(x.d).getDay()]}: ${PROTEIN_MARK[st][2]}, ${Math.round(x.t.p)} of ${x.targets.g.p} g`} style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: 22, color: 'var(--faint)', fontSize: 14 }}>
                      {st === 'none' ? '·' : <ProteinMark status={st} />}
                    </span>
                  );
                })}
              </div>
            </>
          )}
        </div>
        {now.days > 0 && prev.days > 0 && <Compare now={now} prev={prev} goal={s.goal} isCurrent={isCurrent} />}
      </div>
    </div>
  );
}
