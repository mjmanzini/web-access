import { Controller, Get, Header, Query, Req, Res } from '@nestjs/common';
import { Request, Response } from 'express';
import { Public } from '../auth/public.decorator';
import { DeviceIdentityService } from './device-identity.service';
import { PortalService, PortalStatus } from './portal.service';

/**
 * The child-facing status page: "why isn't my tablet working?"
 *
 * Server-rendered so it works with no login and no JavaScript — the devices
 * that need it are, by definition, the ones being blocked. A small script adds
 * live updates on top; without it the page still tells the truth, just a minute
 * later. The blocking rules carry an explicit allow exception for this host so
 * it always resolves.
 */
@Controller()
export class PortalController {
  constructor(
    private readonly portal: PortalService,
    private readonly identity: DeviceIdentityService,
  ) {}

  /**
   * Pairing, step one: show WHICH device this link will set up and ask.
   *
   * It does not plant the cookie yet. A parent generates the link from one row
   * and scans it on a different device, so the two can drift apart — that
   * already happened once, and a tablet ended up paired as the laptop with no
   * hint anything was wrong. Naming the device before committing makes the
   * mistake visible while it is still free to fix.
   */
  @Public()
  @Get('pair')
  @Header('Content-Type', 'text/html; charset=utf-8')
  @Header('Cache-Control', 'no-store')
  async pair(@Query('t') token: string): Promise<string> {
    const deviceId = this.identity.verifyPairToken(token ?? '');
    if (!deviceId) return expiredPage();
    const device = await this.identity.deviceById(deviceId);
    if (!device) return expiredPage();
    return confirmPage(device.name, token);
  }

  /** Pairing, step two: the child's device confirmed, so plant the cookie. */
  @Public()
  @Get('pair/confirm')
  async pairConfirm(
    @Query('t') token: string,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    const deviceId = this.identity.verifyPairToken(token ?? '');
    if (!deviceId) {
      res.status(400).type('html').send(expiredPage());
      return;
    }
    const isHttps =
      req.protocol === 'https' || req.headers['x-forwarded-proto'] === 'https';
    // Same name, same path, same origin — this replaces any previous binding
    // outright rather than layering a second cookie on top of it.
    res.setHeader('Set-Cookie', this.identity.cookieFor(deviceId, isHttps));
    res.redirect(302, '/status');
  }

