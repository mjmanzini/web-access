import { lookupVendor } from './oui';

describe('oui.lookupVendor', () => {
  it('resolves known vendor OUIs (any MAC format)', () => {
    expect(lookupVendor('a4:83:e7:00:11:22')).toBe('Apple');
    expect(lookupVendor('B8-27-EB-11-22-33')).toBe('Raspberry Pi');
    expect(lookupVendor('8c7712aabbcc')).toBe('Samsung');
  });

  it('returns null for unknown OUIs and randomized MACs', () => {
    expect(lookupVendor('12:34:56:78:9a:bc')).toBeNull(); // unknown
    expect(lookupVendor('a2:83:e7:00:11:22')).toBeNull(); // locally-administered
    expect(lookupVendor(null)).toBeNull();
  });
});
