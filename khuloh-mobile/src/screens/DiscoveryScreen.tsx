import React, { useCallback, useState } from "react";
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  RefreshControl,
} from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import { supabase } from "../lib/supabase";
import { Profile } from "../types/profile";

type Props = { navigation: any };

export default function DiscoveryScreen({ navigation }: Props) {
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const fetchProfiles = async () => {
    const { data } = await supabase
      .from("profiles")
      .select("id, username, bio, trust_score, avatar_url")
      .order("trust_score", { ascending: false });

    setProfiles((data as Profile[]) ?? []);
  };

  useFocusEffect(
    useCallback(() => {
      fetchProfiles().finally(() => setLoading(false));
    }, []),
  );

  const onRefresh = async () => {
    setRefreshing(true);
    await fetchProfiles();
    setRefreshing(false);
  };

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color="#6C63FF" size="large" />
      </View>
    );
  }

  return (
    <FlatList
      style={styles.list}
      contentContainerStyle={profiles.length === 0 ? styles.center : styles.listContent}
      data={profiles}
      keyExtractor={(item) => item.id}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#6C63FF" />}
      ListHeaderComponent={
        <TouchableOpacity
          style={styles.zonesButton}
          onPress={() => navigation.navigate("Zones")}
          activeOpacity={0.7}
        >
          <Text style={styles.zonesButtonText}>Enter Zones</Text>
          <Text style={styles.zonesButtonSub}>Live chat rooms near you</Text>
        </TouchableOpacity>
      }
      ListEmptyComponent={
        <Text style={styles.emptyText}>No verified profiles found yet.</Text>
      }
      renderItem={({ item }) => (
        <View style={styles.card}>
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>
              {(item.username ?? "?")?.[0]?.toUpperCase()}
            </Text>
          </View>
          <View style={styles.info}>
            <Text style={styles.username}>{item.username ?? "Anonymous"}</Text>
            <Text style={styles.bio} numberOfLines={2}>
              {item.bio || "No bio"}
            </Text>
          </View>
          <Text style={styles.score}>{item.trust_score}</Text>
        </View>
      )}
    />
  );
}

const styles = StyleSheet.create({
  list: { flex: 1, backgroundColor: "#0a0a0a" },
  listContent: { paddingVertical: 12 },
  center: { flex: 1, justifyContent: "center", alignItems: "center", backgroundColor: "#0a0a0a" },
  emptyText: { color: "#666", fontSize: 16 },
  card: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#1a1a1a",
    marginHorizontal: 16,
    marginVertical: 6,
    borderRadius: 14,
    padding: 14,
  },
  avatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: "#6C63FF",
    justifyContent: "center",
    alignItems: "center",
    marginRight: 14,
  },
  avatarText: { fontSize: 20, fontWeight: "800", color: "#fff" },
  info: { flex: 1 },
  username: { fontSize: 16, fontWeight: "700", color: "#fff", marginBottom: 2 },
  bio: { fontSize: 13, color: "#888" },
  score: { fontSize: 18, fontWeight: "700", color: "#6C63FF" },
  zonesButton: {
    backgroundColor: "#1a1a2e",
    marginHorizontal: 16,
    marginVertical: 10,
    borderRadius: 14,
    padding: 16,
    borderWidth: 1,
    borderColor: "#6C63FF",
    alignItems: "center",
  },
  zonesButtonText: { fontSize: 18, fontWeight: "800", color: "#6C63FF" },
  zonesButtonSub: { fontSize: 12, color: "#888", marginTop: 4 },
});