  @Public()
  @Get('status')
  @Header('Content-Type', 'text/html; charset=utf-8')
  @Header('Cache-Control', 'no-store')
  @Header('X-Frame-Options', 'DENY')
  @Header('Referrer-Policy', 'no-referrer')
  async page(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<string | undefined> {
    // A PWA and Web Push need a secure context. On plain HTTP this page can
    // only ever be a bookmark, so send the child to the HTTPS origin instead
    // of quietly serving the version that can never work.
    const https = this.kidsOrigin();
    if (https && req.headers.host !== https.host) {
      res.redirect(302, `${https.origin}/status`);
      return undefined;
    }
    return render(await this.portal.statusForDevice(await this.identity.resolve(req)));
  }

  /**
   * Live state, over Server-Sent Events.
   *
   * The page used to lean on a 60-second meta refresh, which meant bedtime
   * could start and the tablet would still be showing "Internet is on" for
   * most of a minute — while the parent's Discord alert had already arrived.
   * A child staring at a screen that disagrees with reality is exactly the
   * confusion this page exists to prevent.
   */
  @Public()
  @Get('status/stream')
  async stream(@Req() req: Request, @Res() res: Response): Promise<void> {
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    // Cloudflare and any intermediary proxy must not buffer this.
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders?.();

    const device = await this.identity.resolve(req);
    let last: string | null = null;

    const tick = async () => {
      try {
        const status = await this.portal.statusForDevice(device);
        const key = `${status.state}|${status.until ?? ''}|${status.headline}`;
        if (key !== last) {
          last = key;
          res.write(`event: state\ndata: ${JSON.stringify({ key })}\n\n`);
        } else {
          res.write(': keep-alive\n\n'); // stops idle connections being reaped
        }
      } catch {
        // A transient database blip must not kill the stream; the next tick
        // retries and the page's own reconnect covers a real failure.
      }
    };

    await tick();
    const timer = setInterval(tick, 3000);
    const stop = () => {
      clearInterval(timer);
      res.end();
    };
    req.on('close', stop);
    req.on('error', stop);
  }

  /** JSON flavour, for the dashboard or a future kiosk view. */
  @Public()
  @Get('api/status')
  @Header('Cache-Control', 'no-store')
  async json(@Req() req: Request): Promise<PortalStatus> {
    return this.portal.statusForDevice(await this.identity.resolve(req));
  }

  /** The configured HTTPS origin for the kid app, if any. */
  private kidsOrigin(): { origin: string; host: string } | null {
    const raw = (process.env.KIDS_PUBLIC_URL ?? '').trim().replace(/\/+$/, '');
    if (!raw) return null;
    try {
      const u = new URL(raw);
      return { origin: u.origin, host: u.host };
    } catch {
      return null;
    }
  }
}

/**
 * One big picture per state. A child reads the face before the words, so the
 * emoji has to carry the meaning on its own.
 */
const ART: Record<string, { emoji: string; tint: string; glow: string }> = {
  on: { emoji: '🎉', tint: '#5ef2a8', glow: 'rgba(94,242,168,.18)' },
  bedtime: { emoji: '🌙', tint: '#b3a6ff', glow: 'rgba(179,166,255,.18)' },
  quota: { emoji: '⏳', tint: '#ffc978', glow: 'rgba(255,201,120,.18)' },
  paused: { emoji: '⏸️', tint: '#7fb2ff', glow: 'rgba(127,178,255,.18)' },
  blocked: { emoji: '⏸️', tint: '#7fb2ff', glow: 'rgba(127,178,255,.18)' },
  unfiltered: { emoji: '📡', tint: '#ffc978', glow: 'rgba(255,201,120,.18)' },
  unknown: { emoji: '👋', tint: '#9fb0cf', glow: 'rgba(159,176,207,.15)' },
};

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string,
  );
}

