/**
 * Category → enforcement mapping. The dashboard speaks in friendly categories
 * ("gaming", "social"); AdGuard enforces them three different ways:
 *
 *  - `parental`      → AdGuard's built-in Parental Control (adult-site blocklist)
 *  - `services`      → AdGuard "blocked services" ids (per-client toggles)
 *  - `blocklistUrl`  → a filter-list URL added to filtering (for categories with
 *                      no first-class service, e.g. gambling)
 *
 * Keeping this table in one place lets the AdguardService stay declarative and
 * makes it trivial to extend a category from the frontend later.
 */
export interface CategoryDefinition {
  slug: string;
  label: string;
  parental?: boolean;
  services?: string[];
  blocklistUrl?: string;
}

export const CATEGORY_DEFINITIONS: Record<string, CategoryDefinition> = {
  adult: {
    slug: 'adult',
    label: 'Adult content',
    // AdGuard Parental Control is the adult-content blocklist toggle.
    parental: true,
  },
  social: {
    slug: 'social',
    label: 'Social media',
    services: [
      'facebook',
      'instagram',
      'tiktok',
      'snapchat',
      'twitter',
      'reddit',
      'discord',
    ],
  },
  gaming: {
    slug: 'gaming',
    label: 'Gaming',
    services: ['steam', 'epic_games', 'origin', 'riot_games', 'roblox'],
  },
  video: {
    slug: 'video',
    label: 'Video streaming',
    services: ['youtube', 'netflix', 'twitch', 'disneyplus'],
  },
  gambling: {
    slug: 'gambling',
    label: 'Gambling',
    // No first-class service; use a hosted blocklist.
    blocklistUrl:
      'https://raw.githubusercontent.com/blocklistproject/Lists/master/gambling.txt',
  },
};

/** AdGuard "blocked services" ids to apply for a set of category slugs. */
export function servicesForCategories(slugs: string[]): string[] {
  const set = new Set<string>();
  for (const slug of slugs) {
    for (const svc of CATEGORY_DEFINITIONS[slug]?.services ?? []) set.add(svc);
  }
  return [...set];
}

/** Whether any selected category requires AdGuard Parental Control on. */
export function needsParental(slugs: string[]): boolean {
  return slugs.some((s) => CATEGORY_DEFINITIONS[s]?.parental);
}
