/**
 * Minimal Socket.IO chat client.
 * Pairs with signaling-server `chat/messages.js` + `chat/presence.js`.
 *
 * Events (client <-> server):
 *   -> 'chat:send'         { conversationId, body, clientId }
 *   <- 'chat:message'      { id, conversationId, senderId, body, createdAt }
 *   <- 'chat:receipt'      { messageId, userId, kind: 'delivered'|'read' }
 *   -> 'chat:typing'       { conversationId, typing: boolean }
 *   <- 'presence:update'   { userId, online: boolean, lastSeenAt }
 */
import { io, Socket } from 'socket.io-client';

export interface ChatMessage {
  id: string;
  conversationId: string;
  senderId: string;
  body: string;
  createdAt: string;
  status?: 'sending' | 'sent' | 'delivered' | 'read';
  clientId?: string;
}

export interface Presence { online: boolean; lastSeenAt?: string; typing?: boolean }

const ENCRYPTED_PREFIX = 'wae2e:v1:';
const KEY_SALT = 'web-access-chat-v1';

function bytesToBase64(bytes: Uint8Array) {
  let binary = '';
  bytes.forEach((byte) => { binary += String.fromCharCode(byte); });
  return btoa(binary);
}

function base64ToBytes(value: string) {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

async function conversationKey(conversationId: string) {
  const material = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(`${KEY_SALT}:${conversationId}`),
    'PBKDF2',
    false,
    ['deriveKey'],
  );
  return crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      hash: 'SHA-256',
      salt: new TextEncoder().encode(KEY_SALT),
      iterations: 120_000,
    },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

export function isEncryptedBody(body: string) {
  return body.startsWith(ENCRYPTED_PREFIX);
}

export async function encryptMessageBody(conversationId: string, body: string) {
  if (!body.trim() || typeof crypto === 'undefined' || !crypto.subtle) return body;
  const key = await conversationKey(conversationId);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cipher = new Uint8Array(await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    new TextEncoder().encode(body),
  ));
  return `${ENCRYPTED_PREFIX}${bytesToBase64(iv)}.${bytesToBase64(cipher)}`;
}

export async function decryptMessageBody(conversationId: string, body: string) {
  if (!isEncryptedBody(body) || typeof crypto === 'undefined' || !crypto.subtle) return body;
  try {
    const payload = body.slice(ENCRYPTED_PREFIX.length);
    const [ivPart, cipherPart] = payload.split('.');
    if (!ivPart || !cipherPart) return 'Encrypted message';
    const key = await conversationKey(conversationId);
    const plain = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: base64ToBytes(ivPart) },
      key,
      base64ToBytes(cipherPart),
    );
    return new TextDecoder().decode(plain);
  } catch {
    return 'Encrypted message';
  }
}

export async function decryptChatMessage(message: ChatMessage): Promise<ChatMessage> {
  return { ...message, body: await decryptMessageBody(message.conversationId, message.body) };
}

export class ChatClient {
  private sock: Socket;
  private listeners = {
    message:  new Set<(m: ChatMessage) => void>(),
    receipt:  new Set<(r: { messageId: string; userId: string; kind: 'delivered'|'read' }) => void>(),
    presence: new Set<(p: { userId: string } & Presence) => void>(),
    typing:   new Set<(t: { conversationId: string; userId: string; typing: boolean }) => void>(),
  };

  constructor(url: string, token: string) {
    // Connect to the dedicated `/chat` namespace so chat events don't collide
    // with the legacy host/client signaling on the default namespace.
    const base = url.replace(/\/$/, '');
    this.sock = io(`${base}/chat`, {
      auth: { token },
      transports: ['websocket'],
      withCredentials: true,
    });
    this.sock.on('message',  (m) => {
      void decryptChatMessage(m).then((message) => this.listeners.message.forEach(f => f(message)));
    });
    this.sock.on('receipt',  (r) => this.listeners.receipt.forEach(f => f(r)));
    this.sock.on('presence', (p) => this.listeners.presence.forEach(f => f(p)));
    this.sock.on('typing',   (t) => this.listeners.typing.forEach(f => f(t)));
  }

  send(conversationId: string, body: string): string {
    const clientId = (typeof crypto !== 'undefined' && crypto.randomUUID)
      ? crypto.randomUUID() : String(Date.now());
    void encryptMessageBody(conversationId, body)
      .then((encryptedBody) => this.sock.emit('send', { conversationId, body: encryptedBody, clientId }))
      .catch(() => this.sock.emit('send', { conversationId, body, clientId }));
    return clientId;
  }
  setTyping(conversationId: string, typing: boolean) {
    this.sock.emit('typing', { conversationId, typing });
  }
  markRead(conversationId: string, messageId: string) {
    this.sock.emit('read', { conversationId, messageId });
  }

  onMessage(f: (m: ChatMessage) => void)   { this.listeners.message.add(f);  return () => this.listeners.message.delete(f); }
  onReceipt(f: (r: { messageId: string; userId: string; kind: 'delivered'|'read' }) => void) {
    this.listeners.receipt.add(f);  return () => this.listeners.receipt.delete(f);
  }
  onPresence(f: (p: { userId: string } & Presence) => void) {
    this.listeners.presence.add(f); return () => this.listeners.presence.delete(f);
  }
  onTyping(f: (t: { conversationId: string; userId: string; typing: boolean }) => void) {
    this.listeners.typing.add(f); return () => this.listeners.typing.delete(f);
  }

  disconnect() { this.sock.disconnect(); }
}
