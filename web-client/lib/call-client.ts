/**
 * Browser-to-browser WebRTC call client.
 *
 * Cloud Run is a good fit for Socket.IO signaling, but it cannot expose the
 * arbitrary UDP/TCP media port range required by mediasoup SFU transports.
 * This client keeps the existing call UI contract while sending media directly
 * between browsers over RTCPeerConnection.
 */
import type { Socket } from 'socket.io-client';
import type { ChatMessage, JoinResult, PeerInfo } from './call-protocol';

type Listener<T> = (payload: T) => void;
type ProducerKey = 'mic' | 'cam' | 'screen';

export interface RemoteTrack {
  peerId: string;
  consumer: null;
  track: MediaStreamTrack;
  kind: 'audio' | 'video';
  source: 'camera' | 'mic' | 'screen';
}

export interface CallEvents {
  remoteTrack: RemoteTrack;
  trackEnded: { peerId: string; producerId: string };
  peerJoined: PeerInfo;
  peerLeft: { peerId: string };
  peerState: { peerId: string; mic: boolean; cam: boolean; screen: boolean };
  chat: ChatMessage;
  error: Error;
  closed: void;
}

interface PeerConnectionState {
  pc: RTCPeerConnection;
  makingOffer: boolean;
  pendingCandidates: RTCIceCandidateInit[];
  remoteVideoCount: number;
}

const ICE_SERVERS: RTCIceServer[] = [
  { urls: ['stun:stun.l.google.com:19302'] },
];

export class CallClient {
  private socket: Socket;
  private connections = new Map<string, PeerConnectionState>();
  private localTracks = new Map<ProducerKey, MediaStreamTrack>();
  private listeners = new Map<keyof CallEvents, Set<Listener<unknown>>>();
  self: { id: string; name: string } | null = null;
  peers = new Map<string, PeerInfo>();

  constructor(socket: Socket) {
    this.socket = socket;
    this.bindSocket();
  }

  on<K extends keyof CallEvents>(ev: K, cb: Listener<CallEvents[K]>): () => void {
    let set = this.listeners.get(ev);
    if (!set) { set = new Set(); this.listeners.set(ev, set); }
    set.add(cb as Listener<unknown>);
    return () => set!.delete(cb as Listener<unknown>);
  }

  private emit<K extends keyof CallEvents>(ev: K, payload: CallEvents[K]) {
    this.listeners.get(ev)?.forEach((listener) => {
      try { (listener as Listener<CallEvents[K]>)(payload); } catch { /* ignore */ }
    });
  }

  private request<T = unknown>(event: string, data: unknown): Promise<T> {
    return new Promise((resolve, reject) => {
      this.socket.emit(event, data, (ack: { ok: boolean; error?: string } & Record<string, unknown>) => {
        if (!ack) return reject(new Error('no_ack'));
        if (!ack.ok) return reject(new Error(ack.error || 'error'));
        resolve(ack as unknown as T);
      });
    });
  }

  private bindSocket() {
    this.socket.on('call:peer-joined', ({ peer }: { peer: PeerInfo }) => {
      this.peers.set(peer.id, peer);
      this.emit('peerJoined', peer);
      this.ensureConnection(peer.id);
    });
    this.socket.on('call:peer-left', ({ peerId }: { peerId: string }) => {
      this.peers.delete(peerId);
      this.closeConnection(peerId);
      this.emit('peerLeft', { peerId });
    });
    this.socket.on('call:peer-state', (state: { peerId: string; mic: boolean; cam: boolean; screen: boolean }) => {
      const peer = this.peers.get(state.peerId);
      if (peer) {
        peer.mic = state.mic;
        peer.cam = state.cam;
        peer.screen = state.screen;
      }
      this.emit('peerState', state);
    });
    this.socket.on('call:p2p-signal', (signal: {
      fromPeerId: string;
      description?: RTCSessionDescriptionInit;
      candidate?: RTCIceCandidateInit;
    }) => {
      void this.handleSignal(signal).catch((err) => this.emit('error', err as Error));
    });
    this.socket.on('call:chat', ({ message }: { message: ChatMessage }) => this.emit('chat', message));
  }

  async join(roomId: string, name: string) {
    const result = await this.request<JoinResult & { ok: true }>('call:join', { roomId, name });
    this.self = result.self;
    for (const peer of result.peers) {
      this.peers.set(peer.id, peer);
      this.ensureConnection(peer.id);
    }
    return result;
  }

  async produceMic(track: MediaStreamTrack) {
    await this.addLocalTrack('mic', track);
    return { id: track.id };
  }

  async produceCam(track: MediaStreamTrack) {
    await this.addLocalTrack('cam', track);
    return { id: track.id };
  }

  async produceScreen(track: MediaStreamTrack) {
    await this.addLocalTrack('screen', track);
    return { id: track.id };
  }

