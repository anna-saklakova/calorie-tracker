import { useState } from 'react';
import { ChevronLeft, ChevronRight } from '../components/icons';
import { Segmented, NumInput } from '../components/ui';
import { dayLabel, iso, MON, parse, shift } from '../lib/dates';
import { BODY, bodyInsights, checkInDue, checkIns, intake } from '../lib/body';
import type { Insight, Tone } from '../lib/body';
import { dayGoals, fmt } from '../lib/nutrition';
import { weekReview } from '../lib/review';
import type { ReviewBlock } from '../lib/review';
import { setWaist, setWeighIn } from '../lib/store';
import type { Data } from '../lib/types';
import { KCAL_PER_KG, maintenance, measures, round50, waistTrend, weightTrend } from '../lib/weight';
import type { Measure, Trend } from '../lib/weight';

interface Props {
  data: Data;
  today: string;
  onSaved: (msg: string) => void;
}

const dayNo = (d: string) => Math.round(parse(d).getTime() / 86400000);
const shortDate = (d: string) => `${parse(d).getDate()} ${MON[parse(d).getMonth()]}`;
const signed = (n: number, digits = 1) => `${n > 0 ? '+' : n < 0 ? '−' : ''}${Math.abs(n).toFixed(digits)}`;
const toNum = (v: string) => Math.max(0, Math.round((+v || 0) * 10) / 10);

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const WEEK_HEAD = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'];

/**
 * A month calendar: days with a check-in are filled, with the weight under the date, so past check-ins
 * are seen at a glance; tap one to open it, or any other past day to add one.
 */
function MonthCalendar({ data, today, value, onPick }: { data: Data; today: string; value: string; onPick: (d: string) => void }) {
  const [month, setMonth] = useState(value.slice(0, 7) + '-01');
  const first = parse(month);
  const lead = (first.getDay() + 6) % 7;
  const len = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate();
  const cells = [...Array.from({ length: lead }, () => null), ...Array.from({ length: len }, (_, i) => shift(month, i))];
  const go = (n: number) => setMonth(m => { const d = parse(m); return iso(new Date(d.getFullYear(), d.getMonth() + n, 1)); });
  const isLast = month.slice(0, 7) >= today.slice(0, 7);
  const count = cells.filter(d => d && ((data.days[d]?.weight ?? 0) > 0 || (data.days[d]?.waist ?? 0) > 0)).length;
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <button className="icon-btn" aria-label="Previous month" onClick={() => go(-1)}><ChevronLeft /></button>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: 15, fontWeight: 700 }}>{MONTHS[first.getMonth()]} {first.getFullYear()}</div>
          <div style={{ fontSize: 12, color: 'var(--muted)' }}>{count ? `${count} ${count === 1 ? 'check-in' : 'check-ins'}` : 'no check-ins'}</div>
        </div>
        <button className="icon-btn" aria-label="Next month" disabled={isLast} onClick={() => go(1)}><ChevronRight /></button>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7,1fr)', gap: 4, marginTop: 8 }}>
        {WEEK_HEAD.map(h => <span key={h} style={{ textAlign: 'center', fontSize: 11, fontWeight: 600, color: 'var(--faint)' }}>{h}</span>)}
        {cells.map((d, i) => {
          if (!d) return <span key={'e' + i} />;
          const day = data.days[d];
          const kg = day?.weight ?? 0;
          const has = kg > 0 || (day?.waist ?? 0) > 0;
          const on = d === value;
          const future = d > today;
          return (
            <button
              key={d}
              disabled={future}
              onClick={() => onPick(d)}
              aria-pressed={on}
              aria-label={`${dayLabel(d, today)}${has ? `, check-in${kg ? ` ${kg.toFixed(1)} kg` : ''}` : ''}`}
              style={{
                height: 46, borderRadius: 12, padding: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 1,
                border: on ? '2px solid var(--ink)' : '1px solid transparent',
                background: has ? 'var(--accent)' : 'transparent',
                color: has ? '#fff' : future ? 'var(--disabled)' : 'var(--ink)'
              }}
            >
              <span className="num" style={{ fontSize: 14, fontWeight: d === today || has ? 700 : 500, textDecoration: d === today && !has ? 'underline' : undefined }}>{parse(d).getDate()}</span>
              {has && <span className="num" style={{ fontSize: 9.5, fontWeight: 600, opacity: 0.9 }}>{kg ? kg.toFixed(1) : 'waist'}</span>}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** The check-in form: today by default, any earlier day from the calendar. */
function CheckInForm({ data, today, date, setDate, onSaved }: { data: Data; today: string; date: string; setDate: (d: string) => void; onSaved: (msg: string) => void }) {
  const day = data.days[date];
  const [kg, setKg] = useState(day?.weight ? String(day.weight) : '');
  const [cm, setCm] = useState(day?.waist ? String(day.waist) : '');
  const had = (day?.weight ?? 0) > 0 || (day?.waist ?? 0) > 0;
  const changed = toNum(kg) !== (day?.weight ?? 0) || toNum(cm) !== (day?.waist ?? 0);
  const save = () => {
    setWeighIn(date, toNum(kg));
    setWaist(date, toNum(cm));
    onSaved(toNum(kg) || toNum(cm) ? `Check-in saved · ${dayLabel(date, today)}` : 'Check-in removed');
  };
  return (
    <div className="card" style={{ padding: 16 }}>
      <MonthCalendar data={data} today={today} value={date} onPick={setDate} />
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8, marginTop: 14, paddingTop: 12, borderTop: '1px solid var(--line-soft)' }}>
        <span style={{ fontSize: 15, fontWeight: 700 }}>{dayLabel(date, today)}</span>
        <span style={{ fontSize: 12, color: 'var(--muted)' }}>{had ? 'edit this check-in' : 'new check-in'}</span>
        {date !== today && <button className="pill-btn" style={{ marginLeft: 'auto' }} onClick={() => setDate(today)}>Today</button>}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginTop: 14 }}>
        {[
          { label: 'Weight', unit: 'kg', value: kg, set: setKg },
          { label: 'Waist', unit: 'cm', value: cm, set: setCm }
        ].map(f => (
          <div key={f.label}>
            <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink-2)', marginBottom: 6 }}>{f.label}{f.unit === 'cm' && <span style={{ fontWeight: 500, color: 'var(--muted)' }}> · optional</span>}</div>
            <div className="input-wrap">
              <NumInput value={f.value} ariaLabel={`${f.label} in ${f.unit}`} placeholder="—" onChange={f.set} className="num" style={{ width: '100%', fontSize: 18, fontWeight: 600 }} />
              <span className="unit">{f.unit}</span>
            </div>
          </div>
        ))}
      </div>
      <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 8 }}>Morning, after the toilet, before food. Waist at the navel, relaxed.</div>
      <button className="btn-primary" style={{ marginTop: 14, height: 50 }} disabled={!changed || (!had && !toNum(kg) && !toNum(cm))} onClick={save}>
        {had ? 'Update check-in' : 'Save check-in'}
      </button>
    </div>
  );
}

