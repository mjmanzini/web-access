/**
 * Bedside mode — a big clock a child can leave on a nightstand, that shows
 * itself when bedtime starts and hands the screen back when it ends.
 *
 * Strict TypeScript, compiled by `npm run bedside:build` (see
 * `tsconfig.bedside.json`) into `bedside-mode.generated.ts`, which
 * `KidsController` serves at `/kids/bedside.js`. Everything else on this
 * child-facing surface is deliberately no-build vanilla JS embedded in a
 * server-rendered page (see `portal.controller.ts`) — the status page must
 * work with no JavaScript at all, since the devices that need it most are the
 * ones being blocked. Bedside mode is the one part of this app that CANNOT
 * make that promise: a wake lock and a live clock have no meaningful fallback
 * without JS. So it lives on its own route (`/bedside`), reached by an
 * explicit button, and everything upstream of it keeps working exactly as it
 * did.
 *
 * No bundler, no framework, no imports — this compiles straight to a classic
 * script (see the empty `module` setting in the tsconfig) because that is
 * what a Service-Worker-scoped, no-login page on a family tablet should be:
 * one file, nothing to fail to load.
 *
 * Structure: each concern below is a small factory that owns one thing and
 * returns a `dispose()` — deliberately shaped like a React hook's cleanup,
 * because that discipline (one owner per resource, one place that undoes it)
 * is the right idea regardless of framework. `initBedsideMode()` at the
 * bottom is the only thing that runs eagerly; everything else is inert until
 * a child actually taps Start.
 */

/// <reference lib="dom" />

// ---- shared types --------------------------------------------------------

/**
 * Mirrors `PortalState` in `../portal.service.ts`. Duplicated rather than
 * imported: this file compiles standalone, with no path back into the Nest
 * app's module graph. Kept honest by `isPortalStatus()` below, which trusts
 * nothing about the shape of a value that arrived over the network — the
 * lesson from this app's History page, which once crashed a phone because a
 * response was assumed to match a type it no longer did.
 */
type PortalState =
  | 'on'
  | 'bedtime'
  | 'quota'
  | 'paused'
  | 'blocked'
  | 'unfiltered'
  | 'unknown';

interface PortalStatus {
  state: PortalState;
  deviceId: string | null;
  deviceName: string | null;
  profileName: string | null;
  until: string | null;
  headline: string;
  detail: string;
}

function isPortalStatus(v: unknown): v is PortalStatus {
  if (typeof v !== 'object' || v === null) return false;
  const o = v as Record<string, unknown>;
  return typeof o.state === 'string' && typeof o.headline === 'string' && typeof o.detail === 'string';
}

/** Small icon per state — the same mapping `portal.controller.ts` renders
 *  server-side (its ART table), reduced to the one glyph this dim view needs.
 *  Bedtime is the case the feature was built for; the rest come along for
 *  free because a paused or quota-exhausted child deserves the same honesty
 *  overnight as during the day. */
const STATE_EMOJI: Record<PortalState, string> = {
  on: '🎉',
  bedtime: '🌙',
  quota: '⏳',
  paused: '⏸️',
  blocked: '⏸️',
  unfiltered: '📡',
  unknown: '👋',
};

/** True while whatever the child would see on `/status` is an "off" screen —
 *  same rule `portal.controller.ts`'s `render()` uses, so the two pages never
 *  disagree about whether the internet is on. */
function isOfflineState(state: PortalState): boolean {
  return state !== 'on' && state !== 'unknown' && state !== 'unfiltered';
}

type Dispose = () => void;

// ---- clock ----------------------------------------------------------------

/**
 * A minute-precision clock, deliberately not second-precision.
 *
 * A bedside display exists to be looked at, not to be redrawn sixty times a
 * minute. Waking the tab every second for a digit nobody reads is the single
 * biggest avoidable battery cost in a screen that is, by design, left on all
 * night — so this schedules exactly one update per minute, aligned to the
 * minute boundary, rather than a naive `setInterval(1000)`.
 */
