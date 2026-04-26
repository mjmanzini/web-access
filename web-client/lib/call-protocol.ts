/**
 * Protocol types shared between the web-client / electron host and the
 * signaling-server. Keep these in sync with signaling-server/src/call-signaling.js.
 */

export interface CallMediaConfig {
  announcedIp: string;
  requiresDirectMediaPorts: boolean;
}

export interface PeerInfo {
  id: string;
  name: string;
  mic: boolean;
  cam: boolean;
  screen: boolean;
  joinedAt: number;
}

export interface ExistingProducerInfo {
  peerId: string;
  producerId: string;
  kind: 'audio' | 'video';
  appData?: Record<string, unknown>;
}

export interface ChatMessage {
  id: string;
  from: string;
  fromName: string;
  text: string;
  at: number;
}

export interface JoinResult {
  self: { id: string; name: string };
  rtpCapabilities: unknown;
  peers: PeerInfo[];
  existingProducers: ExistingProducerInfo[];
  chat: ChatMessage[];
  mediaConfig: CallMediaConfig;
}

export type CallKind = 'audio' | 'video' | 'screen';
