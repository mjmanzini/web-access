import AsyncStorage from "@react-native-async-storage/async-storage";
import { AppState, AppStateStatus } from "react-native";
import { getStoredBackendToken } from "./backend-client";
import { ensureConversation, sendConversationMessage } from "./backend-chat";
import { sendZoneMessage } from "./backend-zones";

const QUEUE_KEY = "@khuloh_pending_msgs";

export type PendingMessage = {
  tempId: string;
  type: "whisper" | "zone";
  body: string;
  senderId: string;
  receiverId?: string; // whisper
  roomId?: string; // zone
  createdAt: string;
  retries: number;
};

// ── Queue persistence ─────────────────────────────────────
async function loadQueue(): Promise<PendingMessage[]> {
  try {
    const raw = await AsyncStorage.getItem(QUEUE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

async function saveQueue(queue: PendingMessage[]): Promise<void> {
  await AsyncStorage.setItem(QUEUE_KEY, JSON.stringify(queue));
}

// ── Enqueue a message ─────────────────────────────────────
export async function enqueue(msg: Omit<PendingMessage, "retries">): Promise<void> {
  const queue = await loadQueue();
  queue.push({ ...msg, retries: 0 });
  await saveQueue(queue);
}

// ── Attempt to send a single message ──────────────────────
async function trySend(msg: PendingMessage): Promise<boolean> {
  try {
    const token = await getStoredBackendToken();
    if (!token) return false;

    if (msg.type === "whisper" && msg.receiverId) {
      const conversationId = await ensureConversation(token, msg.receiverId);
      const result = await sendConversationMessage(token, conversationId, msg.body, msg.tempId);
      return result.ok;
    }
    if (msg.type === "zone" && msg.roomId) {
      const result = await sendZoneMessage(token, msg.roomId, msg.body);
      return result.ok;
    }
    return false;
  } catch {
    return false;
  }
}

// ── Flush the queue — send all pending, remove successes ──
export async function flushQueue(): Promise<number> {
  const queue = await loadQueue();
  if (queue.length === 0) return 0;

  const remaining: PendingMessage[] = [];
  let sent = 0;

  for (const msg of queue) {
    const ok = await trySend(msg);
    if (ok) {
      sent++;
    } else if (msg.retries < 10) {
      remaining.push({ ...msg, retries: msg.retries + 1 });
    }
    // Drop messages with 10+ failed retries
  }

  await saveQueue(remaining);
  return sent;
}

// ── Get count of pending messages ─────────────────────────
export async function pendingCount(): Promise<number> {
  return (await loadQueue()).length;
}

// ── Auto-flush on app resume ──────────────────────────────
let listening = false;

export function startAutoFlush(): void {
  if (listening) return;
  listening = true;

  const handleStateChange = (state: AppStateStatus) => {
    if (state === "active") {
      flushQueue();
    }
  };

  AppState.addEventListener("change", handleStateChange);

  // Also flush on first call
  flushQueue();
}
