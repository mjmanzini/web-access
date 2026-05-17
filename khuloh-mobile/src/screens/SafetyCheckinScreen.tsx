import React, { useCallback, useEffect, useState } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  FlatList,
  StyleSheet,
  Alert,
  ActivityIndicator,
} from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import { supabase } from "../lib/supabase";
import { useAuth } from "../contexts/AuthContext";
import { SafetyCheckin } from "../types/safety";
import { T } from "../lib/theme";

type Props = { navigation: any };

export default function SafetyCheckinScreen({ navigation }: Props) {
  const { user } = useAuth();
  const [checkins, setCheckins] = useState<SafetyCheckin[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchCheckins = async () => {
    if (!user) return;
    const { data } = await supabase
      .from("safety_checkins")
      .select("*")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(20);
    setCheckins((data as SafetyCheckin[]) ?? []);
  };

  useFocusEffect(
    useCallback(() => {
      fetchCheckins().finally(() => setLoading(false));
    }, [user]),
  );

  // Poll for pending checkins that are due
  useEffect(() => {
    const interval = setInterval(() => {
      const pending = checkins.find(
        (c) => c.status === "pending" && new Date(c.check_at) <= new Date(),
      );
      if (pending) {
        Alert.alert(
          "Safety Check-In",
          "Are you safe? You met someone recently.",
          [
            {
              text: "I'm Safe ✓",
              onPress: async () => {
                await supabase.rpc("respond_safe", { checkin_id: pending.id });
                await fetchCheckins();
              },
            },
            {
              text: "Remind me later",
              style: "cancel",
            },
          ],
          { cancelable: false },
        );
      }
    }, 30_000); // check every 30s

    return () => clearInterval(interval);
  }, [checkins]);

  const handleStartCheckin = (metUserId: string, metUsername: string) => {
    Alert.alert(
      "Start Safety Check-In",
      `Meeting ${metUsername} in person? We'll check on you in 2 hours.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Yes, enable",
          onPress: async () => {
            if (!user) return;
            const checkAt = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString();
            const { error } = await supabase
              .from("safety_checkins")
              .insert({
                user_id: user.id,
                met_user_id: metUserId,
                status: "pending",
                check_at: checkAt,
              });

            if (error) {
              Alert.alert("Error", error.message);
            } else {
              Alert.alert(
                "Check-In Set",
                "We'll ask if you're safe in 2 hours. If you don't respond, your emergency contacts will be alerted.",
              );
              await fetchCheckins();
            }
          },
        },
      ],
    );
  };

  const handleImSafe = async (checkinId: string) => {
    await supabase.rpc("respond_safe", { checkin_id: checkinId });
    await fetchCheckins();
  };

  const getStatusStyle = (status: string) => {
    switch (status) {
      case "safe": return styles.statusSafe;
      case "alerted": return styles.statusAlerted;
      case "pending": return styles.statusPending;
      default: return styles.statusExpired;
    }
  };

  const getStatusLabel = (status: string) => {
    switch (status) {
      case "safe": return "✓ Safe";
      case "alerted": return "⚠️ Alerted";
      case "pending": return "⏳ Pending";
      default: return "Expired";
    }
  };

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={T.primary} size="large" />
      </View>
    );
  }

  return (
    <FlatList
      style={styles.list}
      contentContainerStyle={checkins.length === 0 ? styles.center : styles.listContent}
      data={checkins}
      keyExtractor={(c) => c.id}
      ListHeaderComponent={
        <View style={styles.header}>
          <Text style={styles.headerTitle}>Safety Check-Ins</Text>
          <Text style={styles.headerSub}>
            When you meet someone in person, we check on you after 2 hours.
          </Text>
          <TouchableOpacity
            style={styles.emergencyLink}
            onPress={() => navigation.navigate("EmergencyContacts")}
          >
            <Text style={styles.emergencyLinkText}>
              Manage Emergency Contacts →
            </Text>
          </TouchableOpacity>
        </View>
      }
      ListEmptyComponent={
        <Text style={styles.emptyText}>No check-ins yet.</Text>
      }
      renderItem={({ item }) => {
        const isDue =
          item.status === "pending" && new Date(item.check_at) <= new Date();
        return (
          <View style={styles.card}>
            <View style={styles.cardLeft}>
              <Text style={styles.cardDate}>
                {new Date(item.created_at).toLocaleDateString()}
              </Text>
              <Text style={styles.cardTime}>
                Check at: {new Date(item.check_at).toLocaleTimeString([], {
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </Text>
            </View>
            <View style={styles.cardRight}>
              <Text style={[styles.statusBadge, getStatusStyle(item.status)]}>
                {getStatusLabel(item.status)}
              </Text>
              {isDue && (
                <TouchableOpacity
                  style={styles.safeBtn}
                  onPress={() => handleImSafe(item.id)}
                >
                  <Text style={styles.safeBtnText}>I'm Safe</Text>
                </TouchableOpacity>
              )}
            </View>
          </View>
        );
      }}
    />
  );
}

// Exported for use in WhisperChatScreen
export { SafetyCheckinScreen };

const styles = StyleSheet.create({
  list: { flex: 1, backgroundColor: T.bg },
  listContent: { paddingBottom: 32 },
  center: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: T.bg,
  },
  header: { paddingHorizontal: 20, paddingTop: 16, paddingBottom: 8 },
  headerTitle: { fontSize: 22, fontWeight: "800", color: T.text },
  headerSub: { fontSize: 13, color: T.textSecondary, marginTop: 4 },
  emergencyLink: { marginTop: 12, marginBottom: 8 },
  emergencyLinkText: { fontSize: 14, color: T.primary, fontWeight: "700" },
  emptyText: { color: T.textMuted, fontSize: 14 },
  card: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: T.surface,
    marginHorizontal: 16,
    marginVertical: 4,
    borderRadius: 14,
    padding: 16,
  },
  cardLeft: { flex: 1 },
  cardDate: { fontSize: 15, fontWeight: "700", color: T.text },
  cardTime: { fontSize: 12, color: T.textSecondary, marginTop: 2 },
  cardRight: { alignItems: "flex-end", gap: 6 },
  statusBadge: { fontSize: 12, fontWeight: "700", paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8, overflow: "hidden" },
  statusSafe: { backgroundColor: T.success + "22", color: T.success },
  statusAlerted: { backgroundColor: T.danger + "22", color: T.danger },
  statusPending: { backgroundColor: T.warning + "22", color: T.warning },
  statusExpired: { backgroundColor: T.border, color: T.textMuted },
  safeBtn: {
    backgroundColor: T.success,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  safeBtnText: { fontSize: 12, fontWeight: "800", color: T.bg },
});
