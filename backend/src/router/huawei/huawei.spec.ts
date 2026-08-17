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
    // Field set copied from a real B525 response — the feed carries rather more
    // than name and liveness, and all of it is worth reading.
    const xml = `<response><Hosts>
      <Host><Active>1</Active><IpAddress>192.168.8.60</IpAddress><MacAddress>a2:fe:3c:3e:cb:ac</MacAddress><AssociatedSsid>84 Bishopscourt_5G</AssociatedSsid><AssociatedTime>43467</AssociatedTime><AddressSource>DHCP</AddressSource><InterfaceType>Wireless</InterfaceType><HostName>Jastice-2</HostName><ActualName>Jastice-2</ActualName></Host>
      <Host><Active>0</Active><IpAddress>192.168.8.102</IpAddress><MacAddress>5e:6c:7d:97:da:ff</MacAddress><AssociatedSsid></AssociatedSsid><AssociatedTime></AssociatedTime><AddressSource>DHCP</AddressSource><InterfaceType>Wireless</InterfaceType><HostName>SM-L330</HostName><ActualName>Kids tablet</ActualName></Host>
      <Host><Active>0</Active><IpAddress>192.168.8.114</IpAddress><MacAddress>54:8d:5a:e7:9c:6c</MacAddress><AddressSource>Static</AddressSource><InterfaceType>Ethernet</InterfaceType><HostName>unknown</HostName><ActualName></ActualName></Host>
    </Hosts></response>`;
    expect(parseHostInfo(xml)).toEqual([
      {
        ip: '192.168.8.60', mac: 'a2:fe:3c:3e:cb:ac', hostname: 'Jastice-2', online: true,
        connection: 'wireless', ssid: '84 Bishopscourt_5G', addressSource: 'DHCP',
        associatedSeconds: 43467,
      },
      // ActualName (set in the router UI) wins over the self-reported HostName.
      {
        ip: '192.168.8.102', mac: '5e:6c:7d:97:da:ff', hostname: 'Kids tablet', online: false,
        connection: 'wireless', ssid: null, addressSource: 'DHCP', associatedSeconds: null,
      },
      // "unknown" and blank are both discarded rather than becoming the name.
      {
        ip: '192.168.8.114', mac: '54:8d:5a:e7:9c:6c', hostname: null, online: false,
        connection: 'ethernet', ssid: null, addressSource: 'Static', associatedSeconds: null,
      },
    ]);
  });

  /**
   * These assertions previously described a payload shape that does not exist.
   * They passed for weeks while every real write was rejected with error 9003,
   * because they tested the invention rather than the firmware. The shape below
   * is copied from an actual GET on a B525s-65a: one <Ssid> block per SSID,
   * flat field names, no per-index suffixes and no Mode field.
   */
  it('builds a blacklist payload in the shape the firmware returns', () => {
    const body = buildMultiMacFilter(['A4-83-E7-00-11-22'], [0, 1]);

    expect(body).toContain('<Ssids>');
    expect(body).toContain('<Ssid><Index>0</Index>');
    expect(body).toContain('<Ssid><Index>1</Index>');
    // Flat, unsuffixed slots — the old `WifiMacFilterMac0_0` form was invented.
    expect(body).toContain('<WifiMacFilterMac0>a4:83:e7:00:11:22</WifiMacFilterMac0>');
    expect(body).not.toMatch(/WifiMacFilterMac\d_\d/);
    expect(body).not.toContain('WifiMacFilterMode');
    // Ten slots and ten hostname fields per SSID, as returned.
    expect((body.match(/<WifiMacFilterMac\d>/g) ?? []).length).toBe(20);
    expect((body.match(/<wifihostname\d>/g) ?? []).length).toBe(20);
  });

  it('uses deny-list (2), never allow-list (1)', () => {
    const body = buildMultiMacFilter(['A4-83-E7-00-11-22']);
    expect(body).toContain('<WifiMacFilterStatus>2</WifiMacFilterStatus>');
    // Status 1 is an ALLOW-list: writing it with one MAC would throw every
    // other device in the house off Wi-Fi, including the machine that would
    // have to undo it. It must never be generated.
    expect(body).not.toContain('<WifiMacFilterStatus>1</WifiMacFilterStatus>');
  });

  it('disables the filter when the list is empty', () => {
    expect(buildMultiMacFilter([])).toContain('<WifiMacFilterStatus>0</WifiMacFilterStatus>');
  });

  it('covers every SSID by default — a device can sit on 2.4GHz or 5GHz', () => {
    const body = buildMultiMacFilter(['A4-83-E7-00-11-22']);
    for (const i of [0, 1, 2, 3]) expect(body).toContain(`<Index>${i}</Index>`);
  });
});
