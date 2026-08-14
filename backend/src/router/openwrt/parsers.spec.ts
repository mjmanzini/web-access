import { parseDhcpLeases, parseNlbwmon, nftMacElements } from './parsers';

describe('openwrt parsers', () => {
  it('parses dnsmasq lease lines (skipping unknown hostnames)', () => {
    const file = [
      '1699999999 A4-83-E7-00-11-22 192.168.1.50 sams-phone 01:a4:83:e7:00:11:22',
      '1699999999 aa:bb:cc:dd:ee:ff 192.168.1.51 * *',
      '',
      'garbage line',
    ].join('\n');
    const leases = parseDhcpLeases(file);
    expect(leases).toEqual([
      { ip: '192.168.1.50', mac: 'a4:83:e7:00:11:22', hostname: 'sams-phone' },
      { ip: '192.168.1.51', mac: 'aa:bb:cc:dd:ee:ff', hostname: null },
    ]);
  });

  it('parses nlbwmon json and sums rows per MAC', () => {
    const json = {
      columns: ['mac', 'conns', 'rx_bytes', 'rx_pkts', 'tx_bytes', 'tx_pkts'],
      data: [
        ['a4:83:e7:00:11:22', 3, 1000, 10, 200, 5],
        ['a4:83:e7:00:11:22', 1, 500, 4, 100, 2], // second row, same MAC
        ['aa:bb:cc:dd:ee:ff', 2, 2000, 20, 0, 0],
      ],
    };
    const bw = parseNlbwmon(json);
    expect(bw).toContainEqual({ mac: 'a4:83:e7:00:11:22', rxBytes: 1500, txBytes: 300 });
    expect(bw).toContainEqual({ mac: 'aa:bb:cc:dd:ee:ff', rxBytes: 2000, txBytes: 0 });
  });

  it('returns [] when nlbwmon columns are missing', () => {
    expect(parseNlbwmon({ columns: ['foo'], data: [[1]] })).toEqual([]);
    expect(parseNlbwmon('not json')).toEqual([]);
  });

  it('formats nft MAC set elements', () => {
    expect(nftMacElements([])).toBe('{ }');
    expect(nftMacElements(['A4-83-E7-00-11-22'])).toBe('{ a4:83:e7:00:11:22 }');
    expect(nftMacElements(['a4:83:e7:00:11:22', 'bogus'])).toBe('{ a4:83:e7:00:11:22 }');
  });
});
