/**
 * Decode what a device is from the name it announces on the network.
 *
 * DHCP hostnames are the one place a device volunteers its own model. Samsung
 * hardware in particular reports a bare factory code — "SM-L330" — which is
 * exactly as informative as a serial number until you translate it. A parent
 * hunting an unrecognised device on their network should not have to search
 * the web for a part number.
 *
 * The rule throughout is: translate what is certain, and stay quiet otherwise.
 * A confident wrong model ("that's the kids' tablet") is worse than no model at
 * all, because it ends the investigation. Everything here is an exact code
 * match or a strongly-signposted pattern; nothing is inferred from resemblance.
 */

export interface DecodedModel {
  /** The factory code found in the hostname, e.g. "SM-L330". */
  code: string | null;
  /** Friendly name, e.g. "Galaxy Watch8 (44mm)". Null when not decodable. */
  model: string | null;
  /** Rough kind, for an icon and for sorting a device list by what it is. */
  kind: DeviceKind | null;
}

export type DeviceKind =
  | 'phone'
  | 'tablet'
  | 'watch'
  | 'laptop'
  | 'tv'
  | 'console'
  | 'speaker'
  | 'router'
  | 'iot';

/**
 * Samsung factory codes. Only codes verified against Samsung's own model
 * listings are here — the series letter alone does not determine the marketing
 * name (SM-A500 is the Galaxy A5, SM-A505 the Galaxy A50), so guessing from the
 * pattern produces confident nonsense.
 */
