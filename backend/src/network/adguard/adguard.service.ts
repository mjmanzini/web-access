import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  DiscoveredDevice,
  NetworkProvider,
  NetworkQueryLogEntry,
  ProfilePolicy,
} from '../network-provider.interface';
import { AdguardApiClient, AdguardClient } from './adguard.client';
import {
  CATEGORY_DEFINITIONS,
  servicesForCategories,
  needsParental,
} from '../../common/categories';
import { buildAntiBypassRules } from './anti-bypass';
import { normalizeMac } from '../../common/mac.util';
import { isSelfAssignedName } from '../../common/hostname.util';

/**
 * AdGuard Home implementation of NetworkProvider. Translates vendor-neutral
 * ProfilePolicy objects into AdGuard client settings + custom filtering rules,
 * idempotently. One Profile == one AdGuard client (keyed by profile id).
 */
@Injectable()
export class AdguardService implements NetworkProvider {
  private readonly logger = new Logger(AdguardService.name);
  private readonly api: AdguardApiClient;

  /** Marker so we only ever manage our own rules inside AdGuard's user_rules. */
  private static readonly MANAGED_TAG = '# home-guardian:managed';

  constructor(private readonly config: ConfigService) {
    this.api = new AdguardApiClient({
      baseUrl: config.get<string>('ADGUARD_URL', 'http://adguardhome:80'),
      username: config.get<string>('ADGUARD_USERNAME', 'admin'),
      password: config.get<string>('ADGUARD_PASSWORD', ''),
    });
  }

  async getStatus(): Promise<{ running: boolean; version: string | null }> {
    try {
      const s = await this.api.status();
      return { running: s.running, version: s.version };
    } catch (err) {
      this.logger.warn(`AdGuard status check failed: ${(err as Error).message}`);
      return { running: false, version: null };
    }
  }

  async discoverDevices(): Promise<DiscoveredDevice[]> {
    const [{ clients, auto_clients }, leases] = await Promise.all([
      this.api.listClients(),
      this.api.dhcpLeases(),
    ]);

    // Prefer DHCP leases (they carry MAC); fold in auto-discovered clients.
    const byIp = new Map<string, DiscoveredDevice>();

    for (const c of auto_clients) {
      // "etc/hosts" entries are the AdGuard host's own hosts file — container
      // hostnames, ip6-allnodes, localhost and friends. They are artifacts of
      // where AdGuard runs, not devices on the family's network.
      if (c.source === 'etc/hosts') continue;
      byIp.set(c.ip, {
        ip: c.ip,
        mac: null,
        name: c.name || null,
        online: true,
        lastSeen: new Date(),
      });
    }
    for (const lease of leases) {
      byIp.set(lease.ip, {
        ip: lease.ip,
        mac: normalizeMac(lease.mac),
        name: lease.hostname || byIp.get(lease.ip)?.name || null,
        online: true,
        lastSeen: new Date(),
      });
    }
    // Configured clients pinned by IP id also count as known devices.
    for (const c of clients) {
      for (const id of c.ids) {
        if (/^\d+\.\d+\.\d+\.\d+$/.test(id) && !byIp.has(id)) {
          byIp.set(id, {
            ip: id,
            mac: null,
            // Our own per-profile client is named `hg-<uuid>`. Reporting that
            // back as the device's name would be this app reading its own
            // bookkeeping and mistaking it for something the device said.
            name: isSelfAssignedName(c.name) ? null : c.name,
            online: false,
            lastSeen: null,
          });
        }
      }
    }
    return [...byIp.values()];
  }

