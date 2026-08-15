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

  constructor(config: ConfigService) {
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
            name: c.name,
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

  async setBlockedClientIdentifiers(identifiers: string[]): Promise<void> {
    const list = await this.api.getAccessList();
    await this.api.setAccessList({
      ...list,
      disallowed_clients: [...new Set(identifiers)],
    });
  }

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
    await this.api.setUserRules(rebuilt);
  }
}
