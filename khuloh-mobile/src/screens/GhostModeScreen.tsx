import React, { useState, useEffect, useRef } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Alert,
  ActivityIndicator,
  ScrollView,
} from "react-native";
import { useAuth } from "../contexts/AuthContext";
import { activateGhostMode, getGhostModeState } from "../lib/vibeEconomy";
import { POINT_AMOUNTS } from "../types/economy";
import { T } from "../lib/theme";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import type { ProfileStackParamList } from "../navigation/types";

type Props = NativeStackScreenProps<ProfileStackParamList, "GhostMode">;

export default function GhostModeScreen({ navigation }: Props) {
  const { profile, refreshProfile } = useAuth();
  const [loading, setLoading] = useState(false);
  const [ghostActive, setGhostActive] = useState(false);
  const [remainingMs, setRemainingMs] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    checkGhostState();
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, []);

  const checkGhostState = async () => {
    if (!profile) return;
    const state = await getGhostModeState(profile.id);
    setGhostActive(state.active);
    setRemainingMs(state.remainingMs);

    if (state.active) {
      startCountdown(state.remainingMs);
    }
  };

  const startCountdown = (ms: number) => {
    if (timerRef.current) clearInterval(timerRef.current);
    let remaining = ms;
    timerRef.current = setInterval(() => {
      remaining -= 1000;
      if (remaining <= 0) {
        setGhostActive(false);
        setRemainingMs(0);
        if (timerRef.current) clearInterval(timerRef.current);
        refreshProfile();
      } else {
        setRemainingMs(remaining);
      }
    }, 1000);
  };

  const formatTime = (ms: number): string => {
    const totalSec = Math.ceil(ms / 1000);
    const min = Math.floor(totalSec / 60);
    const sec = totalSec % 60;
    return `${min}:${sec.toString().padStart(2, "0")}`;
  };

  const handleActivate = async () => {
    const cost = Math.abs(POINT_AMOUNTS.ghost_mode);
    const balance = profile?.vibe_points ?? 0;

    if (balance < cost) {
      Alert.alert(
        "Insufficient Points",
        `Ghost Mode costs ${cost} Vibe Points. You have ${balance}.`,
      );
      return;
    }

    Alert.alert(
      "Activate Ghost Mode?",
      `This will cost ${cost} Vibe Points and make you invisible for 30 minutes.\n\nYour current balance: ${balance} ⚡`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Go Ghost 👻",
          onPress: async () => {
            setLoading(true);
            const result = await activateGhostMode();
            setLoading(false);

            if (result.success && result.ghost_until) {
              const remaining = new Date(result.ghost_until).getTime() - Date.now();
              setGhostActive(true);
              setRemainingMs(remaining);
              startCountdown(remaining);
              await refreshProfile();
            } else {
              Alert.alert("Error", result.error ?? "Failed to activate ghost mode");
            }
          },
        },
      ],
    );
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.ghostEmoji}>{ghostActive ? "👻" : "🫥"}</Text>
      <Text style={styles.title}>Ghost Mode</Text>
      <Text style={styles.subtitle}>
        {ghostActive
          ? "You are invisible to other users"
          : "Disappear from discovery for 30 minutes"}
      </Text>

      {ghostActive ? (
        <View style={styles.activeCard}>
          <Text style={styles.timerLabel}>Time Remaining</Text>
          <Text style={styles.timer}>{formatTime(remainingMs)}</Text>
          <View style={styles.statusRow}>
            <View style={[styles.statusDot, styles.statusActive]} />
            <Text style={styles.statusText}>Ghost Mode Active</Text>
          </View>
          <Text style={styles.activeHint}>
            Your profile is hidden from zone lists, discovery, and whisper search.
            You can still send messages.
          </Text>
        </View>
      ) : (
        <View style={styles.infoCard}>
          <Text style={styles.infoTitle}>What happens?</Text>

          <View style={styles.infoRow}>
            <Text style={styles.infoIcon}>🔒</Text>
            <Text style={styles.infoText}>Hidden from zone member lists</Text>
          </View>
          <View style={styles.infoRow}>
            <Text style={styles.infoIcon}>🔍</Text>
            <Text style={styles.infoText}>Invisible in whisper search</Text>
          </View>
          <View style={styles.infoRow}>
            <Text style={styles.infoIcon}>💬</Text>
            <Text style={styles.infoText}>Can still send & receive messages</Text>
          </View>
          <View style={styles.infoRow}>
            <Text style={styles.infoIcon}>⏱️</Text>
            <Text style={styles.infoText}>Lasts 30 minutes, then auto-visible</Text>
          </View>

          <View style={styles.costCard}>
            <Text style={styles.costLabel}>Cost</Text>
            <Text style={styles.costValue}>
              {Math.abs(POINT_AMOUNTS.ghost_mode)} ⚡
            </Text>
            <Text style={styles.costBalance}>
              Your balance: {profile?.vibe_points ?? 0} ⚡
            </Text>
          </View>

          <TouchableOpacity
            style={[styles.activateButton, loading && styles.buttonDisabled]}
            onPress={handleActivate}
            disabled={loading}
          >
            {loading ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.activateText}>Activate Ghost Mode 👻</Text>
            )}
          </TouchableOpacity>
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: T.bg },
  content: { alignItems: "center", paddingVertical: 48, paddingHorizontal: 24 },
  ghostEmoji: { fontSize: 64, marginBottom: 12 },
  title: { fontSize: 28, fontWeight: "800", color: T.text, marginBottom: 8 },
  subtitle: { fontSize: 15, color: T.textSecondary, textAlign: "center", marginBottom: 32 },
  activeCard: {
    width: "100%",
    backgroundColor: T.surface,
    borderRadius: 16,
    padding: 24,
    alignItems: "center",
    borderWidth: 1,
    borderColor: T.accent,
  },
  timerLabel: { fontSize: 14, color: T.textMuted, marginBottom: 8 },
  timer: { fontSize: 48, fontWeight: "800", color: T.accent, marginBottom: 16 },
  statusRow: { flexDirection: "row", alignItems: "center", marginBottom: 16 },
  statusDot: { width: 10, height: 10, borderRadius: 5, marginRight: 8 },
  statusActive: { backgroundColor: T.accent },
  statusText: { fontSize: 14, fontWeight: "700", color: T.accent },
  activeHint: { fontSize: 13, color: T.textMuted, textAlign: "center", lineHeight: 20 },
  infoCard: {
    width: "100%",
    backgroundColor: T.surface,
    borderRadius: 16,
    padding: 24,
  },
  infoTitle: { fontSize: 18, fontWeight: "700", color: T.text, marginBottom: 16 },
  infoRow: { flexDirection: "row", alignItems: "center", marginBottom: 14 },
  infoIcon: { fontSize: 20, marginRight: 12 },
  infoText: { fontSize: 15, color: T.textSecondary, flex: 1 },
  costCard: {
    backgroundColor: T.surfaceLight,
    borderRadius: 12,
    padding: 16,
    alignItems: "center",
    marginTop: 16,
    marginBottom: 20,
  },
  costLabel: { fontSize: 13, color: T.textMuted },
  costValue: { fontSize: 32, fontWeight: "800", color: T.warning, marginVertical: 4 },
  costBalance: { fontSize: 13, color: T.textSecondary },
  activateButton: {
    backgroundColor: T.accent,
    borderRadius: 12,
    paddingVertical: 16,
    alignItems: "center",
    width: "100%",
  },
  buttonDisabled: { opacity: 0.6 },
  activateText: { color: "#fff", fontSize: 16, fontWeight: "700" },
});
