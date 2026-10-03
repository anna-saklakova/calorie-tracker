import { useState } from 'react';
import { Logo } from '../components/icons';
import { sendEmailLink, signInWithGoogle, syncAvailable } from '../lib/supabase';

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export function SignIn({ onSkip, onError }: { onSkip: () => void; onError: (msg: string) => void }) {
  const [email, setEmail] = useState('');
  const [sentTo, setSentTo] = useState('');
  const [busy, setBusy] = useState(false);
  const valid = EMAIL_RE.test(email.trim());

  const google = async () => {
    try {
      setBusy(true);
      await signInWithGoogle(); // redirects away
    } catch (e) {
      setBusy(false);
      onError(errorText(e));
    }
  };
  const sendLink = async () => {
    if (!valid) return;
    try {
      setBusy(true);
      await sendEmailLink(email.trim());
      setSentTo(email.trim());
    } catch (e) {
      onError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="screen" style={{ padding: '0 28px calc(32px + var(--safe-b))', animation: 'ctFade .3s' }}>
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
        <Logo />
        <h1 style={{ fontSize: 34, fontWeight: 600, letterSpacing: -1, lineHeight: 1.1, margin: '28px 0 0', textWrap: 'pretty' }}>Food log that keeps up with you</h1>
        <div style={{ fontSize: 16, color: 'var(--muted)', marginTop: 12, lineHeight: 1.45, textWrap: 'pretty' }}>
          Sign in to keep your days and library synced across devices. You can also start without an account and connect one later.
        </div>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {syncAvailable ? (
          <>
            <button className="btn-dark" onClick={google} disabled={busy}>
              <span style={{ width: 20, height: 20, borderRadius: '50%', background: '#fff', display: 'grid', placeItems: 'center', fontSize: 12, fontWeight: 700, color: 'var(--ink)' }}>G</span>
              Continue with Google
            </button>
            <form
              onSubmit={e => {
                e.preventDefault();
                sendLink();
              }}
              style={{ display: 'flex', alignItems: 'center', gap: 10, background: '#fff', borderRadius: 18, height: 56, padding: '0 6px 0 18px' }}
            >
              <input
                value={email}
                onChange={e => {
                  setEmail(e.target.value);
                  setSentTo('');
                }}
                type="email"
                autoComplete="email"
                placeholder="Email"
                aria-label="Email"
                style={{ flex: 1, minWidth: 0, border: 'none', background: 'transparent', fontSize: 16 }}
              />
              <button type="submit" disabled={!valid || busy} style={{ height: 44, padding: '0 16px', borderRadius: 14, border: 'none', background: valid ? 'var(--accent)' : 'var(--disabled)', color: '#fff', fontSize: 14, fontWeight: 600 }}>
                Send link
              </button>
            </form>
            {sentTo && <div style={{ fontSize: 13, color: 'var(--accent-ink)', textAlign: 'center' }}>Link sent to {sentTo}. Check your inbox.</div>}
          </>
        ) : (
          <div style={{ fontSize: 13, color: 'var(--muted)', textAlign: 'center', lineHeight: 1.45, padding: '0 8px' }}>
            Sync isn’t set up in this build yet. Your data stays on this phone.
          </div>
        )}
        <button className="btn-ghost" style={{ color: 'var(--muted)' }} onClick={onSkip}>
          Continue without an account
        </button>
        <div style={{ fontSize: 12, color: 'var(--faint)', textAlign: 'center', lineHeight: 1.4 }}>Photos are processed to recognize food and not kept after that.</div>
      </div>
    </div>
  );
}

function errorText(e: unknown) {
  const msg = e instanceof Error ? e.message : '';
  return /rate|too many/i.test(msg) ? 'Too many tries. Wait a minute and try again' : 'Couldn’t sign in. Check your connection and try again';
}
