import { randomBytes, randomUUID } from 'node:crypto';

const CODE_TTL_MS = 5 * 60 * 1000; // 5 minutes to pair
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O/1/I
const CODE_LENGTH = 6;

function generateCode() {
  const bytes = randomBytes(CODE_LENGTH);
  let out = '';
  for (let i = 0; i < CODE_LENGTH; i++) {
    out += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length];
  }
  return out;
}

/**
 * Tracks short-lived pairing codes that map phone -> host session.
 * A session = one Host peer + (eventually) one Client peer in a signaling room.
 */
export class PairingRegistry {
  constructor() {
    this._byCode = new Map(); // code -> { sessionId, expiresAt }
    this._sessions = new Map(); // sessionId -> { hostSocketId, clientSocketId, createdAt }
  }

  size() {
    return this._sessions.size;
  }

  create() {
    let code;
    // Avoid the astronomically rare collision.
    do {
      code = generateCode();
    } while (this._byCode.has(code));

    const sessionId = randomUUID();
    const expiresAt = Date.now() + CODE_TTL_MS;
    this._byCode.set(code, { sessionId, expiresAt });
    this._sessions.set(sessionId, {
      hostSocketId: null,
      clientSocketId: null,
      createdAt: Date.now(),
    });

    setTimeout(() => {
      const entry = this._byCode.get(code);
      if (entry && entry.sessionId === sessionId) this._byCode.delete(code);
    }, CODE_TTL_MS).unref?.();

    return { code, sessionId, expiresAt };
  }

  resolve(code) {
    const entry = this._byCode.get(String(code || '').toUpperCase());
    if (!entry) return null;
    if (entry.expiresAt < Date.now()) {
      this._byCode.delete(code);
      return null;
    }
    return entry;
  }

  getSession(sessionId) {
    return this._sessions.get(sessionId) || null;
  }

  attachHost(sessionId, socketId) {
    const s = this._sessions.get(sessionId);
    if (!s) return false;
    s.hostSocketId = socketId;
    return true;
  }

  attachClient(sessionId, socketId) {
    const s = this._sessions.get(sessionId);
    if (!s) return false;
    s.clientSocketId = socketId;
    return true;
  }

  detachSocket(socketId) {
    for (const [sessionId, s] of this._sessions) {
      if (s.hostSocketId === socketId) s.hostSocketId = null;
      if (s.clientSocketId === socketId) s.clientSocketId = null;
      if (!s.hostSocketId && !s.clientSocketId) {
        this._sessions.delete(sessionId);
      }
    }
  }
}
