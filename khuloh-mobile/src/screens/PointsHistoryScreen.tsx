import React, { useEffect, useState } from "react";
import {
  View,
  Text,
  FlatList,
  StyleSheet,
  ActivityIndicator,
} from "react-native";
import { useAuth } from "../contexts/AuthContext";
import { getTransactions } from "../lib/vibeEconomy";
import { PointTransaction, POINT_REASON_LABELS } from "../types/economy";
import { T } from "../lib/theme";

export default function PointsHistoryScreen() {
  const { user, profile } = useAuth();
  const [transactions, setTransactions] = useState<PointTransaction[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) return;
    getTransactions(user.id, 50).then((txns) => {
      setTransactions(txns);
      setLoading(false);
    });
  }, [user]);

  const formatDate = (iso: string) => {
    const d = new Date(iso);
    return `${d.toLocaleDateString()} ${d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
  };

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={T.primary} size="large" />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.balanceCard}>
        <Text style={styles.balanceLabel}>Current Balance</Text>
        <Text style={styles.balanceValue}>⚡ {profile?.vibe_points ?? 0}</Text>
      </View>

      <FlatList
        data={transactions}
        keyExtractor={(t) => t.id}
        contentContainerStyle={styles.list}
        ListEmptyComponent={
          <Text style={styles.emptyText}>No transactions yet. Start earning!</Text>
        }
        renderItem={({ item }) => (
          <View style={styles.txnRow}>
            <View style={styles.txnLeft}>
              <Text style={styles.txnReason}>
                {POINT_REASON_LABELS[item.reason] ?? item.reason}
              </Text>
              <Text style={styles.txnDate}>{formatDate(item.created_at)}</Text>
            </View>
            <Text
              style={[
                styles.txnAmount,
                item.amount >= 0 ? styles.txnPositive : styles.txnNegative,
              ]}
            >
              {item.amount >= 0 ? "+" : ""}
              {item.amount}
            </Text>
          </View>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: T.bg },
  center: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: T.bg,
  },
  balanceCard: {
    backgroundColor: T.surface,
    margin: 16,
    padding: 20,
    borderRadius: 14,
    alignItems: "center",
    borderWidth: 1,
    borderColor: T.primaryMuted,
  },
  balanceLabel: { fontSize: 14, color: T.textSecondary, fontWeight: "600" },
  balanceValue: { fontSize: 40, fontWeight: "800", color: T.text, marginTop: 4 },
  list: { paddingHorizontal: 16, paddingBottom: 32 },
  emptyText: {
    color: T.textMuted,
    fontSize: 14,
    textAlign: "center",
    marginTop: 40,
  },
  txnRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    backgroundColor: T.surface,
    borderRadius: 10,
    padding: 14,
    marginBottom: 8,
  },
  txnLeft: { flex: 1 },
  txnReason: { fontSize: 14, fontWeight: "600", color: T.text },
  txnDate: { fontSize: 11, color: T.textMuted, marginTop: 2 },
  txnAmount: { fontSize: 18, fontWeight: "800", marginLeft: 12 },
  txnPositive: { color: T.success },
  txnNegative: { color: T.danger },
});