/** Shared chrome for the small standalone pages (pair / expired). */
function shell(title: string, body: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="color-scheme" content="dark" />
<title>${escapeHtml(title)}</title>
<style>
  * { box-sizing: border-box; }
  body {
    margin: 0; min-height: 100vh; display: grid; place-items: center; padding: 24px;
    background: radial-gradient(120% 120% at 50% 0%, #1b2440 0%, #0f1420 60%);
    color: #e7ecf5; font: 18px/1.6 system-ui, -apple-system, Segoe UI, Roboto, sans-serif;
    text-align: center;
  }
  .box { width: 100%; max-width: 560px; }
  .big { font-size: 72px; line-height: 1; margin-bottom: 16px; }
  h1 { font-size: clamp(24px, 4vw, 34px); margin: 0 0 8px; }
  .who {
    display: block; margin: 18px auto; padding: 18px 20px; border-radius: 18px;
    background: rgba(255,255,255,.08); font-size: clamp(22px, 5vw, 34px);
    font-weight: 700; color: #fff; overflow-wrap: anywhere;
  }
  p { color: #b9c4d8; margin: 0 0 22px; }
  .btn {
    display: block; padding: 20px; border-radius: 16px; background: #4f8cff;
    color: #fff; font-weight: 700; font-size: 20px; text-decoration: none; border: 0;
    width: 100%; cursor: pointer;
  }
  .muted { color: #6b7793; font-size: 14px; margin-top: 16px; }
</style>
</head>
<body><div class="box">${body}</div></body>
</html>`;
}

function expiredPage(): string {
  return shell(
    'Link expired',
    `<div class="big">⏱️</div>
     <h1>This link has expired</h1>
     <p>Ask a parent for a new one.</p>`,
  );
}

/** "This device will be set up as X — correct?" */
function confirmPage(deviceName: string, token: string): string {
  return shell(
    'Set up this device',
    `<div class="big">📱</div>
     <h1>Set up this device as</h1>
     <span class="who">${escapeHtml(deviceName)}</span>
     <p>If that is not the name of the device you are holding, ask a parent for
        the right link.</p>
     <a class="btn" href="/pair/confirm?t=${encodeURIComponent(token)}">Yes, that's this device</a>
     <div class="muted">Nothing is saved until you tap.</div>`,
  );
}

/**
 * The child's status screen.
 *
 * Built for a tablet in a case, usually landscape, usually held at arm's
 * length: one enormous picture, a few large words, and buttons a small hand
 * cannot miss. Everything scales with the viewport rather than assuming a
 * phone, and the landscape layout puts the picture beside the words instead of
 * pushing the buttons off the bottom.
 */
function render(s: PortalStatus): string {
  const art = ART[s.state] ?? ART.unknown;
  const offline = s.state !== 'on' && s.state !== 'unknown' && s.state !== 'unfiltered';
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
<meta name="color-scheme" content="dark" />
<!-- No-JS fallback. The live stream below removes this once it connects. -->
<meta http-equiv="refresh" content="60" id="metarefresh" />
<link rel="manifest" href="/kids/manifest.webmanifest" />
<meta name="theme-color" content="#1b2440" />
<meta name="mobile-web-app-capable" content="yes" />
<link rel="apple-touch-icon" href="/kids/icon-192.png" />
<title>${escapeHtml(s.headline)}</title>
<style>
  * { box-sizing: border-box; }
  html, body { height: 100%; }
  body {
    margin: 0; padding: max(20px, env(safe-area-inset-top)) 20px 20px;
    display: grid; place-items: center;
    background:
      radial-gradient(90% 70% at 50% 0%, ${art.glow} 0%, transparent 70%),
      radial-gradient(120% 120% at 50% 0%, #1b2440 0%, #0f1420 60%);
    color: #f2f6ff;
    font: 18px/1.5 system-ui, -apple-system, Segoe UI, Roboto, sans-serif;
    text-align: center;
    -webkit-text-size-adjust: 100%;
  }
  .card { width: 100%; max-width: 900px; display: grid; gap: clamp(8px, 2vh, 20px); }
  .art { font-size: clamp(96px, 26vh, 200px); line-height: 1; }
  h1 {
    font-size: clamp(30px, 7vw, 60px); line-height: 1.1; margin: 0;
    color: ${art.tint}; font-weight: 800; letter-spacing: -0.5px;
  }
  .detail { font-size: clamp(17px, 2.4vw, 24px); color: #c3cee3; margin: 0 auto; max-width: 26ch; }
  .until {
    font-size: clamp(20px, 3.4vw, 30px); font-weight: 700; color: #fff;
    background: rgba(255,255,255,.09); border-radius: 20px;
    padding: clamp(10px, 2vh, 18px) 22px; margin: 0 auto; display: inline-block;
  }
  .until b { font-size: 1.25em; }
  .device {
    display: inline-block; padding: 7px 16px; border-radius: 999px;
    background: rgba(255,255,255,.07); color: #93a1bd; font-size: 15px;
  }
  .actions { display: grid; gap: 12px; margin-top: clamp(4px, 2vh, 14px); }
  .btn {
    display: block; padding: clamp(16px, 2.4vh, 22px); border-radius: 18px;
    background: #4f8cff; color: #fff; font-weight: 700; font-size: clamp(17px, 2.2vw, 22px);
    text-decoration: none; min-height: 60px;
  }
  .btn.calm { background: rgba(255,255,255,.10); color: #e7ecf5; }
  .hint { color: #6b7793; font-size: 13px; }

  /* Tablets live in a case, in landscape: put the picture beside the words so
     the buttons never fall off the bottom of a short viewport. */
  @media (orientation: landscape) and (min-width: 640px) {
    .card {
      grid-template-columns: minmax(0, 0.9fr) minmax(0, 1.1fr);
      align-items: center; text-align: left; gap: clamp(16px, 4vw, 48px);
      max-width: 1000px;
    }
    .art { grid-row: span 5; font-size: clamp(110px, 34vh, 240px); }
    .detail { margin: 0; }
    .until { margin: 0; }
    .actions { grid-template-columns: 1fr 1fr; }
  }
  @media (prefers-reduced-motion: no-preference) {
    .art { animation: float 6s ease-in-out infinite; }
    @keyframes float { 0%,100% { transform: translateY(0); } 50% { transform: translateY(-8px); } }
  }
</style>
</head>
<body>
  <div class="card">
    <div class="art">${art.emoji}</div>
    <h1>${escapeHtml(s.headline)}</h1>
    <p class="detail">${escapeHtml(s.detail)}</p>
    ${s.until ? `<div class="until">Back on at <b>${escapeHtml(s.until)}</b></div>` : ''}
    ${s.deviceName ? `<div><span class="device">${escapeHtml(s.deviceName)}</span></div>` : ''}
    <div class="actions">
      <a class="btn${offline ? '' : ' calm'}" href="/request">Ask for a website</a>
      <button id="notify" class="btn calm" hidden>Tell me before bedtime</button>
    </div>
    <div id="notice" class="hint"></div>
  </div>
<script>
/* Live updates. The page is server-rendered and correct without any of this;
   the stream just means it flips within seconds of bedtime starting instead of
   up to a minute later, which is what made it feel behind the Discord alert. */
(function () {
  if (!('EventSource' in window)) return;
  var es;
  var seen = null;
  var connect = function () {
    es = new EventSource('/status/stream');
    es.addEventListener('state', function (e) {
      var key;
      try { key = JSON.parse(e.data).key; } catch (_) { return; }
      if (seen === null) {
        seen = key;
        // Connected, so the 60s no-JS fallback is no longer needed.
        var m = document.getElementById('metarefresh');
        if (m) m.parentNode.removeChild(m);
        return;
      }
      if (key !== seen) location.reload();
    });
    es.onerror = function () {
      // EventSource retries on its own; this only guards a hard close.
      if (es.readyState === 2) { es.close(); setTimeout(connect, 5000); }
    };
  };
  connect();
})();

/* Notifications, opted into on the device itself. */
(function () {
  var btn = document.getElementById('notify');
  var notice = document.getElementById('notice');
  var say = function (m) { notice.textContent = m; };
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) return;

  var b64 = function (s) {
    var pad = '='.repeat((4 - (s.length % 4)) % 4);
    var raw = atob((s + pad).replace(/-/g, '+').replace(/_/g, '/'));
    return Uint8Array.from(raw, function (c) { return c.charCodeAt(0); });
  };

  fetch('/kids/push-config', { cache: 'no-store' })
    .then(function (r) { return r.json(); })
    .then(function (cfg) {
      if (!cfg.enabled || !cfg.publicKey || !cfg.deviceKnown) return;
      if (cfg.subscribed && Notification.permission === 'granted') {
        say('Reminders are on.');
        return;
      }
      btn.hidden = false;
      btn.addEventListener('click', function () {
        btn.disabled = true;
        say('Just a moment…');
        Notification.requestPermission()
          .then(function (perm) {
            if (perm !== 'granted') throw new Error('Notifications are switched off for this app.');
            return navigator.serviceWorker.register('/kids/sw.js', { scope: '/' });
          })
          .then(function (reg) { return navigator.serviceWorker.ready.then(function () { return reg; }); })
          .then(function (reg) {
            return reg.pushManager.subscribe({
              userVisibleOnly: true,
              applicationServerKey: b64(cfg.publicKey),
            });
          })
          .then(function (sub) {
            return fetch('/kids/subscribe', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(sub.toJSON()),
            });
          })
          .then(function (r) { return r.json(); })
          .then(function (out) {
            if (!out.ok) throw new Error('This device is not set up yet — ask a parent.');
            btn.hidden = true;
            say('Done! You will get a warning before bedtime.');
            return fetch('/kids/test', { method: 'POST' });
          })
          .catch(function (e) { btn.disabled = false; say(e.message || 'That did not work. Try again.'); });
      });
    })
    .catch(function () { /* offline or blocked — the page still works */ });
})();
</script>
</body>
</html>`;
}
