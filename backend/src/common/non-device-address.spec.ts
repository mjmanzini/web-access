import { isNonDeviceAddress } from './hostname.util';

/**
 * Container and VM bridges kept appearing in the parent's device list as things
 * to Forget by hand — Docker's 172.18.x, WSL's vEthernet on 172.27.x. They are
 * infrastructure, not devices. But 172.16/12 is also a legitimate private range
 * a household could be running on, so it cannot simply be blanket-rejected:
 * the test is whether the address shares a /16 with this host's own LAN.
 */
describe('isNonDeviceAddress', () => {
  const LAN = '192.168.8.100';

  it('rejects the container and VM bridges that caused this', () => {
    expect(isNonDeviceAddress('172.18.0.1', LAN)).toBe(true); // Docker bridge
    expect(isNonDeviceAddress('172.27.0.20', LAN)).toBe(true); // WSL vEthernet
    expect(isNonDeviceAddress('172.16.5.5', LAN)).toBe(true);
    expect(isNonDeviceAddress('172.31.255.1', LAN)).toBe(true);
  });

  it('keeps a household genuinely running on 172.16/12', () => {
    // Same /16 as the host's own address — this is the real LAN.
    expect(isNonDeviceAddress('172.20.0.55', '172.20.0.10')).toBe(false);
    // A different /16 in the same range is still a bridge.
    expect(isNonDeviceAddress('172.18.0.1', '172.20.0.10')).toBe(true);
  });

  it('leaves ordinary LAN addresses alone', () => {
    expect(isNonDeviceAddress('192.168.8.112', LAN)).toBe(false);
    expect(isNonDeviceAddress('10.0.0.5', LAN)).toBe(false);
    // 172.32+ is outside the private range entirely.
    expect(isNonDeviceAddress('172.32.0.1', LAN)).toBe(false);
  });

  it('still rejects what it always did', () => {
    expect(isNonDeviceAddress('', LAN)).toBe(true);
    expect(isNonDeviceAddress('127.0.0.1', LAN)).toBe(true);
    expect(isNonDeviceAddress('169.254.1.1', LAN)).toBe(true);
    expect(isNonDeviceAddress('255.255.255.255', LAN)).toBe(true);
    expect(isNonDeviceAddress('192.168.8.255', LAN)).toBe(true);
    expect(isNonDeviceAddress('224.0.0.251', LAN)).toBe(true);
    expect(isNonDeviceAddress('::1', LAN)).toBe(true);
    expect(isNonDeviceAddress('fe80::1', LAN)).toBe(true);
  });

  it('rejects 172.16/12 when no LAN address is configured', () => {
    // Without a hint the safe default is "infrastructure": a household on this
    // range will have ADGUARD_LAN_IP set, a Docker bridge never will be.
    expect(isNonDeviceAddress('172.18.0.1', '')).toBe(true);
  });
});
