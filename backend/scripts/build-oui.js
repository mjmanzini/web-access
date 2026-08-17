#!/usr/bin/env node
/**
 * Bake the IEEE MAC registries into a source file.
 *
 * Vendor lookup has to work with no internet: this box IS the household's DNS,
 * so the moment it needs a lookup service to name a device is the moment device
 * names break during exactly the outage you are trying to diagnose. There is
 * also no sending the family's MAC addresses to a third party to ask who made
 * their phones.
 *
 * The table is gzipped and base64'd because the three registries are ~54k
 * entries and a 1.4 MB literal is a miserable thing to keep in a repo. That
 * costs ~15 ms once at boot. Regenerate with `npm run oui:refresh`.
 *
 * Registries (all public):
 *   MA-L  24-bit prefix  oui/oui.csv       — the classic OUI, most devices
 *   MA-M  28-bit prefix  oui28/mam.csv     — smaller blocks
 *   MA-S  36-bit prefix  oui36/oui36.csv   — smallest blocks
 * Longest prefix wins at lookup time, so a small-block assignment is not
 * misreported as its block operator.
 */
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

const SOURCES = [
  { url: 'https://standards-oui.ieee.org/oui/oui.csv', digits: 6 },
  { url: 'https://standards-oui.ieee.org/oui28/mam.csv', digits: 7 },
  { url: 'https://standards-oui.ieee.org/oui36/oui36.csv', digits: 9 },
];

/**
 * Legal-form noise, stripped from the tail. "Apple, Inc." and "Intel
 * Corporate" are the vendor a parent recognises; the incorporation status is
 * not information they need on a device row.
 */
const LEGAL = new RegExp(
  '[\\s,.]+(' +
    [
      'inc', 'incorporated', 'corp', 'corporation', 'corporate', 'company',
      'co', 'ltd', 'limited', 'llc', 'l\\.l\\.c', 'plc', 'gmbh', 'ag', 'kg',
      'mbh', 's\\.a', 's\\.a\\.s', 's\\.r\\.l', 's\\.p\\.a', 'b\\.v', 'n\\.v',
      'a\\/s', 'ab', 'oy', 'as', 'pty', 'pte', 'sdn', 'bhd', 'kk', 'k\\.k',
      'jsc', 'ooo', 'zao', 'srl', 'spa', 'sa', 'bv', 'nv', 'gk',
    ].join('|') +
    ')\\.?$',
  'i',
);

/** Brands whose IEEE spelling is not what anyone calls them. */
const OVERRIDES = new Map(
  Object.entries({
    'apple': 'Apple',
    'intel': 'Intel',
    'intel corporate': 'Intel',
    'samsung electronics': 'Samsung Electronics',
    'samsung electronics co': 'Samsung Electronics',
    'google': 'Google',
    'microsoft': 'Microsoft',
    'amazon technologies': 'Amazon',
    'amazon': 'Amazon',
    'huawei technologies': 'Huawei',
    'huawei device': 'Huawei',
    'raspberry pi foundation': 'Raspberry Pi',
    'raspberry pi trading': 'Raspberry Pi',
    'sony interactive entertainment': 'Sony PlayStation',
    'nintendo': 'Nintendo',
    'espressif inc': 'Espressif (IoT)',
    'espressif': 'Espressif (IoT)',
    'tp-link technologies': 'TP-Link',
    'tp-link systems': 'TP-Link',
    'hewlett packard': 'HP',
    'hp': 'HP',
    'lg electronics': 'LG',
    'lg innotek': 'LG',
    'asustek computer': 'ASUS',
    'zte': 'ZTE',
    'tcl': 'TCL',
    'd-link international': 'D-Link',
    'd-link': 'D-Link',
    'xiaomi communications': 'Xiaomi',
    'beijing xiaomi mobile software': 'Xiaomi',
    'oneplus technology': 'OnePlus',
    'guangdong oppo mobile telecommunications': 'OPPO',
    'vivo mobile communication': 'vivo',
    'roku': 'Roku',
    'sonos': 'Sonos',
    'nest labs': 'Google Nest',
    'ubiquiti networks': 'Ubiquiti',
    'ubiquiti inc': 'Ubiquiti',
    'mikrotikls sia': 'MikroTik',
    'routerboard.com': 'MikroTik',
    'cisco systems': 'Cisco',
    'netgear': 'NETGEAR',
    'dell': 'Dell',
    'lenovo': 'Lenovo',
    'lenovo mobile communication technology': 'Lenovo',
    'toshiba': 'Toshiba',
    'canon': 'Canon',
    'seiko epson': 'Epson',
    'brother industries': 'Brother',
  }),
);

