'use client';

/**
 * /onboarding/callback — destination of the server-side OAuth callback.
 *
 * The signaling server redirects here with `?token=...&provider=...&new=0|1`
 * after completing the OAuth code exchange. We hydrate the local session and
 * forward to the chat (or the original `return` path).
 */
import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { loginWithToken } from '../../../lib/user-session';

function CallbackInner() {
  const router = useRouter();
  const params = useSearchParams();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const token = params.get('token');
    const ret = params.get('return') || '/chat';
    const errParam = params.get('error');
    if (errParam) {
      setError(errParam);
      const t = setTimeout(() => router.replace('/onboarding'), 1500);
      return () => clearTimeout(t);
    }
    if (!token) {
      setError('missing_token');
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const user = await loginWithToken(token);
        if (cancelled) return;
        if (!user) throw new Error('invalid_token');
        router.replace(ret.startsWith('/') ? ret : '/chat');
      } catch (e) {
        if (!cancelled) setError((e as Error).message || 'login_failed');
      }
    })();
    return () => { cancelled = true; };
  }, [params, router]);

  return (
    <div className="onboard">
      <div className="card" style={{ textAlign: 'center' }}>
        {error ? (
          <>
            <h1>Sign-in failed</h1>
            <p className="sub">{error}</p>
            <button onClick={() => router.replace('/onboarding')}>Back to sign in</button>
          </>
        ) : (
          <>
            <h1>Signing you in…</h1>
            <p className="sub">One moment.</p>
          </>
        )}
      </div>
    </div>
  );
}

export default function OAuthCallbackPage() {
  return (
    <Suspense fallback={<div className="onboard"><div className="card"><h1>Signing you in…</h1></div></div>}>
      <CallbackInner />
    </Suspense>
  );
}
