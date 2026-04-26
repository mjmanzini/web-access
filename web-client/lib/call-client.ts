/**
 * Thin wrapper around mediasoup-client that handles the full call lifecycle:
 *   - load the Device with the router's RTP capabilities
 *   - create send + recv WebRTC transports
 *   - produce local mic/cam/screen tracks
 *   - consume remote producers (and auto-subscribe to new ones as peers join)
 *
 * Emits small events that the UI renders directly:
 *   remoteTrack / trackEnded / peerJoined / peerLeft / peerState / chat / error
 */
import { Device, types as msTypes } from 'mediasoup-client';
type Transport = msTypes.Transport;
type Producer = msTypes.Producer;
type Consumer = msTypes.Consumer;
import type { Socket } from 'socket.io-client';
import type {
  PeerInfo,
  ExistingProducerInfo,
  ChatMessage,
  JoinResult,
} from './call-protocol';

type Listener<T> = (payload: T) => void;

export interface RemoteTrack {
  peerId: string;
  consumer: Consumer;
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

export class CallClient {
  private socket: Socket;
  private device = new Device();
  private sendTransport: Transport | null = null;
  private recvTransport: Transport | null = null;
  private producers = new Map<string, Producer>();
  private consumers = new Map<string, Consumer>();
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
    this.listeners.get(ev)?.forEach((l) => { try { (l as Listener<CallEvents[K]>)(payload); } catch { /* ignore */ } });
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
    });
    this.socket.on('call:peer-left', ({ peerId }: { peerId: string }) => {
      this.peers.delete(peerId);
      this.emit('peerLeft', { peerId });
    });
    this.socket.on('call:peer-state', (s: { peerId: string; mic: boolean; cam: boolean; screen: boolean }) => {
      const p = this.peers.get(s.peerId);
      if (p) { p.mic = s.mic; p.cam = s.cam; p.screen = s.screen; }
      this.emit('peerState', s);
    });
    this.socket.on('call:new-producer', async (info: ExistingProducerInfo) => {
      try { await this.subscribeTo(info); } catch (err) { this.emit('error', err as Error); }
    });
    this.socket.on('call:producer-closed', ({ peerId, producerId }: { peerId: string; producerId: string }) => {
      this.emit('trackEnded', { peerId, producerId });
    });
    this.socket.on('call:chat', ({ message }: { message: ChatMessage }) => this.emit('chat', message));
  }

  async join(roomId: string, name: string) {
    const result = await this.request<JoinResult & { ok: true }>('call:join', { roomId, name });
    this.self = result.self;
    for (const p of result.peers) this.peers.set(p.id, p);
    // @ts-expect-error RtpCapabilities typing
    await this.device.load({ routerRtpCapabilities: result.rtpCapabilities });
    await this.createTransports();
    for (const ep of result.existingProducers) {
      try { await this.subscribeTo(ep); } catch (err) { this.emit('error', err as Error); }
    }
    return result;
  }

  private async createTransports() {
    this.sendTransport = await this.createTransport('send');
    this.recvTransport = await this.createTransport('recv');
  }

  private async createTransport(direction: 'send' | 'recv'): Promise<Transport> {
    type CreateResp = {
      id: string;
      iceParameters: unknown; iceCandidates: unknown; dtlsParameters: unknown;
    };
    const info = await this.request<CreateResp>('call:create-transport', { direction });
    const opts = {
      id: info.id,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      iceParameters: info.iceParameters as any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      iceCandidates: info.iceCandidates as any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      dtlsParameters: info.dtlsParameters as any,
    };
    const transport = direction === 'send'
      ? this.device.createSendTransport(opts)
      : this.device.createRecvTransport(opts);

    transport.on('connect', async ({ dtlsParameters }, cb, errb) => {
      try {
        await this.request('call:connect-transport', { transportId: transport.id, dtlsParameters });
        cb();
      } catch (e) { errb(e as Error); }
    });

    if (direction === 'send') {
      transport.on('produce', async ({ kind, rtpParameters, appData }, cb, errb) => {
        try {
          const { id } = await this.request<{ id: string }>('call:produce', {
            transportId: transport.id, kind, rtpParameters, appData,
          });
          cb({ id });
        } catch (e) { errb(e as Error); }
      });
    }

    return transport;
  }

  async produceMic(track: MediaStreamTrack) {
    if (!this.sendTransport) throw new Error('no_send_transport');
    const producer = await this.sendTransport.produce({
      track,
      appData: { source: 'mic' },
      codecOptions: { opusStereo: true, opusDtx: true },
    });
    this.producers.set('mic', producer);
    return producer;
  }
  async produceCam(track: MediaStreamTrack) {
    if (!this.sendTransport) throw new Error('no_send_transport');
    const producer = await this.sendTransport.produce({
      track,
      appData: { source: 'camera' },
      encodings: [
        { rid: 'r0', maxBitrate: 150_000, scaleResolutionDownBy: 4 },
        { rid: 'r1', maxBitrate: 500_000, scaleResolutionDownBy: 2 },
        { rid: 'r2', maxBitrate: 1_500_000 },
      ],
      codecOptions: { videoGoogleStartBitrate: 600 },
    });
    this.producers.set('cam', producer);
    return producer;
  }
  async produceScreen(track: MediaStreamTrack) {
    if (!this.sendTransport) throw new Error('no_send_transport');
    const producer = await this.sendTransport.produce({
      track,
      appData: { source: 'screen' },
      encodings: [{ maxBitrate: 3_000_000 }],
      codecOptions: { videoGoogleStartBitrate: 1200 },
    });
    this.producers.set('screen', producer);
    return producer;
  }

  async closeProducer(key: 'mic' | 'cam' | 'screen') {
    const p = this.producers.get(key);
    if (!p) return;
    try { p.close(); } catch { /* ignore */ }
    this.producers.delete(key);
    await this.request('call:close-producer', { producerId: p.id });
  }

  async setState(s: Partial<{ mic: boolean; cam: boolean; screen: boolean }>) {
    await this.request('call:state', s);
  }

  async sendChat(text: string) {
    await this.request('call:chat', { text });
  }

  private async subscribeTo(info: ExistingProducerInfo) {
    if (!this.recvTransport) return;
    type ConsumeResp = {
      id: string; producerId: string; kind: 'audio' | 'video';
      rtpParameters: unknown; appData: Record<string, unknown>;
    };
    const resp = await this.request<ConsumeResp>('call:consume', {
      producerId: info.producerId,
      rtpCapabilities: this.device.rtpCapabilities,
    });
    const consumer = await this.recvTransport.consume({
      id: resp.id,
      producerId: resp.producerId,
      kind: resp.kind,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      rtpParameters: resp.rtpParameters as any,
      appData: resp.appData,
    });
    this.consumers.set(consumer.id, consumer);
    await this.request('call:resume-consumer', { consumerId: consumer.id });
    const source = (resp.appData?.source as RemoteTrack['source']) || (resp.kind === 'audio' ? 'mic' : 'camera');
    this.emit('remoteTrack', {
      peerId: info.peerId,
      consumer,
      track: consumer.track,
      kind: resp.kind,
      source,
    });
    consumer.on('trackended', () => this.emit('trackEnded', { peerId: info.peerId, producerId: info.producerId }));
  }

  async leave() {
    for (const p of this.producers.values()) { try { p.close(); } catch { /* ignore */ } }
    for (const c of this.consumers.values()) { try { c.close(); } catch { /* ignore */ } }
    this.producers.clear();
    this.consumers.clear();
    try { this.sendTransport?.close(); } catch { /* ignore */ }
    try { this.recvTransport?.close(); } catch { /* ignore */ }
    this.sendTransport = null;
    this.recvTransport = null;
    try { await this.request('call:leave', {}); } catch { /* ignore */ }
    this.emit('closed', undefined as never);
  }
}