const SAMSUNG: Record<string, [string, DeviceKind]> = {
  // Watches — the household has one of these, and it is why this file exists.
  'SM-L330': ['Galaxy Watch8 (44mm)', 'watch'],
  'SM-L320': ['Galaxy Watch8 (40mm)', 'watch'],
  'SM-L500': ['Galaxy Watch8 Classic', 'watch'],
  'SM-L310': ['Galaxy Watch7 (40mm)', 'watch'],
  'SM-L305': ['Galaxy Watch7 (44mm)', 'watch'],
  'SM-R860': ['Galaxy Watch4 (40mm)', 'watch'],
  'SM-R870': ['Galaxy Watch4 (44mm)', 'watch'],
  'SM-R880': ['Galaxy Watch4 Classic (42mm)', 'watch'],
  'SM-R890': ['Galaxy Watch4 Classic (46mm)', 'watch'],
  'SM-R900': ['Galaxy Watch5 (40mm)', 'watch'],
  'SM-R910': ['Galaxy Watch5 (44mm)', 'watch'],
  'SM-R920': ['Galaxy Watch5 Pro', 'watch'],
  'SM-R930': ['Galaxy Watch6 (40mm)', 'watch'],
  'SM-R940': ['Galaxy Watch6 (44mm)', 'watch'],
  'SM-R950': ['Galaxy Watch6 Classic (43mm)', 'watch'],
  'SM-R960': ['Galaxy Watch6 Classic (47mm)', 'watch'],

  // A-series phones — the common mid-range in this market.
  'SM-A566': ['Galaxy A56', 'phone'],
  'SM-A556': ['Galaxy A55', 'phone'],
  'SM-A546': ['Galaxy A54', 'phone'],
  'SM-A536': ['Galaxy A53', 'phone'],
  'SM-A528': ['Galaxy A52s', 'phone'],
  'SM-A525': ['Galaxy A52', 'phone'],
  'SM-A515': ['Galaxy A51', 'phone'],
  'SM-A505': ['Galaxy A50', 'phone'],
  'SM-A366': ['Galaxy A36', 'phone'],
  'SM-A356': ['Galaxy A35', 'phone'],
  'SM-A346': ['Galaxy A34', 'phone'],
  'SM-A336': ['Galaxy A33', 'phone'],
  'SM-A326': ['Galaxy A32', 'phone'],
  'SM-A315': ['Galaxy A31', 'phone'],
  'SM-A266': ['Galaxy A26', 'phone'],
  'SM-A256': ['Galaxy A25', 'phone'],
  'SM-A246': ['Galaxy A24', 'phone'],
  'SM-A236': ['Galaxy A23', 'phone'],
  'SM-A226': ['Galaxy A22', 'phone'],
  'SM-A217': ['Galaxy A21s', 'phone'],
  'SM-A166': ['Galaxy A16', 'phone'],
  'SM-A156': ['Galaxy A15', 'phone'],
  'SM-A146': ['Galaxy A14', 'phone'],
  'SM-A136': ['Galaxy A13', 'phone'],
  'SM-A127': ['Galaxy A12', 'phone'],
  'SM-A057': ['Galaxy A05s', 'phone'],
  'SM-A055': ['Galaxy A05', 'phone'],
  'SM-A047': ['Galaxy A04s', 'phone'],
  'SM-A045': ['Galaxy A04', 'phone'],
  'SM-A032': ['Galaxy A03 Core', 'phone'],
  'SM-A035': ['Galaxy A03', 'phone'],
  'SM-A037': ['Galaxy A03s', 'phone'],

  // S-series flagships.
  'SM-S938': ['Galaxy S25 Ultra', 'phone'],
  'SM-S936': ['Galaxy S25+', 'phone'],
  'SM-S931': ['Galaxy S25', 'phone'],
  'SM-S928': ['Galaxy S24 Ultra', 'phone'],
  'SM-S926': ['Galaxy S24+', 'phone'],
  'SM-S921': ['Galaxy S24', 'phone'],
  'SM-S918': ['Galaxy S23 Ultra', 'phone'],
  'SM-S916': ['Galaxy S23+', 'phone'],
  'SM-S911': ['Galaxy S23', 'phone'],
  'SM-S908': ['Galaxy S22 Ultra', 'phone'],
  'SM-S906': ['Galaxy S22+', 'phone'],
  'SM-S901': ['Galaxy S22', 'phone'],
  'SM-G998': ['Galaxy S21 Ultra', 'phone'],
  'SM-G996': ['Galaxy S21+', 'phone'],
  'SM-G991': ['Galaxy S21', 'phone'],
  'SM-G991B': ['Galaxy S21', 'phone'],
  'SM-G981': ['Galaxy S20', 'phone'],
  'SM-G973': ['Galaxy S10', 'phone'],
  'SM-G975': ['Galaxy S10+', 'phone'],
  'SM-G960': ['Galaxy S9', 'phone'],
  'SM-G965': ['Galaxy S9+', 'phone'],
  'SM-G950': ['Galaxy S8', 'phone'],
  'SM-G955': ['Galaxy S8+', 'phone'],

  // Notes and foldables.
  'SM-N986': ['Galaxy Note20 Ultra', 'phone'],
  'SM-N981': ['Galaxy Note20', 'phone'],
  'SM-N975': ['Galaxy Note10+', 'phone'],
  'SM-N970': ['Galaxy Note10', 'phone'],
  'SM-F956': ['Galaxy Z Fold6', 'phone'],
  'SM-F946': ['Galaxy Z Fold5', 'phone'],
  'SM-F936': ['Galaxy Z Fold4', 'phone'],
  'SM-F926': ['Galaxy Z Fold3', 'phone'],
  'SM-F741': ['Galaxy Z Flip6', 'phone'],
  'SM-F731': ['Galaxy Z Flip5', 'phone'],
  'SM-F721': ['Galaxy Z Flip4', 'phone'],
  'SM-F711': ['Galaxy Z Flip3', 'phone'],

  // M and J budget lines.
  'SM-M336': ['Galaxy M33', 'phone'],
  'SM-M326': ['Galaxy M32', 'phone'],
  'SM-M315': ['Galaxy M31', 'phone'],
  'SM-M215': ['Galaxy M21', 'phone'],
  'SM-M127': ['Galaxy M12', 'phone'],
  'SM-J600': ['Galaxy J6', 'phone'],
  'SM-J415': ['Galaxy J4+', 'phone'],
  'SM-J330': ['Galaxy J3 (2017)', 'phone'],

  // Tablets.
  'SM-X200': ['Galaxy Tab A8', 'tablet'],
  'SM-X205': ['Galaxy Tab A8 (LTE)', 'tablet'],
  'SM-X110': ['Galaxy Tab A9', 'tablet'],
  'SM-X115': ['Galaxy Tab A9 (LTE)', 'tablet'],
  'SM-X210': ['Galaxy Tab A9+', 'tablet'],
  'SM-X216': ['Galaxy Tab A9+ (5G)', 'tablet'],
  'SM-X510': ['Galaxy Tab S9 FE', 'tablet'],
  'SM-X710': ['Galaxy Tab S9', 'tablet'],
  'SM-X810': ['Galaxy Tab S9+', 'tablet'],
  'SM-X910': ['Galaxy Tab S9 Ultra', 'tablet'],
  'SM-T870': ['Galaxy Tab S7', 'tablet'],
  'SM-T970': ['Galaxy Tab S7+', 'tablet'],
  'SM-T500': ['Galaxy Tab A7', 'tablet'],
  'SM-T505': ['Galaxy Tab A7 (LTE)', 'tablet'],
  'SM-T290': ['Galaxy Tab A 8.0', 'tablet'],
  'SM-T295': ['Galaxy Tab A 8.0 (LTE)', 'tablet'],
  'SM-P610': ['Galaxy Tab S6 Lite', 'tablet'],
  'SM-P620': ['Galaxy Tab S6 Lite (2024)', 'tablet'],

  // Buds report themselves too.
  'SM-R630': ['Galaxy Buds+', 'speaker'],
  'SM-R177': ['Galaxy Buds Live', 'speaker'],
  'SM-R190': ['Galaxy Buds Pro', 'speaker'],
  'SM-R510': ['Galaxy Buds2 Pro', 'speaker'],
};

