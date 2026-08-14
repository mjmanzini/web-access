import { Injectable } from '@nestjs/common';
import {
  ContainmentOptions,
  RouterBandwidth,
  RouterLease,
  RouterProvider,
} from './router-provider.interface';

/**
 * Default RouterProvider when no router is configured. Every method is a safe
 * no-op so the rest of the app (device sync, pause, bandwidth) works unchanged
 * on an AdGuard-only setup — router features simply report "not enabled".
 */
@Injectable()
export class NullRouterProvider implements RouterProvider {
  isEnabled(): boolean {
    return false;
  }
  async getStatus() {
    return { reachable: false, model: null };
  }
  async listLeases(): Promise<RouterLease[]> {
    return [];
  }
  async getBandwidth(): Promise<RouterBandwidth[]> {
    return [];
  }
  async setBlockedMacs(_macs: string[]): Promise<void> {
    /* no-op */
  }
  async applyBypassContainment(_opts: ContainmentOptions): Promise<void> {
    /* no-op */
  }
  async getContainmentStatus() {
    return { applied: false, rules: [] as string[] };
  }
}
