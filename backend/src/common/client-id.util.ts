import { randomBytes } from 'node:crypto';

/**
 * AdGuard ClientID helpers. A ClientID is a stable, IP-independent identifier a
 * device embeds in its encrypted-DNS endpoint (DoT/DoH/DoQ). AdGuard then maps
 * every query carrying it to the right client regardless of IP or a randomized
 * MAC — which is exactly what keeps parental controls from drifting.
 *
 * Allowed charset per AdGuard: ASCII letters, digits, and hyphens. Must be
 * non-empty and is case-insensitive; we normalize to lowercase.
 */

/** Slugify a device name into the AdGuard-safe charset. */
export function slugifyClientId(name: string): string {
  const slug = (name || 'device')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 24)
    .replace(/-+$/g, '');
  // Must start with a letter/digit and be non-empty.
  return slug || 'device';
}

/** A stable ClientID: "<slug>-<random>" (e.g. "sams-iphone-3f9a"). */
export function generateClientId(name: string): string {
  const suffix = randomBytes(2).toString('hex'); // 4 hex chars
  return `${slugifyClientId(name)}-${suffix}`;
}

/** Validate an externally-supplied ClientID against AdGuard's charset. */
export function isValidClientId(id: string): boolean {
  return /^[a-z0-9][a-z0-9-]{0,62}$/.test(id);
}
