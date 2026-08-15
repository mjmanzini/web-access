import { Controller, Get, Header, Req } from '@nestjs/common';
import { Request } from 'express';
import { Public } from '../auth/public.decorator';
import { PortalService, PortalStatus } from './portal.service';

/**
 * The child-facing status page: "why isn't my tablet working?"
 *
 * Server-rendered so it works with no login, no JavaScript and no API call —
 * which matters because the devices that need it are, by definition, the ones
 * whose DNS is being blocked. The blocking rules carry an explicit allow
 * exception for this host so this page always resolves.
 */
@Controller()
export class PortalController {
  constructor(private readonly portal: PortalService) {}

  /** Client IP: real address on the LAN, forwarded header behind the tunnel. */
  private clientIp(req: Request): string {
    const raw =
      (req.headers['cf-connecting-ip'] as string) ||
      (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() ||
      req.socket.remoteAddress ||
      '';
    return raw.replace(/^::ffff:/, ''); // strip IPv4-mapped IPv6 prefix
  }

  @Public()
  @Get('status')
  @Header('Content-Type', 'text/html; charset=utf-8')
  @Header('Cache-Control', 'no-store')
  @Header('X-Frame-Options', 'DENY')
  @Header('Referrer-Policy', 'no-referrer')
  async page(@Req() req: Request): Promise<string> {
    return render(await this.portal.statusForIp(this.clientIp(req)));
  }

  /** JSON flavour, for the dashboard or a future kiosk view. */
  @Public()
  @Get('api/status')
  @Header('Cache-Control', 'no-store')
  async json(@Req() req: Request): Promise<PortalStatus> {
    return this.portal.statusForIp(this.clientIp(req));
  }
}

const ART: Record<string, { emoji: string; tint: string }> = {
  on: { emoji: '🟢', tint: '#3ecf8e' },
  bedtime: { emoji: '🌙', tint: '#8b7bff' },
  quota: { emoji: '⏳', tint: '#ffb64f' },
  paused: { emoji: '⏸️', tint: '#4f8cff' },
  blocked: { emoji: '⏸️', tint: '#4f8cff' },
  unknown: { emoji: '❓', tint: '#8a97b4' },
};

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string,
  );
}

function render(s: PortalStatus): string {
  const art = ART[s.state] ?? ART.unknown;
  const offline = s.state !== 'on' && s.state !== 'unknown';
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="color-scheme" content="dark" />
<!-- Re-check periodically so the page flips to "Internet is on" by itself. -->
<meta http-equiv="refresh" content="60" />
<link rel="manifest" href="/kids/manifest.webmanifest" />
<meta name="theme-color" content="#1b2440" />
<meta name="mobile-web-app-capable" content="yes" />
<link rel="apple-touch-icon" href="/kids/icon-192.png" />
<title>${escapeHtml(s.headline)}</title>
<style>
  * { box-sizing: border-box; }
  body {
    margin: 0; min-height: 100vh; display: grid; place-items: center; padding: 24px;
    background: radial-gradient(120% 120% at 50% 0%, #1b2440 0%, #0f1420 60%);
    color: #e7ecf5; font: 16px/1.55 system-ui, -apple-system, Segoe UI, Roboto, sans-serif;
    text-align: center;
  }
  .card { width: 100%; max-width: 380px; }
  .emoji { font-size: 68px; line-height: 1; margin-bottom: 14px; }
  h1 { font-size: 26px; margin: 0 0 10px; color: ${art.tint}; }
  p { margin: 0 0 18px; color: #b9c4d8; }
  .device { display: inline-block; margin-bottom: 22px; padding: 5px 12px; border-radius: 999px;
            background: rgba(255,255,255,.06); color: #8a97b4; font-size: 13px; }
  .until { font-size: 15px; color: #e7ecf5; background: rgba(255,255,255,.06);
           border-radius: 12px; padding: 12px; margin-bottom: 20px; }
  a.btn { display: block; padding: 14px; border-radius: 12px; background: #4f8cff;
          color: #fff; font-weight: 600; text-decoration: none; }
  .btn2 { display: block; width: 100%; margin-top: 10px; padding: 14px; border: 0;
          border-radius: 12px; background: rgba(255,255,255,.10); color: #e7ecf5;
          font: inherit; font-weight: 600; cursor: pointer; }
  .btn2[disabled] { opacity: .6; }
  .hint { margin-top: 16px; font-size: 12px; color: #6b7793; }
</style>
</head>
<body>
  <div class="card">
    <div class="emoji">${art.emoji}</div>
    <h1>${escapeHtml(s.headline)}</h1>
    <p>${escapeHtml(s.detail)}</p>
    ${s.deviceName ? `<div class="device">${escapeHtml(s.deviceName)}</div>` : ''}
    ${s.until ? `<div class="until">Back on at <strong>${escapeHtml(s.until)}</strong></div>` : ''}
    ${offline ? '<a class="btn" href="/request">Ask to unblock a site</a>' : '<a class="btn" href="/request">Ask for a site to be unblocked</a>'}
    <button id="notify" class="btn2" hidden>Tell me before bedtime</button>
    <div id="notice" class="hint"></div>
    <div class="hint">This page updates by itself.</div>
  </div>
<script>
/* Notifications, opted into on the device itself. The page stays useful with
   this script disabled or unsupported — the button simply never appears. */
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
        say('Reminders are on for this device.');
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
            say('Done. You will get a warning 10 minutes before bedtime.');
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
