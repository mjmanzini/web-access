import { isRandomizedMac, normalizeMac } from './mac.util';
import { OUI_TABLE_GZ_B64, OUI_TABLE_SIZE } from './oui-table.generated';
import { gunzipSync } from 'node:zlib';

/**
 * MAC → manufacturer, from the IEEE registries baked into the build.
 *
 * Entirely offline, deliberately. This machine is the household's DNS server,
 * so a lookup that needs the internet fails exactly when the network is being
 * diagnosed — and asking a third-party API "who made the device with this MAC"
 * would mean shipping the family's hardware addresses off the premises to
 * answer a cosmetic question. Neither is a trade worth making.
 *
 * Coverage is the full registry (~53k assignments), not a curated shortlist,
 * so an unrecognised device is genuinely unregistered rather than merely
 * absent from a list someone kept by hand.
 */

/** Inflated on first use — a few ms, and never at all if nothing asks. */
let table: Map<string, string> | null = null;

function oui(): Map<string, string> {
  if (table) return table;
  const text = gunzipSync(Buffer.from(OUI_TABLE_GZ_B64, 'base64')).toString('utf8');
  const map = new Map<string, string>();
  for (const line of text.split('\n')) {
    const sp = line.indexOf(' ');
    if (sp > 0) map.set(line.slice(0, sp), line.slice(sp + 1));
  }
  table = map;
  return map;
}

/**
 * Names the registry gets right but a parent would not recognise, plus the
 * handful this household actually owns. Applied over the generated table so a
 * refresh of the registry never undoes them.
 */
const FRIENDLY: Record<string, string> = {
  // Huawei's own OUIs — the router in this house.
  '00:e0:fc': 'Huawei',
  '48:46:fb': 'Huawei',
};

/**
 * Vendor for a MAC, or null when unknown or meaningless.
 *
 * Longest prefix wins: a 36-bit (MA-S) assignment must not be reported as the
 * company that operates the 24-bit block it sits inside.
 */
export function lookupVendor(mac: string | null | undefined): string | null {
  const norm = normalizeMac(mac);
  // A randomized MAC's OUI belongs to nobody — reporting a vendor for one is
  // inventing a fact. See vendorLabel() for how this is shown.
  if (!norm || isRandomizedMac(norm)) return null;
  const friendly = FRIENDLY[norm.split(':').slice(0, 3).join(':')];
  if (friendly) return friendly;
  const hex = norm.replace(/:/g, '');
  const t = oui();
  return t.get(hex.slice(0, 9)) ?? t.get(hex.slice(0, 7)) ?? t.get(hex.slice(0, 6)) ?? null;
}

/**
 * What to show a parent, including when the honest answer is "cannot know".
 *
 * A randomized MAC is not a gap in our data, it is the device declining to
 * identify itself — and saying so is useful, because it is also the thing that
 * defeats MAC-based controls. Guessing a vendor from a private MAC would be
 * worse than useless: the OUI is invented by the phone.
 */
export function vendorLabel(
  mac: string | null | undefined,
  storedVendor?: string | null,
): { text: string; known: boolean; private: boolean } {
  const norm = normalizeMac(mac);
  if (norm && isRandomizedMac(norm)) {
    return { text: 'vendor hidden (private MAC)', known: false, private: true };
  }
  const vendor = lookupVendor(norm) ?? storedVendor ?? null;
  if (vendor) return { text: vendor, known: true, private: false };
  return {
    text: norm ? 'unknown manufacturer' : 'no MAC seen',
    known: false,
    private: false,
  };
}

/** How many assignments are baked in — surfaced for diagnostics. */
export const ouiTableSize = OUI_TABLE_SIZE;
