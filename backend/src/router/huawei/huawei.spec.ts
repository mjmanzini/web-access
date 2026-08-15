import { createHash, createHmac, pbkdf2Sync } from 'node:crypto';
import { clientNonce, computeClientProof, xorBuffers } from './scram';
import { tag, blocks, buildRequest, errorCode } from './xml';
import { parseHostInfo, parseHostList, buildMultiMacFilter } from './parsers';

describe('huawei scram', () => {
  it('produces a 64-hex client nonce', () => {
    expect(clientNonce()).toMatch(/^[0-9a-f]{64}$/);
  });

  it('xor round-trips', () => {
    const a = Buffer.from('aabbccdd', 'hex');
    const b = Buffer.from('11223344', 'hex');
    expect(xorBuffers(xorBuffers(a, b), b).equals(a)).toBe(true);
  });

  it('follows Huawei HMAC ordering, not RFC 5802 SCRAM', () => {
    // Pins the key/message roles: Huawei uses HMAC(key="Client Key", msg=salted)
    // and HMAC(key=authMessage, msg=storedKey). The RFC swaps both, which the
    // router rejects with error 108006 (reported as "wrong password").
    const password = 'secret';
    const salt = 'ab'.repeat(16);
    const servernonce = 'c'.repeat(64);
    const iterations = 100;
    const nonce = 'd'.repeat(64);

    const salted = pbkdf2Sync(password, Buffer.from(salt, 'hex'), iterations, 32, 'sha256');
    const clientKey = createHmac('sha256', 'Client Key').update(salted).digest();
    const storedKey = createHash('sha256').update(clientKey).digest();
    const authMessage = `${nonce},${servernonce},${servernonce}`;
    const signature = createHmac('sha256', authMessage).update(storedKey).digest();
    const expected = xorBuffers(clientKey, signature).toString('hex');

    expect(computeClientProof(password, nonce, { salt, servernonce, iterations })).toBe(expected);

    // And explicitly NOT the RFC ordering.
    const rfcClientKey = createHmac('sha256', salted).update('Client Key').digest();
    const rfcStored = createHash('sha256').update(rfcClientKey).digest();
    const rfcSig = createHmac('sha256', rfcStored).update(authMessage).digest();
    const rfcProof = xorBuffers(rfcClientKey, rfcSig).toString('hex');
    expect(computeClientProof(password, nonce, { salt, servernonce, iterations })).not.toBe(rfcProof);
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

  it('parses HostInfo including offline devices, preferring ActualName', () => {
    const xml = `<response><Hosts>
      <Host><Active>1</Active><IpAddress>192.168.8.60</IpAddress><MacAddress>a2:fe:3c:3e:cb:ac</MacAddress><HostName>Jastice-2</HostName><ActualName>Jastice-2</ActualName></Host>
      <Host><Active>0</Active><IpAddress>192.168.8.102</IpAddress><MacAddress>5e:6c:7d:97:da:ff</MacAddress><HostName>SM-L330</HostName><ActualName>Kids tablet</ActualName></Host>
      <Host><Active>0</Active><IpAddress>192.168.8.114</IpAddress><MacAddress>54:8d:5a:e7:9c:6c</MacAddress><HostName>unknown</HostName><ActualName></ActualName></Host>
    </Hosts></response>`;
    expect(parseHostInfo(xml)).toEqual([
      { ip: '192.168.8.60', mac: 'a2:fe:3c:3e:cb:ac', hostname: 'Jastice-2', online: true },
      // ActualName (set in the router UI) wins over the self-reported HostName.
      { ip: '192.168.8.102', mac: '5e:6c:7d:97:da:ff', hostname: 'Kids tablet', online: false },
      // "unknown" and blank are both discarded rather than becoming the name.
      { ip: '192.168.8.114', mac: '54:8d:5a:e7:9c:6c', hostname: null, online: false },
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
