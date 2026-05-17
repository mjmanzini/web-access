// ── Local cache with TTL for data-lite mode ──
// Caches SafeSpots, Vibe Points ledger, and profile snapshots
// Uses AsyncStorage with TTL-based invalidation

import AsyncStorage from '@react-native-async-storage/async-storage';

const CACHE_PREFIX = '@khuloh_cache:';

type CacheEntry<T> = {
  data: T;
  cachedAt: number;  // unix ms
  ttlMs: number;
};

// ── Default TTLs ──
export const TTL = {
  SAFE_SPOTS: 24 * 60 * 60 * 1000,    // 24 hours (venues rarely change)
  VIBE_BALANCE: 5 * 60 * 1000,         // 5 minutes
  TRANSACTIONS: 10 * 60 * 1000,        // 10 minutes
  PROFILE: 15 * 60 * 1000,             // 15 minutes
  SHOUTS: 2 * 60 * 1000,               // 2 minutes (more volatile)
} as const;

// ── Core cache operations ──

export async function cacheGet<T>(key: string): Promise<T | null> {
  try {
    const raw = await AsyncStorage.getItem(CACHE_PREFIX + key);
    if (!raw) return null;

    const entry: CacheEntry<T> = JSON.parse(raw);
    const age = Date.now() - entry.cachedAt;

    if (age > entry.ttlMs) {
      // Expired — remove stale entry
      await AsyncStorage.removeItem(CACHE_PREFIX + key);
      return null;
    }

    return entry.data;
  } catch {
    return null;
  }
}

export async function cacheSet<T>(key: string, data: T, ttlMs: number): Promise<void> {
  try {
    const entry: CacheEntry<T> = {
      data,
      cachedAt: Date.now(),
      ttlMs,
    };
    await AsyncStorage.setItem(CACHE_PREFIX + key, JSON.stringify(entry));
  } catch {
    // Silently fail — cache is best-effort
  }
}

export async function cacheRemove(key: string): Promise<void> {
  try {
    await AsyncStorage.removeItem(CACHE_PREFIX + key);
  } catch {
    // no-op
  }
}

// ── Scoped key builders ──

export const CacheKeys = {
  safeSpots: (city?: string) => `safe_spots:${city ?? 'all'}`,
  vibeBalance: (userId: string) => `vibe_balance:${userId}`,
  transactions: (userId: string) => `transactions:${userId}`,
  profile: (userId: string) => `profile:${userId}`,
  shouts: (roomId: string) => `shouts:${roomId}`,
  dailyLogin: (userId: string) => `daily_login:${userId}:${new Date().toISOString().slice(0, 10)}`,
} as const;

// ── Cache-first fetch pattern ──
// Returns cached data immediately, fetches fresh data in background

export async function cacheFirstFetch<T>(
  key: string,
  ttlMs: number,
  fetcher: () => Promise<T>,
): Promise<{ data: T; fromCache: boolean }> {
  // Try cache first
  const cached = await cacheGet<T>(key);
  if (cached !== null) {
    // Background refresh (fire-and-forget)
    fetcher().then((fresh) => cacheSet(key, fresh, ttlMs)).catch(() => {});
    return { data: cached, fromCache: true };
  }

  // Cache miss — fetch and cache
  const fresh = await fetcher();
  await cacheSet(key, fresh, ttlMs);
  return { data: fresh, fromCache: false };
}

// ── Cache stats (for data-lite settings screen) ──

export async function getCacheStats(): Promise<{
  totalEntries: number;
  totalSizeBytes: number;
  entries: { key: string; sizeBytes: number; ageMs: number; expired: boolean }[];
}> {
  try {
    const allKeys = await AsyncStorage.getAllKeys();
    const cacheKeys = allKeys.filter((k) => k.startsWith(CACHE_PREFIX));
    const entries: { key: string; sizeBytes: number; ageMs: number; expired: boolean }[] = [];
    let totalSize = 0;

    for (const fullKey of cacheKeys) {
      const raw = await AsyncStorage.getItem(fullKey);
      if (!raw) continue;
      const size = new TextEncoder().encode(raw).length;
      totalSize += size;

      try {
        const parsed = JSON.parse(raw) as CacheEntry<unknown>;
        const age = Date.now() - parsed.cachedAt;
        entries.push({
          key: fullKey.replace(CACHE_PREFIX, ''),
          sizeBytes: size,
          ageMs: age,
          expired: age > parsed.ttlMs,
        });
      } catch {
        entries.push({ key: fullKey.replace(CACHE_PREFIX, ''), sizeBytes: size, ageMs: 0, expired: true });
      }
    }

    return { totalEntries: entries.length, totalSizeBytes: totalSize, entries };
  } catch {
    return { totalEntries: 0, totalSizeBytes: 0, entries: [] };
  }
}

// ── Clear all cache ──

export async function clearCache(): Promise<void> {
  try {
    const allKeys = await AsyncStorage.getAllKeys();
    const cacheKeys = allKeys.filter((k) => k.startsWith(CACHE_PREFIX));
    if (cacheKeys.length > 0) {
      await AsyncStorage.multiRemove(cacheKeys);
    }
  } catch {
    // no-op
  }
}
