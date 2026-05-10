/**
 * A call "room" on top of mediasoup. One router per room; peers produce and
 * consume through that router. We keep the state small: identity, transports,
 * producers, consumers.
 *
 * Each room also carries light-weight state for the Teams-style UX layer:
 * presence, chat history, and "who is ringing whom".
 */
import { randomUUID } from 'node:crypto';
import { getWorker, ROUTER_MEDIA_CODECS, WEBRTC_TRANSPORT_OPTIONS } from './mediasoup-worker.js';

/** @typedef {{ id: string, name: string, userId: string|null, socketId: string, joinedAt: number,
 *             mic: boolean, cam: boolean, screen: boolean,
 *             transports: Map<string, any>, producers: Map<string, any>,
 *             consumers: Map<string, any> }} Peer */

export class CallRoom {
  constructor(id) {
    this.id = id;
    /** @type {Map<string, Peer>} */
    this.peers = new Map();
    /** @type {{ id: string, from: string, fromName: string, text: string, at: number }[]} */
    this.chat = [];
    this._router = null;
    this._closed = false;
  }

  async router() {
    if (!this._router) {
      const worker = await getWorker();
      this._router = await worker.createRouter({ mediaCodecs: ROUTER_MEDIA_CODECS });
    }
    return this._router;
  }

  async addPeer({ socketId, name, userId = null }) {
    const peer = {
      id: randomUUID(),
      name: String(name || 'Guest').slice(0, 40),
      userId: userId ? String(userId) : null,
      socketId,
      joinedAt: Date.now(),
      mic: true,
      cam: true,
      screen: false,
      transports: new Map(),
      producers: new Map(),
      consumers: new Map(),
    };
    this.peers.set(peer.id, peer);
    return peer;
  }

  findPeerBySocket(socketId) {
    for (const p of this.peers.values()) if (p.socketId === socketId) return p;
    return null;
  }

  /** Serialisable presence list sent to clients. */
  presence() {
    return Array.from(this.peers.values()).map((p) => ({
      id: p.id,
      name: p.name,
      userId: p.userId || null,
      mic: p.mic,
      cam: p.cam,
      screen: p.screen,
      joinedAt: p.joinedAt,
    }));
  }

  /** All *other* peers' producers — used to bootstrap a new joiner. */
  otherProducers(selfId) {
    const out = [];
    for (const p of this.peers.values()) {
      if (p.id === selfId) continue;
      for (const prod of p.producers.values()) {
        out.push({ peerId: p.id, producerId: prod.id, kind: prod.kind, appData: prod.appData });
      }
    }
    return out;
  }

  removePeer(peerId) {
    const p = this.peers.get(peerId);
    if (!p) return null;
    for (const c of p.consumers.values()) { try { c.close(); } catch { /* ignore */ } }
    for (const prod of p.producers.values()) { try { prod.close(); } catch { /* ignore */ } }
    for (const t of p.transports.values()) { try { t.close(); } catch { /* ignore */ } }
    this.peers.delete(peerId);
    return p;
  }

  async createWebRtcTransport() {
    const router = await this.router();
    const transport = await router.createWebRtcTransport(WEBRTC_TRANSPORT_OPTIONS);
    return transport;
  }

  close() {
    if (this._closed) return;
    this._closed = true;
    for (const pid of Array.from(this.peers.keys())) this.removePeer(pid);
    try { this._router?.close(); } catch { /* ignore */ }
    this._router = null;
  }
}

/**
 * Registry — rooms keyed by an opaque room id. Host is free to pick any id;
 * we recommend reusing the pairing `sessionId` so a remote-desktop session
 * and its matching call share a room by default.
 */
export class RoomRegistry {
  constructor() {
    /** @type {Map<string, CallRoom>} */
    this._rooms = new Map();
  }
  async getOrCreate(id) {
    let room = this._rooms.get(id);
    if (!room) {
      room = new CallRoom(id);
      this._rooms.set(id, room);
    }
    return room;
  }
  get(id) { return this._rooms.get(id) || null; }
  drop(id) {
    const r = this._rooms.get(id);
    if (r) { r.close(); this._rooms.delete(id); }
  }
  size() { return this._rooms.size; }
}
