/**
 * Anti-bypass ruleset. Filters alone don't stop a determined kid — they can
 * switch to a public DNS-over-HTTPS resolver and route around AdGuard entirely.
 * These AdGuard filtering rules block the best-known escape hatches at the DNS
 * layer. The *complete* fix also needs a router firewall rule (block outbound
 * 853/DoT and known DoH IPs, force port-53 redirect) — documented in
 * docs/ARCHITECTURE.md, and enforceable later via an OpenWrt provider.
 */

/** Firefox's canary domain — resolving it to NXDOMAIN disables Firefox auto-DoH. */
export const FIREFOX_DOH_CANARY = 'use-application-dns.net';

/** Popular public DoH/DoT resolver hostnames to blackhole. */
export const PUBLIC_DOH_HOSTS = [
  'dns.google',
  'dns.google.com',
  'cloudflare-dns.com',
  'mozilla.cloudflare-dns.com',
  'dns.quad9.net',
  'doh.opendns.com',
  'dns.nextdns.io',
  'doh.cleanbrowsing.org',
  'dns.adguard.com',
  'dns-family.adguard.com',
  'doh.dns.sb',
  'dns.controld.com',
];

/**
 * Build the AdGuard rules that block DNS bypass. Scoped to a client when
 * `clientKey` is given (only that profile is affected), else global.
 */
export function buildAntiBypassRules(clientKey?: string): string[] {
  const suffix = clientKey ? `$client='${clientKey}'` : '';
  const rules: string[] = [];
  // Block the resolver hostnames.
  for (const host of PUBLIC_DOH_HOSTS) {
    rules.push(`||${host}^${suffix}`);
  }
  // Force Firefox canary to NXDOMAIN so it falls back to system DNS.
  rules.push(`||${FIREFOX_DOH_CANARY}^${suffix}`);
  return rules;
}
