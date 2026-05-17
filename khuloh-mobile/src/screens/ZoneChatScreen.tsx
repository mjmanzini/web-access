import React, { useEffect, useRef, useState, useCallback } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  FlatList,
  StyleSheet,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Alert,
} from "react-native";
import { useAuth } from "../contexts/AuthContext";
import { ZoneMessage, RoomMember } from "../types/zones";
import { Shout } from "../types/economy";
import { VIBE_COLORS, Vibe } from "../types/profile";
import { quickScanMessage, reportUser } from "../lib/scamShield";
import { T } from "../lib/theme";
import { fetchZoneMessages, sendZoneMessage, subscribeToZone } from "../lib/backend-zones";

const getVibeColor = (vibe?: string) => VIBE_COLORS[(vibe as Vibe) ?? 'chat'] ?? VIBE_COLORS.chat;

type Props = {
  route: { params: { roomId: string; roomName: string } };
  navigation: any;
};

export default function ZoneChatScreen({ route, navigation }: Props) {
  const { roomId, roomName } = route.params;
  const { user, profile, session } = useAuth();
  const [messages, setMessages] = useState<ZoneMessage[]>([]);
  const [members, setMembers] = useState<RoomMember[]>([]);
  const [text, setText] = useState("");
  const [scamWarning, setScamWarning] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const flatListRef = useRef<FlatList>(null);

  // Fetch initial messages + members + economy data
  useEffect(() => {
    if (!session?.token) {
      setLoading(false);
      return;
    }

    const init = async () => {
      try {
        const msgs = await fetchZoneMessages(session.token, roomId);
        setMessages(msgs);
      } catch (error) {
        Alert.alert("Zone Unavailable", error instanceof Error ? error.message : "Failed to load messages");
        setMessages([]);
      }

      setLoading(false);
    };

    init();
  }, [roomId, session?.token]);

  // Subscribe to realtime messages
  useEffect(() => {
    if (!session?.token) return;

    const subscription = subscribeToZone(session.token, roomId, {
      onMessage: (message) => {
        setMessages((prev) => [...prev, message]);
      },
      onPresence: (nextMembers) => {
        setMembers(nextMembers);
      },
      onError: (message) => {
        Alert.alert("Zone Error", message);
      },
    });

    return () => {
      subscription.dispose();
    };
  }, [roomId, session?.token]);

  const handleSend = async () => {
    const trimmed = text.trim();
    if (!trimmed || !user || !session?.token) return;

    // Local scam scan
    const warning = quickScanMessage(trimmed);
    if (warning) {
      setScamWarning(warning);
      // Still allow send, but show warning
    } else {
      setScamWarning(null);
    }

    setSending(true);
    const result = await sendZoneMessage(session.token, roomId, trimmed);
    setSending(false);

    if (!result.ok) {
      Alert.alert("Message Failed", result.error || "Unable to send message");
      return;
    }

    setText("");
  };

  const handleWhisper = (targetUserId: string, targetUsername: string | null) => {
    if (targetUserId === user?.id) return;
    navigation.navigate("Whisper", {
      targetUserId,
      targetUsername: targetUsername ?? "Anonymous",
    });
  };

  const handleReport = (targetUserId: string, targetUsername: string | null) => {
    if (targetUserId === user?.id) return;
    Alert.alert(
      "Report User",
      `Report ${targetUsername ?? "this user"} for suspicious behavior?`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Report",
          style: "destructive",
          onPress: async () => {
            const result = await reportUser(targetUserId, "Reported from zone chat");
            Alert.alert(
              result.success ? "Reported" : "Error",
              result.success ? "Thank you. We'll review this report." : result.error,
            );
          },
        },
      ],
    );
  };

  // ── Merge messages + shouts into a chronological feed ──
  type FeedItem = ZoneMessage & { _type: "msg" };
  const feed: FeedItem[] = React.useMemo(() => {
    const msgItems: FeedItem[] = messages.map((m) => ({ ...m, _type: "msg" as const }));
    return [...msgItems].sort(
      (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
    );
  }, [messages]);

  const renderFeedItem = useCallback(
    ({ item }: { item: FeedItem }) => {
      const isMe = item.sender_id === user?.id;
      return (
        <View style={[styles.msgRow, isMe && styles.msgRowMe]}>
          {!isMe && (
            <TouchableOpacity
              onPress={() =>
                handleWhisper(item.sender_id, item.sender_username ?? null)
              }
              onLongPress={() => {
                handleReport(item.sender_id, item.sender_username ?? null);
              }}
            >
              <View style={[styles.msgAvatar, { borderWidth: 2, borderColor: getVibeColor(item.sender_vibe) }]}>
                <Text style={styles.msgAvatarText}>
                  {(item.sender_username ?? "?")?.[0]?.toUpperCase()}
                </Text>
              </View>
            </TouchableOpacity>
          )}
          <View
            style={[styles.msgBubble, isMe ? styles.msgBubbleMe : styles.msgBubbleOther]}
          >
            {!isMe && (
              <Text style={styles.msgSender}>
                {item.sender_username ?? "Anon"}
              </Text>
            )}
            <Text style={styles.msgText}>{item.body}</Text>
          </View>
        </View>
      );
    },
    [user?.id],
  );

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={T.primary} size="large" />
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      keyboardVerticalOffset={90}
    >
      {/* Online members bar */}
      <View style={styles.membersBar}>
        <FlatList
          horizontal
          showsHorizontalScrollIndicator={false}
          data={members}
          keyExtractor={(m) => m.user_id}
          renderItem={({ item }) => (
            <TouchableOpacity
              style={styles.memberChip}
              onPress={() => handleWhisper(item.user_id, item.username ?? null)}
              disabled={item.user_id === user?.id}
            >
              <View style={[styles.memberAvatar, { borderWidth: 2, borderColor: getVibeColor(item.vibe) }]}>
                <Text style={styles.memberAvatarText}>
                  {(item.username ?? "?")?.[0]?.toUpperCase()}
                </Text>
              </View>
              <Text style={styles.memberName} numberOfLines={1}>
                {item.user_id === user?.id
                  ? "You"
                  : item.username ?? "Anon"}
              </Text>
            </TouchableOpacity>
          )}
        />
        <Text style={styles.memberCount}>{members.length} online</Text>
      </View>

      {/* Messages + Shouts feed */}
      <FlatList
        ref={flatListRef}
        style={styles.messagesList}
        data={feed}
        keyExtractor={(m) => m.id}
        renderItem={renderFeedItem}
        onContentSizeChange={() =>
          flatListRef.current?.scrollToEnd({ animated: false })
        }
        ListEmptyComponent={
          <View style={styles.emptyWrap}>
            <Text style={styles.emptyText}>No messages yet. Say something!</Text>
          </View>
        }
      />

      {/* Scam warning */}
      {scamWarning && (
        <View style={styles.scamBanner}>
          <Text style={styles.scamText}>⚠️ Scam Shield: {scamWarning}</Text>
        </View>
      )}

      {/* Muted banner */}
      {isMuted && (
        <View style={styles.mutedBanner}>
          <Text style={styles.mutedText}>🔇 You are temporarily muted in this zone.</Text>
        </View>
      )}

      {/* Input */}
      <View style={styles.inputBar}>
        <TextInput
          style={styles.input}
          placeholder={isMuted ? "You are muted…" : "Type a message…"}
          placeholderTextColor={T.textMuted}
          value={text}
          onChangeText={setText}
          maxLength={2000}
          multiline
          editable={!isMuted}
        />
        <TouchableOpacity
          style={[styles.sendBtn, (!text.trim() || sending) && styles.sendBtnDisabled]}
          onPress={handleSend}
          disabled={!text.trim() || sending}
        >
          <Text style={styles.sendBtnText}>›</Text>
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
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
  // Members bar
  membersBar: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: T.surface,
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderBottomWidth: 1,
    borderBottomColor: T.border,
  },
  memberChip: { alignItems: "center", marginRight: 14, width: 48 },
  memberAvatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: T.surfaceLight,
    justifyContent: "center",
    alignItems: "center",
  },
  memberAvatarText: { fontSize: 14, fontWeight: "800", color: T.text },
  memberName: { fontSize: 10, color: T.textSecondary, marginTop: 3 },
  guardianBadge: { fontSize: 10, position: "absolute", top: -2, right: -2 },
  memberCount: {
    fontSize: 11,
    color: T.success,
    fontWeight: "700",
    marginLeft: 4,
  },
  // Messages
  messagesList: { flex: 1, paddingHorizontal: 12, paddingTop: 8 },
  emptyWrap: { flex: 1, justifyContent: "center", alignItems: "center", paddingTop: 80 },
  emptyText: { color: T.textMuted, fontSize: 14 },
  msgRow: { flexDirection: "row", marginBottom: 8, alignItems: "flex-end" },
  msgRowMe: { flexDirection: "row-reverse" },
  msgAvatar: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: T.surfaceLight,
    justifyContent: "center",
    alignItems: "center",
    marginRight: 6,
  },
  msgAvatarText: { fontSize: 12, fontWeight: "700", color: T.textSecondary },
  msgBubble: {
    maxWidth: "75%",
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  msgBubbleMe: { backgroundColor: T.bubbleMe, borderBottomRightRadius: 4 },
  msgBubbleOther: { backgroundColor: T.bubbleOther, borderBottomLeftRadius: 4 },
  msgSender: { fontSize: 11, color: T.primary, fontWeight: "700", marginBottom: 2 },
  msgText: { fontSize: 15, color: T.text, lineHeight: 20 },
  // Input
  inputBar: {
    flexDirection: "row",
    alignItems: "flex-end",
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: T.surface,
    borderTopWidth: 1,
    borderTopColor: T.border,
  },
  input: {
    flex: 1,
    backgroundColor: T.inputBg,
    color: T.text,
    fontSize: 15,
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 10,
    maxHeight: 100,
    borderWidth: 1,
    borderColor: T.border,
  },
  sendBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: T.send,
    justifyContent: "center",
    alignItems: "center",
    marginLeft: 8,
  },
  sendBtnDisabled: { opacity: 0.4 },
  sendBtnText: { fontSize: 22, fontWeight: "800", color: "#fff" },
  // Scam shield
  scamBanner: {
    backgroundColor: T.danger + "22",
    paddingVertical: 6,
    paddingHorizontal: 14,
    borderTopWidth: 1,
    borderTopColor: T.danger + "44",
  },
  scamText: { fontSize: 12, color: T.danger, textAlign: "center" },
  // Shout styles
  shoutBanner: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: T.warning + "22",
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 8,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: T.warning + "44",
  },
  shoutIcon: { fontSize: 20, marginRight: 8 },
  shoutContent: { flex: 1 },
  shoutSender: { fontSize: 11, fontWeight: "700", color: T.warning },
  shoutBody: { fontSize: 14, color: T.text, marginTop: 2 },
  shoutToggle: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: T.warning + "33",
    justifyContent: "center",
    alignItems: "center",
    marginRight: 8,
  },
  shoutToggleText: { fontSize: 16 },
  shoutInputBar: {
    backgroundColor: T.warning + "11",
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderTopWidth: 1,
    borderTopColor: T.warning + "44",
  },
  shoutInputLabel: { fontSize: 12, fontWeight: "700", color: T.warning, marginBottom: 6 },
  shoutInputRow: { flexDirection: "row", alignItems: "flex-end" },
  shoutInput: {
    flex: 1,
    backgroundColor: T.inputBg,
    color: T.text,
    fontSize: 14,
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: T.warning + "44",
    maxHeight: 80,
  },
  shoutCancel: { fontSize: 13, color: T.textSecondary, textAlign: "center", marginTop: 6 },
  // Muted banner
  mutedBanner: {
    backgroundColor: T.danger + "22",
    paddingVertical: 6,
    paddingHorizontal: 14,
    borderTopWidth: 1,
    borderTopColor: T.danger + "44",
  },
  mutedText: { fontSize: 12, color: T.danger, textAlign: "center" },
});
