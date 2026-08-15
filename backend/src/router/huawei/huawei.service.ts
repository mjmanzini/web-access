import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  ContainmentOptions,
  RouterBandwidth,
  RouterLease,
  RouterProvider,
} from '../router-provider.interface';
import { HuaweiClient } from './huawei.client';
import { parseHostInfo, parseHostList, buildMultiMacFilter } from './parsers';
import { tag } from './xml';

/**
 * Huawei HiLink (B525-class LTE CPE) implementation of RouterProvider. These
 * routers can't run OpenWrt, so this is a PARTIAL provider:
 *
 *   ✓ device discovery (connected hosts: IP + MAC + hostname)
 *   ✓ per-device hard cutoff via the Wi-Fi MAC blacklist (for pause/bedtime)
 *   ✗ per-device bandwidth      — not exposed by the device API
 *   ✗ bypass containment        — no firewall/DNS-forcing API (stays DNS-layer)
 *
 * MAC-filter blocking affects Wi-Fi clients; a device using a randomized MAC can
 * evade it, which is why the DNS layer (AdGuard, by ClientID/IP) blocks in
 * parallel. Best-effort + defensive: a router error degrades gracefully.
 */
@Injectable()
export class HuaweiLteService implements RouterProvider {
  private readonly logger = new Logger(HuaweiLteService.name);
  private readonly client: HuaweiClient;

  constructor(config: ConfigService) {
    this.client = new HuaweiClient({
      baseUrl: config.get<string>('HUAWEI_URL', 'http://192.168.8.1'),
      username: config.get<string>('HUAWEI_USERNAME', 'admin'),
      password: config.get<string>('HUAWEI_PASSWORD', ''),
    });
  }

  isEnabled(): boolean {
    return true;
  }

  async getStatus(): Promise<{ reachable: boolean; model: string | null }> {
    try {
      const xml = await this.client.deviceInfo();
      return { reachable: true, model: tag(xml, 'DeviceName') ?? tag(xml, 'devicename') };
    } catch (err) {
      this.logger.warn(`Huawei router unreachable: ${(err as Error).message}`);
      return { reachable: false, model: null };
    }
  }

  /**
   * The router is the source of truth for the device inventory. /api/lan/HostInfo
   * carries names, MACs, address source and — unlike the Wi-Fi host list — the
   * devices that are currently switched off. Falls back to the Wi-Fi list on
   * firmwares that don't expose it.
   */
  async listLeases(): Promise<RouterLease[]> {
    try {
      const leases = parseHostInfo(await this.client.hostInfo());
      if (leases.length) return leases;
      this.logger.debug('HostInfo returned nothing — falling back to host-list');
    } catch (err) {
      this.logger.warn(`HostInfo failed, trying host-list: ${(err as Error).message}`);
    }
    try {
      return parseHostList(await this.client.hostList());
    } catch (err) {
      this.logger.warn(`hostList failed: ${(err as Error).message}`);
      return [];
    }
  }

  /** Not available on this hardware — the device API has no per-client bytes. */
  async getBandwidth(): Promise<RouterBandwidth[]> {
    return [];
  }

  async setBlockedMacs(macs: string[]): Promise<void> {
    try {
      await this.client.setMacFilter(buildMultiMacFilter(macs));
      this.logger.log(`Huawei Wi-Fi MAC blacklist: ${macs.length} device(s) blocked`);
    } catch (err) {
      this.logger.warn(`setBlockedMacs failed: ${(err as Error).message}`);
    }
  }

  /** No firewall/DNS-forcing API on HiLink — containment stays at the DNS layer. */
  async applyBypassContainment(_opts: ContainmentOptions): Promise<void> {
    this.logger.debug('bypass containment not supported on Huawei LTE (DNS-layer only)');
  }

  async getContainmentStatus(): Promise<{ applied: boolean; rules: string[] }> {
    return {
      applied: false,
      rules: ['not supported on Huawei LTE — use AdGuard DNS-layer bypass rules'],
    };
  }
}
