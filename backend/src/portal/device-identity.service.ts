import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { Request } from 'express';
import { Device } from '../entities/device.entity';

/** How long a pairing link stays usable. Long enough to walk to the tablet. */
const PAIR_TOKEN_TTL_MS = 15 * 60_000;
/** How long a paired device stays recognised without re-pairing. */
const COOKIE_MAX_AGE_S = 365 * 24 * 60 * 60;

export const DEVICE_COOKIE = 'hg_device';

/**
 * Works out WHICH device is asking.
 *
 * Source IP was the original answer, and it is wrong here for two reasons:
 *
 *  1. Over the LAN the API is reached through Docker's published port, which
 *     NATs every client to the bridge gateway (172.18.0.1). Every child looked
 *     like the same "device" — and because that address had drifted into the
 *     devices table, the status page cheerfully told a blocked tablet that its
 *     internet was on. A status page that lies is worse than no status page.
 *  2. Over the HTTPS tunnel the request arrives with Cloudflare's address, so
 *     the IP is not even on the household network.
 *
 * So identity is a signed cookie, planted once by a pairing link a parent
 * opens on the child's device. The IP is kept only as a fallback for the case
 * it is still meaningful: a genuine LAN address that maps to a known device.
 */
@Injectable()
export class DeviceIdentityService {
  private readonly logger = new Logger(DeviceIdentityService.name);
  private readonly secret: string;

  constructor(
    @InjectRepository(Device) private readonly devices: Repository<Device>,
    config: ConfigService,
  ) {
    this.secret = config.get<string>('JWT_SECRET', '') || 'home-guardian-unsigned';
  }

  /** The device making this request, or null if we genuinely cannot tell. */
  async resolve(req: Request): Promise<Device | null> {
    const fromCookie = this.deviceIdFromCookie(req);
    if (fromCookie) {
      const device = await this.devices.findOne({ where: { id: fromCookie } });
      if (device) return device;
      // Paired to a device that has since been removed — fall through rather
      // than claiming to be it.
    }

    const ip = this.clientIp(req);
    if (!ip || !this.isHouseholdAddress(ip)) return null;
    return this.devices.findOne({ where: { ipAddress: ip } });
  }

  /**
   * Is this an address that can identify a household device at all?
   *
   * Excludes loopback, Docker/container bridges and link-local. Anything that
   * is infrastructure rather than a device must return "I don't know" instead
   * of matching a row that happens to carry that address.
   */
  isHouseholdAddress(ip: string): boolean {
    if (!/^\d+\.\d+\.\d+\.\d+$/.test(ip)) return false;
    const [a, b] = ip.split('.').map(Number);
    if (a === 127) return false; // loopback
    if (a === 169 && b === 254) return false; // link-local
    // Docker's default pools. The bridge gateway masquerading as a device is
    // exactly the bug this guard exists to stop.
    if (a === 172 && b >= 16 && b <= 31) return false;
    return true;
  }

  clientIp(req: Request): string {
    const raw =
      (req.headers['cf-connecting-ip'] as string) ||
      (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() ||
      req.socket.remoteAddress ||
      '';
    return raw.replace(/^::ffff:/, '');
  }

  // ---- pairing ----

  /** A short-lived token a parent turns into a link for the child's device. */
  issuePairToken(deviceId: string): string {
    const expires = Date.now() + PAIR_TOKEN_TTL_MS;
    return `${deviceId}.${expires}.${this.sign(`${deviceId}.${expires}`)}`;
  }

  /** Returns the device id if the token is intact and unexpired. */
  verifyPairToken(token: string): string | null {
    const parts = (token ?? '').split('.');
    if (parts.length !== 3) return null;
    const [deviceId, expires, mac] = parts;
    if (!this.verify(`${deviceId}.${expires}`, mac)) return null;
    if (!Number(expires) || Number(expires) < Date.now()) return null;
    return deviceId;
  }

  /**
   * The cookie that marks this browser as that device.
   *
   * Not HttpOnly-optional: the child's page never needs to read it, and making
   * it unreadable to script means a stray XSS on the portal cannot harvest it.
   * SameSite=Lax so it survives the tap-through from a notification.
   * `secure` only when the origin is HTTPS — the LAN origin is plain HTTP, and
   * a Secure cookie there is simply dropped.
   */
  cookieFor(deviceId: string, secure: boolean): string {
    const value = `${deviceId}.${this.sign(deviceId)}`;
    return [
      `${DEVICE_COOKIE}=${value}`,
      'Path=/',
      `Max-Age=${COOKIE_MAX_AGE_S}`,
      'HttpOnly',
      'SameSite=Lax',
      secure ? 'Secure' : '',
    ]
      .filter(Boolean)
      .join('; ');
  }

  private deviceIdFromCookie(req: Request): string | null {
    const header = req.headers.cookie;
    if (!header) return null;
    for (const part of header.split(';')) {
      const [name, ...rest] = part.trim().split('=');
      if (name !== DEVICE_COOKIE) continue;
      const raw = rest.join('=');
      const idx = raw.lastIndexOf('.');
      if (idx < 1) return null;
      const deviceId = raw.slice(0, idx);
      return this.verify(deviceId, raw.slice(idx + 1)) ? deviceId : null;
    }
    return null;
  }

  private sign(payload: string): string {
    return createHmac('sha256', this.secret).update(payload).digest('base64url');
  }

  private verify(payload: string, mac: string): boolean {
    const expected = Buffer.from(this.sign(payload));
    const given = Buffer.from(mac ?? '');
    return expected.length === given.length && timingSafeEqual(expected, given);
  }
}
