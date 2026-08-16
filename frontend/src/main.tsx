import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import { ConfirmProvider } from './components/ui';
import './styles.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <ConfirmProvider>
      <App />
      </ConfirmProvider>
    </BrowserRouter>
  </React.StrictMode>,
);

// Register after load so it never competes with the first paint. Registration
// happens on an already-authenticated page, so the request for /sw.js carries
// the Cloudflare Access cookie; a failure here is non-fatal by design — the
// dashboard works fine without it, it just isn't installable.
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register('/sw.js')
      .then((reg) => {
        // Check for a new build on every launch, and again hourly for a window
        // left open. Without this, an installed dashboard can sit on old code
        // indefinitely: signing out and back in does not touch the worker or
        // its cached assets, which is exactly how a shipped feature keeps
        // looking "missing" to the person who asked for it.
        reg.update().catch(() => {});
        setInterval(() => reg.update().catch(() => {}), 60 * 60 * 1000);

        // A waiting worker means a newer bundle is ready. Activate it and
        // reload once, rather than asking a parent on a phone to understand
        // service-worker lifecycles.
        const promote = () => {
          if (reg.waiting) reg.waiting.postMessage({ type: 'SKIP_WAITING' });
        };
        if (reg.waiting) promote();
        reg.addEventListener('updatefound', () => {
          const next = reg.installing;
          next?.addEventListener('statechange', () => {
            // "installed" with an existing controller == an update, not a
            // first install (which must not trigger a reload loop).
            if (next.state === 'installed' && navigator.serviceWorker.controller) promote();
          });
        });
      })
      .catch(() => {
        /* not installable (no HTTPS, or Access blocked the fetch) — ignore */
      });

    let reloading = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (reloading) return; // guard against the reload loop this can cause
      reloading = true;
      window.location.reload();
    });
  });
}
