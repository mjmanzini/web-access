import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import './styles.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </React.StrictMode>,
);

// Register after load so it never competes with the first paint. Registration
// happens on an already-authenticated page, so the request for /sw.js carries
// the Cloudflare Access cookie; a failure here is non-fatal by design — the
// dashboard works fine without it, it just isn't installable.
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {
      /* not installable (no HTTPS, or Access blocked the fetch) — ignore */
    });
  });
}
