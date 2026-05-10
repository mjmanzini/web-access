/**
 * Call signaling over Socket.IO, layered on top of mediasoup.
 *
 * Event summary (client -> server, all ack'd with { ok, ... }):
 *   call:join              { roomId, name }                     -> { self, rtpCapabilities, peers, existingProducers, chat }
 *   call:leave             {}                                   -> { ok }
 *   call:create-transport  { direction: 'send'|'recv' }         -> { id, iceParameters, iceCandidates, dtlsParameters }
 *   call:connect-transport { transportId, dtlsParameters }      -> { ok }
 *   call:produce           { transportId, kind, rtpParameters, appData } -> { id }
 *   call:consume           { producerId, rtpCapabilities }      -> { id, producerId, kind, rtpParameters, appData }
 *   call:resume-consumer   { consumerId }                       -> { ok }
 *   call:close-producer    { producerId }                       -> { ok }
 *   call:state             { mic, cam, screen }                 -> { ok }    // peer-advertised status
 *   call:chat              { text }                             -> { ok, message }
 *   call:ring              { roomId, toPeerId? }                -> { ok }    // incoming-call notification
 *   call:ring-response     { roomId, accepted }                 -> { ok }
 *   call:p2p-signal        { toPeerId, description?, candidate? } -> { ok }
 *
 * Broadcast events (server -> clients in a room):
 *   call:peer-joined     { peer }
 *   call:peer-left       { peerId }
 *   call:new-producer    { peerId, producerId, kind, appData }
 *   call:producer-closed { peerId, producerId }
 *   call:peer-state      { peerId, mic, cam, screen }
 *   call:chat            { message }
 *   call:ring            { fromPeer, roomId }
 *   call:ring-response   { fromPeer, roomId, accepted }
 *   call:p2p-signal      { fromPeerId, description?, candidate? }
 */
import { RoomRegistry } from './mediasoup-room.js';
import { ANNOUNCED_IP } from './mediasoup-worker.js';
import {
  upsertCallRoom,
  recordParticipantJoin,
  recordParticipantLeave,
  markRoomEnded,
  saveChatMessage,
  logEvent,
} from './db.js';

const rooms = new RoomRegistry();
const CHAT_HISTORY = 50;

function wrap(handler) {
  return async (payload, ack) => {
    try {
      const result = await handler(payload || {});
      ack?.({ ok: true, ...(result || {}) });
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn('[call]', err);
      ack?.({ ok: false, error: err?.message || 'internal_error' });
    }
  };
}

