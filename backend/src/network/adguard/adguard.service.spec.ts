import { ConfigService } from '@nestjs/config';
import { AdguardService } from './adguard.service';

/**
 * Regression: two rule buckets being written at the same time.
 *
 * AdGuard exposes a single user-rules list, so every bucket update is a
 * read-modify-write of the whole thing. When the enforce tick pushed the
 * "__blocked__" bucket while a profile-policy push rewrote its own bucket, both
 * read the same "before" list and the later write erased the earlier one. In the
 * field that deleted the block rule for a paused profile: the database, the
 * dashboard and the API all still said "switched off" while the device browsed
 * freely, which is the worst failure this system can have — it lies.
 */
describe('AdguardService — concurrent rule writes', () => {
  /** Stands in for AdGuard: one rules list, with a slow, interleaving read. */
  function fakeApi(readDelayMs = 5) {
    const state = { rules: [] as string[], writes: 0 };
    return {
      state,
      getUserRules: jest.fn(async () => {
        // Snapshot FIRST, then let the response take time to arrive — that is
        // what an HTTP GET does, and it is what makes the read stale by the
        // time the caller acts on it. (Snapshotting after the delay would
        // accidentally serialize the fake and hide the very bug under test.)
        const snapshot = [...state.rules];
        await new Promise((r) => setTimeout(r, readDelayMs));
        return snapshot;
      }),
      setUserRules: jest.fn(async (rules: string[]) => {
        state.writes++;
        state.rules = [...rules];
      }),
    };
  }

  function serviceWith(api: unknown): AdguardService {
    const svc = new AdguardService(new ConfigService({}));
    // The client is constructed internally; swap it for the fake.
    (svc as unknown as { api: unknown }).api = api;
    return svc;
  }

  /** setManagedBucket is private — this is the behaviour under test. */
  const writeBucket = (svc: AdguardService, key: string, rules: string[]) =>
    (
      svc as unknown as {
        setManagedBucket(k: string, r: string[] | null): Promise<void>;
      }
    ).setManagedBucket(key, rules);

  it('keeps both buckets when writes overlap', async () => {
    const api = fakeApi();
    const svc = serviceWith(api);

    await Promise.all([
      writeBucket(svc, '__blocked__', ["||*^$client='192.168.8.112'"]),
      writeBucket(svc, 'profile-a', ['||dns.google^']),
    ]);

    expect(api.state.rules).toContain("||*^$client='192.168.8.112'");
    expect(api.state.rules).toContain('||dns.google^');
  });

  it('survives many interleaved writes without losing a bucket', async () => {
    const api = fakeApi(2);
    const svc = serviceWith(api);

    await Promise.all(
      Array.from({ length: 12 }, (_, i) =>
        writeBucket(svc, `bucket-${i}`, [`||example-${i}.com^`]),
      ),
    );

    for (let i = 0; i < 12; i++) {
      expect(api.state.rules).toContain(`||example-${i}.com^`);
    }
  });

  it('preserves hand-written admin rules outside the managed block', async () => {
    const api = fakeApi();
    api.state.rules = ['||admin-added.example^'];
    const svc = serviceWith(api);

    await writeBucket(svc, '__blocked__', ["||*^$client='10.0.0.5'"]);

    expect(api.state.rules[0]).toBe('||admin-added.example^');
    expect(api.state.rules).toContain("||*^$client='10.0.0.5'");
  });

  it('skips the write when nothing changed, so re-pushing on a timer is free', async () => {
    const api = fakeApi();
    const svc = serviceWith(api);

    await writeBucket(svc, '__blocked__', ["||*^$client='10.0.0.5'"]);
    const after = api.state.writes;
    await writeBucket(svc, '__blocked__', ["||*^$client='10.0.0.5'"]);

    expect(api.state.writes).toBe(after);
  });

  it('does not wedge later writes when one write fails', async () => {
    const api = fakeApi();
    const svc = serviceWith(api);
    api.setUserRules.mockRejectedValueOnce(new Error('AdGuard down'));

    await expect(writeBucket(svc, 'a', ['||a.example^'])).rejects.toThrow();
    await writeBucket(svc, 'b', ['||b.example^']);

    expect(api.state.rules).toContain('||b.example^');
  });
});

/**
 * A blocked device must still receive the notification that explains why it is
 * blocked. That means the push transport stays reachable while everything else
 * is answered 0.0.0.0 — and that the hole stays exactly as small as declared.
 */
