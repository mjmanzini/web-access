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
    this.sock.on('message',  (m) => this.listeners.message.forEach(f => f(m)));
    this.sock.on('receipt',  (r) => this.listeners.receipt.forEach(f => f(r)));
    this.sock.on('presence', (p) => this.listeners.presence.forEach(f => f(p)));
    this.sock.on('typing',   (t) => this.listeners.typing.forEach(f => f(t)));
  }

  send(conversationId: string, body: string): string {
    const clientId = (typeof crypto !== 'undefined' && crypto.randomUUID)
      ? crypto.randomUUID() : String(Date.now());
    this.sock.emit('send', { conversationId, body, clientId });
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
