'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { webauthn } from '../../lib/auth/webauthn-client';
import { api, saveStoredUser, type StoredUser } from '../../lib/user-session';

/**
 * Frictionless 2-step onboarding:
 *   1. Name
 *   2. Email or phone (one of)
 *  +  Optional: register a passkey (Face ID / fingerprint) on supported devices.
 */
export default function OnboardingPage() {
  const router = useRouter();
  const [step, setStep] = useState<1 | 2>(1);
  const [name, setName] = useState('');
  const [contact, setContact] = useState(''); // email or phone
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [biomDone, setBiomDone] = useState(false);
  const [biomSupported, setBiomSupported] = useState<boolean | null>(null);

  const next = () => {
    setErr(null);
    if (step === 1) {
      if (name.trim().length < 2) return setErr('Please enter your name.');
      setStep(2);
      // probe biometric availability for the next pane
      Promise.all([webauthn.isSupported(), webauthn.hasPlatformAuthenticator()])
        .then(([s, p]) => setBiomSupported(s && p))
        .catch(() => setBiomSupported(false));
    } else {
      finish();
    }
  };

  const finish = async () => {
    setErr(null);
    const isEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contact);
    const isPhone = /^\+?[\d\s-]{7,}$/.test(contact);
    if (!isEmail && !isPhone) return setErr('Enter a valid email or phone number.');
    setBusy(true);
    try {
      const u = await api<StoredUser>('/api/auth/register', {
        method: 'POST',
        body: JSON.stringify({
          displayName: name.trim(),
          email: isEmail ? contact.trim() : undefined,
          phone: isPhone ? contact.trim() : undefined,
        }),
      });
      saveStoredUser(u);
      router.push('/chat');
    } catch (e) {
      setErr((e as Error).message ?? 'Registration failed');
    } finally {
      setBusy(false);
    }
  };

  const setupBiometrics = async () => {
    setErr(null); setBusy(true);
    try {
      await webauthn.register('This device');
      setBiomDone(true);
    } catch (e) {
      setErr('Could not register passkey: ' + (e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="onboard">
      <div className="card">
        <div className="step-dots">
          <span className={step >= 1 ? 'on' : ''} />
          <span className={step >= 2 ? 'on' : ''} />
        </div>

        {step === 1 && (
          <>
            <h1>Welcome 👋</h1>
            <p className="sub">What should we call you?</p>
            <label htmlFor="n">Name</label>
            <input id="n" autoFocus value={name} onChange={(e) => setName(e.target.value)}
                   onKeyDown={(e) => { if (e.key === 'Enter') next(); }}
                   placeholder="Jane Doe" />
          </>
        )}

        {step === 2 && (
          <>
            <h1>Almost done</h1>
            <p className="sub">We need one way to reach you for calls and invites.</p>
            <label htmlFor="c">Email or phone</label>
            <input id="c" autoFocus value={contact} onChange={(e) => setContact(e.target.value)}
                   onKeyDown={(e) => { if (e.key === 'Enter') next(); }}
                   placeholder="you@example.com or +1 555 0123" />

            {biomSupported && !biomDone && (
              <div className="biom">
                <strong style={{ color: 'var(--wa-text)' }}>Faster sign-in</strong><br />
                Use Face ID, Touch ID or your fingerprint to log back in.
                <button
                  onClick={setupBiometrics}
                  disabled={busy}
                  style={{
                    marginTop: 10, padding: '8px 14px', borderRadius: 6,
                    background: 'var(--wa-accent)', color: '#fff', fontWeight: 600,
                  }}
                >
                  Set up biometrics
                </button>
              </div>
            )}
            {biomDone && <div className="biom" style={{ borderStyle: 'solid' }}>✓ Passkey registered.</div>}
          </>
        )}

        {err && <div className="err">{err}</div>}

        <button
          onClick={next}
          disabled={busy}
          style={{
            marginTop: 22, width: '100%', height: 44,
            background: 'var(--wa-accent)', color: '#fff',
            borderRadius: 8, fontWeight: 600, fontSize: 14,
          }}
        >
          {busy ? 'Working…' : step === 1 ? 'Continue' : 'Finish'}
        </button>
      </div>
    </div>
  );
}
