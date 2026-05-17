// ── Delta-sync for Vibe Points ledger ──
// Only syncs balance changes since last sync instead of full history
// Saves ~90% data on economy screens for active users

import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from './supabase';
import type { PointTransaction } from '../types/economy';

const SYNC_KEY = '@khuloh_delta:last_synced';
const LEDGER_KEY = '@khuloh_delta:ledger';
const BALANCE_KEY = '@khuloh_delta:balance';

type DeltaSyncState = {
  lastSyncedAt: string; // ISO timestamp
  balance: number;
  recentTransactions: PointTransaction[];
};

// ── Get last sync timestamp ──
async function getLastSyncedAt(): Promise<string | null> {
  try {
    return await AsyncStorage.getItem(SYNC_KEY);
  } catch {
    return null;
  }
}

// ── Save sync state ──
async function saveSyncState(state: DeltaSyncState): Promise<void> {
  try {
    await AsyncStorage.multiSet([
      [SYNC_KEY, state.lastSyncedAt],
      [BALANCE_KEY, String(state.balance)],
      [LEDGER_KEY, JSON.stringify(state.recentTransactions)],
    ]);
  } catch {
    // best-effort
  }
}

// ── Get cached balance (instant, zero network) ──
export async function getCachedBalance(): Promise<number | null> {
  try {
    const raw = await AsyncStorage.getItem(BALANCE_KEY);
    return raw !== null ? parseInt(raw, 10) : null;
  } catch {
    return null;
  }
}

// ── Get cached transactions ──
export async function getCachedTransactions(): Promise<PointTransaction[]> {
  try {
    const raw = await AsyncStorage.getItem(LEDGER_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

// ── Delta sync: fetch only new transactions since last sync ──
export async function deltaSync(userId: string): Promise<DeltaSyncState> {
  const lastSynced = await getLastSyncedAt();
  const cachedTxns = await getCachedTransactions();

  // Build query for new transactions only
  let query = supabase
    .from('point_transactions')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false });

  if (lastSynced) {
    // Only fetch transactions newer than last sync
    query = query.gt('created_at', lastSynced);
  } else {
    // First sync — fetch last 50
    query = query.limit(50);
  }

  const { data: newTxns } = await query;
  const freshTxns = (newTxns ?? []) as PointTransaction[];

  // Merge: prepend new transactions to cached ones (dedup by id)
  const existingIds = new Set(cachedTxns.map((t) => t.id));
  const merged = [
    ...freshTxns.filter((t) => !existingIds.has(t.id)),
    ...cachedTxns,
  ].slice(0, 100); // keep last 100

  // Fetch current balance (lightweight single-column query)
  const { data: profileData } = await supabase
    .from('profiles')
    .select('vibe_points')
    .eq('id', userId)
    .single();

  const balance = profileData?.vibe_points ?? 0;
  const syncTimestamp = new Date().toISOString();

  const state: DeltaSyncState = {
    lastSyncedAt: syncTimestamp,
    balance,
    recentTransactions: merged,
  };

  await saveSyncState(state);

  return state;
}

// ── Optimistic update: apply a local transaction before server confirms ──
export async function optimisticTransaction(
  userId: string,
  amount: number,
  reason: string,
): Promise<void> {
  const cachedBalance = await getCachedBalance();
  if (cachedBalance !== null) {
    await AsyncStorage.setItem(BALANCE_KEY, String(cachedBalance + amount));
  }

  const txns = await getCachedTransactions();
  const optimistic: PointTransaction = {
    id: `optimistic_${Date.now()}`,
    user_id: userId,
    amount,
    reason: reason as PointTransaction['reason'],
    created_at: new Date().toISOString(),
  };
  txns.unshift(optimistic);
  await AsyncStorage.setItem(LEDGER_KEY, JSON.stringify(txns.slice(0, 100)));
}

// ── Clear delta sync state ──
export async function clearDeltaSync(): Promise<void> {
  try {
    await AsyncStorage.multiRemove([SYNC_KEY, LEDGER_KEY, BALANCE_KEY]);
  } catch {
    // no-op
  }
}

// ── Sync stats for data-lite settings ──
export async function getDeltaSyncStats(): Promise<{
  lastSyncedAt: string | null;
  cachedTransactionCount: number;
  cachedBalance: number | null;
}> {
  const lastSynced = await getLastSyncedAt();
  const txns = await getCachedTransactions();
  const balance = await getCachedBalance();
  return {
    lastSyncedAt: lastSynced,
    cachedTransactionCount: txns.length,
    cachedBalance: balance,
  };
}
