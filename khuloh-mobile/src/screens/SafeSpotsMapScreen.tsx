import React, { useEffect, useState } from "react";
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Alert,
  TextInput,
} from "react-native";
import { getSafeSpots } from "../lib/safeSpots";
import { bookUberToSafeSpot, navigateToSafeSpot } from "../lib/uberIntegration";
import type { SafeSpot } from "../types/safespots";
import { T } from "../lib/theme";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import type { SafeSpotsStackParamList } from "../navigation/types";

type Props = NativeStackScreenProps<SafeSpotsStackParamList, "SafeSpots">;

const CATEGORY_ICONS: Record<string, string> = {
  cafe: "☕",
  restaurant: "🍽️",
  lounge: "🛋️",
  bar: "🍸",
};

const SA_CITIES = [
  "All",
  "Cape Town",
  "Johannesburg",
  "Durban",
  "Pretoria",
  "Stellenbosch",
];

export default function SafeSpotsMapScreen({ navigation }: Props) {
  const [spots, setSpots] = useState<SafeSpot[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedCity, setSelectedCity] = useState("All");
  const [search, setSearch] = useState("");

  useEffect(() => {
    loadSpots();
  }, [selectedCity]);

  const loadSpots = async () => {
    setLoading(true);
    const data = await getSafeSpots(selectedCity === "All" ? undefined : selectedCity);
    setSpots(data);
    setLoading(false);
  };

  const filtered = spots.filter(
    (s) =>
      !search ||
      s.name.toLowerCase().includes(search.toLowerCase()) ||
      s.address.toLowerCase().includes(search.toLowerCase()),
  );

  const handleUber = (spot: SafeSpot) => {
    Alert.alert(
      "Book Uber",
      `Ride to ${spot.name}?\nTrip details will be shared with your emergency contacts.`,
      [
        { text: "Cancel", style: "cancel" },
        { text: "Book Uber", onPress: () => bookUberToSafeSpot(spot) },
      ],
    );
  };

  const handleCheckin = (spot: SafeSpot) => {
    navigation.navigate("PairCheckin" as any, { spotId: spot.id, spotName: spot.name });
  };

  return (
    <View style={styles.container}>
      {/* Search */}
      <View style={styles.searchBar}>
        <TextInput
          style={styles.searchInput}
          placeholder="Search Safe-Spots…"
          placeholderTextColor={T.textMuted}
          value={search}
          onChangeText={setSearch}
        />
      </View>

      {/* City filter */}
      <View style={styles.cityBar}>
        <FlatList
          horizontal
          showsHorizontalScrollIndicator={false}
          data={SA_CITIES}
          keyExtractor={(c) => c}
          renderItem={({ item }) => (
            <TouchableOpacity
              style={[
                styles.cityChip,
                selectedCity === item && styles.cityChipActive,
              ]}
              onPress={() => setSelectedCity(item)}
            >
              <Text
                style={[
                  styles.cityChipText,
                  selectedCity === item && styles.cityChipTextActive,
                ]}
              >
                {item}
              </Text>
            </TouchableOpacity>
          )}
        />
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={T.primary} size="large" />
        </View>
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={(s) => s.id}
          contentContainerStyle={styles.list}
          ListEmptyComponent={
            <Text style={styles.emptyText}>No Safe-Spots found in this area.</Text>
          }
          renderItem={({ item }) => (
            <View style={styles.spotCard}>
              <View style={styles.spotHeader}>
                <Text style={styles.spotIcon}>
                  {CATEGORY_ICONS[item.category] ?? "📍"}
                </Text>
                <View style={styles.spotInfo}>
                  <Text style={styles.spotName}>{item.name}</Text>
                  <Text style={styles.spotAddress}>{item.address}</Text>
                </View>
                <View style={styles.verifiedBadge}>
                  <Text style={styles.verifiedText}>🛡️ Safe</Text>
                </View>
              </View>

              <View style={styles.spotMeta}>
                <Text style={styles.discountBadge}>
                  🏷️ {item.discount_pct}% Khuloh Discount
                </Text>
              </View>

              <View style={styles.spotActions}>
                <TouchableOpacity
                  style={styles.actionBtn}
                  onPress={() => navigateToSafeSpot(item)}
                >
                  <Text style={styles.actionBtnText}>📍 Directions</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.actionBtn, styles.actionBtnUber]}
                  onPress={() => handleUber(item)}
                >
                  <Text style={styles.actionBtnText}>🚗 Uber</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.actionBtn, styles.actionBtnCheckin]}
                  onPress={() => handleCheckin(item)}
                >
                  <Text style={styles.actionBtnText}>✅ Check-In</Text>
                </TouchableOpacity>
              </View>
            </View>
          )}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: T.bg },
  center: { flex: 1, justifyContent: "center", alignItems: "center" },
  searchBar: { paddingHorizontal: 16, paddingTop: 12 },
  searchInput: {
    backgroundColor: T.inputBg,
    color: T.text,
    fontSize: 15,
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: T.border,
  },
  cityBar: { paddingVertical: 10, paddingHorizontal: 12 },
  cityChip: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 16,
    backgroundColor: T.surface,
    marginRight: 8,
    borderWidth: 1,
    borderColor: T.border,
  },
  cityChipActive: {
    backgroundColor: T.primaryMuted,
    borderColor: T.primary,
  },
  cityChipText: { fontSize: 13, color: T.textSecondary, fontWeight: "600" },
  cityChipTextActive: { color: T.primary },
  list: { paddingHorizontal: 16, paddingBottom: 32 },
  emptyText: { color: T.textMuted, fontSize: 14, textAlign: "center", marginTop: 40 },
  spotCard: {
    backgroundColor: T.surface,
    borderRadius: 14,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: T.border,
  },
  spotHeader: { flexDirection: "row", alignItems: "center" },
  spotIcon: { fontSize: 28, marginRight: 12 },
  spotInfo: { flex: 1 },
  spotName: { fontSize: 16, fontWeight: "700", color: T.text },
  spotAddress: { fontSize: 12, color: T.textSecondary, marginTop: 2 },
  verifiedBadge: {
    backgroundColor: T.primaryMuted,
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  verifiedText: { fontSize: 11, fontWeight: "700", color: T.primary },
  spotMeta: { marginTop: 10 },
  discountBadge: {
    fontSize: 13,
    fontWeight: "700",
    color: T.warning,
    backgroundColor: T.warning + "22",
    alignSelf: "flex-start",
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
  },
  spotActions: {
    flexDirection: "row",
    marginTop: 12,
    gap: 8,
  },
  actionBtn: {
    flex: 1,
    backgroundColor: T.surfaceLight,
    borderRadius: 10,
    paddingVertical: 10,
    alignItems: "center",
  },
  actionBtnUber: { backgroundColor: "#131313" },
  actionBtnCheckin: { backgroundColor: T.primaryMuted },
  actionBtnText: { fontSize: 12, fontWeight: "700", color: T.text },
});