const W = 340;
const CH = 150;
const PAD = { l: 34, r: 10, t: 14, b: 22 };

/** One measure over time: the check-ins as points, the trend line dashed over the weeks it covers. Tap a point for its value. */
function LineChart({ title, unit, points, trend, from }: { title: string; unit: string; points: Measure[]; trend: Trend | null; from: string }) {
  const [sel, setSel] = useState<number | null>(null);
  const pts = points.filter(p => p.date >= from);
  if (pts.length < 2) return null;
  const x0 = dayNo(pts[0].date);
  const x1 = Math.max(dayNo(pts[pts.length - 1].date), x0 + 7);
  const vals = pts.map(p => p.value);
  let lo = Math.min(...vals);
  let hi = Math.max(...vals);
  // at least 2 units of height, so a steady line doesn't read as a cliff
  const mid = (lo + hi) / 2;
  if (hi - lo < 2) [lo, hi] = [mid - 1, mid + 1];
  const padV = (hi - lo) * 0.12;
  lo -= padV;
  hi += padV;
  const X = (d: string) => PAD.l + ((dayNo(d) - x0) / (x1 - x0)) * (W - PAD.l - PAD.r);
  const Y = (v: number) => PAD.t + (1 - (v - lo) / (hi - lo)) * (CH - PAD.t - PAD.b);
  const ticks = [lo + padV, (lo + hi) / 2, hi - padV];
  const line = pts.map((p, i) => `${i ? 'L' : 'M'}${X(p.date).toFixed(1)},${Y(p.value).toFixed(1)}`).join(' ');
  const tr = trend && trend.from >= from ? trend : null;
  const trY = (d: string) => Y(tr!.now - (tr!.perWeek / 7) * (dayNo(tr!.to) - dayNo(d)));
  const s = sel !== null ? pts[sel] : null;
  return (
    <div className="card" style={{ padding: '14px 12px 10px', marginTop: 10 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', padding: '0 4px' }}>
        <span style={{ fontSize: 14, fontWeight: 700 }}>{title}</span>
        <span style={{ fontSize: 12, color: 'var(--muted)' }} aria-live="polite">
          {s ? `${shortDate(s.date)} · ${s.value.toFixed(1)} ${unit}` : tr ? `trend ${signed(tr.perWeek, 2)} ${unit}/week` : 'tap a point'}
        </span>
      </div>
      <svg viewBox={`0 0 ${W} ${CH}`} width="100%" role="img" aria-label={`${title}: ${pts.map(p => `${shortDate(p.date)} ${p.value.toFixed(1)} ${unit}`).join(', ')}`} style={{ display: 'block', marginTop: 6 }} onClick={() => setSel(null)}>
        {ticks.map(t => (
          <g key={t}>
            <line x1={PAD.l} x2={W - PAD.r} y1={Y(t)} y2={Y(t)} stroke="var(--line-soft)" strokeWidth={1} />
            <text x={PAD.l - 6} y={Y(t) + 4} textAnchor="end" fontSize={10} fill="var(--faint)">{t.toFixed(t >= 100 ? 0 : 1)}</text>
          </g>
        ))}
        <text x={PAD.l} y={CH - 4} fontSize={10} fill="var(--faint)">{shortDate(pts[0].date)}</text>
        <text x={W - PAD.r} y={CH - 4} fontSize={10} fill="var(--faint)" textAnchor="end">{shortDate(pts[pts.length - 1].date)}</text>
        {tr && <line x1={X(tr.from)} x2={X(tr.to)} y1={trY(tr.from)} y2={trY(tr.to)} stroke="var(--ink-2)" strokeWidth={1.5} strokeDasharray="5 4" opacity={0.6} />}
        <path d={line} fill="none" stroke="var(--accent)" strokeWidth={2} strokeLinejoin="round" />
        {s && <line x1={X(s.date)} x2={X(s.date)} y1={PAD.t} y2={CH - PAD.b} stroke="var(--dash)" strokeWidth={1} />}
        {pts.map((p, i) => (
          <g key={p.date} onClick={e => (e.stopPropagation(), setSel(sel === i ? null : i))} style={{ cursor: 'pointer' }}>
            <circle cx={X(p.date)} cy={Y(p.value)} r={14} fill="transparent" />
            <circle cx={X(p.date)} cy={Y(p.value)} r={sel === i ? 5.5 : 4} fill="var(--accent)" stroke="var(--surface)" strokeWidth={2} />
          </g>
        ))}
      </svg>
      {tr && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: 'var(--faint)', padding: '2px 4px 0' }}>
          <span style={{ width: 14, borderTop: '1.5px dashed var(--ink-2)', opacity: 0.6 }} />trend of the last {Math.round(tr.span / 7)} weeks
        </div>
      )}
    </div>
  );
}

