import { useState } from 'react';
import { api } from '../api/client';
import { auth } from '../api/auth';
import { ErrorNotice } from '../components/ui';

/**
 * Forgotten password, by emailed code.
 *
 * Two steps on purpose. The first always reports the same thing — "if that
 * address has an account, a code is on its way" — because an honest "no such
 * account" here would turn this page into a way to find out who has one. The
 * second takes the code and the new password together, so a correct code is
 * spent only when there is actually a password to set.
 */
export default function ForgotPassword({ onBack }: { onBack: () => void }) {
  const [step, setStep] = useState<'request' | 'code'>('request');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const request = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const out = await api.forgotPassword(email.trim());
      setNotice(out.message);
      setStep('code');
    } catch (e) {
      setError((e as Error)?.message || 'Could not send a code right now.');
    } finally {
      setBusy(false);
    }
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (password.length < 8) return setError('Password must be at least 8 characters.');
    if (password !== confirmPassword) return setError('The two passwords do not match.');

    setBusy(true);
    try {
      const out = await api.resetPassword(email.trim(), code.trim(), password);
      auth.set(out.token); // a successful reset signs them in
    } catch (e) {
      setError((e as Error)?.message || 'That code is not valid. Ask for a new one.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ display: 'grid', placeItems: 'center', minHeight: '100vh', padding: 20 }}>
      <div className="card" style={{ width: '100%', maxWidth: 360 }}>
        <div className="brand" style={{ marginBottom: 16 }}>
          Home<span>Guardian</span>
        </div>

        {error && <ErrorNotice message={error} onDismiss={() => setError(null)} />}

        {step === 'request' ? (
          <form onSubmit={request} className="grid" style={{ gap: 10 }}>
            <div style={{ fontSize: 15, fontWeight: 600 }}>Reset your password</div>
            <div className="muted" style={{ fontSize: 12 }}>
              We will email you a 6-digit code.
            </div>
            <input
              type="email"
              placeholder="Your email address"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
              autoCapitalize="none"
              autoCorrect="off"
              autoFocus
              required
            />
            <button type="submit" disabled={busy}>
              {busy ? 'Sending…' : 'Send me a code'}
            </button>
            <button type="button" className="ghost" onClick={onBack}>
              Back to sign in
            </button>
          </form>
        ) : (
          <form onSubmit={submit} className="grid" style={{ gap: 10 }}>
            {notice && (
              <div className="badge ok" style={{ display: 'block' }}>
                {notice}
              </div>
            )}
            <input
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="[0-9]*"
              maxLength={6}
              placeholder="6-digit code"
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
              style={{ letterSpacing: 6, fontSize: 18, textAlign: 'center' }}
              autoFocus
              required
            />
            <input
              type="password"
              placeholder="New password (at least 8 characters)"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="new-password"
              required
            />
            <input
              type="password"
              placeholder="Type it again"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              autoComplete="new-password"
              required
            />
            <button type="submit" disabled={busy}>
              {busy ? 'Checking…' : 'Set new password'}
            </button>
            <div className="muted" style={{ fontSize: 12 }}>
              The code expires in 10 minutes and works once.
            </div>
            <button
              type="button"
              className="ghost"
              onClick={() => {
                setStep('request');
                setCode('');
                setNotice(null);
              }}
            >
              Use a different address
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