  async applyProfilePolicy(policy: ProfilePolicy): Promise<void> {
    const client: AdguardClient = {
      name: this.clientName(policy.clientKey),
      ids: policy.identifiers,
      use_global_settings: false,
      filtering_enabled: true,
      parental_enabled: needsParental(policy.blockedCategories),
      safebrowsing_enabled: true,
      safe_search: {
        enabled: policy.safeSearch,
        google: policy.safeSearch,
        bing: policy.safeSearch,
        duckduckgo: policy.safeSearch,
        yandex: policy.safeSearch,
        // YouTube Restricted Mode rides on AdGuard's safe_search.youtube.
        youtube: policy.youtubeRestricted,
      },
      use_global_blocked_services: false,
      blocked_services: servicesForCategories(policy.blockedCategories),
    };

    await this.api.upsertClient(client);

    // Compile this profile's per-client domain + anti-bypass rules.
    const name = this.clientName(policy.clientKey);
    const rules: string[] = [];
    for (const d of policy.blockDomains) rules.push(`||${d}^$client='${name}'`);
    for (const d of policy.allowDomains) rules.push(`@@||${d}^$client='${name}'`);
    if (policy.blockDnsBypass) rules.push(...buildAntiBypassRules(name));
    await this.setManagedBucket(policy.clientKey, rules);

    // Categories backed by a hosted blocklist (e.g. gambling, which AdGuard has
    // no first-class "service" for). Filter lists are global in AdGuard, so this
    // applies network-wide rather than to this profile alone — the alternative
    // was leaving the category silently unenforced.
    for (const slug of policy.blockedCategories) {
      const url = CATEGORY_DEFINITIONS[slug]?.blocklistUrl;
      if (!url) continue;
      try {
        await this.api.addFilterUrl(url, `Home Guardian — ${slug}`);
      } catch (err) {
        this.logger.warn(
          `could not subscribe ${slug} blocklist: ${(err as Error).message}`,
        );
      }
    }

    this.logger.log(
      `Applied policy for ${policy.displayName} (${policy.identifiers.length} ids)`,
    );
  }

  async removeProfileClient(clientKey: string): Promise<void> {
    try {
      await this.api.deleteClient(this.clientName(clientKey));
    } catch (err) {
      this.logger.warn(`deleteClient failed: ${(err as Error).message}`);
    }
    await this.setManagedBucket(clientKey, null);
  }

  async setGlobalDomainRules(
    blockDomains: string[],
    allowDomains: string[],
  ): Promise<void> {
    const rules: string[] = [];
    for (const d of blockDomains) rules.push(`||${d}^`);
    for (const d of allowDomains) rules.push(`@@||${d}^`);
    await this.setManagedBucket('__global__', rules);
  }