  async closeProducer(key: ProducerKey) {
    const track = this.localTracks.get(key);
    if (!track) return;
    this.localTracks.delete(key);
    for (const { pc } of this.connections.values()) {
      for (const sender of pc.getSenders()) {
        if (sender.track === track) pc.removeTrack(sender);
      }
    }
    this.emit('trackEnded', { peerId: this.self?.id || 'self', producerId: track.id });
  }

  async setState(state: Partial<{ mic: boolean; cam: boolean; screen: boolean }>) {
    await this.request('call:state', state);
  }

  async sendChat(text: string) {
    await this.request('call:chat', { text });
  }

  private async addLocalTrack(key: ProducerKey, track: MediaStreamTrack) {
    this.localTracks.set(key, track);
    for (const peerId of this.peers.keys()) {
      const state = this.ensureConnection(peerId);
      if (!state.pc.getSenders().some((sender) => sender.track === track)) {
        state.pc.addTrack(track, new MediaStream([track]));
        await this.sendOffer(peerId, state);
      }
    }
  }

  private ensureConnection(peerId: string): PeerConnectionState {
    const existing = this.connections.get(peerId);
    if (existing) return existing;

    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
    const state: PeerConnectionState = {
      pc,
      makingOffer: false,
      pendingCandidates: [],
      remoteVideoCount: 0,
    };
    this.connections.set(peerId, state);

    for (const track of this.localTracks.values()) {
      pc.addTrack(track, new MediaStream([track]));
    }

    pc.onicecandidate = ({ candidate }) => {
      if (candidate) this.sendSignal(peerId, { candidate: candidate.toJSON() });
    };
    pc.onnegotiationneeded = async () => {
      try {
        await this.sendOffer(peerId, state);
      } catch (err) {
        this.emit('error', err as Error);
      }
    };
    pc.ontrack = ({ track }) => {
      const source = this.trackSourceFor(peerId, track.kind);
      this.emit('remoteTrack', {
        peerId,
        consumer: null,
        track,
        kind: track.kind as 'audio' | 'video',
        source,
      });
      track.addEventListener('ended', () => this.emit('trackEnded', { peerId, producerId: track.id }));
    };
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'failed') void pc.restartIce();
    };

    return state;
  }

  private async sendOffer(peerId: string, state: PeerConnectionState) {
    if (state.makingOffer || state.pc.signalingState !== 'stable') return;
    try {
      state.makingOffer = true;
      await state.pc.setLocalDescription();
      if (state.pc.localDescription) this.sendSignal(peerId, { description: state.pc.localDescription.toJSON() });
    } finally {
      state.makingOffer = false;
    }
  }

  private trackSourceFor(peerId: string, kind: string): RemoteTrack['source'] {
    if (kind === 'audio') return 'mic';
    const state = this.connections.get(peerId);
    const peer = this.peers.get(peerId);
    const source = peer?.screen && state && state.remoteVideoCount > 0 ? 'screen' : 'camera';
    if (state) state.remoteVideoCount += 1;
    return source;
  }

  private async handleSignal({ fromPeerId, description, candidate }: {
    fromPeerId: string;
    description?: RTCSessionDescriptionInit;
    candidate?: RTCIceCandidateInit;
  }) {
    if (!fromPeerId) return;
    const state = this.ensureConnection(fromPeerId);
    const { pc } = state;

    if (description) {
      const offerCollision = description.type === 'offer' && (state.makingOffer || pc.signalingState !== 'stable');
      const polite = this.isPolitePeer(fromPeerId);
      if (offerCollision && !polite) return;

      await pc.setRemoteDescription(description);
      for (const queued of state.pendingCandidates.splice(0)) {
        try { await pc.addIceCandidate(queued); } catch { /* ignore */ }
      }
      if (description.type === 'offer') {
        await pc.setLocalDescription();
        if (pc.localDescription) this.sendSignal(fromPeerId, { description: pc.localDescription.toJSON() });
      }
    }

    if (candidate) {
      if (pc.remoteDescription) await pc.addIceCandidate(candidate);
      else state.pendingCandidates.push(candidate);
    }
  }

  private isPolitePeer(peerId: string) {
    return String(this.self?.id || '') > String(peerId);
  }

  private sendSignal(toPeerId: string, payload: { description?: RTCSessionDescriptionInit; candidate?: RTCIceCandidateInit }) {
    this.socket.emit('call:p2p-signal', { toPeerId, ...payload });
  }

  private closeConnection(peerId: string) {
    const state = this.connections.get(peerId);
    if (!state) return;
    try { state.pc.close(); } catch { /* ignore */ }
    this.connections.delete(peerId);
  }

  async leave() {
    this.localTracks.clear();
    for (const peerId of Array.from(this.connections.keys())) this.closeConnection(peerId);
    try { await this.request('call:leave', {}); } catch { /* ignore */ }
    this.emit('closed', undefined as never);
  }
}
