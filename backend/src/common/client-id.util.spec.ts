import {
  generateClientId,
  isValidClientId,
  slugifyClientId,
} from './client-id.util';

describe('client-id.util', () => {
  it('slugifies names into the AdGuard-safe charset', () => {
    expect(slugifyClientId("Sam's iPhone 15!")).toBe('sam-s-iphone-15');
    expect(slugifyClientId('   ')).toBe('device');
    expect(slugifyClientId('')).toBe('device');
    // No leading/trailing hyphens, max length respected.
    const long = slugifyClientId('a'.repeat(100));
    expect(long.length).toBeLessThanOrEqual(24);
    expect(long).not.toMatch(/^-|-$/);
  });

  it('generates valid, unique-ish client ids with a random suffix', () => {
    const a = generateClientId('Living Room TV');
    const b = generateClientId('Living Room TV');
    expect(isValidClientId(a)).toBe(true);
    expect(a).toMatch(/^living-room-tv-[0-9a-f]{4}$/);
    expect(a).not.toBe(b); // random suffix differs
  });

  it('validates client ids against the charset', () => {
    expect(isValidClientId('kids-tablet-1')).toBe(true);
    expect(isValidClientId('BAD_UNDERSCORE')).toBe(false);
    expect(isValidClientId('-leading')).toBe(false);
    expect(isValidClientId('')).toBe(false);
  });
});
