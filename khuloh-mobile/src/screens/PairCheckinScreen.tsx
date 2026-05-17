import React, { useEffect, useState } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Alert,
  ActivityIndicator,
  FlatList,
} from "react-native";
import { useAuth } from "../contexts/AuthContext";
import {
  initiatePairCheckin,
  confirmPairCheckin,
  getMyCheckins,
} from "../lib/safeSpots";
import type { PairCheckin } from "../types/safespots";
import { T } from "../lib/theme";

type Props = {
  route: { params: { spotId: string; spotName: string } };
  navigation: any;
};

const STATUS_BADGES: Record<string, { label: string; color: string }> = {
  pending: { label: "⏳ Pending", color: T.warning },
  confirmed: { label: "✅ Confirmed", color: T.success },
  expired: { label: "⌛ Expired", color: T.textMuted },
  redeemed: { label: "🏷️ Redeemed", color: T.primary },
};

export default function PairCheckinScreen({ route, navigation }: Props) {
  const { spotId, spotName } = route.params;
  const { user, refreshProfile } = useAuth();
  const [mode, setMode] = useState<"choose" | "initiate" | "confirm">("choose");
  const [partnerId, setPartnerId] = useState("");
  const [checkinId, setCheckinId] = useState("");
  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [checkins, setCheckins] = useState<PairCheckin[]>([]);
  const [showHistory, setShowHistory] = useState(false);

  useEffect(() => {
    loadHistory();
  }, []);

  const loadHistory = async () => {
    const data = await getMyCheckins();
    setCheckins(data);
  };

  const handleInitiate = async () => {
    if (!partnerId.trim()) {
      Alert.alert("Error", "Enter your partner's user ID");
      return;
    }
    setLoading(true);
    const result = await initiatePairCheckin(spotId, partnerId.trim());
    setLoading(false);

    if ("error" in result) {
      Alert.alert("Error", result.error);
      return;
    }

    Alert.alert(
      "Check-In Created!",
      `Share this code with your date: ${result.checkin_code}\n\nThey'll enter this code to confirm and you both get the Khuloh Discount!`,
    );
    await refreshProfile();
    await loadHistory();
    setMode("choose");
    setPartnerId("");
  };

  const handleConfirm = async () => {
    if (!checkinId.trim() || !code.trim()) {
      Alert.alert("Error", "Enter the check-in ID and code");
      return;
    }
    setLoading(true);
    const success = await confirmPairCheckin(checkinId.trim(), code.trim());
    setLoading(false);

    if (success) {
      Alert.alert(
        "🎉 Check-In Confirmed!",
        "You both earned 5 Vibe Points! Show your confirmed check-in to your server for the Khuloh Discount.",
      );
      await refreshProfile();
      await loadHistory();
      setMode("choose");
    } else {
      Alert.alert("Failed", "Invalid code or check-in has expired.");
    }
    setCheckinId("");
    setCode("");
  };

  const formatTime = (iso: string) => {
    const d = new Date(iso);
    return `${d.toLocaleDateString()} ${d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
  };

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.spotLabel}>📍 {spotName}</Text>
        <Text style={styles.subtitle}>
          Check in with your date to unlock the Khuloh Discount
        </Text>
      </View>

      {mode === "choose" && (
        <View style={styles.chooseSection}>
          <TouchableOpacity
            style={styles.choiceCard}
            onPress={() => setMode("initiate")}
          >
            <Text style={styles.choiceIcon}>🔑</Text>
            <Text style={styles.choiceTitle}>Start Check-In</Text>
            <Text style={styles.choiceDesc}>
              Generate a code for your date to confirm
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.choiceCard}
            onPress={() => setMode("confirm")}
          >
            <Text style={styles.choiceIcon}>✅</Text>
            <Text style={styles.choiceTitle}>Enter Code</Text>
            <Text style={styles.choiceDesc}>
              Your date shared a check-in code with you
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.historyToggle}
            onPress={() => setShowHistory(!showHistory)}
          >
            <Text style={styles.historyToggleText}>
              {showHistory ? "Hide" : "Show"} Check-In History
            </Text>
          </TouchableOpacity>

          {showHistory && (
            <FlatList
              data={checkins}
              keyExtractor={(c) => c.id}
              scrollEnabled={false}
              ListEmptyComponent={
                <Text style={styles.emptyText}>No check-ins yet.</Text>
              }
              renderItem={({ item }) => {
                const badge = STATUS_BADGES[item.status] ?? STATUS_BADGES.pending;
                return (
                  <View style={styles.historyCard}>
                    <View style={styles.historyInfo}>
                      <Text style={styles.historySpot}>
                        {item.spot_name ?? "Unknown venue"}
                      </Text>
                      <Text style={styles.historyPartner}>
                        with {item.partner_username ?? "Unknown"}
                      </Text>
                      <Text style={styles.historyDate}>
                        {formatTime(item.created_at)}
                      </Text>
                    </View>
                    <Text style={[styles.historyBadge, { color: badge.color }]}>
                      {badge.label}
                    </Text>
                  </View>
                );
              }}
            />
          )}
        </View>
      )}

      {mode === "initiate" && (
        <View style={styles.formSection}>
          <Text style={styles.formTitle}>🔑 Start Pair Check-In</Text>
          <Text style={styles.formDesc}>
            Enter your date's user ID. They'll get a code to confirm.
          </Text>
          <TextInput
            style={styles.input}
            placeholder="Partner's user ID"
            placeholderTextColor={T.textMuted}
            value={partnerId}
            onChangeText={setPartnerId}
            autoCapitalize="none"
          />
          <TouchableOpacity
            style={[styles.button, loading && styles.buttonDisabled]}
            onPress={handleInitiate}
            disabled={loading}
          >
            {loading ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.buttonText}>Generate Check-In Code</Text>
            )}
          </TouchableOpacity>
          <TouchableOpacity onPress={() => setMode("choose")}>
            <Text style={styles.cancelText}>← Back</Text>
          </TouchableOpacity>
        </View>
      )}

      {mode === "confirm" && (
        <View style={styles.formSection}>
          <Text style={styles.formTitle}>✅ Confirm Check-In</Text>
          <Text style={styles.formDesc}>
            Enter the check-in ID and code your date shared with you.
          </Text>
          <TextInput
            style={styles.input}
            placeholder="Check-In ID"
            placeholderTextColor={T.textMuted}
            value={checkinId}
            onChangeText={setCheckinId}
            autoCapitalize="none"
          />
          <TextInput
            style={styles.input}
            placeholder="6-digit code"
            placeholderTextColor={T.textMuted}
            value={code}
            onChangeText={setCode}
            autoCapitalize="characters"
            maxLength={6}
          />
          <TouchableOpacity
            style={[styles.button, loading && styles.buttonDisabled]}
            onPress={handleConfirm}
            disabled={loading}
          >
            {loading ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.buttonText}>Confirm & Unlock Discount</Text>
            )}
          </TouchableOpacity>
          <TouchableOpacity onPress={() => setMode("choose")}>
            <Text style={styles.cancelText}>← Back</Text>
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: T.bg },
  header: {
    backgroundColor: T.surface,
    padding: 20,
    borderBottomWidth: 1,
    borderBottomColor: T.border,
    alignItems: "center",
  },
  spotLabel: { fontSize: 18, fontWeight: "800", color: T.text },
  subtitle: {
    fontSize: 13,
    color: T.textSecondary,
    marginTop: 4,
    textAlign: "center",
  },
  chooseSection: { padding: 20 },
  choiceCard: {
    backgroundColor: T.surface,
    borderRadius: 14,
    padding: 20,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: T.border,
    alignItems: "center",
  },
  choiceIcon: { fontSize: 32, marginBottom: 8 },
  choiceTitle: { fontSize: 16, fontWeight: "700", color: T.text },
  choiceDesc: {
    fontSize: 13,
    color: T.textSecondary,
    marginTop: 4,
    textAlign: "center",
  },
  formSection: { padding: 20 },
  formTitle: { fontSize: 18, fontWeight: "800", color: T.text, marginBottom: 8 },
  formDesc: { fontSize: 13, color: T.textSecondary, marginBottom: 16 },
  input: {
    backgroundColor: T.inputBg,
    color: T.text,
    fontSize: 16,
    borderRadius: 12,
    padding: 14,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: T.border,
  },
  button: {
    backgroundColor: T.primary,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: "center",
    marginBottom: 12,
  },
  buttonDisabled: { opacity: 0.6 },
  buttonText: { color: "#fff", fontSize: 16, fontWeight: "700" },
  cancelText: { color: T.textSecondary, fontSize: 14, textAlign: "center" },
  historyToggle: { marginTop: 12, alignItems: "center" },
  historyToggleText: { color: T.accent, fontSize: 14, fontWeight: "600" },
  historyCard: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    backgroundColor: T.surface,
    borderRadius: 10,
    padding: 14,
    marginTop: 8,
  },
  historyInfo: { flex: 1 },
  historySpot: { fontSize: 14, fontWeight: "600", color: T.text },
  historyPartner: { fontSize: 12, color: T.textSecondary, marginTop: 2 },
  historyDate: { fontSize: 11, color: T.textMuted, marginTop: 2 },
  historyBadge: { fontSize: 12, fontWeight: "700" },
  emptyText: { color: T.textMuted, fontSize: 13, textAlign: "center", marginTop: 16 },
});
