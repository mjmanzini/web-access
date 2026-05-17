'use client';

import { useEffect, useRef, useState } from 'react';
import { triggerPanic } from './client';
import { loadStoredUser, signalingUrl } from '../user-session';

const HOLD_MS = 1500;

/**
 * Long-press hook for the floating Panic button.
 * Hold ≥1.5s → confirm modal → trigger fan-out.
 */
export function usePanicLongPress() {
  const timer = useRef<number | null>(null);
  const [pressing, setPressing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent,  setSent]  = useState(false);

  function start() {
    setPressing(true);
    timer.current = window.setTimeout(() => {
      setPressing(false);
      setConfirming(true);
    }, HOLD_MS);
  }
  function cancel() {
    setPressing(false);
    if (timer.current) { window.clearTimeout(timer.current); timer.current = null; }
  }

  async function confirm(note?: string) {
    const u = loadStoredUser();
    if (!u) return;
    setBusy(true); setError(null);
    try {
      await triggerPanic(signalingUrl(), u.token, note);
      setSent(true);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
      setConfirming(false);
    }
  }

  function dismiss() {
    setConfirming(false); setSent(false); setError(null);
  }

  useEffect(() => () => { if (timer.current) window.clearTimeout(timer.current); }, []);

  return {
    handlers: {
      onMouseDown: start,
      onMouseUp: cancel,
      onMouseLeave: cancel,
      onTouchStart: start,
      onTouchEnd: cancel,
      onTouchCancel: cancel,
    },
    pressing, confirming, busy, error, sent,
    confirm, dismiss,
  };
}

export function PanicButton({ className = '' }: { className?: string }) {
  const p = usePanicLongPress();
  return (
    <>
      <button
        type="button"
        aria-label="Panic — hold 1.5 seconds"
        className={className}
        style={{
          position: 'fixed',
          right: 16, bottom: 16,
          width: 56, height: 56, borderRadius: 28,
          background: p.pressing ? '#ff4d4d' : 'tomato',
          color: '#fff',
          border: 'none',
          fontWeight: 800,
          boxShadow: '0 4px 12px rgba(0,0,0,0.25)',
          cursor: 'pointer',
          zIndex: 1000,
          transition: 'background 0.2s',
        }}
        {...p.handlers}
      >
        SOS
      </button>
      {p.confirming && (
        <div
          role="dialog"
          aria-modal="true"
          style={{
            position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)',
            display: 'grid', placeItems: 'center', zIndex: 1001,
          }}
        >
          <div style={{ background: 'var(--wa-bg, #fff)', padding: 24, borderRadius: 12, maxWidth: 360 }}>
            <h3 style={{ margin: 0 }}>Send panic alert?</h3>
            <p style={{ fontSize: 14 }}>
              Your trusted contacts will be notified by email (and SMS, if configured).
              In a real emergency call <strong>10111</strong> or <strong>112</strong>.
            </p>
            {p.error && <p style={{ color: 'tomato', fontSize: 13 }}>{p.error}</p>}
            {p.sent  && <p style={{ color: 'var(--wa-accent, #0a0)', fontSize: 13 }}>Alert sent.</p>}
            <div className="row" style={{ gap: 8, justifyContent: 'flex-end' }}>
              <button className="add-contact-secondary" onClick={p.dismiss}>Cancel</button>
              <button
                className="wa-primary-btn"
                disabled={p.busy || p.sent}
                onClick={() => void p.confirm()}
                style={{ background: 'tomato', color: '#fff' }}
              >
                {p.busy ? 'Sending…' : p.sent ? 'Sent' : 'Send alert'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
