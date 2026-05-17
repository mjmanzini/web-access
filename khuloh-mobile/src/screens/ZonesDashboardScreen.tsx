import React, { useCallback, useState } from "react";
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  RefreshControl,
  Alert,
} from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import { RoomWithCount } from "../types/zones";
import { T } from "../lib/theme";
import { fetchZones } from "../lib/backend-zones";

type Props = { navigation: any };

export default function ZonesDashboardScreen({ navigation }: Props) {
  const [rooms, setRooms] = useState<RoomWithCount[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const fetchRooms = async () => {
    try {
      const data = await fetchZones();
      setRooms((data as RoomWithCount[]) ?? []);
    } catch (error) {
      Alert.alert("Zones Unavailable", error instanceof Error ? error.message : "Failed to load zones");
      setRooms([]);
    }
  };

  useFocusEffect(
    useCallback(() => {
      fetchRooms().finally(() => setLoading(false));
    }, []),
  );

  const onRefresh = async () => {
    setRefreshing(true);
    await fetchRooms();
    setRefreshing(false);
  };

  const handleEnterZone = (room: RoomWithCount) => {
    navigation.navigate("ZoneChat", {
      roomId: room.id,
      roomName: room.name,
    });
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
      contentContainerStyle={rooms.length === 0 ? styles.center : styles.listContent}
      data={rooms}
      keyExtractor={(item) => item.id}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={T.primary} colors={[T.primary]} />
      }
      ListHeaderComponent={
        <View style={styles.header}>
          <Text style={styles.headerTitle}>Zones</Text>
          <Text style={styles.headerSub}>Tap a zone to start mixing</Text>
        </View>
      }
      ListEmptyComponent={
        <Text style={styles.emptyText}>No zones available.</Text>
      }
      renderItem={({ item }) => (
        <TouchableOpacity
          style={styles.card}
          onPress={() => handleEnterZone(item)}
          activeOpacity={0.7}
        >
          <View style={styles.cardLeft}>
            <Text style={styles.roomName}>{item.name}</Text>
            <Text style={styles.roomCity}>{item.city}</Text>
            {item.description ? (
              <Text style={styles.roomDesc} numberOfLines={1}>
                {item.description}
              </Text>
            ) : null}
          </View>
          <View style={styles.cardRight}>
            <View
              style={[
                styles.onlineDot,
                item.online_count > 0 ? styles.onlineDotActive : null,
              ]}
            />
            <Text style={styles.onlineCount}>{item.online_count}</Text>
            <Text style={styles.onlineLabel}>online</Text>
          </View>
        </TouchableOpacity>
      )}
    />
  );
}

const styles = StyleSheet.create({
  list: { flex: 1, backgroundColor: T.bg },
  listContent: { paddingBottom: 24 },
  center: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: T.bg,
  },
  header: { paddingHorizontal: 20, paddingTop: 16, paddingBottom: 8 },
  headerTitle: { fontSize: 28, fontWeight: "800", color: T.text },
  headerSub: { fontSize: 14, color: T.textSecondary, marginTop: 2 },
  emptyText: { color: T.textMuted, fontSize: 16 },
  card: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: T.surface,
    marginHorizontal: 16,
    marginVertical: 5,
    borderRadius: 14,
    padding: 16,
  },
  cardLeft: { flex: 1 },
  roomName: { fontSize: 17, fontWeight: "700", color: T.text },
  roomCity: { fontSize: 13, color: T.primary, marginTop: 2 },
  roomDesc: { fontSize: 12, color: T.textMuted, marginTop: 4 },
  cardRight: { alignItems: "center", minWidth: 50 },
  onlineDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: T.textMuted,
    marginBottom: 4,
  },
  onlineDotActive: { backgroundColor: T.success },
  onlineCount: { fontSize: 20, fontWeight: "800", color: T.text },
  onlineLabel: { fontSize: 10, color: T.textSecondary, marginTop: 1 },
});
