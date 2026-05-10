'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { dismissToast, subscribeToasts, type Toast } from '../../lib/notifications';

export function Toaster() {
  const [toasts, setToasts] = useState<Toast[]>([]);
  useEffect(() => {
    const off = subscribeToasts(setToasts);
    return () => { off(); };
  }, []);

  if (toasts.length === 0) return null;

  return (
    <div className="toaster" role="status" aria-live="polite">
      {toasts.map((t) => {
        const inner = (
          <>
            {t.avatarUrl ? (
              <img src={t.avatarUrl} alt="" className="toast-avatar" />
            ) : (
              <span className={`toast-icon toast-icon-${t.kind}`} aria-hidden>
                {t.kind === 'error' ? '⚠' : t.kind === 'success' ? '✓' : t.kind === 'message' ? '💬' : 'ℹ'}
              </span>
            )}
            <div className="toast-body">
              <strong className="toast-title">{t.title}</strong>
              {t.body && <span className="toast-text">{t.body}</span>}
            </div>
            <button
              className="toast-close"
              type="button"
              aria-label="Dismiss"
              onClick={(e) => { e.preventDefault(); e.stopPropagation(); dismissToast(t.id); }}
            >×</button>
          </>
        );

        const className = `toast toast-${t.kind}`;
        return t.href ? (
          <Link
            key={t.id}
            href={t.href}
            className={className}
            onClick={() => dismissToast(t.id)}
          >
            {inner}
          </Link>
        ) : (
          <div key={t.id} className={className}>{inner}</div>
        );
      })}
    </div>
  );
}
