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
import { Whisper } from "../types/zones";
import { VIBE_COLORS, Vibe } from "../types/profile";
import { quickScanMessage, reportUser } from "../lib/scamShield";
import { T } from "../lib/theme";
import {
  ensureConversation,
  fetchConversationMessages,
  markConversationRead,
  sendConversationMessage,
  subscribeToConversation,
} from "../lib/backend-chat";

type Props = {
  route: { params: { targetUserId: string; targetUsername: string; conversationId?: string } };
};

export default function WhisperChatScreen({ route }: Props) {
  const { targetUserId, targetUsername, conversationId: initialConversationId } = route.params;
  const { user, profile, session } = useAuth();
  const [messages, setMessages] = useState<Whisper[]>([]);
  const [targetVibe, setTargetVibe] = useState<Vibe>('chat');
  const [text, setText] = useState("");
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [scamWarning, setScamWarning] = useState<string | null>(null);
  const [conversationId, setConversationId] = useState(initialConversationId ?? null);
  const flatListRef = useRef<FlatList>(null);

  const isIgniteMode = profile?.vibe === 'ignite' || targetVibe === 'ignite';

  // Fetch existing whispers between the two users
  useEffect(() => {
    if (!user || !session?.token) return;

    const fetchWhispers = async () => {
      try {
        const activeConversationId = initialConversationId || await ensureConversation(session.token, targetUserId);
        setConversationId(activeConversationId);
        const whisperMessages = await fetchConversationMessages(session.token, activeConversationId, user.id, targetUserId);
        setMessages(whisperMessages);
      } catch (error) {
        Alert.alert("Chat Unavailable", error instanceof Error ? error.message : "Failed to load chat");
        setMessages([]);
      }
      setLoading(false);
    };

    fetchWhispers();
  }, [user, targetUserId, initialConversationId, session?.token]);

  // Enable screenshot blocking on Android for ignite mode
  useEffect(() => {
    if (Platform.OS !== 'android' || !isIgniteMode) return;

    const enableSecure = async () => {
      try {
        const { default: RNScreenCapture } = await import('react-native');
        // FLAG_SECURE is set via native module when available
        // This is a placeholder – full implementation requires native code or expo-screen-capture
      } catch {}
    };
    enableSecure();
  }, [isIgniteMode]);

  // Subscribe to new whispers in realtime
  useEffect(() => {
    if (!user || !session?.token || !conversationId) return;

    const subscription = subscribeToConversation(session.token, conversationId, user.id, targetUserId, {
      onMessage: (message) => {
        setMessages((prev) => [...prev, message]);
        if (message.sender_id !== user.id) {
          markConversationRead(session.token, conversationId, message.id);
        }
      },
    });

    return () => { subscription.dispose(); };
  }, [user, targetUserId, session?.token, conversationId]);

  const handleSend = async () => {
    const trimmed = text.trim();
    if (!trimmed || !user || !session?.token) return;

    const warning = quickScanMessage(trimmed);
    if (warning) {
      setScamWarning(warning);
    } else {
      setScamWarning(null);
    }

    setSending(true);
    setText("");

    const activeConversationId = conversationId || await ensureConversation(session.token, targetUserId);
    if (!conversationId) setConversationId(activeConversationId);
    const clientId = `mobile-${Date.now()}`;
    const optimistic: Whisper = {
      id: clientId,
      sender_id: user.id,
      receiver_id: targetUserId,
      body: trimmed,
      created_at: new Date().toISOString(),
      expires_at: null,
    };
    setMessages((prev) => [...prev, optimistic]);

    const result = await sendConversationMessage(session.token, activeConversationId, trimmed, clientId);
    setSending(false);

    if (!result.ok) {
      setMessages((prev) => prev.filter((item) => item.id !== clientId));
      Alert.alert("Message Failed", result.error || "Unable to send message");
      return;
    }
  };

  const handleReportUser = () => {
    Alert.alert(
      "Report User",
      `Report ${targetUsername} for suspicious behavior?`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Report",
          style: "destructive",
          onPress: async () => {
            const result = await reportUser(targetUserId, "Reported from whisper chat");
            Alert.alert(
              result.success ? "Reported" : "Error",
              result.success ? "Thank you. We'll review this report." : result.error,
            );
          },
        },
      ],
    );
  };

  const renderMessage = useCallback(
    ({ item }: { item: Whisper }) => {
      const isMe = item.sender_id === user?.id;
      const expiring = !!item.expires_at;
      return (
        <View style={[styles.msgRow, isMe && styles.msgRowMe]}>
          <View
            style={[styles.msgBubble, isMe ? styles.msgBubbleMe : styles.msgBubbleOther]}
          >
            <Text style={styles.msgText}>{item.body}</Text>
            <View style={styles.msgMeta}>
              {expiring && <Text style={styles.expiryBadge}>🔥 24h</Text>}
              <Text style={styles.msgTime}>
                {new Date(item.created_at).toLocaleTimeString([], {
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </Text>
            </View>
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
      {/* Header info */}
      <View style={styles.headerBar}>
        <View style={[styles.headerAvatar, { borderWidth: 2, borderColor: VIBE_COLORS[targetVibe] }]}>
          <Text style={styles.headerAvatarText}>
            {targetUsername[0]?.toUpperCase() ?? "?"}
          </Text>
        </View>
        <View>
          <Text style={styles.headerName}>{targetUsername}</Text>
          <Text style={[styles.headerLabel, { color: VIBE_COLORS[targetVibe] }]}>Whisper</Text>
        </View>
        {isIgniteMode && (
          <View style={styles.igniteBar}>
            <Text style={styles.igniteText}>🔒 Private</Text>
          </View>
        )}
        <TouchableOpacity onPress={handleReportUser} style={styles.reportBtn}>
          <Text style={styles.reportBtnText}>⚠️</Text>
        </TouchableOpacity>
      </View>

      {/* Messages */}
      <FlatList
        ref={flatListRef}
        style={styles.messagesList}
        data={messages}
        keyExtractor={(m) => m.id}
        renderItem={renderMessage}
        onContentSizeChange={() =>
          flatListRef.current?.scrollToEnd({ animated: false })
        }
        ListEmptyComponent={
          <View style={styles.emptyWrap}>
            <Text style={styles.emptyText}>
              Start a private conversation with {targetUsername}
            </Text>
          </View>
        }
      />

      {/* Scam warning */}
      {scamWarning && (
        <View style={styles.scamBanner}>
          <Text style={styles.scamText}>⚠️ Scam Shield: {scamWarning}</Text>
        </View>
      )}

      {/* Input */}
      <View style={styles.inputBar}>
        <TextInput
          style={styles.input}
          placeholder="Whisper something…"
          placeholderTextColor={T.textMuted}
          value={text}
          onChangeText={setText}
          maxLength={2000}
          multiline
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
  // Header
  headerBar: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: T.surface,
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderBottomWidth: 1,
    borderBottomColor: T.border,
  },
  headerAvatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: T.surfaceLight,
    justifyContent: "center",
    alignItems: "center",
    marginRight: 12,
  },
  headerAvatarText: { fontSize: 16, fontWeight: "800", color: T.text },
  headerName: { fontSize: 16, fontWeight: "700", color: T.text },
  headerLabel: { fontSize: 11, color: T.primary, fontWeight: "600" },
  // Messages
  messagesList: { flex: 1, paddingHorizontal: 12, paddingTop: 8 },
  emptyWrap: { flex: 1, justifyContent: "center", alignItems: "center", paddingTop: 80 },
  emptyText: { color: T.textMuted, fontSize: 14, textAlign: "center" },
  msgRow: { flexDirection: "row", marginBottom: 8 },
  msgRowMe: { flexDirection: "row-reverse" },
  msgBubble: {
    maxWidth: "75%",
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  msgBubbleMe: { backgroundColor: T.bubbleMe, borderBottomRightRadius: 4 },
  msgBubbleOther: { backgroundColor: T.bubbleOther, borderBottomLeftRadius: 4 },
  msgText: { fontSize: 15, color: T.text, lineHeight: 20 },
  msgMeta: { flexDirection: "row", alignItems: "center", justifyContent: "flex-end", marginTop: 4, gap: 6 },
  expiryBadge: { fontSize: 10, color: T.danger },
  msgTime: { fontSize: 10, color: "rgba(232,239,244,0.5)", textAlign: "right" },
  igniteBar: {
    marginLeft: "auto",
    backgroundColor: T.danger + "22",
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  igniteText: { fontSize: 11, color: T.danger, fontWeight: "700" },
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
  // Report & scam
  reportBtn: { marginLeft: "auto", padding: 6 },
  reportBtnText: { fontSize: 18 },
  scamBanner: {
    backgroundColor: T.danger + "22",
    paddingVertical: 6,
    paddingHorizontal: 14,
    borderTopWidth: 1,
    borderTopColor: T.danger + "44",
  },
  scamText: { fontSize: 12, color: T.danger, textAlign: "center" },
});
