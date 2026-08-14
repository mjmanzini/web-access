import { ContainmentOptions } from '../router-provider.interface';

/**
 * nftables command builders for the router. We keep ALL our state in a single
 * dedicated table `inet home_guardian` so it's fully fenced from OpenWrt's own
 * `fw4` ruleset — we can flush/rebuild ours without touching the router's.
 */

export const HG_TABLE = 'inet home_guardian';
export const BLOCKED_SET = 'hg_blocked_macs';

/** Well-known public DoH resolver IPs to blackhole under containment. */
export const KNOWN_DOH_IPS = [
  '1.1.1.1',
  '1.0.0.1', // Cloudflare
  '8.8.8.8',
  '8.8.4.4', // Google
  '9.9.9.9',
  '149.112.112.112', // Quad9
  '208.67.222.222',
  '208.67.220.220', // OpenDNS
  '94.140.14.14',
  '94.140.15.15', // AdGuard DNS
];

/** Common consumer-VPN ports to drop under containment. */
export const VPN_PORTS = {
  udp: [51820 /* WireGuard */, 1194 /* OpenVPN */, 500, 4500 /* IPsec/IKE */],
  tcp: [1194 /* OpenVPN/TCP */, 1723 /* PPTP */],
};

/** Commands that (re)create our table + MAC block set + drop rule. Idempotent. */
export function buildScaffold(): string[] {
  return [
    `add table ${HG_TABLE}`,
    `add set ${HG_TABLE} ${BLOCKED_SET} { type ether_addr; flags interval; }`,
    `add chain ${HG_TABLE} block { type filter hook forward priority -150; policy accept; }`,
    // Drop any forwarded traffic from a blocked MAC (true internet cutoff).
    `add rule ${HG_TABLE} block ether saddr @${BLOCKED_SET} drop`,
  ];
}

/** Replace the blocked-MAC set contents. */
export function buildSetBlockedMacs(elements: string): string[] {
  return [
    `flush set ${HG_TABLE} ${BLOCKED_SET}`,
    ...(elements === '{ }'
      ? []
      : [`add element ${HG_TABLE} ${BLOCKED_SET} ${elements}`]),
  ];
}

/**
 * Build the anti-bypass containment rules into a dedicated `contain` chain we
 * fully own. We flush the chain first so toggling options is clean.
 */
export function buildContainment(opts: ContainmentOptions): {
  rules: string[];
  summary: string[];
} {
  const rules: string[] = [
    `add table ${HG_TABLE}`,
    `add chain ${HG_TABLE} contain { type filter hook forward priority -140; policy accept; }`,
    `flush chain ${HG_TABLE} contain`,
  ];
  const summary: string[] = [];

  if (opts.blockDot) {
    rules.push(`add rule ${HG_TABLE} contain tcp dport 853 drop`);
    summary.push('drop DNS-over-TLS (tcp/853)');
  }
  if (opts.blockKnownDohIps) {
    rules.push(
      `add rule ${HG_TABLE} contain ip daddr { ${KNOWN_DOH_IPS.join(', ')} } tcp dport 443 drop`,
    );
    summary.push(`drop known DoH resolver IPs (${KNOWN_DOH_IPS.length})`);
  }
  if (opts.blockVpnPorts) {
    rules.push(
      `add rule ${HG_TABLE} contain udp dport { ${VPN_PORTS.udp.join(', ')} } drop`,
      `add rule ${HG_TABLE} contain tcp dport { ${VPN_PORTS.tcp.join(', ')} } drop`,
    );
    summary.push('drop common VPN ports (WireGuard/OpenVPN/IPsec/PPTP)');
  }
  if (opts.forceDnsToAdguard && opts.adguardIp) {
    // Allow DNS to AdGuard, drop DNS to anywhere else (both UDP + TCP 53).
    rules.push(
      `add rule ${HG_TABLE} contain ip daddr ${opts.adguardIp} udp dport 53 accept`,
      `add rule ${HG_TABLE} contain ip daddr ${opts.adguardIp} tcp dport 53 accept`,
      `add rule ${HG_TABLE} contain udp dport 53 drop`,
      `add rule ${HG_TABLE} contain tcp dport 53 drop`,
    );
    summary.push(`force all DNS to AdGuard (${opts.adguardIp})`);
  }
  return { rules, summary };
}
