import { useState } from 'react';
import type { ReactNode } from 'react';
import { Logo } from '../components/icons';
import { SubHeader } from '../components/ui';
import { authErrorText, resendConfirmation, sendPasswordReset, setNewPassword, signInWithGoogle, signInWithPassword, signUp } from '../lib/supabase';

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
export const MIN_PASSWORD = 8;

type Mode = 'signin' | 'signup' | 'forgot';

/** The only screen a signed-out user sees: sign in, create an account or reset the password. */
export function SignIn({ initialError }: { initialError?: string | null }) {
  const [mode, setMode] = useState<Mode>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [password2, setPassword2] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(initialError ?? '');
  const [notice, setNotice] = useState('');
  /** set when the account exists but its email isn't confirmed yet */
  const [unconfirmed, setUnconfirmed] = useState('');

  const mail = email.trim();
  const emailOk = EMAIL_RE.test(mail);
  const canSubmit =
    !busy &&
    emailOk &&
    (mode === 'forgot' || (mode === 'signin' ? password.length > 0 : password.length >= MIN_PASSWORD && password === password2));

  const switchMode = (m: Mode) => {
    setMode(m);
    setError('');
    setNotice('');
    setUnconfirmed('');
    setPassword('');
    setPassword2('');
  };

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await fn();
    } catch (e) {
      const code = (e as { code?: string }).code;
      if (code === 'email_not_confirmed' || /not confirmed/i.test((e as Error).message ?? '')) setUnconfirmed(mail);
      setError(authErrorText(e));
    } finally {
      setBusy(false);
    }
  };

  const submit = () => {
    if (!canSubmit) return;
    if (mode === 'signin') return run(() => signInWithPassword(mail, password));
    if (mode === 'forgot')
      return run(async () => {
        await sendPasswordReset(mail);
        setNotice(`If ${mail} has an account, a reset link is on its way. Open it on this device.`);
      });
    return run(async () => {
      const res = await signUp(mail, password);
      if (res === 'exists') {
        setMode('signin');
        setPassword('');
        setPassword2('');
        setError('This email already has an account. Sign in, or reset your password');
      } else if (res === 'confirm') {
        setNotice(`Almost done. We sent a confirmation link to ${mail}. Open it to finish creating your account.`);
        setUnconfirmed(mail);
      }
      // 'signed-in': the session listener takes over
    });
  };

  const google = () => run(signInWithGoogle); // redirects away

  const title = mode === 'signin' ? 'Food log that keeps up with you' : mode === 'signup' ? 'Create your account' : 'Reset your password';
  const sub =
    mode === 'signin'
      ? 'Sign in to see your days and library on any device.'
      : mode === 'signup'
        ? 'Your log is saved to your account, so it’s there on any device you sign in on.'
        : 'Enter your email and we’ll send you a link to set a new password.';

  return (
    <div className="screen" style={{ animation: 'ctFade .3s' }}>
      {mode !== 'signin' && <SubHeader title="" onBack={() => switchMode('signin')} />}
      <div className="scroll" style={{ display: 'flex', flexDirection: 'column', padding: '0 28px calc(28px + var(--safe-b))' }}>
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center', padding: '32px 0 24px' }}>
          {mode === 'signin' && <Logo />}
          <h1 style={{ fontSize: mode === 'signin' ? 34 : 28, fontWeight: 600, letterSpacing: -1, lineHeight: 1.1, margin: mode === 'signin' ? '28px 0 0' : 0, textWrap: 'pretty' }}>{title}</h1>
          <div style={{ fontSize: 16, color: 'var(--muted)', marginTop: 12, lineHeight: 1.45, textWrap: 'pretty' }}>{sub}</div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {mode !== 'forgot' && (
            <>
              <button className="btn-dark" onClick={google} disabled={busy}>
                <span style={{ width: 20, height: 20, borderRadius: '50%', background: '#fff', display: 'grid', placeItems: 'center', fontSize: 12, fontWeight: 700, color: 'var(--ink)' }}>G</span>
                Continue with Google
              </button>
              <div className="auth-or">or with email</div>
            </>
          )}

          <form
            onSubmit={e => {
              e.preventDefault();
              submit();
            }}
            style={{ display: 'flex', flexDirection: 'column', gap: 10 }}
          >
            <input className="auth-input" value={email} onChange={e => setEmail(e.target.value)} type="email" autoComplete="email" placeholder="Email" aria-label="Email" />
            {mode !== 'forgot' && (
              <PasswordInput value={password} onChange={setPassword} placeholder={mode === 'signup' ? `Password · ${MIN_PASSWORD}+ characters` : 'Password'} autoComplete={mode === 'signup' ? 'new-password' : 'current-password'} />
            )}
            {mode === 'signup' && <PasswordInput value={password2} onChange={setPassword2} placeholder="Repeat password" autoComplete="new-password" />}
            {mode === 'signup' && password2 && password !== password2 && <Note tone="error">Passwords don’t match</Note>}
            {mode === 'signup' && password && password.length < MIN_PASSWORD && <Note>At least {MIN_PASSWORD} characters</Note>}

            {error && <Note tone="error">{error}</Note>}
            {notice && <Note tone="ok">{notice}</Note>}

            <button type="submit" className="btn-primary" disabled={!canSubmit}>
              {busy ? 'One moment…' : mode === 'signin' ? 'Sign in' : mode === 'signup' ? 'Create account' : 'Send reset link'}
            </button>
          </form>

          {unconfirmed && (
            <button
              className="btn-ghost"
              disabled={busy}
              onClick={() =>
                run(async () => {
                  await resendConfirmation(unconfirmed);
                  setNotice(`Sent a new confirmation link to ${unconfirmed}.`);
                })
              }
            >
              Resend confirmation email
            </button>
          )}

          {mode === 'signin' && (
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
              <button className="btn-ghost" style={{ width: 'auto', padding: '0 4px', color: 'var(--muted)' }} onClick={() => switchMode('forgot')}>
                Forgot password?
              </button>
              <button className="btn-ghost" style={{ width: 'auto', padding: '0 4px', color: 'var(--accent-ink)' }} onClick={() => switchMode('signup')}>
                Create account
              </button>
            </div>
          )}
          {mode === 'signup' && (
            <button className="btn-ghost" style={{ color: 'var(--muted)' }} onClick={() => switchMode('signin')}>
              Already have an account? Sign in
            </button>
          )}
          <div style={{ fontSize: 12, color: 'var(--faint)', textAlign: 'center', lineHeight: 1.4, marginTop: 4 }}>
            One email, one account: Google and password sign-in open the same log. Photos are processed to recognize food and not kept after that.
          </div>
        </div>
      </div>
    </div>
  );
}

