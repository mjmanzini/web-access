/* Home Guardian service worker.
 *
 * Scope is deliberately narrow. The dashboard sits behind Cloudflare Access,
 * and Access works by 302-ing unauthenticated requests to its login page and
 * setting a cookie. Two rules follow from that:
 *
 *   1. Never cache navigations or API calls. A cached page would be served to
 *      someone whose Access session has expired, and a cached API response
 *      could leak household data after sign-out.
 *   2. Never intercept cross-origin requests — the API lives on another host,
 *      and Access redirects must reach the network untouched.
 *
 * So this caches only same-origin, hashed build assets (which are immutable and
 * carry no data), and otherwise gets out of the way. Its real job is being the
 * push-notification receiver.
 */

const CACHE = 'hg-assets-v1';
const ASSET_PATHS = /^\/(assets|icons)\//;

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(caches.open(CACHE));
});

// The page asks the waiting worker to take over as soon as a new build is
// installed, so an update lands on the next launch instead of whenever the
// browser feels like it.
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Only same-origin GETs for build assets. Everything else — navigations, API
  // calls, Access redirects — goes straight to the network, uncached.
  if (
    request.method !== 'GET' ||
    url.origin !== self.location.origin ||
    !ASSET_PATHS.test(url.pathname)
  ) {
    return;
  }

  event.respondWith(
    caches.match(request).then(
      (hit) =>
        hit ||
        fetch(request).then((res) => {
          // Don't cache redirects/errors — an Access 302 must never be stored.
          if (res.ok && res.type === 'basic') {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(request, copy));
          }
          return res;
        }),
    ),
  );
});

// ---- Push notifications ----

self.addEventListener('push', (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    payload = { title: 'Home Guardian', body: event.data ? event.data.text() : '' };
  }

  const title = payload.title || 'Home Guardian';
  event.waitUntil(
    self.registration.showNotification(title, {
      body: payload.body || '',
      icon: '/icons/icon-192.png',
      badge: '/icons/icon-192.png',
      tag: payload.tag || 'home-guardian',
      // Same alert about the same subject replaces the previous one rather than
      // stacking, mirroring the server-side cooldown.
      renotify: false,
      data: { url: payload.url || '/dashboard' },
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = (event.notification.data && event.notification.data.url) || '/dashboard';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if (client.url.includes(target) && 'focus' in client) return client.focus();
      }
      return self.clients.openWindow(target);
    }),
  );
});
