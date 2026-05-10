// Web-Access service worker.
// Scope: the client is a real-time WebRTC viewer, so we deliberately do NOT
// cache HTML or API responses (/ice, /pair/*). We only cache static app-shell
// assets produced by Next.js under /_next/static/, plus the manifest + icons.

const STATIC_CACHE = 'webaccess-static-v1';
const PRECACHE = [
  '/',
  '/manifest.webmanifest',
  '/icons/icon-192.svg',
  '/icons/icon-512.svg',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(STATIC_CACHE).then((cache) => cache.addAll(PRECACHE).catch(() => {}))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== STATIC_CACHE).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // Never intercept cross-origin calls (signaling server lives on another host).
  if (url.origin !== self.location.origin) return;

  // Never cache the pairing page HTML so `?code=` flows always hit fresh JS.
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req).catch(() => caches.match('/').then((r) => r || Response.error()))
    );
    return;
  }

  // Cache-first for immutable Next.js static assets.
  if (url.pathname.startsWith('/_next/static/') || url.pathname.startsWith('/icons/')) {
    event.respondWith(
      caches.open(STATIC_CACHE).then(async (cache) => {
        const hit = await cache.match(req);
        if (hit) return hit;
        const res = await fetch(req);
        if (res.ok) cache.put(req, res.clone());
        return res;
      })
    );
  }
});

// ---------------------------------------------------------------------------
// Notifications
// ---------------------------------------------------------------------------

self.addEventListener('push', (event) => {
  let payload = {};
  try { payload = event.data ? event.data.json() : {}; } catch { payload = { title: event.data && event.data.text() }; }
  const title = payload.title || 'Web-Access';
  const opts = {
    body: payload.body || '',
    tag: payload.tag || 'web-access',
    icon: payload.icon || '/icons/icon-192.svg',
    badge: '/icons/icon-192.svg',
    data: { href: payload.href || '/chat' },
  };
  event.waitUntil(self.registration.showNotification(title, opts));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = (event.notification.data && event.notification.data.href) || '/chat';
  event.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const client of all) {
      try {
        const url = new URL(client.url);
        if (url.origin === self.location.origin) {
          await client.focus();
          if (target && url.pathname + url.hash !== target) {
            try { client.navigate(target); } catch { /* not supported */ }
          }
          return;
        }
      } catch { /* ignore */ }
    }
    await self.clients.openWindow(target);
  })());
});