  /**
   * Cut a set of clients off, by ANSWERING every query with a block rather than
   * refusing to serve them.
   *
   * The obvious implementation — AdGuard's access list (`disallowed_clients`) —
   * is actively harmful whenever a secondary DNS server is handed out: AdGuard
   * drops/refuses the query, the client treats that as "this resolver is down",
   * fails over to the secondary (typically the router), and resolves everything
   * unfiltered. Bedtime then appears to do nothing. Android is especially quick
   * to fail over because it queries configured resolvers in parallel.
   *
   * A client-scoped catch-all filter rule keeps the client talking to AdGuard —
   * it gets a prompt 0.0.0.0 for every name, so there is no failure to fail over
   * from, and the block actually holds.
   */
  async setBlockedClientIdentifiers(identifiers: string[]): Promise<void> {
    const unique = [...new Set(identifiers)];
    // The child's own status page ("why isn't my tablet working?") lives on the
    // local portal host. A catch-all block would take that page down for
    // exactly the devices that need it, so every blocked client keeps an
    // explicit exception for it. @@ rules win over blocks in AdGuard.
    const portal = this.config
      .get<string>('PORTAL_HOSTNAME', 'homeguardian.co.za')
      .trim();
    // A blocked device must still be able to RECEIVE the notification telling
    // it why it is blocked, and Android delivers web push over a persistent
    // connection to Google's messaging servers. Block those and the child's app
    // goes silent exactly when it has something to say.
    //
    // This is a real, deliberate hole, so it is kept as small as possible:
    // named hosts only, no wildcards, and only the two that push actually needs
    // — mtalk.google.com (the FCM/MCS connection that carries the message) and
    // fcm.googleapis.com (registration). Neither serves general web content, so
    // the practical browsing leak is nil; a determined tunnel over FCM is
    // theoretically possible and is a trade we accept, because a bedtime
    // warning that never arrives is the worse failure.
    const pushHosts = this.config
      .get<string>('PUSH_ALLOW_DOMAINS', 'mtalk.google.com,fcm.googleapis.com')
      .split(',')
      .map((h) => h.trim())
      .filter(Boolean);

    // The kid app's HTTPS origin, when one is configured. It is a real public
    // hostname resolved through Cloudflare, so unlike the LAN portal it does
    // NOT survive a catch-all block on its own — without this exception the
    // child's app goes dark exactly when it is needed.
    const kidsHost = (() => {
      const url = this.config.get<string>('KIDS_PUBLIC_URL', '').trim();
      if (!url) return null;
      try {
        return new URL(url).hostname || null;
      } catch {
        this.logger.warn(`KIDS_PUBLIC_URL is not a valid URL: ${url}`);
        return null;
      }
    })();

    const rules: string[] = [];
    for (const id of unique) {
      rules.push(`||*^$client='${id}'`);
      if (portal) rules.push(`@@||${portal}^$client='${id}'`);
      if (kidsHost) rules.push(`@@||${kidsHost}^$client='${id}'`);
      for (const host of pushHosts) rules.push(`@@||${host}^$client='${id}'`);
    }
    await this.setManagedBucket('__blocked__', rules);

    // Retire any access-list entries a previous version left behind, so the
    // refuse-to-serve path can't reintroduce the failover it caused.
    const list = await this.api.getAccessList();
    if (list.disallowed_clients.length) {
      await this.api.setAccessList({ ...list, disallowed_clients: [] });
      this.logger.log(
        `Cleared ${list.disallowed_clients.length} access-list entr(ies); blocking now uses client-scoped rules`,
      );
    }
  }

  /**
   * The ten minutes before bedtime: stop new video starting.
   *
   * DNS blocking cannot end a stream that is already running. YouTube resolves
   * a googlevideo host once, opens QUIC connections to it, and then pulls
   * segments over those same connections for as long as they stay open — no
   * further lookups, nothing for a resolver to refuse. Bedtime arrived and the
   * video kept playing.
   *
   * Blocking the video CDNs at T-10 does not fix that (only a link-layer cutoff
   * does) but it changes the shape of the problem: no new stream can start in
   * the run-up, and whatever is playing runs its buffer down instead of topping
   * it up. Ten minutes of buffer is not a thing.
   */
  async setPreBedtimeIdentifiers(identifiers: string[]): Promise<void> {
    const unique = [...new Set(identifiers)];
    const rules: string[] = [];
    for (const id of unique) {
      for (const domain of AdguardService.VIDEO_DOMAINS) {
        rules.push(`||${domain}^$client='${id}'`);
      }
    }
    await this.setManagedBucket('__prebedtime__', rules.length ? rules : null);
  }

  /**
   * Segment/CDN hosts, not front doors. Blocking `youtube.com` stops the page
   * loading but not playback already in flight; `googlevideo.com` is where the
   * segments actually come from, so a player that tries to open a new stream
   * fails immediately.
   */
  private static readonly VIDEO_DOMAINS = [
    'googlevideo.com',
    'youtube.com',
    'youtubei.googleapis.com',
    'ytimg.com',
    'nflxvideo.net',
    'netflix.com',
    'ttvnw.net',
    'tiktokcdn.com',
    'tiktokv.com',
    'dstv.stream',
    'showmax.com',
  ];

