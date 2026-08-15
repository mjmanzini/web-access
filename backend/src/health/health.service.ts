import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SchedulerRegistry } from '@nestjs/schedule';
import {
  NETWORK_PROVIDER,
  NetworkProvider,
} from '../network/network-provider.interface';
import {
  ROUTER_PROVIDER,
  RouterProvider,
} from '../router/router-provider.interface';
import { EventsGateway } from '../events/events.gateway';

export interface ComponentHealth {
  name: string;
  up: boolean;
  fails: number;
  lastOkAt: string | null;
  downSince: string | null;
}

/**
 * The heartbeat. On a fixed cadence it checks whether the backend can still
 * reach AdGuard (and the router, if configured). A component that stays down
 * past HEARTBEAT_FAIL_THRESHOLD raises a critical alert (dashboard + webhook →
 * phone); recovery raises an info alert. While everything is healthy it pings
 * HEARTBEAT_PING_URL — a dead-man's switch, so an external monitor catches the
 * one case this process can't report itself: the whole box being powered off.
 */
@Injectable()
export class HealthService implements OnModuleInit {
  private readonly logger = new Logger(HealthService.name);
  private readonly threshold: number;
  private readonly intervalSec: number;
  private readonly pingUrl: string;
  private lastPingAt: string | null = null;

  private components: Record<string, ComponentHealth> = {
    adguard: { name: 'adguard', up: true, fails: 0, lastOkAt: null, downSince: null },
  };

  /** Last DNS-steering verdict, so the alert fires on change, not every check. */
  private steeringOk: boolean | null = null;

  constructor(
    @Inject(NETWORK_PROVIDER) private network: NetworkProvider,
    @Inject(ROUTER_PROVIDER) private router: RouterProvider,
    private events: EventsGateway,
    private config: ConfigService,
    private scheduler: SchedulerRegistry,
  ) {
    this.threshold = Math.max(1, Number(config.get('HEARTBEAT_FAIL_THRESHOLD', 3)));
    this.intervalSec = Math.max(15, Number(config.get('HEARTBEAT_INTERVAL_SEC', 60)));
    this.pingUrl = config.get<string>('HEARTBEAT_PING_URL', '');
  }

  onModuleInit(): void {
    if (this.router.isEnabled()) {
      this.components.router = {
        name: 'router', up: true, fails: 0, lastOkAt: null, downSince: null,
      };
    }
    const handle = setInterval(() => this.tick(), this.intervalSec * 1000);
    this.scheduler.addInterval('heartbeat', handle);
    this.logger.log(
      `heartbeat every ${this.intervalSec}s, alert after ${this.threshold} misses` +
        (this.pingUrl ? ', dead-man ping enabled' : ''),
    );
  }

  /** Current health snapshot for the dashboard. */
  snapshot() {
    const comps = Object.values(this.components);
    return {
      healthy: comps.every((c) => c.up),
      components: comps,
      deadManPing: { url: !!this.pingUrl, lastPingAt: this.lastPingAt },
    };
  }

  private async tick(): Promise<void> {
    await this.check('adguard', async () => (await this.network.getStatus()).running);
    if (this.components.router) {
      await this.check('router', async () => (await this.router.getStatus()).reachable);
      await this.checkDnsSteering();
    }
    // Dead-man switch: only ping when fully healthy, so a degraded state also
    // trips the external monitor (missing ping == something is wrong).
    if (this.pingUrl && Object.values(this.components).every((c) => c.up)) {
      this.ping();
    }
  }

  /**
   * Is the router still handing out the filter as the DNS server?
   *
   * This silently reverted in the field: the router put its own address back as
   * both primary and secondary, so every DHCP device stopped being filtered
   * while the dashboard happily reported rules enforced and blocks applied.
   * Nothing else in the system can detect that — AdGuard is healthy, the rules
   * are correct, the devices simply stop asking. Only the router knows, so ask
   * the router.
   */
  private async checkDnsSteering(): Promise<void> {
    const expected = this.config.get<string>('ADGUARD_LAN_IP', '').trim();
    if (!expected || !this.router.getDhcpDns) return;

    const dns = await this.router.getDhcpDns();
    if (!dns) return;

    const ok = dns.primary === expected;
    if (ok === this.steeringOk) return; // only announce changes
    this.steeringOk = ok;

    if (!ok) {
      this.events.emitAlert({
        type: 'system_down',
        severity: 'critical',
        message:
          `Your router is no longer sending devices to Home Guardian for DNS ` +
          `(it is handing out ${dns.primary ?? 'nothing'} instead of ${expected}). ` +
          `Filtering and bedtime will not apply to devices as their leases renew.`,
        at: new Date().toISOString(),
      });
      this.logger.warn(`DNS steering LOST — router hands out ${dns.primary}, expected ${expected}`);
    } else {
      this.logger.log('DNS steering verified — router points at Home Guardian');
    }
  }

  private async check(name: string, probe: () => Promise<boolean>): Promise<void> {
    const c = this.components[name];
    let ok = false;
    try {
      ok = await probe();
    } catch {
      ok = false;
    }
    const now = new Date().toISOString();

    if (ok) {
      c.lastOkAt = now;
      c.fails = 0;
      if (!c.up) {
        c.up = true;
        c.downSince = null;
        this.events.emitAlert({
          type: 'system_recovered',
          severity: 'info',
          message: `${name} is reachable again.`,
          at: now,
        });
        this.logger.log(`${name} recovered`);
      }
      return;
    }

    c.fails++;
    if (c.up && c.fails >= this.threshold) {
      c.up = false;
      c.downSince = now;
      this.events.emitAlert({
        type: 'system_down',
        severity: 'critical',
        message: `${name} has been unreachable for ${this.threshold} checks — filtering/monitoring may be down.`,
        at: now,
      });
      this.logger.warn(`${name} marked DOWN after ${c.fails} misses`);
    }
  }

  private ping(): void {
    fetch(this.pingUrl, { method: 'GET' })
      .then(() => {
        this.lastPingAt = new Date().toISOString();
      })
      .catch((e) => this.logger.warn(`dead-man ping failed: ${e.message}`));
  }
}