const TONE: Record<Tone, [string, string]> = { good: ['✓', 'var(--accent)'], warn: ['!', 'var(--danger)'], info: ['i', 'var(--est)'] };

function InsightRow({ i }: { i: Insight }) {
  const [glyph, bg] = TONE[i.tone];
  return (
    <div className="row" style={{ cursor: 'default', alignItems: 'flex-start', justifyContent: 'flex-start' }}>
      <span aria-hidden style={{ display: 'inline-grid', placeItems: 'center', width: 22, height: 22, borderRadius: '50%', background: bg, color: '#fff', fontSize: 13, fontWeight: 800, flex: 'none', marginTop: 1 }}>{glyph}</span>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 15, fontWeight: 600 }}>{i.title}</div>
        <div style={{ fontSize: 13, color: 'var(--ink-2)', marginTop: 3, textWrap: 'pretty' }}>{i.text}</div>
        {i.ref && <div style={{ fontSize: 11, color: 'var(--faint)', marginTop: 4 }}>{i.ref}</div>}
      </div>
    </div>
  );
}

/** One block of the review of the last 7 days: what is known, then what is not. */
function ReviewRow({ b }: { b: ReviewBlock }) {
  const [glyph, bg] = TONE[b.tone];
  return (
    <div className="row" style={{ cursor: 'default', alignItems: 'flex-start', justifyContent: 'flex-start' }}>
      <span aria-hidden style={{ display: 'inline-grid', placeItems: 'center', width: 22, height: 22, borderRadius: '50%', background: bg, color: '#fff', fontSize: 13, fontWeight: 800, flex: 'none', marginTop: 1 }}>{glyph}</span>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--muted)' }}>{b.title}</div>
        <div style={{ fontSize: 15, fontWeight: 600, marginTop: 1 }}>{b.headline}</div>
        {b.known.map((t, i) => (
          <div key={i} style={{ fontSize: 13, color: 'var(--ink-2)', marginTop: 4, textWrap: 'pretty' }}>{t}</div>
        ))}
        {b.unknown.length > 0 && (
          <div style={{ marginTop: 8 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: 0.4 }}>Not known</div>
            {b.unknown.map((t, i) => (
              <div key={i} style={{ fontSize: 13, color: 'var(--muted)', marginTop: 3, textWrap: 'pretty' }}>{t}</div>
            ))}
          </div>
        )}
        {b.ref && <div style={{ fontSize: 11, color: 'var(--faint)', marginTop: 6 }}>{b.ref}</div>}
      </div>
    </div>
  );
}

