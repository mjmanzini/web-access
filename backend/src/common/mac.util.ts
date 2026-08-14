/**
 * MAC address helpers. The key control-evasion signal is MAC randomization:
 * modern phones present a "private"/locally-administered MAC per SSID, which
 * defeats MAC-based grouping and blocking. We detect it from the U/L bit.
 */

/** Normalize any MAC form (dashes, dots, upper) to "aa:bb:cc:dd:ee:ff". */
export function normalizeMac(input: string | null | undefined): string | null {
  if (!input) return null;
  const hex = input.replace(/[^0-9a-fA-F]/g, '').toLowerCase();
  if (hex.length !== 12) return null;
  return hex.match(/.{2}/g)!.join(':');
}

/**
 * A MAC is randomized/private when the locally-administered bit (bit 1 of the
 * first octet, mask 0x02) is set. Real hardware (globally unique) MACs have it
 * clear. This is exactly what iOS/Android "Private Wi-Fi Address" toggles.
 */
export function isRandomizedMac(mac: string | null | undefined): boolean {
  const norm = normalizeMac(mac);
  if (!norm) return false;
  const firstOctet = parseInt(norm.slice(0, 2), 16);
  return (firstOctet & 0x02) === 0x02;
}