/** Set a new password: after a reset link (no way back) or from Settings (with Back). */
export function SetPassword({ email, onDone, onBack }: { email: string; onDone: () => void; onBack?: () => void }) {
  const [password, setPassword] = useState('');
  const [password2, setPassword2] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const ok = password.length >= MIN_PASSWORD && password === password2 && !busy;

  const save = async () => {
    if (!ok) return;
    setBusy(true);
    setError('');
    try {
      await setNewPassword(password);
      onDone();
    } catch (e) {
      setError(authErrorText(e));
      setBusy(false);
    }
  };

  return (
    <div className="screen rise">
      {onBack ? <SubHeader title="Password" onBack={onBack} /> : <div style={{ height: 62 }} />}
      <div className="scroll" style={{ padding: '24px 28px calc(28px + var(--safe-b))' }}>
        <h1 style={{ fontSize: 28, fontWeight: 600, letterSpacing: -1, lineHeight: 1.1, margin: 0 }}>Set a new password</h1>
        <div style={{ fontSize: 16, color: 'var(--muted)', marginTop: 12, lineHeight: 1.45 }}>
          For {email}. You can then sign in with this password or with Google, and you’ll get the same log.
        </div>
        <form
          onSubmit={e => {
            e.preventDefault();
            save();
          }}
          style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 28 }}
        >
          <input type="email" value={email} autoComplete="username" readOnly hidden />
          <PasswordInput value={password} onChange={setPassword} placeholder={`New password · ${MIN_PASSWORD}+ characters`} autoComplete="new-password" />
          <PasswordInput value={password2} onChange={setPassword2} placeholder="Repeat password" autoComplete="new-password" />
          {password2 && password !== password2 && <Note tone="error">Passwords don’t match</Note>}
          {error && <Note tone="error">{error}</Note>}
          <button type="submit" className="btn-primary" disabled={!ok}>
            {busy ? 'One moment…' : 'Save password'}
          </button>
        </form>
      </div>
    </div>
  );
}

function PasswordInput({ value, onChange, placeholder, autoComplete }: { value: string; onChange: (v: string) => void; placeholder: string; autoComplete: string }) {
  const [show, setShow] = useState(false);
  return (
    <div className="auth-input" style={{ display: 'flex', alignItems: 'center', gap: 8, paddingRight: 6 }}>
      <input
        value={value}
        onChange={e => onChange(e.target.value)}
        type={show ? 'text' : 'password'}
        autoComplete={autoComplete}
        placeholder={placeholder}
        aria-label={placeholder}
        style={{ flex: 1, minWidth: 0, border: 'none', background: 'transparent', fontSize: 16, height: '100%' }}
      />
      <button type="button" onClick={() => setShow(s => !s)} style={{ border: 'none', background: 'transparent', color: 'var(--muted)', fontSize: 13, fontWeight: 600, padding: '0 10px', height: 40 }}>
        {show ? 'Hide' : 'Show'}
      </button>
    </div>
  );
}

function Note({ children, tone }: { children: ReactNode; tone?: 'error' | 'ok' }) {
  const color = tone === 'error' ? 'var(--danger)' : tone === 'ok' ? 'var(--accent-ink)' : 'var(--muted)';
  return <div style={{ fontSize: 13, color, lineHeight: 1.4, padding: '0 6px', textWrap: 'pretty' }}>{children}</div>;
}

/** Full-screen state while the session or the data loads, or when loading failed. */
type StateAction = { label: string; onClick: () => void };

export function AuthState({ title, body, action, secondary }: { title: string; body?: string; action?: StateAction; secondary?: StateAction }) {
  return (
    <div className="center-state">
      <Logo />
      <div className="state-title" style={{ marginTop: 24 }}>{title}</div>
      {body && <div className="state-body" style={{ whiteSpace: 'pre-line', wordBreak: 'break-word' }}>{body}</div>}
      {action && (
        <button className="btn-small-dark" style={{ marginTop: 20 }} onClick={action.onClick}>
          {action.label}
        </button>
      )}
      {secondary && (
        <button className="btn-ghost" style={{ width: 'auto', marginTop: 4, color: 'var(--muted)' }} onClick={secondary.onClick}>
          {secondary.label}
        </button>
      )}
    </div>
  );
}
