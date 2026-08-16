import {
  Body,
  Controller,
  Get,
  Header,
  NotFoundException,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { createReadStream, existsSync } from 'node:fs';
import { join } from 'node:path';
import { IsObject, IsOptional, IsString } from 'class-validator';
import { Public } from '../auth/public.decorator';
import { PushService } from '../push/push.service';
import { DeviceIdentityService } from './device-identity.service';
import { PortalService } from './portal.service';

class KidSubscribeDto {
  @IsString() endpoint: string;
  @IsObject() keys: { p256dh: string; auth: string };
  @IsOptional() @IsString() userAgent?: string;
}

/**
 * "Home Guardian Kids" — the child's own installable app.
 *
 * Everything here is unauthenticated by design: the child has no account, and
 * the device that needs this most is the one currently being blocked. Identity
 * comes from the source IP, exactly as the status page and the unblock-request
 * page already do, and every response is scoped to that one device. An
 * unrecognised address gets a polite "not set up yet" and nothing else — no
 * device list, no other children, no parent settings.
 *
 * Reachable only over the LAN (the portal host resolves to a private address),
 * so this is not an internet-exposed surface.
 */
@Controller('kids')
export class KidsController {
  constructor(
    private readonly portal: PortalService,
    private readonly push: PushService,
    private readonly identity: DeviceIdentityService,
  ) {}

  @Public()
  @Get('manifest.webmanifest')
  @Header('Content-Type', 'application/manifest+json; charset=utf-8')
  @Header('Cache-Control', 'no-cache')
  manifest(): string {
    return JSON.stringify(
      {
        name: 'Home Guardian Kids',
        short_name: 'My Internet',
        description: 'See why the internet is off, and when it comes back.',
        // Opening straight to the status page is the whole point of the app.
        start_url: '/status',
        scope: '/',
        display: 'standalone',
        orientation: 'portrait',
        background_color: '#0f1420',
        theme_color: '#1b2440',
        icons: [
          { src: '/kids/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/kids/icon-512.png', sizes: '512x512', type: 'image/png' },
          {
            src: '/kids/icon-maskable-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      null,
      2,
    );
  }

  /**
   * Served from /kids/ but claiming the whole origin, so one worker covers
   * /status and /request. Requires the Service-Worker-Allowed header below;
   * without it the browser refuses the wider scope.
   */
  @Public()
  @Get('sw.js')
  @Header('Content-Type', 'application/javascript; charset=utf-8')
  @Header('Cache-Control', 'no-cache')
  @Header('Service-Worker-Allowed', '/')
  serviceWorker(): string {
    return KIDS_SW;
  }

  @Public()
  @Get('icon-192.png')
  icon192(@Res() res: Response): void {
    this.sendIcon(res, 'icon-192.png');
  }

  @Public()
  @Get('icon-512.png')
  icon512(@Res() res: Response): void {
    this.sendIcon(res, 'icon-512.png');
  }

  @Public()
  @Get('icon-maskable-512.png')
  iconMaskable(@Res() res: Response): void {
    this.sendIcon(res, 'icon-maskable-512.png');
  }

  private sendIcon(res: Response, name: string): void {
    // Fixed filenames only — never interpolate a request value into a path.
    const file = join(process.cwd(), 'public', 'kids', name);
    if (!existsSync(file)) throw new NotFoundException();
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Cache-Control', 'public, max-age=86400');
    createReadStream(file).pipe(res);
  }

  /** What the page needs to decide whether to offer notifications. */
  @Public()
  @Get('push-config')
  @Header('Cache-Control', 'no-store')
  async pushConfig(@Req() req: Request): Promise<{
    enabled: boolean;
    publicKey: string | null;
    deviceKnown: boolean;
    subscribed: boolean;
  }> {
    const status = await this.portal.statusForDevice(await this.identity.resolve(req));
    const deviceId = status.deviceId;
    return {
      enabled: this.push.isEnabled(),
      publicKey: this.push.publicKey(),
      deviceKnown: !!deviceId,
      subscribed: deviceId ? (await this.push.countForDevice(deviceId)) > 0 : false,
    };
  }

  /**
   * Subscribe this device to its own notifications. No auth: the subscription
   * is bound to whichever device owns the requesting IP, so the worst a
   * stranger on the LAN can do is sign a device up for its own bedtime
   * reminders.
   */
  @Public()
  @Post('subscribe')
  async subscribe(
    @Req() req: Request,
    @Body() dto: KidSubscribeDto,
  ): Promise<{ ok: boolean; reason?: string }> {
    const status = await this.portal.statusForDevice(await this.identity.resolve(req));
    if (!status.deviceId) return { ok: false, reason: 'device-not-recognised' };

    await this.push.subscribeDevice(status.deviceId, {
      endpoint: dto.endpoint,
      keys: dto.keys,
      userAgent: dto.userAgent ?? (req.headers['user-agent'] as string) ?? undefined,
    });
    return { ok: true };
  }

  /** Prove it works, from the child's own device. */
  @Public()
  @Post('test')
  async test(@Req() req: Request): Promise<{ delivered: number }> {
    const status = await this.portal.statusForDevice(await this.identity.resolve(req));
    if (!status.deviceId) return { delivered: 0 };
    const delivered = await this.push.sendToDevices([status.deviceId], {
      title: 'Notifications are on',
      body: "You'll get a warning before bedtime, and a message when the internet comes back.",
      url: '/status',
      tag: 'kids-test',
    });
    return { delivered };
  }
}

/**
 * The child's service worker. Deliberately tiny: it exists to receive pushes
 * and to open the status page when one is tapped.
 *
 * It caches nothing. The status page must always reflect the live state — a
 * cached "it's bedtime" shown at eight the next morning would be worse than no
 * app at all.
 */
const KIDS_SW = `/* Home Guardian Kids — notifications only, no caching. */
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

self.addEventListener('push', (event) => {
  let p = {};
  try { p = event.data ? event.data.json() : {}; } catch (_) { p = {}; }
  event.waitUntil(
    self.registration.showNotification(p.title || 'Home Guardian', {
      body: p.body || '',
      icon: '/kids/icon-192.png',
      badge: '/kids/icon-192.png',
      tag: p.tag || 'home-guardian-kids',
      renotify: true,
      // The server decides what has to be noticed; a warning and a block both
      // stay on screen until tapped, an "all clear" does not.
      requireInteraction: p.requireInteraction === true,
      vibrate: p.vibrate || [200, 100, 200],
      data: { url: p.url || '/status' },
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = (event.notification.data && event.notification.data.url) || '/status';
  // Android will not let a page push itself to the front on its own, so the
  // tap IS the mechanism: focus the app if it is open, otherwise launch it.
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      for (const c of list) {
        if (!('focus' in c)) continue;
        // navigate() throws on a client this worker does not control (an
        // ordinary tab, or one opened before the worker took over). Focus it
        // anyway — a focused stale page beats no window at all — and fall
        // through to opening a fresh one if even that fails.
        try {
          const navigated = c.navigate(target);
          if (navigated && typeof navigated.then === 'function') {
            return navigated.then(function (client) {
              return (client || c).focus();
            }, function () {
              return c.focus();
            });
          }
        } catch (_) { /* fall through to focus */ }
        return c.focus();
      }
      return self.clients.openWindow(target);
    }).catch(function () {
      // Last resort: if enumeration itself failed, still open the page.
      return self.clients.openWindow(target);
    }),
  );
});
`;