/** ALL-CAPS registry entries read as shouting; title-case them carefully. */
const KEEP_UPPER = new Set([
  'lg', 'hp', 'ibm', 'zte', 'tcl', 'amd', 'arm', 'nec', 'jvc', 'usi', 'cnc',
  'avm', 'aim', 'sk', 'kt', 'bt', 'tp', 'db', 'io', 'ip', 'pc', 'tv', 'usb',
  'gps', 'led', 'lcd', 'rf', 'ai', 'iot', 'r&d', 'uk', 'usa', 'us', 'eu',
]);

function cleanName(raw) {
  let n = String(raw || '')
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(+d))
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
  if (!n) return '';

  // Repeatedly, because "Foo Co., Ltd." has two of them stacked up.
  for (let i = 0; i < 4; i++) {
    const next = n.replace(LEGAL, '');
    if (next === n) break;
    n = next.trim();
  }
  n = n.replace(/[\s,.]+$/, '').trim();

  const isShouting = n === n.toUpperCase() && /[A-Z]{3}/.test(n);
  if (isShouting) {
    n = n
      .split(' ')
      .map((w) =>
        KEEP_UPPER.has(w.toLowerCase().replace(/[^a-z&]/g, ''))
          ? w
          : w.replace(
              /[A-Za-z]+/g,
              (t) => t[0].toUpperCase() + t.slice(1).toLowerCase(),
            ),
      )
      .join(' ');
  }

  const override = OVERRIDES.get(n.toLowerCase());
  if (override) return override;

  // A long corporate mouthful helps nobody on a narrow device row.
  if (n.length > 34) {
    const short = n.split(/[,(]/)[0].trim();
    if (short.length >= 3) n = short;
  }
  return n.slice(0, 40);
}

async function main() {
  const rows = new Map();
  let total = 0;

  for (const src of SOURCES) {
    process.stderr.write(`fetching ${src.url} … `);
    const res = await fetch(src.url);
    if (!res.ok) throw new Error(`${src.url} → HTTP ${res.status}`);
    const text = await res.text();
    let n = 0;

    for (const line of text.split(/\r?\n/).slice(1)) {
      // Assignment is unquoted hex; the org name may be quoted and contain commas.
      const m = line.match(/^(?:MA-[LMS]|CID),([0-9A-Fa-f]+),(?:"((?:[^"]|"")*)"|([^,]*)),/);
      if (!m) continue;
      const prefix = m[1].toLowerCase();
      if (prefix.length !== src.digits) continue;
      const name = cleanName((m[2] ?? m[3] ?? '').replace(/""/g, '"'));
      if (!name || /^private$/i.test(name)) continue;
      rows.set(prefix, name);
      n++;
    }
    total += n;
    process.stderr.write(`${n} entries\n`);
  }

  // "aabbcc Vendor" per line — shortest possible thing that still diffs.
  const payload = [...rows.entries()]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([p, v]) => `${p} ${v}`)
    .join('\n');

  const b64 = zlib.gzipSync(Buffer.from(payload, 'utf8'), { level: 9 }).toString('base64');
  const out = `// GENERATED FILE — do not edit by hand. Run \`npm run oui:refresh\`.
//
// IEEE MA-L / MA-M / MA-S registries, ${rows.size} assignments, baked in so
// that naming a device never depends on the internet or on handing the
// household's MAC addresses to a lookup service.
//
// Generated from https://standards-oui.ieee.org/ on ${new Date().toISOString().slice(0, 10)}.

/**
 * gzip + base64 of "<prefix> <vendor>" lines; inflated once, lazily.
 *
 * An array joined at import time, not a chain of '+' concatenations: the
 * chained form builds a binary-expression tree thousands deep and overflows
 * the TypeScript compiler's stack.
 */
export const OUI_TABLE_GZ_B64: string = [
${b64.match(/.{1,100}/g).map((c) => `  '${c}',`).join('\n')}
].join('');

export const OUI_TABLE_SIZE = ${rows.size};
`;

  const dest = path.join(__dirname, '..', 'src', 'common', 'oui-table.generated.ts');
  fs.writeFileSync(dest, out);
  process.stderr.write(
    `\nwrote ${path.relative(process.cwd(), dest)} — ${rows.size} unique prefixes ` +
      `(${total} parsed), ${(b64.length / 1024).toFixed(0)} KB base64\n`,
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
