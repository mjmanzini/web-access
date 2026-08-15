import { Socket, createSocket } from 'node:dgram';
import { promises as dns } from 'node:dns';

/**
 * Best-effort friendly-name discovery for a LAN device.
 *
 * AdGuard only learns names it can see (rDNS, /etc/hosts, its own DHCP), which
 * on a typical home LAN means most devices arrive nameless and fall back to a
 * bare IP. Two cheap probes fill most of that gap:
 *
 *   1. NetBIOS name query (UDP 137) — Windows boxes answer with their machine
 *      name (e.g. "DESKTOP-VPURVNV"). Also answered by Samba and many NAS/printers.
 *   2. Reverse DNS (PTR) — works when the router publishes DHCP hostnames.
 *
 * Both are strictly best-effort: short timeouts, never throw, null on no answer.
 * Phones generally answer neither (iOS/Android don't run a NetBIOS responder),
 * which is why manual rename exists.
 */

const NETBIOS_PORT = 137;
// Kept short: on LANs without a NetBIOS responder (common — Windows now ships
// it off by default) every probe burns this budget, and scans probe in parallel.
const DEFAULT_TIMEOUT_MS = 500;

/** Encode the NetBIOS wildcard name "*" in first-level encoding (32 bytes). */
function encodeWildcardName(): Buffer {
  // 16-byte NetBIOS name: '*' followed by 15 NULs, each nibble mapped to 'A'+n.
  const raw = Buffer.alloc(16, 0);
  raw[0] = 0x2a; // '*'
  const out = Buffer.alloc(32);
  for (let i = 0; i < 16; i++) {
    out[i * 2] = 0x41 + ((raw[i] >> 4) & 0x0f);
    out[i * 2 + 1] = 0x41 + (raw[i] & 0x0f);
  }
  return out;
}

function buildNbstatQuery(): Buffer {
  const name = encodeWildcardName();
  const buf = Buffer.alloc(12 + 1 + name.length + 1 + 4);
  let o = 0;
  buf.writeUInt16BE(0x4a4b, o); o += 2; // transaction id
  buf.writeUInt16BE(0x0000, o); o += 2; // flags: standard query, no recursion
  buf.writeUInt16BE(0x0001, o); o += 2; // questions
  buf.writeUInt16BE(0x0000, o); o += 2; // answer RRs
  buf.writeUInt16BE(0x0000, o); o += 2; // authority RRs
  buf.writeUInt16BE(0x0000, o); o += 2; // additional RRs
  buf.writeUInt8(name.length, o); o += 1; // label length (32)
  name.copy(buf, o); o += name.length;
  buf.writeUInt8(0x00, o); o += 1; // end of name
  buf.writeUInt16BE(0x0021, o); o += 2; // type NBSTAT
  buf.writeUInt16BE(0x0001, o); // class IN
  return buf;
}

/**
 * Parse an NBSTAT response and return the workstation name.
 * Layout after the header/question echo: [name count][name(15) + type(1) + flags(2)]…
 */
function parseNbstatResponse(msg: Buffer): string | null {
  // Skip header (12) + echoed question name + type/class + TTL + datalen.
  let o = 12;
  if (o >= msg.length) return null;
  const labelLen = msg[o];
  o += 1 + labelLen + 1; // label + terminating NUL
  o += 2 + 2 + 4 + 2; // type + class + ttl + data length
  if (o >= msg.length) return null;

  const count = msg[o];
  o += 1;
  for (let i = 0; i < count && o + 18 <= msg.length; i++) {
    const name = msg.subarray(o, o + 15).toString('ascii').trim();
    const suffix = msg[o + 15];
    const flags = msg.readUInt16BE(o + 16);
    o += 18;
    const isGroup = (flags & 0x8000) !== 0;
    // Suffix 0x00 = workstation service; unique (non-group) entry is the host name.
    if (suffix === 0x00 && !isGroup && name) {
      return name;
    }
  }
  return null;
}

/** NetBIOS name query. Resolves to null on timeout or malformed reply. */
export function netbiosName(
  ip: string,
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<string | null> {
  return new Promise((resolve) => {
    let socket: Socket;
    try {
      socket = createSocket('udp4');
    } catch {
      return resolve(null);
    }

    let settled = false;
    const finish = (value: string | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        socket.close();
      } catch {
        /* already closed */
      }
      resolve(value);
    };

    const timer = setTimeout(() => finish(null), timeoutMs);
    socket.on('error', () => finish(null));
    socket.on('message', (msg) => {
      try {
        finish(parseNbstatResponse(msg));
      } catch {
        finish(null);
      }
    });

    try {
      socket.send(buildNbstatQuery(), NETBIOS_PORT, ip, (err) => {
        if (err) finish(null);
      });
    } catch {
      finish(null);
    }
  });
}

/** Reverse-DNS lookup, trimmed to the first label (host.lan -> host). */
async function reverseDnsName(ip: string): Promise<string | null> {
  try {
    const names = await dns.reverse(ip);
    const first = names?.[0];
    if (!first) return null;
    const label = first.split('.')[0];
    return label && label !== ip ? label : null;
  } catch {
    return null;
  }
}

/**
 * Resolve a friendly hostname for an IP, trying NetBIOS then reverse DNS.
 * Returns null when the device doesn't announce itself.
 */
export async function resolveHostname(ip: string): Promise<string | null> {
  if (!ip) return null;
  const netbios = await netbiosName(ip);
  if (netbios) return netbios;
  return reverseDnsName(ip);
}

/** True for addresses that are never a real, nameable device. */
export function isNonDeviceAddress(ip: string): boolean {
  if (!ip) return true;

  if (ip.includes(':')) {
    const v6 = ip.toLowerCase();
    if (v6 === '::' || v6 === '::1') return true; // unspecified / loopback
    if (v6.startsWith('ff')) return true; // ff00::/8 multicast (ip6-allnodes etc.)
    if (v6.startsWith('fe80')) return true; // link-local
    if (v6.startsWith('fe00')) return true; // reserved (ip6-localnet)
    return false;
  }

  if (ip === '255.255.255.255' || ip.endsWith('.255')) return true; // broadcast
  const first = Number(ip.split('.')[0]);
  if (first >= 224 && first <= 239) return true; // multicast
  if (ip.startsWith('127.')) return true; // loopback
  if (ip.startsWith('169.254.')) return true; // link-local
  return false;
}

/**
 * A name is a "placeholder" when it was auto-derived rather than chosen. Those
 * may be replaced by better discovery; anything else is treated as user-set and
 * is never overwritten by a scan.
 */
export function isPlaceholderName(
  name: string | null | undefined,
  ip: string | null,
  vendor: string | null,
): boolean {
  if (!name) return true;
  const n = name.trim();
  if (!n) return true;
  if (ip && n === ip) return true;
  if (/^\d+\.\d+\.\d+\.\d+$/.test(n)) return true; // any bare IPv4
  if (vendor && n === `${vendor} device`) return true;
  if (/ device$/i.test(n) && /^[A-Z]/.test(n)) return true; // "<Vendor> device"
  return false;
}