function useClock(el: HTMLElement): Dispose {
  let timer: ReturnType<typeof setTimeout> | null = null;

  const render = (): void => {
    const now = new Date();
    const hh = String(now.getHours()).padStart(2, '0');
    const mm = String(now.getMinutes()).padStart(2, '0');
    el.textContent = `${hh}:${mm}`;
  };

  const scheduleNext = (): void => {
    const now = new Date();
    const msToNextMinute = 60_000 - (now.getSeconds() * 1000 + now.getMilliseconds());
    timer = setTimeout(() => {
      render();
      scheduleNext();
    }, msToNextMinute);
  };

  render();
  scheduleNext();

  return () => {
    if (timer !== null) clearTimeout(timer);
  };
}

// ---- wake lock --------------------------------------------------------------

/**
 * Holds the screen wake lock, and keeps holding it.
 *
 * The spec releases a wake lock automatically the moment the tab is hidden —
 * app-switched, screen locked by a hardware button, browser backgrounded —
 * and does NOT re-grant it automatically when the tab becomes visible again.
 * A bedside display that silently stops working the first time someone picks
 * the tablet up and puts it back down is worse than one that never tried, so
 * this listens for `visibilitychange` and re-requests every time the page
 * becomes visible while bedside mode is still meant to be active.
 *
 * Absence is not failure. Safari (as of recent versions) and some in-app
 * WebViews have no Wake Lock API at all; `'wakeLock' in navigator` is false
 * there, and this degrades to "the clock might turn off" rather than an
 * error — a locked screen still shows the right time when woken, it just
 * cannot promise to stay lit. `onChange` reports that honestly so the UI can
 * say so instead of claiming a guarantee it cannot keep.
 */
function useWakeLock(
  onChange: (active: boolean, detail: string) => void,
): { hold: () => void; release: () => void; dispose: Dispose } {
  let sentinel: WakeLockSentinel | null = null;
  let shouldHold = false;

  const supported = 'wakeLock' in navigator;

  const request = (): void => {
    if (!supported || !shouldHold) return;
    navigator.wakeLock
      .request('screen')
      .then((s) => {
        sentinel = s;
        onChange(true, 'Screen will stay on.');
        // The system (not just this page) can revoke a lock — battery saver,
        // an OS-level policy, another app taking focus without a visibility
        // change this page can observe. Treat that exactly like losing it any
        // other way: note it, and pick it back up on the next visible tick.
        s.addEventListener('release', () => {
          if (sentinel === s) sentinel = null;
          if (shouldHold && document.visibilityState === 'visible') {
            onChange(false, 'Reconnecting screen lock…');
          }
        });
      })
      .catch((err: unknown) => {
        sentinel = null;
        const reason = err instanceof Error ? err.message : 'not permitted';
        onChange(false, `Couldn't keep the screen on (${reason}). It may turn off on its own.`);
      });
  };

  const onVisibility = (): void => {
    if (document.visibilityState === 'visible' && shouldHold && (!sentinel || sentinel.released)) {
      request();
    }
  };
  document.addEventListener('visibilitychange', onVisibility);

  if (!supported) {
    // Reported once, on the next tick, so a caller that sets up its own
    // listener before calling hold() still sees it.
    setTimeout(() => onChange(false, "This browser can't keep the screen on by itself."), 0);
  }

  return {
    hold: () => {
      shouldHold = true;
      request();
    },
    release: () => {
      shouldHold = false;
      sentinel?.release().catch(() => undefined);
      sentinel = null;
    },
    dispose: () => {
      shouldHold = false;
      document.removeEventListener('visibilitychange', onVisibility);
      sentinel?.release().catch(() => undefined);
      sentinel = null;
    },
  };
}

// ---- fullscreen -------------------------------------------------------------

/**
 * Best-effort fullscreen. Must be called from inside a user-gesture handler —
 * browsers reject a fullscreen request made any other way — which is exactly
 * why bedside mode starts from a tap rather than auto-arming on page load.
 * Failure (unsupported, denied, an iframe without `allowfullscreen`) is
 * silent and non-fatal: fullscreen is a nicety here, not a requirement the
 * rest of the page depends on.
 */
