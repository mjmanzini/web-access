import { normalizeMac } from '../../common/mac.util';
import { RouterLease } from '../router-provider.interface';
import { blocks, tag, buildRequest } from './xml';

/**
 * Parse /api/lan/HostInfo — the richer feed. Unlike /api/wlan/host-list it
 * includes devices the router knows but that are not currently connected
 * (`Active` 0), so switched-off devices stay in the inventory instead of
 * vanishing. `ActualName` is the label set in the router UI and wins over the
 * device's self-reported `HostName` when both are present.
 */
export function parseHostInfo(xml: string): RouterLease[] {
  const leases: RouterLease[] = [];
  for (const host of blocks(xml, 'Host')) {
    const mac = normalizeMac(tag(host, 'MacAddress'));
    const ip = tag(host, 'IpAddress');
    if (!mac || !ip) continue;
    const actual = tag(host, 'ActualName');
    const reported = tag(host, 'HostName');
    const name = [actual, reported].find((n) => n && n !== 'unknown') ?? null;
    leases.push({ ip, mac, hostname: name, online: tag(host, 'Active') === '1' });
  }
  return leases;
}

/** Parse /api/wlan/host-list (or /api/lan/HostInfo) into leases. */
export function parseHostList(xml: string): RouterLease[] {
  const leases: RouterLease[] = [];
  for (const host of blocks(xml, 'Host')) {
    const mac = normalizeMac(tag(host, 'MacAddress'));
    const ip = tag(host, 'IpAddress');
    if (!mac || !ip) continue;
    const name = tag(host, 'HostName');
    leases.push({ ip, mac, hostname: name && name !== 'unknown' ? name : null });
  }
  return leases;
}

/**
 * Build the /api/wlan/multi-macfilter-settings POST body to blacklist a set of
 * MACs across the given SSID indexes (2.4G = 0, 5G = 1 on the B525). The B525
 * exposes 10 MAC slots per SSID; we fill from the top and blank the rest.
 *
 * NOTE: Huawei firmwares vary in exact field names/values for the filter mode.
 * This targets the common B525 scheme (status 1 = on, mode "1" = blacklist).
 * Validate against the device and adjust if the router rejects it.
 */
export function buildMultiMacFilter(macs: string[], ssidIndexes = [0, 1]): string {
  const norm = macs.map(normalizeMac).filter(Boolean).slice(0, 10) as string[];
  const fields: Array<[string, string | number]> = [];
  for (const idx of ssidIndexes) {
    fields.push([`Index${idx}`, idx]);
    fields.push([`wifihostname${idx}`, '']);
    fields.push([`WifiMacFilterStatus${idx}`, norm.length ? 1 : 0]);
    fields.push([`WifiMacFilterMode${idx}`, 1]); // 1 = blacklist (deny listed)
    for (let slot = 0; slot < 10; slot++) {
      fields.push([`WifiMacFilterMac${idx}_${slot}`, norm[slot] ?? '']);
    }
  }
  return buildRequest(fields);
}
