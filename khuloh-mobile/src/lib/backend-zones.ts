import { io, Socket } from "socket.io-client";
import { getBackendBaseUrl } from "./backend-client";
import type { RoomMember, RoomWithCount, ZoneMessage } from "../types/zones";

type ZoneApi = {
  id: string;
  name: string;
  city: string;
  topic?: string | null;
  member_count?: number;
  created_at?: string;
};

type ZoneMessageApi = {
  id: string;
  zoneId: string;
  fromId: string;
  fromHandle?: string | null;
  body: string;
  ts: string;
};

type PresenceSnapshot = {
  zoneId: string;
  count: number;
  members: Array<{ uid: string; handle?: string | null }>;
};

let khulohSocket: Socket | null = null;
let khulohSocketToken: string | null = null;

async function parseJson(response: Response) {
  const text = await response.text();
  if (!text) return null;
  return JSON.parse(text);
}

async function backendRequest<T>(path: string, token?: string): Promise<T> {
  const response = await fetch(`${getBackendBaseUrl()}${path}`, {
    headers: {
      Accept: "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  });
  const payload = await parseJson(response);
  if (!response.ok) {
    throw new Error(String((payload as { error?: string } | null)?.error || `request_failed_${response.status}`));
  }
  return payload as T;
}

function mapZone(zone: ZoneApi): RoomWithCount {
  return {
    id: zone.id,
    name: zone.name,
    city: zone.city,
    description: zone.topic || "",
    created_at: zone.created_at || new Date().toISOString(),
    online_count: Number(zone.member_count) || 0,
  };
}

function mapZoneMessage(message: ZoneMessageApi): ZoneMessage {
  return {
    id: message.id,
    room_id: message.zoneId,
    sender_id: message.fromId,
    body: message.body,
    created_at: message.ts,
    sender_username: message.fromHandle || undefined,
    sender_avatar_url: null,
    sender_vibe: undefined,
  };
}

export function mapPresence(snapshot: PresenceSnapshot): RoomMember[] {
  return (snapshot.members || []).map((member) => ({
    room_id: snapshot.zoneId,
    user_id: member.uid,
    joined_at: new Date().toISOString(),
    username: member.handle || null,
    avatar_url: null,
    vibe: undefined,
  }));
}

export async function fetchZones(): Promise<RoomWithCount[]> {
  const data = await backendRequest<{ zones: ZoneApi[] }>("/api/khuloh/zones");
  return (data.zones || []).map(mapZone);
}

export async function fetchZoneMessages(token: string, zoneId: string): Promise<ZoneMessage[]> {
  const data = await backendRequest<{ messages: ZoneMessageApi[] }>(`/api/khuloh/zones/${zoneId}/messages`, token);
  return (data.messages || []).map(mapZoneMessage);
}

export function getKhulohSocket(token: string) {
  if (khulohSocket && khulohSocketToken === token) return khulohSocket;
  if (khulohSocket) {
    khulohSocket.removeAllListeners();
    khulohSocket.disconnect();
  }

  khulohSocket = io(`${getBackendBaseUrl()}/khuloh`, {
    auth: { token },
    transports: ["websocket"],
    autoConnect: true,
  });
  khulohSocketToken = token;
  return khulohSocket;
}

export function subscribeToZone(
  token: string,
  zoneId: string,
  handlers: {
    onMessage?: (message: ZoneMessage) => void;
    onPresence?: (members: RoomMember[], count: number) => void;
    onError?: (message: string) => void;
  },
) {
  const socket = getKhulohSocket(token);

  const handleMessage = (message: ZoneMessageApi) => {
    if (message.zoneId !== zoneId) return;
    handlers.onMessage?.(mapZoneMessage(message));
  };

  const handlePresence = (snapshot: PresenceSnapshot) => {
    if (snapshot.zoneId !== zoneId) return;
    handlers.onPresence?.(mapPresence(snapshot), snapshot.count || 0);
  };

  socket.on("zone:msg", handleMessage);
  socket.on("zone:presence", handlePresence);
  socket.emit("zone:join", { zoneId });
  socket.emit("zone:presence:list", { zoneId }, (result: PresenceSnapshot & { ok?: boolean; error?: string }) => {
    if (result?.ok === false) {
      handlers.onError?.(result.error || "presence_failed");
      return;
    }
    if (result?.zoneId) {
      handlePresence(result as PresenceSnapshot);
    }
  });

  return {
    socket,
    dispose() {
      socket.emit("zone:leave", { zoneId });
      socket.off("zone:msg", handleMessage);
      socket.off("zone:presence", handlePresence);
    },
  };
}

export function sendZoneMessage(token: string, zoneId: string, body: string) {
  const socket = getKhulohSocket(token);
  return new Promise<{ ok: boolean; error?: string }>((resolve) => {
    socket.emit("zone:msg", { zoneId, body }, (ack: { ok?: boolean; error?: string }) => {
      resolve({ ok: Boolean(ack?.ok), error: ack?.error });
    });
  });
}