function useFullscreen(): { enter: () => void; dispose: Dispose } {
  const enter = (): void => {
    const el = document.documentElement as HTMLElement & {
      requestFullscreen?: () => Promise<void>;
    };
    el.requestFullscreen?.().catch(() => undefined);
  };
  return {
    enter,
    dispose: () => {
      if (document.fullscreenElement) {
        document.exitFullscreen().catch(() => undefined);
      }
    },
  };
}

// ---- status feed ------------------------------------------------------------

/**
 * The live bedtime/pause/quota state, SSE-first with a polling fallback.
 *
 * `/status/stream` is the same endpoint the ordinary status page uses,
 * carrying the full `PortalStatus` alongside its change-detection key (see
 * `portal.controller.ts`) — bedside mode reacts to real schedule state, never
 * a time hard-coded into this file. If the stream drops, a 15s poll of
 * `/api/status` keeps the view honest until it reconnects; the two never run
 * at once, so a flaky connection cannot double-fire a transition.
 */
function useStatusFeed(
  onStatus: (s: PortalStatus) => void,
  onConnectivity: (ok: boolean) => void,
): Dispose {
  let es: EventSource | null = null;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let pollTimer: ReturnType<typeof setInterval> | null = null;
  let disposed = false;

  const fetchOnce = (): void => {
    fetch('/api/status', { cache: 'no-store' })
      .then((r) => r.json())
      .then((j: unknown) => {
        if (disposed) return;
        if (isPortalStatus(j)) {
          onConnectivity(true);
          onStatus(j);
        } else {
          onConnectivity(false);
        }
      })
      .catch(() => {
        if (!disposed) onConnectivity(false);
      });
  };

  const startPolling = (): void => {
    if (pollTimer !== null || disposed) return;
    fetchOnce();
    pollTimer = setInterval(fetchOnce, 15_000);
  };
  const stopPolling = (): void => {
    if (pollTimer !== null) clearInterval(pollTimer);
    pollTimer = null;
  };

  const connect = (): void => {
    if (disposed) return;
    es = new EventSource('/status/stream');
    es.addEventListener('state', (e: MessageEvent<string>) => {
      let payload: unknown;
      try {
        payload = JSON.parse(e.data);
      } catch {
        return;
      }
      if (typeof payload !== 'object' || payload === null) return;
      const status = (payload as Record<string, unknown>).status;
      if (!isPortalStatus(status)) return;
      onConnectivity(true);
      stopPolling(); // the stream is alive; the safety net can stand down
      onStatus(status);
    });
    es.onerror = (): void => {
      if (disposed) return;
      onConnectivity(false);
      startPolling(); // keep the view honest while the stream is down
      if (es && es.readyState === EventSource.CLOSED) {
        es.close();
        es = null;
        reconnectTimer = setTimeout(connect, 5_000);
      }
    };
  };

  connect();

  return () => {
    disposed = true;
    if (reconnectTimer !== null) clearTimeout(reconnectTimer);
    stopPolling();
    es?.close();
    es = null;
  };
}

// ---- push subscription --------------------------------------------------

/** Mirrors the response of `GET /kids/push-config` (see `kids.controller.ts`). */
interface PushConfig {
  enabled: boolean;
  publicKey: string | null;
  deviceKnown: boolean;
  subscribed: boolean;
}

function isPushConfig(v: unknown): v is PushConfig {
  if (typeof v !== 'object' || v === null) return false;
  const o = v as Record<string, unknown>;
  return typeof o.enabled === 'boolean' && typeof o.deviceKnown === 'boolean';
}

/**
 * VAPID keys arrive base64url; `applicationServerKey` wants raw bytes.
 *
 * Returns the ArrayBuffer rather than the Uint8Array view over it. Both
 * satisfy `BufferSource` at runtime, but since TypeScript 5.7 `Uint8Array` is
 * generic in its backing buffer and the plain `Uint8Array.from(...)` inference
 * widens to `ArrayBufferLike` — which includes `SharedArrayBuffer` and so no
 * longer matches the DOM signature. Handing back the buffer sidesteps the
 * question entirely and works on either side of that TS version boundary.
 */
