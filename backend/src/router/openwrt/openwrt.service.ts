import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  ContainmentOptions,
  RouterBandwidth,
  RouterLease,
  RouterProvider,
} from '../router-provider.interface';
import { OpenWrtClient } from './openwrt.client';
import { parseDhcpLeases, parseNlbwmon, nftMacElements } from './parsers';
import { buildScaffold, buildSetBlockedMacs, buildContainment, HG_TABLE } from './firewall';

/**
 * OpenWrt implementation of RouterProvider via ubus-over-HTTP. Owns a fenced
 * nftables table (`inet home_guardian`) for MAC blocks + bypass containment, and
 * reads DHCP leases + nlbwmon counters. Best-effort and defensive: a router blip
 * degrades to empty results / logged warnings, never a crash.
 */
@Injectable()
export class OpenWrtService implements RouterProvider {
  private readonly logger = new Logger(OpenWrtService.name);
  private readonly client: OpenWrtClient;
  private scaffolded = false;
  private containment = { applied: false, rules: [] as string[] };

  constructor(config: ConfigService) {
    this.client = new OpenWrtClient({
      baseUrl: config.get<string>('OPENWRT_URL', 'http://192.168.1.1'),
      username: config.get<string>('OPENWRT_USERNAME', 'root'),
      password: config.get<string>('OPENWRT_PASSWORD', ''),
    });
  }

  isEnabled(): boolean {
    return true;
  }

  async getStatus(): Promise<{ reachable: boolean; model: string | null }> {
    try {
      const { model } = await this.client.boardInfo();
      return { reachable: true, model };
    } catch (err) {
      this.logger.warn(`router unreachable: ${(err as Error).message}`);
      return { reachable: false, model: null };
    }
  }

  async listLeases(): Promise<RouterLease[]> {
    try {
      return parseDhcpLeases(await this.client.readFile('/tmp/dhcp.leases'));
    } catch (err) {
      this.logger.warn(`listLeases failed: ${(err as Error).message}`);
      return [];
    }
  }

  async getBandwidth(): Promise<RouterBandwidth[]> {
    try {
      const out = await this.client.exec('nlbw', ['-c', 'json', '-g', 'mac']);
      return parseNlbwmon(out);
    } catch (err) {
      this.logger.warn(`getBandwidth failed (is nlbwmon installed?): ${(err as Error).message}`);
      return [];
    }
  }

  async setBlockedMacs(macs: string[]): Promise<void> {
    try {
      await this.ensureScaffold();
      await this.client.nft(buildSetBlockedMacs(nftMacElements(macs)));
      this.logger.log(`router firewall: ${macs.length} MAC(s) hard-blocked`);
    } catch (err) {
      this.logger.warn(`setBlockedMacs failed: ${(err as Error).message}`);
    }
  }

  async applyBypassContainment(opts: ContainmentOptions): Promise<void> {
    try {
      await this.ensureScaffold();
      const { rules, summary } = buildContainment(opts);
      await this.client.nft(rules);
      this.containment = { applied: summary.length > 0, rules: summary };
      this.logger.log(`router containment applied: ${summary.join('; ') || 'none'}`);
    } catch (err) {
      this.logger.warn(`applyBypassContainment failed: ${(err as Error).message}`);
    }
  }

  async getContainmentStatus(): Promise<{ applied: boolean; rules: string[] }> {
    return this.containment;
  }

  /** Create our fenced nft table once per process (fresh, no duplicate rules). */
  private async ensureScaffold(): Promise<void> {
    if (this.scaffolded) return;
    try {
      await this.client.nft([`delete table ${HG_TABLE}`]);
    } catch {
      /* table didn't exist — fine */
    }
    await this.client.nft(buildScaffold());
    this.scaffolded = true;
  }
}
