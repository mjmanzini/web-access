import { DevicesService } from './devices.service';
import { Device } from '../entities/device.entity';

/**
 * When a device was last here, and whether it is here now.
 *
 * Both of these were wrong in the same way: discovery lists devices that are
 * switched off — a DHCP lease outlives the machine that holds it, and AdGuard
 * keeps a client entry for anything it has ever seen — and the sync treated
 * "listed" as "present". Every offline device therefore reported a last-seen
 * of one sync tick ago, forever. A laptop off since Tuesday read "1m ago".
 *
 * The mirror bug: a device that disappeared from the feed entirely was never
 * marked offline, so it stayed in the online count with a frozen timestamp.
 *
 * These tests pin the rule: only presence moves the clock, and absence from
 * the feed means gone.
 */
describe('device presence and last-seen', () => {
  const NOW = new Date('2026-08-17T06:00:00+02:00');
  const TUESDAY = new Date('2026-08-11T19:30:00+02:00');

  function deviceRow(over: Partial<Device>): Device {
    return {
      id: `id-${over.ipAddress}`,
      name: over.name ?? 'Device',
      clientId: 'cid',
      ipAddress: over.ipAddress ?? '192.168.8.2',
      macAddress: over.macAddress ?? null,
      macRandomized: false,
      vendor: 'Acme',
      isOnline: over.isOnline ?? false,
      lastSeenAt: over.lastSeenAt ?? null,
      blocked: false,
      profile: null,
      profileId: over.profileId ?? null,
      createdAt: TUESDAY,
      updatedAt: TUESDAY,
      ...over,
    } as Device;
  }

  /**
   * Enough of the service's world to run a sync. The device repo is real
   * enough to answer the findOne shapes the sync uses and to record saves.
   */
  function harness(rows: Device[], leases: Array<Record<string, unknown>>) {
    const devices = {
      find: async () => rows,
      findOne: async ({ where }: { where: Record<string, unknown> }) =>
        rows.find(
          (r) =>
            (where.macAddress === undefined ||
              (where.macAddress as { _type?: string } | null)?._type === 'isNull'
              ? where.macAddress === undefined || !r.macAddress
              : r.macAddress === where.macAddress) &&
            (where.ipAddress === undefined || r.ipAddress === where.ipAddress),
        ) ?? null,
      create: (v: Partial<Device>) => deviceRow(v),
      save: async (v: Device | Device[]) => {
        for (const row of Array.isArray(v) ? v : [v]) {
          if (!rows.includes(row)) rows.push(row);
        }
        return v;
      },
      remove: async () => undefined,
    };
    const activity = {
      createQueryBuilder: () => ({
        select: () => ({
          addSelect: () => ({
            groupBy: () => ({ getRawMany: async () => [] }),
          }),
        }),
      }),
    };
    const svc = new DevicesService(
      devices as never,
      activity as never,
      { countBy: async () => 0, delete: async () => undefined } as never,
      { discoverDevices: async () => [] } as never,
      { isEnabled: () => true, listLeases: async () => leases } as never,
      { emitAlert: () => undefined } as never,
      { syncBlockedIdentifiers: async () => undefined } as never,
      { get: () => undefined } as never,
    );
    return { svc, rows };
  }

  beforeAll(() => jest.useFakeTimers().setSystemTime(NOW));
  afterAll(() => jest.useRealTimers());

  it('does not advance last-seen for a device the router lists but reports off', async () => {
    const laptop = deviceRow({
      name: 'Government laptop',
      ipAddress: '192.168.8.108',
      macAddress: 'aa:bb:cc:00:11:22',
      isOnline: false,
      lastSeenAt: TUESDAY,
    });
    const { svc } = harness([laptop], [
      { ip: '192.168.8.108', mac: 'aa:bb:cc:00:11:22', hostname: 'Government laptop', online: false },
    ]);

    await svc.syncFromNetwork();

    // The bug: this used to become NOW on every 2-minute tick.
    expect(laptop.lastSeenAt).toEqual(TUESDAY);
    expect(laptop.isOnline).toBe(false);
  });

  it('does advance last-seen for a device that is actually present', async () => {
    const phone = deviceRow({
      name: 'Main jastice phone',
      ipAddress: '192.168.8.60',
      macAddress: 'aa:bb:cc:00:33:44',
      isOnline: true,
      lastSeenAt: TUESDAY,
    });
    const { svc } = harness([phone], [
      { ip: '192.168.8.60', mac: 'aa:bb:cc:00:33:44', hostname: 'Main jastice phone', online: true },
    ]);

    await svc.syncFromNetwork();

    expect(phone.lastSeenAt).toEqual(NOW);
    expect(phone.isOnline).toBe(true);
  });

  it('records a device first discovered while off as never seen, not seen now', async () => {
    const { svc, rows } = harness([], [
      { ip: '192.168.8.114', mac: 'aa:bb:cc:00:55:66', hostname: 'Vodacom laptop', online: false },
    ]);

    await svc.syncFromNetwork();

    const created = rows.find((r) => r.ipAddress === '192.168.8.114');
    expect(created?.isOnline).toBe(false);
    // Inventing a sighting is worse than admitting we have never had one.
    expect(created?.lastSeenAt).toBeNull();
  });

  it('marks a device offline once it stops appearing in the feed', async () => {
    const ghost = deviceRow({
      name: 'host.docker.internal',
      ipAddress: '192.168.8.107',
      isOnline: true,
      lastSeenAt: TUESDAY,
      profileId: 'keep-me', // pinned so pruning cannot remove it instead
    });
    const here = deviceRow({
      name: 'Laptop',
      ipAddress: '192.168.8.100',
      macAddress: 'aa:bb:cc:00:77:88',
      isOnline: true,
    });
    const { svc } = harness([ghost, here], [
      { ip: '192.168.8.100', mac: 'aa:bb:cc:00:77:88', hostname: 'Laptop', online: true },
    ]);

    await svc.syncFromNetwork();

    expect(ghost.isOnline).toBe(false);
    // Left where it was: this is the last sync that genuinely saw it.
    expect(ghost.lastSeenAt).toEqual(TUESDAY);
    expect(here.isOnline).toBe(true);
  });

  it('does not black out the house when a poll comes back empty', async () => {
    const phone = deviceRow({
      name: 'Main jastice phone',
      ipAddress: '192.168.8.60',
      isOnline: true,
      lastSeenAt: TUESDAY,
    });
    const { svc } = harness([phone], []);

    await svc.syncFromNetwork();

    // One failed router poll is not evidence that everything left.
    expect(phone.isOnline).toBe(true);
  });
});