function decodeVapidKey(key: string): ArrayBuffer {
  const pad = '='.repeat((4 - (key.length % 4)) % 4);
  const raw = atob((key + pad).replace(/-/g, '+').replace(/_/g, '/'));
  const buf = new ArrayBuffer(raw.length);
  const view = new Uint8Array(buf);
  for (let i = 0; i < raw.length; i++) view[i] = raw.charCodeAt(i);
  return buf;
}

/**
 * Registers this tablet for its own bedtime push.
 *
 * Two entry points, and the difference between them matters:
 *
 *  - `resume()` runs on load. It subscribes *silently* and only when
 *    permission was already granted — re-subscribing matters because browsers
 *    rotate push endpoints on their own, and a nightstand tablet that has not
 *    been opened in weeks would otherwise go quiet with nothing on screen to
 *    say so. It never prompts.
 *  - `request()` runs from the Start tap. Asking for notification permission
 *    outside a user gesture is refused outright by some browsers and silently
 *    penalised by others, so the one prompt this page shows is attached to
 *    the one deliberate tap it already has.
 *
 * The POST goes to `/kids/subscribe`, not the parent dashboard's
 * `/push/subscribe`: this page has no login, and the kid endpoint binds the
 * subscription to whichever device owns the requesting IP. Posting to the
 * parent route from here would simply 401.
 *
 * Every failure path is silent. A tablet that cannot be notified is still a
 * working clock, and an error message on a bedside screen at 3am helps nobody.
 */
function usePush(onState: (subscribed: boolean) => void): {
  resume: () => void;
  request: () => void;
} {
  const supported =
    'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

  const loadConfig = (): Promise<PushConfig | null> =>
    fetch('/kids/push-config', { cache: 'no-store' })
      .then((r) => r.json())
      .then((j: unknown) => (isPushConfig(j) ? j : null))
      .catch(() => null);

  const subscribeWith = (cfg: PushConfig): Promise<void> => {
    const key = cfg.publicKey;
    if (!key) return Promise.resolve();
    return navigator.serviceWorker
      .register('/kids/sw.js', { scope: '/' })
      .then((reg) => navigator.serviceWorker.ready.then(() => reg))
      .then((reg) =>
        // An existing subscription is reused rather than replaced: calling
        // subscribe() again with the same key returns it, but going through
        // getSubscription() first avoids churning the endpoint (and the DB
        // row) on every single page load.
        reg.pushManager.getSubscription().then(
          (existing) =>
            existing ??
            reg.pushManager.subscribe({
              userVisibleOnly: true,
              applicationServerKey: decodeVapidKey(key),
            }),
        ),
      )
      .then((sub) =>
        fetch('/kids/subscribe', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(sub.toJSON()),
        }),
      )
      .then((r) => r.json())
      .then((out: unknown) => {
        // `{ ok: false, reason: 'device-not-recognised' }` is a normal answer
        // here, not an error: a tablet a parent has not adopted yet simply
        // has nothing to be notified about.
        onState(typeof out === 'object' && out !== null && (out as Record<string, unknown>).ok === true);
      })
      .catch(() => onState(false));
  };

  const run = (interactive: boolean): void => {
    if (!supported) return;
    void loadConfig().then((cfg) => {
      // `deviceKnown` false means this IP maps to no device a parent has set
      // up. Nothing to subscribe to, and nothing worth saying about it here.
      if (!cfg || !cfg.enabled || !cfg.publicKey || !cfg.deviceKnown) return;
      if (Notification.permission === 'granted') return subscribeWith(cfg);
      if (!interactive || Notification.permission === 'denied') return;
      return Notification.requestPermission()
        .then((perm) => (perm === 'granted' ? subscribeWith(cfg) : undefined))
        .catch(() => undefined);
    });
  };

  return {
    resume: () => run(false),
    request: () => run(true),
  };
}