describe('AdguardService — blocked-client rule composition', () => {
  function harness(env: Record<string, string> = {}) {
    const state = { rules: [] as string[] };
    const api = {
      getUserRules: async () => [...state.rules],
      setUserRules: async (r: string[]) => { state.rules = [...r]; },
      getAccessList: async () => ({ allowed_clients: [], disallowed_clients: [], blocked_hosts: [] }),
      setAccessList: async () => undefined,
    };
    const svc = new AdguardService(new ConfigService({ PORTAL_HOSTNAME: 'homeguardian.co.za', ...env }));
    (svc as unknown as { api: unknown }).api = api;
    return { svc, state };
  }

  it('pairs every block with the portal and push exceptions', async () => {
    const { svc, state } = harness();
    await svc.setBlockedClientIdentifiers(['192.168.8.112']);

    expect(state.rules).toContain("||*^$client='192.168.8.112'");
    expect(state.rules).toContain("@@||homeguardian.co.za^$client='192.168.8.112'");
    expect(state.rules).toContain("@@||mtalk.google.com^$client='192.168.8.112'");
    expect(state.rules).toContain("@@||fcm.googleapis.com^$client='192.168.8.112'");
  });

  it('allows nothing beyond the declared hosts — no wildcards, no extras', async () => {
    const { svc, state } = harness();
    await svc.setBlockedClientIdentifiers(['192.168.8.112']);

    const allowed = state.rules.filter((r) => r.startsWith('@@'));
    expect(allowed).toHaveLength(3);
    // A wildcard here would quietly reopen general browsing.
    expect(allowed.some((r) => r.includes('*'))).toBe(false);
    expect(allowed.every((r) => r.includes("$client='192.168.8.112'"))).toBe(true);
  });

  it('honours PUSH_ALLOW_DOMAINS so the hole can be closed entirely', async () => {
    const { svc, state } = harness({ PUSH_ALLOW_DOMAINS: '' });
    await svc.setBlockedClientIdentifiers(['192.168.8.112']);

    expect(state.rules.filter((r) => r.startsWith('@@'))).toEqual([
      "@@||homeguardian.co.za^$client='192.168.8.112'",
    ]);
  });
});

/**
 * DNS cannot stop a video that is already playing — YouTube resolves a
 * googlevideo host once and then pulls segments over connections that are
 * already open. Blocking the CDNs before bedtime is what stops a new stream
 * starting, so the buffer drains instead of refilling.
 */
describe('AdguardService — pre-bedtime video tightening', () => {
  function harness() {
    const state = { rules: [] as string[] };
    const api = {
      getUserRules: async () => [...state.rules],
      setUserRules: async (r: string[]) => { state.rules = [...r]; },
      getAccessList: async () => ({ allowed_clients: [], disallowed_clients: [], blocked_hosts: [] }),
      setAccessList: async () => undefined,
    };
    const svc = new AdguardService(new ConfigService({}));
    (svc as unknown as { api: unknown }).api = api;
    return { svc, state };
  }

  it('blocks the segment CDNs for the given clients', async () => {
    const { svc, state } = harness();
    await svc.setPreBedtimeIdentifiers(['192.168.8.112']);

    // googlevideo is where the bytes come from; blocking youtube.com alone
    // stops the page, not the playback.
    expect(state.rules).toContain("||googlevideo.com^$client='192.168.8.112'");
    expect(state.rules).toContain("||nflxvideo.net^$client='192.168.8.112'");
  });

  it('scopes every rule to a client, never globally', async () => {
    const { svc, state } = harness();
    await svc.setPreBedtimeIdentifiers(['tab-80-kids-e0cf']);
    const managed = state.rules.filter((r) => r.startsWith('||'));
    expect(managed.length).toBeGreaterThan(0);
    // A rule without $client would take video off every device in the house.
    expect(managed.every((r) => r.includes("$client='tab-80-kids-e0cf'"))).toBe(true);
  });

  it('clears itself when no device is in the run-up window', async () => {
    const { svc, state } = harness();
    await svc.setPreBedtimeIdentifiers(['192.168.8.112']);
    expect(state.rules.some((r) => r.includes('googlevideo'))).toBe(true);

    await svc.setPreBedtimeIdentifiers([]);
    expect(state.rules.some((r) => r.includes('googlevideo'))).toBe(false);
  });

  it('does not disturb the blocked-client bucket', async () => {
    const { svc, state } = harness();
    await svc.setBlockedClientIdentifiers(['192.168.8.112']);
    await svc.setPreBedtimeIdentifiers(['192.168.8.60']);

    expect(state.rules).toContain("||*^$client='192.168.8.112'");
    expect(state.rules).toContain("||googlevideo.com^$client='192.168.8.60'");
  });
});
