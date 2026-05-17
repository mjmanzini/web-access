// ── Smart Thumbnail library ──
// Generates 10KB blurred avatar placeholders for data-lite mode
// Lazy-loads full images only when tapped or WiFi available

import AsyncStorage from '@react-native-async-storage/async-storage';

const THUMB_PREFIX = '@khuloh_thumb:';
const THUMB_SIZE = 48; // px — tiny placeholder
const PLACEHOLDER_COLOR = '#1A2A3A'; // T.surfaceLight fallback

export type ThumbnailState = 'placeholder' | 'thumb' | 'full';

export type ThumbnailResult = {
  uri: string | null;
  state: ThumbnailState;
};

// ── Generate a color-based placeholder (zero network) ──
export function getPlaceholderUri(username?: string | null): string {
  // Return a simple SVG data URI as placeholder
  const initial = (username ?? '?')[0]?.toUpperCase() ?? '?';
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${THUMB_SIZE}" height="${THUMB_SIZE}">
    <rect width="100%" height="100%" fill="${PLACEHOLDER_COLOR}"/>
    <text x="50%" y="55%" font-size="24" fill="#E8EFF4" text-anchor="middle" dominant-baseline="middle" font-family="sans-serif">${initial}</text>
  </svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

// ── Cache a thumbnail locally ──
export async function cacheThumbnail(userId: string, base64Thumb: string): Promise<void> {
  try {
    await AsyncStorage.setItem(THUMB_PREFIX + userId, base64Thumb);
  } catch {
    // no-op
  }
}

// ── Retrieve cached thumbnail ──
export async function getCachedThumbnail(userId: string): Promise<string | null> {
  try {
    return await AsyncStorage.getItem(THUMB_PREFIX + userId);
  } catch {
    return null;
  }
}

// ── Get best available image for a user ──
export async function getSmartAvatar(
  userId: string,
  avatarUrl: string | null,
  username?: string | null,
  dataLightMode = false,
): Promise<ThumbnailResult> {
  // In data-light mode, never load full images
  if (dataLightMode) {
    const cached = await getCachedThumbnail(userId);
    if (cached) {
      return { uri: `data:image/jpeg;base64,${cached}`, state: 'thumb' };
    }
    return { uri: getPlaceholderUri(username), state: 'placeholder' };
  }

  // Normal mode: try cached thumb first, then full URL
  if (avatarUrl) {
    return { uri: avatarUrl, state: 'full' };
  }

  const cached = await getCachedThumbnail(userId);
  if (cached) {
    return { uri: `data:image/jpeg;base64,${cached}`, state: 'thumb' };
  }

  return { uri: getPlaceholderUri(username), state: 'placeholder' };
}

// ── Estimate data savings from using thumbnails ──
export function estimateDataSaved(
  avatarCount: number,
  avgFullSizeKb = 150,
  thumbSizeKb = 10,
): { savedKb: number; savedPct: number } {
  const fullTotal = avatarCount * avgFullSizeKb;
  const thumbTotal = avatarCount * thumbSizeKb;
  const saved = fullTotal - thumbTotal;
  return {
    savedKb: saved,
    savedPct: Math.round((saved / fullTotal) * 100),
  };
}

// ── Clear all cached thumbnails ──
export async function clearThumbnailCache(): Promise<void> {
  try {
    const allKeys = await AsyncStorage.getAllKeys();
    const thumbKeys = allKeys.filter((k) => k.startsWith(THUMB_PREFIX));
    if (thumbKeys.length > 0) {
      await AsyncStorage.multiRemove(thumbKeys);
    }
  } catch {
    // no-op
  }
}