// ---- state machine + wiring --------------------------------------------------

type BedsideMode = 'idle' | 'monitoring' | 'triggered' | 'error';

interface Dom {
  overlay: HTMLElement;
  startBtn: HTMLButtonElement;
  main: HTMLElement;
  clock: HTMLElement;
  banner: HTMLElement;
  bannerEmoji: HTMLElement;
  bannerHeadline: HTMLElement;
  bannerDetail: HTMLElement;
  bannerUntil: HTMLElement;
  lockBadge: HTMLElement;
  connBadge: HTMLElement;
  exitBtn: HTMLElement;
  sleep: HTMLElement;
  sleepText: HTMLElement;
  sleepDismiss: HTMLButtonElement;
}

function requireEl<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`bedside mode: missing #${id}`);
  return el as T;
}

/**
 * Wires every hook above into one state machine and one cleanup path.
 *
 * `mode` is deliberately visible in the DOM (`data-mode` on <body>) rather
 * than kept only in this closure — CSS drives almost all of the visual
 * change from that attribute, so the state the code is in and the state the
 * screen shows can never quietly drift apart.
 */
function initBedsideMode(): void {
  const dom: Dom = {
    overlay: requireEl('start-overlay'),
    startBtn: requireEl<HTMLButtonElement>('start-btn'),
    main: requireEl('bedside-main'),
    clock: requireEl('clock'),
    banner: requireEl('bedtime-banner'),
    bannerEmoji: requireEl('bedtime-emoji'),
    bannerHeadline: requireEl('bedtime-headline'),
    bannerDetail: requireEl('bedtime-detail'),
    bannerUntil: requireEl('bedtime-until'),
    lockBadge: requireEl('badge-lock'),
    connBadge: requireEl('badge-conn'),
    exitBtn: requireEl('exit-btn'),
    sleep: requireEl('sleep-screen'),
    sleepText: requireEl('sleep-text'),
    sleepDismiss: requireEl<HTMLButtonElement>('sleep-dismiss'),
  };

  let mode: BedsideMode = 'idle';
  let everConnected = false;
  let clockDispose: Dispose | null = null;
  let statusDispose: Dispose | null = null;
  /**
   * Which bedtime occurrence a parent has already dismissed the sleep screen
   * for. Keyed by the window rather than a bare boolean, so dismissing tonight
   * does not also suppress tomorrow night — and so the 3s status poll cannot
   * re-raise the screen a second after it was waved away.
   */
  let dismissedFor: string | null = null;
  let lastStatus: PortalStatus | null = null;

  const setMode = (next: BedsideMode): void => {
    mode = next;
    document.body.dataset.mode = next;
  };

  const wakeLock = useWakeLock((active, detail) => {
    dom.lockBadge.textContent = active ? '🔒 Screen locked on' : '🔓 ' + detail;
    dom.lockBadge.title = detail;
  });
  const fullscreen = useFullscreen();
  const push = usePush(() => undefined);
  // Silent re-subscribe on every load, so a rotated endpoint heals itself
  // without anyone having to notice it broke. Never prompts — see usePush().
  push.resume();

  /**
   * The sleep screen — the thing a notification tap is meant to land on.
   *
   * Reserved for `bedtime` alone. Quota and a parent pause are also "off", and
   * they get the banner below, but neither of them means "go to sleep"; a
   * child who has used up their hour at 4pm should not be told it is night.
   */
  const applySleepScreen = (s: PortalStatus): void => {
    const key = `${s.state}|${s.until ?? ''}`;
    const show = s.state === 'bedtime' && dismissedFor !== key;
    if (show) {
      const who = (s.profileName ?? '').trim();
      dom.sleepText.textContent = who ? `Time to sleep, ${who} 🌙` : 'Time to sleep 🌙';
    }
    dom.sleep.hidden = !show;
    // Drives the CSS (and the animation) from the DOM, for the same reason
    // `data-mode` exists: one source of truth for what the screen is doing.
    document.body.classList.toggle('bedtime-triggered', show);
    if (s.state !== 'bedtime') dismissedFor = null; // bedtime ended; re-arm
  };

  const applyStatus = (s: PortalStatus): void => {
    lastStatus = s;
    applySleepScreen(s);
    const offline = isOfflineState(s.state);
    if (offline) {
      setMode('triggered');
      dom.bannerEmoji.textContent = STATE_EMOJI[s.state] ?? STATE_EMOJI.unknown;
      dom.bannerHeadline.textContent = s.headline;
      dom.bannerDetail.textContent = s.detail;
      dom.bannerUntil.textContent = s.until ? `Back on at ${s.until}` : '';
      dom.bannerUntil.hidden = !s.until;
      dom.banner.hidden = false;
    } else {
      // Ended: back to the plain clock. No reload, no re-request of the wake
      // lock or fullscreen — bedside mode itself does not stop just because
      // bedtime did.
      if (mode !== 'idle') setMode('monitoring');
      dom.banner.hidden = true;
    }
  };

  const applyConnectivity = (ok: boolean): void => {
    if (ok) {
      everConnected = true;
      dom.connBadge.textContent = '📶 Live';
      dom.connBadge.title = 'Connected to Home Guardian.';
      if (mode === 'error') setMode('monitoring');
    } else {
      dom.connBadge.textContent = '📡 Reconnecting…';
      dom.connBadge.title = 'Lost the connection; the clock keeps going while it retries.';
      // Only a genuinely broken start (never once connected) is an error the
      // child should be shown — a clock that is merely between reconnect
      // attempts is not a failure, it is the fallback working as intended.
      if (!everConnected && mode === 'monitoring') setMode('error');
    }
  };

  const start = (): void => {
    dom.overlay.hidden = true;
    dom.main.hidden = false;
    setMode('monitoring');

    wakeLock.hold();
    fullscreen.enter(); // must run inside this click handler — see useFullscreen()

    // Inside the tap, for the same reason: this is where the notification
    // permission prompt is allowed to appear.
    push.request();

    clockDispose = useClock(dom.clock);
    statusDispose = useStatusFeed(applyStatus, applyConnectivity);
  };

  const stop = (): void => {
    wakeLock.dispose();
    fullscreen.dispose();
    clockDispose?.();
    statusDispose?.();
    clockDispose = null;
    statusDispose = null;
  };

  /**
   * Soft dismiss, aimed at a parent standing over the tablet — not an escape
   * hatch. It clears the sleep screen for tonight only, and changes nothing
   * about enforcement: the internet stays off either way. That separation is
   * the point. A button that looked like it ended bedtime would be a lie.
   */
  dom.sleepDismiss.addEventListener('click', () => {
    if (lastStatus) dismissedFor = `${lastStatus.state}|${lastStatus.until ?? ''}`;
    dom.sleep.hidden = true;
    document.body.classList.remove('bedtime-triggered');
  });

  dom.startBtn.addEventListener('click', start);
  // Explicit exit, not just "wait for navigation": drops fullscreen and the
  // wake lock immediately rather than leaving them for the browser to notice.
  dom.exitBtn.addEventListener('click', stop);

  // `pagehide` survives back/forward-cache and tab close alike; `beforeunload`
  // is deliberately NOT used here because adding one disqualifies the page
  // from bfcache in most browsers, which would make the back button from
  // here noticeably slower for no benefit — pagehide already covers the
  // real cleanup need (no leaked timers, no dangling wake lock).
  window.addEventListener('pagehide', stop);

  // Arriving by tapping the bedtime notification (see
  // PushService.sendBedtimeNotification, which sends `/bedside?from=push`).
  // Skip the Start prompt: the tap already WAS the decision, and making a
  // child find a second button on a screen that just said "go to sleep" would
  // be absurd. The wake lock and fullscreen may or may not be granted without
  // a gesture — both already fail silently, and the sleep screen does not
  // depend on either.
  if (window.location.search.indexOf('from=push') !== -1) {
    start();
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initBedsideMode);
} else {
  initBedsideMode();
}
