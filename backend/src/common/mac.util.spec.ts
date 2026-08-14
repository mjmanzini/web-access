import { isRandomizedMac, normalizeMac } from './mac.util';

describe('mac.util', () => {
  it('normalizes assorted MAC formats to colon-lowercase', () => {
    expect(normalizeMac('A4-83-E7-00-11-22')).toBe('a4:83:e7:00:11:22');
    expect(normalizeMac('a483.e700.1122')).toBe('a4:83:e7:00:11:22');
    expect(normalizeMac('nonsense')).toBeNull();
    expect(normalizeMac(null)).toBeNull();
  });

  it('flags locally-administered (randomized) MACs via the U/L bit', () => {
    // 0x02 set in the first octet => randomized/private.
    expect(isRandomizedMac('a2:83:e7:00:11:22')).toBe(true); // 0xa2 & 0x02
    expect(isRandomizedMac('06:00:00:00:00:00')).toBe(true); // 0x06 & 0x02
    // Globally-unique vendor MAC => not randomized.
    expect(isRandomizedMac('a4:83:e7:00:11:22')).toBe(false); // 0xa4 & 0x02 == 0
    expect(isRandomizedMac(null)).toBe(false);
  });
});