export function attachCallSignaling(io) {
  io.on('connection', (socket) => {
    /** @type {{ roomId: string, peerId: string, participantRowId: number|null } | null} */
    let membership = null;

    async function broadcast(ev, payload) {
      if (!membership) return;
      socket.to(`call:${membership.roomId}`).emit(ev, payload);
    }

    socket.on('call:join', wrap(async ({ roomId, name }) => {
      if (!roomId) throw new Error('roomId required');
      if (membership) throw new Error('already in a call');
      const room = await rooms.getOrCreate(String(roomId));
      const peer = await room.addPeer({ socketId: socket.id, name });
      await upsertCallRoom(room.id).catch(() => {});
      const participantRowId = await recordParticipantJoin(room.id, { peerId: peer.id, name: peer.name }).catch(() => null);
      membership = { roomId: room.id, peerId: peer.id, participantRowId };
      socket.join(`call:${room.id}`);
      logEvent('call_join', { roomId: room.id, payload: { peerId: peer.id, name: peer.name } });

      socket.to(`call:${room.id}`).emit('call:peer-joined', {
        peer: { id: peer.id, name: peer.name, mic: peer.mic, cam: peer.cam, screen: peer.screen, joinedAt: peer.joinedAt },
      });

      return {
        self: { id: peer.id, name: peer.name },
        rtpCapabilities: null,
        peers: room.presence().filter((p) => p.id !== peer.id),
        existingProducers: [],
        chat: room.chat.slice(-CHAT_HISTORY),
        mediaConfig: {
          announcedIp: ANNOUNCED_IP,
          requiresDirectMediaPorts: false,
          mode: 'p2p',
        },
      };
    }));

    socket.on('call:p2p-signal', wrap(async ({ toPeerId, description, candidate }) => {
      if (!membership) throw new Error('not in a call');
      if (!toPeerId) throw new Error('toPeerId required');
      const room = rooms.get(membership.roomId);
      const target = room?.peers.get(String(toPeerId));
      if (!room || !target) throw new Error('peer_missing');
      io.to(target.socketId).emit('call:p2p-signal', {
        fromPeerId: membership.peerId,
        description: description || null,
        candidate: candidate || null,
      });
      return {};
    }));

    socket.on('call:create-transport', wrap(async ({ direction }) => {
      if (!membership) throw new Error('not in a call');
      const room = rooms.get(membership.roomId);
      const peer = room?.peers.get(membership.peerId);
      if (!room || !peer) throw new Error('peer_missing');
      if (direction !== 'send' && direction !== 'recv') throw new Error('bad_direction');
      const transport = await room.createWebRtcTransport();
      transport.appData = { ...(transport.appData || {}), direction };
      peer.transports.set(transport.id, transport);
      transport.on('dtlsstatechange', (state) => {
        if (state === 'closed') peer.transports.delete(transport.id);
      });
      return {
        id: transport.id,
        iceParameters: transport.iceParameters,
        iceCandidates: transport.iceCandidates,
        dtlsParameters: transport.dtlsParameters,
      };
    }));

    socket.on('call:connect-transport', wrap(async ({ transportId, dtlsParameters }) => {
      if (!membership) throw new Error('not in a call');
      const room = rooms.get(membership.roomId);
      const peer = room?.peers.get(membership.peerId);
      const t = peer?.transports.get(transportId);
      if (!t) throw new Error('transport_missing');
      await t.connect({ dtlsParameters });
      return {};
    }));

    socket.on('call:produce', wrap(async ({ transportId, kind, rtpParameters, appData }) => {
      if (!membership) throw new Error('not in a call');
      const room = rooms.get(membership.roomId);
      const peer = room?.peers.get(membership.peerId);
      const t = peer?.transports.get(transportId);
      if (!t) throw new Error('transport_missing');
      const producer = await t.produce({ kind, rtpParameters, appData: appData || {} });
      peer.producers.set(producer.id, producer);
      producer.on('transportclose', () => peer.producers.delete(producer.id));
      socket.to(`call:${room.id}`).emit('call:new-producer', {
        peerId: peer.id,
        producerId: producer.id,
        kind: producer.kind,
        appData: producer.appData,
      });
      return { id: producer.id };
    }));

    socket.on('call:consume', wrap(async ({ producerId, rtpCapabilities }) => {
      if (!membership) throw new Error('not in a call');
      const room = rooms.get(membership.roomId);
      const peer = room?.peers.get(membership.peerId);
      if (!room || !peer) throw new Error('peer_missing');
      const router = await room.router();
      if (!router.canConsume({ producerId, rtpCapabilities })) throw new Error('cannot_consume');
      // Use any recv transport the peer has already created.
      const recvTransport = Array.from(peer.transports.values()).find((t) => t.appData?.direction === 'recv')
        || Array.from(peer.transports.values())[0];
      if (!recvTransport) throw new Error('no_recv_transport');
      const consumer = await recvTransport.consume({
        producerId, rtpCapabilities, paused: true,
      });
      peer.consumers.set(consumer.id, consumer);
      consumer.on('transportclose', () => peer.consumers.delete(consumer.id));
      consumer.on('producerclose', () => {
        peer.consumers.delete(consumer.id);
        socket.emit('call:producer-closed', { peerId: findProducerOwner(room, producerId)?.id, producerId });
      });
      return {
        id: consumer.id,
        producerId,
        kind: consumer.kind,
        rtpParameters: consumer.rtpParameters,
        appData: consumer.appData,
      };
    }));

    socket.on('call:resume-consumer', wrap(async ({ consumerId }) => {
      if (!membership) throw new Error('not in a call');
      const room = rooms.get(membership.roomId);
      const peer = room?.peers.get(membership.peerId);
      const c = peer?.consumers.get(consumerId);
      if (!c) throw new Error('consumer_missing');
      await c.resume();
      return {};
    }));

    socket.on('call:close-producer', wrap(async ({ producerId }) => {
      if (!membership) throw new Error('not in a call');
      const room = rooms.get(membership.roomId);
      const peer = room?.peers.get(membership.peerId);
      const p = peer?.producers.get(producerId);
      if (!p) throw new Error('producer_missing');
      p.close();
      peer.producers.delete(producerId);
      socket.to(`call:${room.id}`).emit('call:producer-closed', { peerId: peer.id, producerId });
      return {};
    }));

    socket.on('call:state', wrap(async ({ mic, cam, screen }) => {
      if (!membership) throw new Error('not in a call');
      const room = rooms.get(membership.roomId);
      const peer = room?.peers.get(membership.peerId);
      if (!peer) throw new Error('peer_missing');
      if (typeof mic === 'boolean') peer.mic = mic;
      if (typeof cam === 'boolean') peer.cam = cam;
      if (typeof screen === 'boolean') peer.screen = screen;
      socket.to(`call:${room.id}`).emit('call:peer-state', {
        peerId: peer.id, mic: peer.mic, cam: peer.cam, screen: peer.screen,
      });
      return {};
    }));

    socket.on('call:chat', wrap(async ({ text }) => {
      if (!membership) throw new Error('not in a call');
      const room = rooms.get(membership.roomId);
      const peer = room?.peers.get(membership.peerId);
      if (!peer) throw new Error('peer_missing');
      const clean = String(text || '').slice(0, 2000).trim();
      if (!clean) throw new Error('empty');
      const message = {
        id: Math.random().toString(36).slice(2, 10),
        from: peer.id, fromName: peer.name, text: clean, at: Date.now(),
      };
      room.chat.push(message);
      if (room.chat.length > CHAT_HISTORY * 2) room.chat.splice(0, room.chat.length - CHAT_HISTORY);
      saveChatMessage(room.id, { fromPeer: peer.id, fromName: peer.name, text: clean }).catch(() => {});
      io.to(`call:${room.id}`).emit('call:chat', { message });
      return { message };
    }));

    socket.on('call:ring', wrap(async ({ roomId, toPeerId }) => {
      if (!roomId) throw new Error('roomId required');
      const targetRoom = `call:${roomId}`;
      io.to(targetRoom).emit('call:ring', { fromPeer: membership?.peerId || null, roomId, toPeerId: toPeerId || null });
      return {};
    }));

    socket.on('call:ring-response', wrap(async ({ roomId, accepted }) => {
      if (!roomId) throw new Error('roomId required');
      io.to(`call:${roomId}`).emit('call:ring-response', {
        fromPeer: membership?.peerId || null, roomId, accepted: !!accepted,
      });
      return {};
    }));

    socket.on('call:leave', wrap(async () => {
      await cleanup();
      return {};
    }));

    socket.on('disconnect', () => { void cleanup(); });

    async function cleanup() {
      if (!membership) return;
      const { roomId, peerId, participantRowId } = membership;
      const room = rooms.get(roomId);
      if (room) {
        room.removePeer(peerId);
        socket.to(`call:${roomId}`).emit('call:peer-left', { peerId });
        if (room.peers.size === 0) {
          rooms.drop(roomId);
          markRoomEnded(roomId).catch(() => {});
        }
      }
      recordParticipantLeave(participantRowId).catch(() => {});
      logEvent('call_leave', { roomId, payload: { peerId } });
      membership = null;
    }
  });
}

function findProducerOwner(room, producerId) {
  for (const p of room.peers.values()) {
    if (p.producers.has(producerId)) return p;
  }
  return null;
}
