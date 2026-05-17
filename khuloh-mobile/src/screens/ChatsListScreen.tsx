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
import { useAuth } from "../contexts/AuthContext";
import { VIBE_COLORS, Vibe } from "../types/profile";
import { T } from "../lib/theme";
import { fetchConversations as fetchBackendConversations } from "../lib/backend-chat";

type Conversation = {
  partnerId: string;
  partnerUsername: string;
  partnerVibe: Vibe;
  lastMessage: string;
  lastMessageAt: string;
  isMe: boolean; // did I send the last message?
};

type Props = { navigation: any };

export default function ChatsListScreen({ navigation }: Props) {
  const { user, session } = useAuth();
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const fetchConversations = async () => {
    if (!user || !session?.token) return;

    try {
      const data = await fetchBackendConversations(session.token, user.id);
      setConversations(data);
    } catch (error) {
      Alert.alert("Chats Unavailable", error instanceof Error ? error.message : "Failed to load chats");
      return;
    }
  };

  useFocusEffect(
    useCallback(() => {
      fetchConversations().finally(() => setLoading(false));
    }, [user]),
  );

  const onRefresh = async () => {
    setRefreshing(true);
    await fetchConversations();
    setRefreshing(false);
  };

  const openChat = (c: Conversation) => {
    navigation.navigate("Whisper", {
      targetUserId: c.partnerId,
      targetUsername: c.partnerUsername,
      conversationId: (c as Conversation & { conversationId?: string }).conversationId,
    });
  };

  const formatTime = (iso: string) => {
    const d = new Date(iso);
    const now = new Date();
    const diff = now.getTime() - d.getTime();
    const oneDay = 86_400_000;

    if (diff < oneDay && d.getDate() === now.getDate()) {
      return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    }
    if (diff < 7 * oneDay) {
      return d.toLocaleDateString([], { weekday: "short" });
    }
    return d.toLocaleDateString([], { month: "short", day: "numeric" });
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
      contentContainerStyle={
        conversations.length === 0 ? styles.emptyContainer : styles.listContent
      }
      data={conversations}
      keyExtractor={(c) => c.partnerId}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={onRefresh}
          tintColor={T.primary}
          colors={[T.primary]}
        />
      }
      ListEmptyComponent={
        <View style={styles.emptyWrap}>
          <Text style={styles.emptyIcon}>💬</Text>
          <Text style={styles.emptyTitle}>No chats yet</Text>
          <Text style={styles.emptySub}>
            Head to Zones and start a Whisper with someone!
          </Text>
        </View>
      }
      renderItem={({ item }) => (
        <TouchableOpacity
          style={styles.row}
          onPress={() => openChat(item)}
          activeOpacity={0.7}
        >
          <View
            style={[
              styles.avatar,
              { borderColor: VIBE_COLORS[item.partnerVibe] },
            ]}
          >
            <Text style={styles.avatarText}>
              {item.partnerUsername[0]?.toUpperCase() ?? "?"}
            </Text>
          </View>

          <View style={styles.mid}>
            <Text style={styles.username} numberOfLines={1}>
              {item.partnerUsername}
            </Text>
            <Text style={styles.preview} numberOfLines={1}>
              {item.isMe ? "You: " : ""}
              {item.lastMessage}
            </Text>
          </View>

          <Text style={styles.time}>{formatTime(item.lastMessageAt)}</Text>
        </TouchableOpacity>
      )}
      ItemSeparatorComponent={() => <View style={styles.separator} />}
    />
  );
}

const styles = StyleSheet.create({
  list: { flex: 1, backgroundColor: T.bg },
  listContent: { paddingTop: 4 },
  emptyContainer: { flex: 1 },
  center: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: T.bg,
  },
  emptyWrap: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 40,
  },
  emptyIcon: { fontSize: 48, marginBottom: 12 },
  emptyTitle: { fontSize: 20, fontWeight: "800", color: T.text, marginBottom: 6 },
  emptySub: { fontSize: 14, color: T.textSecondary, textAlign: "center" },
  row: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  avatar: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: T.surface,
    borderWidth: 2,
    justifyContent: "center",
    alignItems: "center",
    marginRight: 14,
  },
  avatarText: { fontSize: 20, fontWeight: "800", color: T.text },
  mid: { flex: 1, marginRight: 8 },
  username: { fontSize: 16, fontWeight: "700", color: T.text, marginBottom: 3 },
  preview: { fontSize: 14, color: T.textSecondary },
  time: { fontSize: 12, color: T.textMuted },
  separator: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: T.border,
    marginLeft: 82,
  },
});