/**
 * Non-Samsung hostnames that state the device outright. Ordered — first match
 * wins — so more specific patterns must come first.
 */
const PATTERNS: Array<{ re: RegExp; model: string | ((m: RegExpMatchArray) => string); kind: DeviceKind }> = [
  { re: /\biPhone\b/i, model: 'iPhone', kind: 'phone' },
  { re: /\biPad\b/i, model: 'iPad', kind: 'tablet' },
  { re: /\bMacBook[- ]?(Pro|Air)?\b/i, model: (m) => `MacBook${m[1] ? ' ' + m[1] : ''}`, kind: 'laptop' },
  { re: /\biMac\b/i, model: 'iMac', kind: 'laptop' },
  { re: /\bApple[- ]?TV\b/i, model: 'Apple TV', kind: 'tv' },
  { re: /\bAppleWatch\b|\bApple[- ]Watch\b/i, model: 'Apple Watch', kind: 'watch' },
  { re: /\bPixel[- ]?(\d[a-z]?)[- ]?(Pro|XL|a)?\b/i, model: (m) => `Pixel ${m[1]}${m[2] ? ' ' + m[2] : ''}`, kind: 'phone' },
  { re: /\bChromecast\b/i, model: 'Chromecast', kind: 'tv' },
  { re: /\bNest[- ]?(Hub|Mini|Audio)\b/i, model: (m) => `Nest ${m[1]}`, kind: 'speaker' },
  { re: /\bshield\b/i, model: 'NVIDIA Shield', kind: 'tv' },
  { re: /\bBRAVIA\b/i, model: 'Sony BRAVIA TV', kind: 'tv' },
  { re: /\b(LG)?webOS(TV)?\b/i, model: 'LG webOS TV', kind: 'tv' },
  { re: /\bRoku\b/i, model: 'Roku', kind: 'tv' },
  { re: /\bPS5\b/i, model: 'PlayStation 5', kind: 'console' },
  { re: /\bPS4\b/i, model: 'PlayStation 4', kind: 'console' },
  { re: /\bXbox\b/i, model: 'Xbox', kind: 'console' },
  { re: /\bNintendo|Switch\b/i, model: 'Nintendo Switch', kind: 'console' },
  { re: /\bEcho(-|_)?(Dot|Show|Studio)?\b/i, model: (m) => `Amazon Echo${m[2] ? ' ' + m[2] : ''}`, kind: 'speaker' },
  { re: /\bSonos\b/i, model: 'Sonos speaker', kind: 'speaker' },
  { re: /\bHUAWEI[-_ ]?B\d{3}\b/i, model: 'Huawei LTE router', kind: 'router' },
  // Samsung's Android default hostname is the owner's name plus the model,
  // e.g. "Maria's A56" sanitised to "Maria-s-A56". The "-s-" is the signal;
  // a bare "A56" anywhere in a name is not enough to claim a model.
  { re: /-s-([ASMF]\d{2})\b/i, model: (m) => `Galaxy ${m[1].toUpperCase()}`, kind: 'phone' },
  { re: /\bGalaxy[- ]?(Tab)\b/i, model: 'Galaxy Tab', kind: 'tablet' },
  { re: /\bGalaxy[- ]?([SANZMF]\d{1,2}\+?)\b/i, model: (m) => `Galaxy ${m[1].toUpperCase()}`, kind: 'phone' },
];

