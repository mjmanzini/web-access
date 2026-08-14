import { clientNonce, computeClientProof, xorBuffers } from './scram';
import { tag, blocks, buildRequest, errorCode } from './xml';
import { parseHostList, buildMultiMacFilter } from './parsers';

describe('huawei scram', () => {
  it('produces a 64-hex client nonce', () => {
    expect(clientNonce()).toMatch(/^[0-9a-f]{64}$/);
  });

  it('xor round-trips', () => {
    const a = Buffer.from('aabbccdd', 'hex');
    const b = Buffer.from('11223344', 'hex');
    expect(xorBuffers(xorBuffers(a, b), b).equals(a)).toBe(true);
  });

  it('computes a deterministic 64-hex client proof', () => {
    const challenge = {
      salt: 'ab'.repeat(16),
      servernonce: 'a'.repeat(64) + 'b'.repeat(64),
      iterations: 100,
    };
    const nonce = 'a'.repeat(64);
    const proof = computeClientProof('secret', nonce, challenge);
    expect(proof).toMatch(/^[0-9a-f]{64}$/);
    // Stable for fixed inputs.
    expect(computeClientProof('secret', nonce, challenge)).toBe(proof);
  });
});

describe('huawei xml', () => {
  it('reads tags, blocks, and error codes', () => {
    const xml = '<response><Hosts><Host><MacAddress>AA:BB:CC:DD:EE:FF</MacAddress></Host></Hosts></response>';
    expect(tag(xml, 'MacAddress')).toBe('AA:BB:CC:DD:EE:FF');
    expect(blocks(xml, 'Host').length).toBe(1);
    expect(errorCode('<error><code>125003</code><message/></error>')).toBe('125003');
    expect(errorCode(xml)).toBeNull();
  });

  it('builds a request body with escaping', () => {
    const body = buildRequest([['username', 'admin'], ['x', 'a<b&c']]);
    expect(body).toContain('<username>admin</username>');
    expect(body).toContain('a&lt;b&amp;c');
  });
});

describe('huawei parsers', () => {
  it('parses host-list into leases', () => {
    const xml = `<response><Hosts>
      <Host><MacAddress>a4:83:e7:00:11:22</MacAddress><IpAddress>192.168.8.100</IpAddress><HostName>sams-phone</HostName></Host>
      <Host><MacAddress>bad</MacAddress><IpAddress>192.168.8.101</IpAddress><HostName>unknown</HostName></Host>
    </Hosts></response>`;
    const leases = parseHostList(xml);
    expect(leases).toEqual([
      { ip: '192.168.8.100', mac: 'a4:83:e7:00:11:22', hostname: 'sams-phone' },
    ]);
  });

  it('builds a blacklist MAC filter payload for both SSIDs', () => {
    const body = buildMultiMacFilter(['A4-83-E7-00-11-22']);
    expect(body).toContain('<WifiMacFilterStatus0>1</WifiMacFilterStatus0>');
    expect(body).toContain('<WifiMacFilterMode0>1</WifiMacFilterMode0>');
    expect(body).toContain('<WifiMacFilterMac0_0>a4:83:e7:00:11:22</WifiMacFilterMac0_0>');
    expect(body).toContain('<WifiMacFilterMac1_0>a4:83:e7:00:11:22</WifiMacFilterMac1_0>');
    // Empty list disables the filter.
    expect(buildMultiMacFilter([])).toContain('<WifiMacFilterStatus0>0</WifiMacFilterStatus0>');
  });
});
