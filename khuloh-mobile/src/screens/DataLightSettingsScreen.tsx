import React, { useState, useEffect } from "react";
import {
  View,
  Text,
  Switch,
  StyleSheet,
  Alert,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
} from "react-native";
import { useAuth } from "../contexts/AuthContext";
import { setDataLightMode } from "../lib/safeSpots";
import { getCacheStats, clearCache } from "../lib/localCache";
import { getDeltaSyncStats, clearDeltaSync } from "../lib/deltaSync";
import { clearThumbnailCache } from "../lib/thumbnails";
import { T } from "../lib/theme";

export default function DataLightSettingsScreen() {
  const { profile, refreshProfile } = useAuth();
  const [dataLight, setDataLight] = useState(profile?.data_light_mode ?? false);
  const [saving, setSaving] = useState(false);
  const [cacheSize, setCacheSize] = useState<string>("...");
  const [cacheEntries, setCacheEntries] = useState(0);
  const [deltaTxns, setDeltaTxns] = useState(0);
  const [clearing, setClearing] = useState(false);

  useEffect(() => {
    loadCacheStats();
  }, []);

  const loadCacheStats = async () => {
    const [cache, delta] = await Promise.all([
      getCacheStats(),
      getDeltaSyncStats(),
    ]);
    setCacheEntries(cache.totalEntries);
    setCacheSize(
      cache.totalSizeBytes > 1024
        ? `${(cache.totalSizeBytes / 1024).toFixed(1)} KB`
        : `${cache.totalSizeBytes} B`,
    );
    setDeltaTxns(delta.cachedTransactionCount);
  };

  const handleClearCache = async () => {
    Alert.alert("Clear Cache", "This will remove all cached data. You'll use slightly more data until caches rebuild.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Clear",
        style: "destructive",
        onPress: async () => {
          setClearing(true);
          await Promise.all([clearCache(), clearDeltaSync(), clearThumbnailCache()]);
          setClearing(false);
          await loadCacheStats();
        },
      },
    ]);
  };

  const handleToggle = async (value: boolean) => {
    setSaving(true);
    setDataLight(value);
    const success = await setDataLightMode(value);
    setSaving(false);

    if (success) {
      await refreshProfile();
    } else {
      setDataLight(!value);
      Alert.alert("Error", "Failed to update data mode.");
    }
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <View style={styles.heroCard}>
        <Text style={styles.heroIcon}>📡</Text>
        <Text style={styles.heroTitle}>Data-Free Mode</Text>
        <Text style={styles.heroDesc}>
          The "Moya Strategy" — Khuloh for every South African, regardless of data balance.
        </Text>
      </View>

      <View style={styles.settingRow}>
        <View style={styles.settingInfo}>
          <Text style={styles.settingTitle}>Data-Light Mode</Text>
          <Text style={styles.settingDesc}>
            Text-only rooms, no images, minimal data usage. Perfect for when data is scarce.
          </Text>
        </View>
        <Switch
          value={dataLight}
          onValueChange={handleToggle}
          disabled={saving}
          trackColor={{ false: T.border, true: T.primaryMuted }}
          thumbColor={dataLight ? T.primary : T.textMuted}
        />
      </View>

      <View style={styles.infoSection}>
        <Text style={styles.infoTitle}>What changes in Data-Light Mode:</Text>

        <View style={styles.infoRow}>
          <Text style={styles.infoIcon}>💬</Text>
          <Text style={styles.infoText}>Text-only messages (no images or media)</Text>
        </View>
        <View style={styles.infoRow}>
          <Text style={styles.infoIcon}>🔕</Text>
          <Text style={styles.infoText}>Reduced real-time polling frequency</Text>
        </View>
        <View style={styles.infoRow}>
          <Text style={styles.infoIcon}>📉</Text>
          <Text style={styles.infoText}>Compressed message payloads</Text>
        </View>
        <View style={styles.infoRow}>
          <Text style={styles.infoIcon}>🚫</Text>
          <Text style={styles.infoText}>No avatar images in chat</Text>
        </View>
        <View style={styles.infoRow}>
          <Text style={styles.infoIcon}>⚡</Text>
          <Text style={styles.infoText}>Faster loading on slow connections</Text>
        </View>
      </View>

      <View style={styles.infoSection}>
        <Text style={styles.infoTitle}>📊 Local Cache Stats</Text>

        <View style={styles.infoRow}>
          <Text style={styles.infoIcon}>💾</Text>
          <Text style={styles.infoText}>Cache size: {cacheSize}</Text>
        </View>
        <View style={styles.infoRow}>
          <Text style={styles.infoIcon}>📦</Text>
          <Text style={styles.infoText}>Cached entries: {cacheEntries}</Text>
        </View>
        <View style={styles.infoRow}>
          <Text style={styles.infoIcon}>⚡</Text>
          <Text style={styles.infoText}>Cached transactions: {deltaTxns}</Text>
        </View>
        <View style={styles.infoRow}>
          <Text style={styles.infoIcon}>🔄</Text>
          <Text style={styles.infoText}>Delta-sync: only new changes synced</Text>
        </View>

        <TouchableOpacity
          style={styles.clearButton}
          onPress={handleClearCache}
          disabled={clearing}
        >
          {clearing ? (
            <ActivityIndicator color={T.danger} size="small" />
          ) : (
            <Text style={styles.clearButtonText}>Clear All Caches</Text>
          )}
        </TouchableOpacity>
      </View>

      <View style={styles.zeroRateCard}>
        <Text style={styles.zeroRateTitle}>🇿🇦 Zero-Rating (Coming Soon)</Text>
        <Text style={styles.zeroRateDesc}>
          We're working with MTN and Vodacom to make Khuloh completely data-free —
          just like MoyaApp and the legendary Mxit. Stay tuned!
        </Text>
        <View style={styles.networkBadges}>
          <View style={styles.networkBadge}>
            <Text style={styles.networkBadgeText}>MTN</Text>
          </View>
          <View style={styles.networkBadge}>
            <Text style={styles.networkBadgeText}>Vodacom</Text>
          </View>
          <View style={styles.networkBadge}>
            <Text style={styles.networkBadgeText}>Cell C</Text>
          </View>
          <View style={styles.networkBadge}>
            <Text style={styles.networkBadgeText}>Telkom</Text>
          </View>
        </View>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: T.bg },
  content: { padding: 16, paddingBottom: 48 },
  heroCard: {
    backgroundColor: T.surface,
    borderRadius: 14,
    padding: 24,
    alignItems: "center",
    marginBottom: 20,
    borderWidth: 1,
    borderColor: T.accentMuted,
  },
  heroIcon: { fontSize: 40, marginBottom: 12 },
  heroTitle: { fontSize: 20, fontWeight: "800", color: T.text },
  heroDesc: {
    fontSize: 13,
    color: T.textSecondary,
    textAlign: "center",
    marginTop: 8,
    lineHeight: 18,
  },
  settingRow: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: T.surface,
    borderRadius: 14,
    padding: 16,
    marginBottom: 20,
  },
  settingInfo: { flex: 1, marginRight: 12 },
  settingTitle: { fontSize: 16, fontWeight: "700", color: T.text },
  settingDesc: { fontSize: 13, color: T.textSecondary, marginTop: 4, lineHeight: 18 },
  infoSection: {
    backgroundColor: T.surface,
    borderRadius: 14,
    padding: 16,
    marginBottom: 20,
  },
  infoTitle: { fontSize: 14, fontWeight: "700", color: T.text, marginBottom: 12 },
  infoRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 6,
  },
  infoIcon: { fontSize: 16, marginRight: 10, width: 24 },
  infoText: { fontSize: 13, color: T.textSecondary, flex: 1 },
  zeroRateCard: {
    backgroundColor: T.accentMuted,
    borderRadius: 14,
    padding: 20,
    alignItems: "center",
    borderWidth: 1,
    borderColor: T.accent + "44",
  },
  zeroRateTitle: { fontSize: 16, fontWeight: "800", color: T.accent },
  zeroRateDesc: {
    fontSize: 13,
    color: T.textSecondary,
    textAlign: "center",
    marginTop: 8,
    lineHeight: 18,
  },
  networkBadges: {
    flexDirection: "row",
    marginTop: 12,
    gap: 8,
  },
  networkBadge: {
    backgroundColor: T.surface,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  networkBadgeText: { fontSize: 12, fontWeight: "700", color: T.text },
  clearButton: {
    marginTop: 12,
    paddingVertical: 10,
    alignItems: "center",
    borderWidth: 1,
    borderColor: T.danger + "44",
    borderRadius: 10,
  },
  clearButtonText: { color: T.danger, fontSize: 14, fontWeight: "600" },
});
