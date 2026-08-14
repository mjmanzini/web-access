import { normalizeMac } from '../../common/mac.util';
import { RouterBandwidth, RouterLease } from '../router-provider.interface';

/**
 * Pure parsers for the raw text/JSON OpenWrt returns. Kept separate from the
 * transport so they're trivially unit-testable without a router.
 */

/**
 * Parse a dnsmasq lease file (`/tmp/dhcp.leases`). Each line:
 *   <expiry_epoch> <mac> <ip> <hostname> <client-id>
 * hostname of "*" means unknown.
 */
export function parseDhcpLeases(fileContent: string): RouterLease[] {
  const leases: RouterLease[] = [];
  for (const raw of fileContent.split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    const [, mac, ip, hostname] = line.split(/\s+/);
    const norm = normalizeMac(mac);
    if (!norm || !ip) continue;
    leases.push({
      ip,
      mac: norm,
      hostname: hostname && hostname !== '*' ? hostname : null,
    });
  }
  return leases;
}

interface NlbwmonJson {
  columns?: string[];
  data?: Array<Array<string | number>>;
}

/**
 * Parse `nlbw -c json -g mac` output into per-MAC cumulative byte counters.
 * Uses the `columns` header to locate fields, so it tolerates column reordering
 * across nlbwmon versions. Rows sharing a MAC are summed.
 */
export function parseNlbwmon(input: string | NlbwmonJson): RouterBandwidth[] {
  const json: NlbwmonJson =
    typeof input === 'string' ? safeJson(input) : input;
  const cols = json.columns ?? [];
  const rows = json.data ?? [];
  const iMac = cols.indexOf('mac');
  const iRx = cols.indexOf('rx_bytes');
  const iTx = cols.indexOf('tx_bytes');
  if (iMac === -1 || iRx === -1 || iTx === -1) return [];

  const byMac = new Map<string, RouterBandwidth>();
  for (const row of rows) {
    const mac = normalizeMac(String(row[iMac]));
    if (!mac) continue;
    const rx = Number(row[iRx]) || 0;
    const tx = Number(row[iTx]) || 0;
    const cur = byMac.get(mac) ?? { mac, rxBytes: 0, txBytes: 0 };
    cur.rxBytes += rx;
    cur.txBytes += tx;
    byMac.set(mac, cur);
  }
  return [...byMac.values()];
}

function safeJson(s: string): NlbwmonJson {
  try {
    return JSON.parse(s);
  } catch {
    return {};
  }
}

/** Format MACs as an nft set element list: "{ aa:.., bb:.. }" (or "{ }"). */
export function nftMacElements(macs: string[]): string {
  const norm = macs.map(normalizeMac).filter(Boolean) as string[];
  return norm.length ? `{ ${norm.join(', ')} }` : '{ }';
}
