import { io, Socket } from "socket.io-client";
import { getBackendBaseUrl } from "./backend-client";
import type { Vibe } from "../types/profile";
import type { Whisper } from "../types/zones";

type ConversationMember = {
  id: string;
  username?: string | null;
  displayName?: string | null;
};

type ConversationApi = {
  id: string;
  members?: ConversationMember[];
  last_message?: string | null;
  last_msg_at?: string | null;
  last_sender_id?: string | null;
};

type MessageApi = {
  id: string;
  conversation_id: string;
  sender_id: string;
  body: string;
  created_at: string;
};

type ChatSocketMessage = {
  id: string;
  conversation_id: string;
  sender_id: string;
  body: string;
  created_at: string;
};

let chatSocket: Socket | null = null;
let chatSocketToken: string | null = null;

async function parseJson(response: Response) {
  const text = await response.text();
  if (!text) return null;
  return JSON.parse(text);
}

async function backendRequest<T>(path: string, options: RequestInit = {}, token?: string): Promise<T> {
  const response = await fetch(`${getBackendBaseUrl()}${path}`, {
    ...options,
    headers: {
      Accept: "application/json",
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.headers || {}),
    },
  });
  const payload = await parseJson(response);
  if (!response.ok) {
    throw new Error(String((payload as { error?: string } | null)?.error || `request_failed_${response.status}`));
  }
  return payload as T;
}

function mapMessage(message: MessageApi | ChatSocketMessage, currentUserId?: string, targetUserId?: string): Whisper {
  return {
    id: message.id,
    sender_id: message.sender_id,
    receiver_id: message.sender_id === currentUserId ? (targetUserId || "") : (currentUserId || ""),
    body: message.body,
    created_at: message.created_at,
    expires_at: null,
  };
}

export type ChatConversationSummary = {
  conversationId: string;
  partnerId: string;
  partnerUsername: string;
  partnerVibe: Vibe;
  lastMessage: string;
  lastMessageAt: string;
  isMe: boolean;
};

export async function fetchConversations(token: string, userId: string): Promise<ChatConversationSummary[]> {
  const data = await backendRequest<{ conversations: ConversationApi[] }>("/api/conversations", {}, token);
  return (data.conversations || [])
    .map((conversation) => {
      const partner = (conversation.members || []).find((member) => member.id !== userId);
      if (!partner) return null;
      return {
        conversationId: conversation.id,
        partnerId: partner.id,
        partnerUsername: partner.username || partner.displayName || "Anonymous",
        partnerVibe: "chat" as Vibe,
        lastMessage: conversation.last_message || "",
        lastMessageAt: conversation.last_msg_at || new Date().toISOString(),
        isMe: conversation.last_sender_id === userId,
      };
    })
    .filter(Boolean) as ChatConversationSummary[];
}

export async function ensureConversation(token: string, peerUserId: string) {
  const data = await backendRequest<{ id: string }>(
    "/api/conversations",
    {
      method: "POST",
      body: JSON.stringify({ peerUserId }),
    },
    token,
  );
  return data.id;
}

export async function fetchConversationMessages(
  token: string,
  conversationId: string,
  currentUserId: string,
  targetUserId: string,
) {
  const data = await backendRequest<{ messages: MessageApi[] }>(`/api/conversations/${conversationId}/messages`, {}, token);
  return (data.messages || []).map((message) => mapMessage(message, currentUserId, targetUserId));
}

export function getChatSocket(token: string) {
  if (chatSocket && chatSocketToken === token) return chatSocket;
  if (chatSocket) {
    chatSocket.removeAllListeners();
    chatSocket.disconnect();
  }
  chatSocket = io(`${getBackendBaseUrl()}/chat`, {
    auth: { token },
    transports: ["websocket"],
    autoConnect: true,
  });
  chatSocketToken = token;
  return chatSocket;
}

export function subscribeToConversation(
  token: string,
  conversationId: string,
  currentUserId: string,
  targetUserId: string,
  handlers: {
    onMessage?: (message: Whisper) => void;
    onReceipt?: (receipt: { messageId: string; userId: string; kind: string }) => void;
  },
) {
  const socket = getChatSocket(token);

  const handleMessage = (message: ChatSocketMessage) => {
    if (message.conversation_id !== conversationId) return;
    handlers.onMessage?.(mapMessage(message, currentUserId, targetUserId));
  };

  const handleReceipt = (receipt: { messageId: string; userId: string; kind: string }) => {
    handlers.onReceipt?.(receipt);
  };

  socket.on("message", handleMessage);
  socket.on("receipt", handleReceipt);

  return {
    socket,
    dispose() {
      socket.off("message", handleMessage);
      socket.off("receipt", handleReceipt);
    },
  };
}

export function sendConversationMessage(
  token: string,
  conversationId: string,
  body: string,
  clientId: string,
) {
  const socket = getChatSocket(token);
  return new Promise<{ ok: boolean; error?: string; message?: Whisper }>((resolve) => {
    socket.emit("send", { conversationId, body, clientId }, (ack: { ok?: boolean; error?: string; message?: ChatSocketMessage }) => {
      resolve({
        ok: Boolean(ack?.ok),
        error: ack?.error,
        message: ack?.message ? mapMessage(ack.message) : undefined,
      });
    });
  });
}

export function markConversationRead(token: string, conversationId: string, messageId: string) {
  const socket = getChatSocket(token);
  socket.emit("read", { conversationId, messageId });
}