  async fetchQueryLog(limit: number): Promise<NetworkQueryLogEntry[]> {
    const rows = await this.api.queryLog(limit);
    return rows.map((r) => ({
      timestamp: new Date(r.time),
      clientIp: r.client,
      domain: (r.question?.name ?? '').toLowerCase().replace(/\.$/, ''),
      queryType: r.question?.type ?? 'A',
      action: this.mapReason(r.reason),
      category: r.rule ? r.rule : null,
      upstream: r.upstream ?? null,
      elapsedMs: r.elapsedMs ? Math.round(parseFloat(r.elapsedMs)) : null,
    }));
  }

  // ---- internals ----

  private clientName(clientKey: string): string {
    return `hg-${clientKey}`;
  }

  private mapReason(reason: string): 'allowed' | 'blocked' | 'rewritten' {
    if (!reason) return 'allowed';
    if (reason.startsWith('Filtered')) return 'blocked';
    if (reason.startsWith('Rewrite')) return 'rewritten';
    return 'allowed';
  }

  /**
   * Replace exactly one keyed "bucket" of rules inside the block of AdGuard
   * user_rules that WE own (marked by MANAGED_TAG), preserving both any
   * hand-written admin rules outside our block and the other buckets inside it.
   * Pass `rules: null` to drop the bucket entirely. This keeps each profile's
   * (and the global) rules independently reconcilable without clobbering others.
   */
  private async setManagedBucket(
    key: string,
    rules: string[] | null,
  ): Promise<void> {
    // AdGuard has ONE user-rules list, and updating a bucket means read the
    // whole list, edit it, write the whole list back. Two of those cycles
    // interleaving (the enforce tick pushing __blocked__ while a profile policy
    // push rewrites its own bucket) both read the same "before" state and the
    // slower writer's version wins — silently deleting the other bucket. That
    // is exactly how a paused profile ended up with no block rule in AdGuard
    // while the database still said "paused": enforcement looked applied on
    // every screen we had, and the tablet browsed. Serialize the cycles.
    return this.withRulesLock(() => this.rewriteBucket(key, rules));
  }

  /** Serializes every read-modify-write cycle over the shared rules list. */
  private rulesLock: Promise<unknown> = Promise.resolve();

  private withRulesLock<T>(fn: () => Promise<T>): Promise<T> {
    // Chain onto the previous cycle whether it resolved or rejected: one failed
    // write must not wedge every later write behind a permanently rejected
    // promise.
    const run = this.rulesLock.then(fn, fn);
    this.rulesLock = run.catch(() => undefined);
    return run;
  }

  private async rewriteBucket(
    key: string,
    rules: string[] | null,
  ): Promise<void> {
    const existing = await this.api.getUserRules();
    const tag = AdguardService.MANAGED_TAG;

    // Split admin (unmanaged) rules from our managed block.
    const managedStart = existing.indexOf(tag);
    const adminRules =
      managedStart === -1 ? existing : existing.slice(0, managedStart);

    // Parse the current managed block into buckets keyed by "# client:<key>".
    const managed = managedStart === -1 ? [] : existing.slice(managedStart + 1);
    const buckets = new Map<string, string[]>();
    let current = '';
    for (const line of managed) {
      const m = line.match(/^# client:(.+)$/);
      if (m) {
        current = m[1].trim();
        buckets.set(current, []);
      } else if (current) {
        buckets.get(current)!.push(line);
      }
    }

    if (rules === null) buckets.delete(key);
    else buckets.set(key, rules);

    // Reassemble: admin rules first, then our tagged managed block.
    const rebuilt = [...adminRules, tag];
    for (const [k, r] of buckets) rebuilt.push(`# client:${k}`, ...r);

    // No-op writes are skipped, which makes re-pushing the whole enforcement
    // set on a timer cheap enough to do unconditionally — so if a bucket ever
    // does go missing, the next tick puts it back instead of waiting for a
    // state change that may never come.
    if (
      rebuilt.length === existing.length &&
      rebuilt.every((line, i) => line === existing[i])
    ) {
      return;
    }
    await this.api.setUserRules(rebuilt);
  }
}