/** Windows and generic hostnames that identify nothing about the hardware. */
const UNINFORMATIVE = /^(DESKTOP|LAPTOP|PC|WIN|localhost|android|unknown)[-_]?/i;

/**
 * Read a device's model out of the name it announces.
 *
 * `hostname` should be what the network reported (DHCP / router), not the
 * label a parent typed — renaming a device to "Njabulo Tablet" is useful, but
 * it destroys the evidence, so the raw hostname is kept separately and read
 * here.
 */
export function decodeModel(hostname: string | null | undefined): DecodedModel {
  const none: DecodedModel = { code: null, model: null, kind: null };
  const h = (hostname ?? '').trim();
  if (!h) return none;

  // Samsung factory code, anywhere in the name.
  const sm = h.match(/\bSM[-_]?([A-Z]\d{3,4}[A-Z]?)\b/i);
  if (sm) {
    const code = `SM-${sm[1].toUpperCase()}`;
    const exact = SAMSUNG[code];
    if (exact) return { code, model: exact[0], kind: exact[1] };
    // Try without the region suffix letter — SM-G991B is an SM-G991.
    const base = code.replace(/[A-Z]$/, '');
    const near = SAMSUNG[base];
    if (near) return { code, model: near[0], kind: near[1] };
    // A Samsung code we do not have. Say that, rather than inventing a name:
    // the code itself is still the most useful thing on screen.
    return { code, model: null, kind: null };
  }

  for (const p of PATTERNS) {
    const m = h.match(p.re);
    if (m) {
      return {
        code: null,
        model: typeof p.model === 'function' ? p.model(m) : p.model,
        kind: p.kind,
      };
    }
  }

  if (UNINFORMATIVE.test(h)) return none;
  return none;
}

/**
 * Emoji for a decoded kind — a device list reads far faster with them.
 *
 * Nothing for an unknown kind, deliberately: a generic monitor glyph is a
 * claim about form factor, and this file's whole point is not making claims it
 * cannot support.
 */
export function kindIcon(kind: DeviceKind | null): string {
  switch (kind) {
    case 'phone': return '📱';
    case 'tablet': return '📋';
    case 'watch': return '⌚';
    case 'laptop': return '💻';
    case 'tv': return '📺';
    case 'console': return '🎮';
    case 'speaker': return '🔊';
    case 'router': return '📡';
    case 'iot': return '💡';
    default: return '';
  }
}