type Range = '12w' | 'all';

export function Body({ data, today, onSaved }: Props) {
  const [date, setDate] = useState(today);
  const [range, setRange] = useState<Range>('12w');
  const [allRows, setAllRows] = useState(false);
  const { due, since } = checkInDue(data, today);
  const list = checkIns(data, today);
  const weights = measures(data, 'weight', today);
  const waists = measures(data, 'waist', today);
  const trend = weightTrend(data, today);
  const wTrend = waistTrend(data, today);
  const m = maintenance(data, today);
  // the goal for the weekly-loss line: the average goal of the last two weeks (strength days have their own), or today's
  const goal = intake(data, shift(today, -14), today).goal || dayGoals(data, today).goal;
  const review = weekReview(data, today);
  // protein and the gaps in the log are covered by the review of the last 7 days
  const insights = bodyInsights(data, today).filter(i => i.key !== 'protein' && i.key !== 'gaps');
  const from = range === 'all' ? '0000-01-01' : shift(today, -84);
  const lastW = weights[weights.length - 1];
  const lastC = waists[waists.length - 1];

  const tiles: { label: string; value: string; sub: string }[] = [];
  if (lastW) tiles.push({ label: 'Weight', value: `${lastW.value.toFixed(1)} kg`, sub: trend ? `${signed(trend.perWeek, 2)} kg a week` : shortDate(lastW.date) });
  if (lastC) tiles.push({ label: 'Waist', value: `${lastC.value.toFixed(1)} cm`, sub: wTrend ? `${signed(wTrend.perWeek, 1)} cm a week` : shortDate(lastC.date) });

  return (
    <div className="screen fade">
      <div className="head">
        <span style={{ fontSize: 17, fontWeight: 600, padding: '0 6px' }}>Body</span>
      </div>
      <div className="scroll pad-tab">
        <div style={{ marginTop: 18, display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', padding: '0 4px 10px' }}>
          <span className="label" style={{ padding: 0 }}>Check-in</span>
          <span style={{ fontSize: 12, fontWeight: 600, color: due ? 'var(--danger)' : 'var(--muted)' }}>
            {since === null ? 'Once a week, same day' : due ? `Due · last ${since} days ago` : since === 0 ? 'Done today' : `Next in ${7 - since} ${7 - since === 1 ? 'day' : 'days'}`}
          </span>
        </div>
        <CheckInForm key={date} data={data} today={today} date={date} setDate={setDate} onSaved={onSaved} />

        {tiles.length > 0 && (
          <div style={{ display: 'grid', gridTemplateColumns: `repeat(${tiles.length},1fr)`, gap: 8, marginTop: 22 }}>
            {tiles.map(t => (
              <div key={t.label} className="card" style={{ padding: 14 }}>
                <div style={{ fontSize: 13, color: 'var(--muted)', fontWeight: 600 }}>{t.label}</div>
                <div className="num" style={{ fontSize: 22, fontWeight: 700, marginTop: 4 }}>{t.value}</div>
                <div className="num" style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>{t.sub}</div>
              </div>
            ))}
          </div>
        )}

        {m.status === 'ok' && (
          <div className="card" style={{ marginTop: 8 }}>
            <div className="row" style={{ cursor: 'default' }}>
              <div style={{ minWidth: 0 }}>
                <div className="row-name">Maintenance by your log</div>
                <div className="row-sub">
                  ± {fmt(round50(m.range))} kcal{goal > 0 ? ` · at your goal ${signed(((goal - m.kcal) * 7) / KCAL_PER_KG, 2)} kg a week` : ''}
                </div>
              </div>
              <div className="num" style={{ fontSize: 16, fontWeight: 600, flex: 'none' }}>≈ {fmt(round50(m.kcal))} kcal</div>
            </div>
          </div>
        )}

        <section style={{ marginTop: 26 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', padding: '0 4px 10px', gap: 8 }}>
            <span className="label" style={{ padding: 0 }}>Last 7 days</span>
            <span style={{ fontSize: 12, color: 'var(--muted)', textAlign: 'right' }}>{review.summary}</span>
          </div>
          <div className="card">
            {review.blocks.map(b => <ReviewRow key={b.key} b={b} />)}
          </div>
          <div style={{ fontSize: 11, color: 'var(--faint)', padding: '8px 6px 0', textWrap: 'pretty' }}>
            {`${shortDate(review.from)} – ${shortDate(shift(review.to, -1))}. Today isn’t counted until it’s over. Readings of food and weight are hints from your own log, not a diagnosis.`}
          </div>
        </section>

        {insights.length > 0 && (
          <section style={{ marginTop: 26 }}>
            <div className="label" style={{ padding: '0 4px 10px' }}>Longer view</div>
            <div className="card">
              {insights.map(i => <InsightRow key={i.key} i={i} />)}
            </div>
          </section>
        )}

        {(weights.length >= 2 || waists.length >= 2) && (
          <section style={{ marginTop: 26 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 4px' }}>
              <span className="label" style={{ padding: 0 }}>Over time</span>
              <div style={{ width: 160 }}>
                <Segmented small value={range} options={[['12w', '12 weeks'], ['all', 'All']]} onChange={setRange} />
              </div>
            </div>
            <LineChart key={`w${range}`} title="Weight" unit="kg" points={weights} trend={trend} from={from} />
            <LineChart key={`c${range}`} title="Waist" unit="cm" points={waists} trend={wTrend} from={from} />
          </section>
        )}

        {list.length > 0 && (
          <section style={{ marginTop: 26 }}>
            <div className="label" style={{ padding: '0 4px 10px' }}>History</div>
            <div className="card">
              {(allRows ? list : list.slice(0, 6)).map(c => {
                // the change against the check-in at least 6 days before: over fewer days it's water, not worth a number
                const older = list.find(o => o.weight && dayNo(c.date) - dayNo(o.date) >= BODY.minSpan);
                const dKg = c.weight && older?.weight ? c.weight - older.weight : null;
                return (
                  <button
                    key={c.date}
                    className="row"
                    onClick={() => {
                      setDate(c.date);
                      document.querySelector('.scroll')?.scrollTo({ top: 0, behavior: 'smooth' });
                    }}
                    aria-label={`Edit the check-in of ${dayLabel(c.date, today)}`}
                  >
                    <div style={{ minWidth: 0 }}>
                      <div className="row-name">{dayLabel(c.date, today)}</div>
                      <div className="row-sub">{c.waist ? `waist ${c.waist.toFixed(1)} cm` : 'no waist'}</div>
                    </div>
                    <div style={{ textAlign: 'right', flex: 'none' }}>
                      <div className="num" style={{ fontSize: 16, fontWeight: 600 }}>{c.weight ? `${c.weight.toFixed(1)} kg` : '—'}</div>
                      {dKg !== null && <div className="num" style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>{signed(dKg)} kg in {dayNo(c.date) - dayNo(older!.date)} d</div>}
                    </div>
                  </button>
                );
              })}
            </div>
            {list.length > 6 && (
              <button className="btn-ghost" onClick={() => setAllRows(a => !a)}>{allRows ? 'Show fewer' : `Show all ${list.length}`}</button>
            )}
          </section>
        )}

        {!list.length && (
          <div className="secondary" style={{ marginTop: 22, padding: '0 8px', textAlign: 'center', textWrap: 'pretty' }}>
            Weigh in once a week, on the same day and in the same conditions. After a few weeks this screen shows the trend, your maintenance calories and how your eating moved the numbers.
          </div>
        )}
      </div>
    </div>
  );
}
