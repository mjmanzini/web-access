import { isRandomizedMac, normalizeMac } from './mac.util';

/**
 * Best-effort MAC OUI → vendor lookup for auto-naming devices. This is a curated
 * table of common consumer vendors, not the full IEEE registry — enough to turn
 * "192.168.1.50" into "Apple device" for most home gear. Swap in the full IEEE
 * OUI DB if you want exhaustive coverage. Randomized/private MACs return null
 * (their OUI is meaningless).
 */
const OUI: Record<string, string> = {};
function reg(vendor: string, prefixes: string[]) {
  for (const p of prefixes) OUI[p.replace(/[^0-9a-f]/gi, '').toLowerCase()] = vendor;
}

reg('Apple', ['3c:22:fb', 'a4:83:e7', 'ac:bc:32', 'f0:18:98', 'dc:a9:04', '68:96:7b', '88:66:5a', '90:72:40']);
reg('Samsung', ['00:12:fb', '8c:77:12', '34:23:87', '5c:0a:5b', 'e8:50:8b', 'd0:17:6a']);
reg('Google', ['3c:5a:b4', '54:60:09', 'f4:f5:d8', '1c:f2:9a', 'da:a1:19', '48:d6:d5']);
reg('Amazon', ['44:65:0d', '68:37:e9', 'fc:65:de', '0c:47:c9', '74:c2:46', 'ac:63:be']);
reg('Microsoft', ['00:12:5a', '28:18:78', '7c:1e:52', '50:1a:c5', '98:5f:d3']);
reg('Intel', ['00:1b:21', '3c:a9:f4', '34:e6:d7', 'a0:a8:cd', '8c:16:45']);
reg('Raspberry Pi', ['b8:27:eb', 'dc:a6:32', 'e4:5f:01', '28:cd:c1']);
reg('Sony', ['00:13:a9', 'fc:0f:e6', 'a8:e3:ee', '5c:e0:c5']);
reg('LG', ['00:1c:62', '3c:cd:93', 'a8:16:b2', '10:68:3f']);
reg('TP-Link', ['50:c7:bf', 'a4:2b:b0', '14:cc:20', 'ec:08:6b']);
reg('Espressif (IoT)', ['24:0a:c4', '30:ae:a4', '84:cc:a8', '7c:9e:bd', 'a0:20:a6']);
reg('Nintendo', ['00:1a:e9', '98:b6:e9', '7c:bb:8a', '58:bd:a3']);
reg('Roku', ['b0:a7:37', 'cc:6d:a0', 'dc:3a:5e', 'b8:3e:59']);
reg('Xiaomi', ['64:09:80', '78:11:dc', '50:8f:4c', 'f8:a4:5f']);

/** Vendor name for a MAC, or null (unknown or randomized). */
export function lookupVendor(mac: string | null | undefined): string | null {
  const norm = normalizeMac(mac);
  if (!norm || isRandomizedMac(norm)) return null;
  const oui = norm.split(':').slice(0, 3).join('');
  return OUI[oui] ?? null;
}
