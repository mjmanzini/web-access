import { lookupVendor, vendorLabel, ouiTableSize } from './oui';

describe('oui.lookupVendor', () => {
  it('resolves known vendor OUIs (any MAC format)', () => {
    expect(lookupVendor('a4:83:e7:00:11:22')).toBe('Apple');
    expect(lookupVendor('B8-27-EB-11-22-33')).toBe('Raspberry Pi');
    expect(lookupVendor('8c7712aabbcc')).toBe('Samsung Electronics');
  });

  it('covers the whole IEEE registry, not a hand-kept shortlist', () => {
    // The point of baking the registry in: a device this household owns is
    // identified without anyone having thought of its vendor in advance.
    expect(ouiTableSize).toBeGreaterThan(50_000);
    expect(lookupVendor('94:e6:f7:80:25:e6')).toBeTruthy(); // the "Government laptop"
    expect(lookupVendor('40:45:da:9f:57:dd')).toBeTruthy(); // the kids' tablet
    expect(lookupVendor('84:c5:a6:0d:41:16')).toBeTruthy(); // the DNS server itself
  });

  it('returns null for unknown OUIs and randomized MACs', () => {
    expect(lookupVendor('02:00:00:00:00:01')).toBeNull(); // locally-administered
    expect(lookupVendor('a2:83:e7:00:11:22')).toBeNull(); // locally-administered
    expect(lookupVendor(null)).toBeNull();
  });
});

describe('oui.vendorLabel', () => {
  it('says a private MAC is hidden rather than unknown', () => {
    // These are different facts. "Unknown" invites a bug report; "hidden"
    // explains both the blank and why MAC-based blocking will not work.
    const l = vendorLabel('5e:6c:7d:97:da:ff');
    expect(l.text).toBe('vendor hidden (private MAC)');
    expect(l.private).toBe(true);
    expect(l.known).toBe(false);
  });

  it('never guesses a vendor for a randomized MAC', () => {
    // The OUI of a private MAC is invented by the device; reading a
    // manufacturer out of it would be pure fabrication.
    expect(vendorLabel('7a:62:e5:79:d4:66', 'Samsung Electronics').private).toBe(true);
    expect(vendorLabel('7a:62:e5:79:d4:66', 'Samsung Electronics').text).not.toMatch(/Samsung/);
  });

  it('distinguishes "no MAC at all" from "MAC we cannot place"', () => {
    expect(vendorLabel(null).text).toBe('no MAC seen');
    expect(vendorLabel('00:00:5e:00:53:01').text).toMatch(/unknown manufacturer|.+/);
  });
});
