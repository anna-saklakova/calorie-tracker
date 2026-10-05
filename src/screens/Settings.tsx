import { useEffect, useState } from 'react';
import { ChevronRight } from '../components/icons';
import { NumInput, Segmented, SubHeader } from '../components/ui';
import { convertMacroGoal, macroTargets } from '../lib/nutrition';
import { liveLibrary, updateSettings } from '../lib/store';
import { syncLabel } from '../lib/sync';
import type { SyncState } from '../lib/sync';
import type { Data, Settings as S } from '../lib/types';

interface Props {
  data: Data;
  sync: SyncState;
  onBack: () => void;
  onPassword: () => void;
  onSignOut: () => void;
  onExport: () => void;
}

const MACROS: ['p' | 'f' | 'c', string, string][] = [['p', 'Protein', 'var(--rose-ink)'], ['f', 'Fat', 'var(--peach-ink)'], ['c', 'Carbs', 'var(--accent-ink)']];

export function Settings({ data, sync, onBack, onPassword, onSignOut, onExport }: Props) {
  const s = data.settings;
  const t = macroTargets(s);
  const hasGoal = s.goal > 0;
  const [goalText, setGoalText] = useState(s.goal ? String(s.goal) : '');
  // re-render every minute so "Synced · n min ago" stays current
  const [, tick] = useState(0);
  useEffect(() => {
    const iv = setInterval(() => tick(n => n + 1), 60000);
    return () => clearInterval(iv);
  }, []);

  const macroSum =
    s.macroMode === 'pct'
      ? t.pctSum === 100 ? 'Adds up to 100%' : `Adds up to ${t.pctSum}%, should be 100`
      : `≈ ${t.gramsKcal} kcal` + (hasGoal ? ` · ${t.pct.p} / ${t.pct.f} / ${t.pct.c} %` : '');

  const user = sync.user;
  const email = user?.email ?? '';
  const initial = (user?.user_metadata?.full_name || email || '?')[0]?.toUpperCase();
  // accounts created with a password have an "email" identity; Google-only accounts don't
  const hasPassword = !!user?.identities?.some(i => i.provider === 'email');
  const days = Object.values(data.days).filter(d => d.meals.length).length;

  return (
    <div className="screen rise">
      <SubHeader title="Settings" onBack={onBack} />
      <div className="scroll" style={{ padding: '16px 20px calc(24px + var(--safe-b))' }}>
        <div className="card">
          <div className="row">
            <div>
              <div style={{ fontSize: 16, fontWeight: 600 }}>Daily goal</div>
              <div className="row-sub">From today on · past days keep theirs</div>
            </div>
            <div className="input-wrap">
              <NumInput
                value={goalText}
                ariaLabel="Daily goal in kcal"
                placeholder="—"
                onChange={v => {
                  setGoalText(v);
                  updateSettings({ goal: Math.max(0, Math.round(+v || 0)) });
                }}
                className="num"
                style={{ width: 64, fontSize: 16, fontWeight: 600, textAlign: 'right' }}
              />
              <span className="unit">kcal</span>
            </div>
          </div>

          <div className="row-sep" style={{ padding: '14px 16px' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
              <div>
                <div style={{ fontSize: 16, fontWeight: 600 }}>Macro goal</div>
                <div className="row-sub">{s.macroMode === 'pct' ? 'Share of calories from each' : 'Grams per day'}</div>
              </div>
              <Segmented<S['macroMode']> value={s.macroMode} options={[['pct', '%'], ['g', 'Grams']]} onChange={m => updateSettings({ macroMode: m, macroGoal: convertMacroGoal(s, m) })} />
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 8, marginTop: 12 }}>
              {MACROS.map(([k, label, color]) => (
                <label key={k} className="field">
                  <span style={{ color }}>{label}</span>
                  <div style={{ display: 'flex', alignItems: 'center', background: 'var(--bg)', borderRadius: 10, height: 44, padding: '0 10px' }}>
                    <NumInput
                      value={s.macroGoal[k]}
                      onChange={v => updateSettings({ macroGoal: { ...s.macroGoal, [k]: v === '' ? '' : +v } })}
                      className="num"
                      style={{ width: '100%', minWidth: 0, border: 'none', background: 'transparent', fontSize: 15, fontWeight: 600 }}
                    />
                    <span style={{ fontSize: 12, color: 'var(--muted)' }}>{s.macroMode === 'pct' ? '%' : 'g'}</span>
                  </div>
                </label>
              ))}
            </div>
            <div style={{ fontSize: 12, color: s.macroMode === 'pct' && t.pctSum !== 100 ? 'var(--est)' : 'var(--muted)', marginTop: 8 }}>{macroSum}</div>
          </div>

          <div className="row row-sep">
            <div>
              <div style={{ fontSize: 16, fontWeight: 600 }}>Amounts</div>
              <div className="row-sub">How new items are entered</div>
            </div>
            <Segmented<S['units']> value={s.units} options={[['g', 'Grams'], ['portion', 'Portions']]} onChange={u => updateSettings({ units: u })} />
          </div>
        </div>

        <div className="card" style={{ marginTop: 12 }}>
          <div className="row">
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
              <div style={{ width: 40, height: 40, borderRadius: '50%', background: 'var(--accent)', color: '#fff', display: 'grid', placeItems: 'center', fontSize: 15, fontWeight: 700, flex: 'none' }}>
                {initial}
              </div>
              <div style={{ minWidth: 0 }}>
                <div className="row-name">{email}</div>
                <div className="row-sub" style={{ color: sync.save === 'offline' || sync.save === 'error' ? 'var(--danger)' : undefined }}>{syncLabel(sync)}</div>
              </div>
            </div>
            <button className="pill-btn" style={{ height: 36, padding: '0 14px', flex: 'none' }} onClick={onSignOut}>
              Sign out
            </button>
          </div>
          <button className="row row-sep" onClick={onPassword}>
            <div>
              <div style={{ fontSize: 16, fontWeight: 600 }}>{hasPassword ? 'Change password' : 'Set a password'}</div>
              <div className="row-sub">{hasPassword ? 'For signing in with email' : 'To sign in with email too, not only Google'}</div>
            </div>
            <ChevronRight small color="var(--faint)" />
          </button>
          <button className="row row-sep" onClick={onExport}>
            <div>
              <div style={{ fontSize: 16, fontWeight: 600 }}>Export data</div>
              <div className="row-sub">{days} {days === 1 ? 'day' : 'days'} · {liveLibrary(data).length} {liveLibrary(data).length === 1 ? 'product' : 'products'} · JSON</div>
            </div>
            <ChevronRight small color="var(--faint)" />
          </button>
        </div>
        <div style={{ fontSize: 12, color: 'var(--faint)', marginTop: 20, padding: '0 4px' }}>Version {__APP_VERSION__}</div>
      </div>
    </div>
  );
}
