import { ConfigService } from '@nestjs/config';
import { Request } from 'express';
import { DEVICE_COOKIE, DeviceIdentityService } from './device-identity.service';

/**
 * Getting this wrong is not a cosmetic bug. When the portal resolved devices by
 * source IP, every LAN client arrived NAT'd to Docker's bridge gateway
 * (172.18.0.1) — and because that address had drifted into the devices table,
 * a blocked child's tablet was told "Internet is on".
 */
describe('DeviceIdentityService', () => {
  const devices = { findOne: jest.fn() };
  const make = () =>
    new DeviceIdentityService(
      devices as never,
      new ConfigService({ JWT_SECRET: 'test-secret' }),
    );

  const req = (over: Partial<Request> = {}): Request =>
    ({ headers: {}, socket: { remoteAddress: undefined }, ...over }) as Request;

  beforeEach(() => devices.findOne.mockReset());

  describe('address classification', () => {
    const svc = () => make();

    it('rejects Docker bridge addresses — the source of the lie', () => {
      for (const ip of ['172.18.0.1', '172.17.0.1', '172.27.0.20', '172.31.255.254']) {
        expect(svc().isHouseholdAddress(ip)).toBe(false);
      }
    });

    it('rejects loopback and link-local', () => {
      expect(svc().isHouseholdAddress('127.0.0.1')).toBe(false);
      expect(svc().isHouseholdAddress('169.254.1.5')).toBe(false);
    });

    it('accepts real household addresses', () => {
      expect(svc().isHouseholdAddress('192.168.8.112')).toBe(true);
      expect(svc().isHouseholdAddress('10.0.0.5')).toBe(true);
      // 172.32+ is outside Docker's range and is a normal address.
      expect(svc().isHouseholdAddress('172.32.0.1')).toBe(true);
    });
  });

  it('returns null rather than matching a device on a NAT address', async () => {
    const svc = make();
    const out = await svc.resolve(req({ socket: { remoteAddress: '172.18.0.1' } as never }));
    expect(out).toBeNull();
    // The critical part: it must not even look, so a stray row cannot match.
    expect(devices.findOne).not.toHaveBeenCalled();
  });

  it('still resolves by IP when the address is genuinely a LAN one', async () => {
    const svc = make();
    devices.findOne.mockResolvedValue({ id: 'd1' });
    const out = await svc.resolve(req({ socket: { remoteAddress: '::ffff:192.168.8.112' } as never }));
    expect(out).toEqual({ id: 'd1' });
    expect(devices.findOne).toHaveBeenCalledWith({ where: { ipAddress: '192.168.8.112' } });
  });

  describe('pairing', () => {
    it('round-trips a token', () => {
      const svc = make();
      expect(svc.verifyPairToken(svc.issuePairToken('device-1'))).toBe('device-1');
    });

    it('rejects a tampered or forged token', () => {
      const svc = make();
      const token = svc.issuePairToken('device-1');
      expect(svc.verifyPairToken(token.replace('device-1', 'device-2'))).toBeNull();
      expect(svc.verifyPairToken('device-2.9999999999999.forged')).toBeNull();
      expect(svc.verifyPairToken('')).toBeNull();
      expect(svc.verifyPairToken('nonsense')).toBeNull();
    });

    it('rejects an expired token', () => {
      const svc = make();
      const token = svc.issuePairToken('device-1');
      const realNow = Date.now;
      Date.now = () => realNow() + 20 * 60_000; // 20 minutes later
      try {
        expect(svc.verifyPairToken(token)).toBeNull();
      } finally {
        Date.now = realNow;
      }
    });

    it('will not accept a token signed with a different secret', () => {
      const other = new DeviceIdentityService(
        devices as never,
        new ConfigService({ JWT_SECRET: 'someone-elses-secret' }),
      );
      expect(make().verifyPairToken(other.issuePairToken('device-1'))).toBeNull();
    });
  });

  describe('cookie', () => {
    it('identifies the paired device on later requests', async () => {
      const svc = make();
      const cookie = svc.cookieFor('device-9', false);
      const value = cookie.split(';')[0].split('=').slice(1).join('=');

      devices.findOne.mockResolvedValue({ id: 'device-9' });
      const out = await svc.resolve(
        req({ headers: { cookie: `${DEVICE_COOKIE}=${value}` } } as never),
      );
      expect(out).toEqual({ id: 'device-9' });
      expect(devices.findOne).toHaveBeenCalledWith({ where: { id: 'device-9' } });
    });

    it('ignores a forged cookie', async () => {
      const svc = make();
      const out = await svc.resolve(
        req({ headers: { cookie: `${DEVICE_COOKIE}=device-9.not-a-real-signature` } } as never),
      );
      expect(out).toBeNull();
    });

    it('marks the cookie Secure only on an HTTPS origin', () => {
      const svc = make();
      // A Secure cookie on the plain-HTTP LAN origin is silently dropped.
      expect(svc.cookieFor('d', false)).not.toContain('Secure');
      expect(svc.cookieFor('d', true)).toContain('Secure');
      expect(svc.cookieFor('d', false)).toContain('HttpOnly');
      expect(svc.cookieFor('d', false)).toContain('SameSite=Lax');
    });
  });
});
