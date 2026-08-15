/**
 * RouterProvider is the OPTIONAL, complementary seam to NetworkProvider. Where
 * AdGuard (NetworkProvider) owns DNS/content policy, the router owns things DNS
 * can't do: true internet cutoffs at the firewall, per-device bandwidth
 * accounting, and containment of bypass attempts (forcing DNS to AdGuard,
 * dropping DoT/known-DoH/VPN traffic).
 *
 * It is off by default (NullRouterProvider). A real driver (OpenWrtService)
 * lights up when ROUTER_PROVIDER=openwrt is configured. Nothing in the app
 * requires a router to function — router features are purely additive.
 */

export const ROUTER_PROVIDER = Symbol('ROUTER_PROVIDER');

export interface RouterLease {
  ip: string;
  mac: string;
  hostname: string | null;
  /**
   * Whether the router currently sees the device as connected. Undefined when
   * the source only reports live clients; false means "known but not here",
   * which is how devices that are switched off stay in the inventory.
   */
  online?: boolean;
}

/** Cumulative per-MAC byte counters as reported by the router. */
export interface RouterBandwidth {
  mac: string;
  rxBytes: number; // downloaded
  txBytes: number; // uploaded
}

export interface ContainmentOptions {
  /** Force all client DNS (port 53) to AdGuard; drop external DNS. */
  forceDnsToAdguard: boolean;
  /** AdGuard's LAN IP, required when forceDnsToAdguard is true. */
  adguardIp?: string;
  /** Drop DNS-over-TLS (TCP 853). */
  blockDot: boolean;
  /** Drop traffic to well-known public DoH resolver IPs. */
  blockKnownDohIps: boolean;
  /** Drop common consumer VPN ports (WireGuard/OpenVPN/IPsec). */
  blockVpnPorts: boolean;
}

export interface RouterProvider {
  /** True only for a configured real router driver. */
  isEnabled(): boolean;

  getStatus(): Promise<{ reachable: boolean; model: string | null }>;

  /** Authoritative IP↔MAC↔hostname from the router's DHCP server. */
  listLeases(): Promise<RouterLease[]>;

  /** Cumulative per-MAC byte counters (e.g. from nlbwmon). */
  getBandwidth(): Promise<RouterBandwidth[]>;

  /** Replace the set of MACs hard-blocked at the firewall (true cutoff). */
  setBlockedMacs(macs: string[]): Promise<void>;

  /** Install/refresh the anti-bypass firewall rules (idempotent, fenced). */
  applyBypassContainment(opts: ContainmentOptions): Promise<void>;

  getContainmentStatus(): Promise<{ applied: boolean; rules: string[] }>;
}
