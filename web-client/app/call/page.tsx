'use client';

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { io, type Socket } from 'socket.io-client';
import { CallClient, type RemoteTrack } from '../../lib/call-client';
import type { CallMediaConfig, ChatMessage, PeerInfo } from '../../lib/call-protocol';

function defaultSignalingUrl(): string {
  if (typeof window !== 'undefined') {
    const { protocol, hostname, host, port } = window.location;
    if (port === '3000' || port === '3001') return `${protocol}//${hostname}:4000`;
    return `${protocol}//${host}`;
  }
  return 'http://localhost:4000';
}
const SIGNALING_URL = process.env.NEXT_PUBLIC_SIGNALING_URL || defaultSignalingUrl();

interface TrackEntry {
  peerId: string;
  source: 'camera' | 'mic' | 'screen';
  stream: MediaStream;
  kind: 'audio' | 'video';
}

function CallInner() {
  const params = useSearchParams();
  const [roomId, setRoomId] = useState((params.get('room') || params.get('code') || '').trim());
  const [name, setName] = useState(() => {
    if (typeof window !== 'undefined') return localStorage.getItem('wa:name') || '';
    return '';
  });
  const [phase, setPhase] = useState<'idle' | 'joining' | 'in-call' | 'error'>('idle');
  const [status, setStatus] = useState('');
  const [warning, setWarning] = useState('');
  const [peers, setPeers] = useState<PeerInfo[]>([]);
  const [tracks, setTracks] = useState<TrackEntry[]>([]);
  const [chat, setChat] = useState<ChatMessage[]>([]);
  const [chatOpen, setChatOpen] = useState(false);
  const [participantsOpen, setParticipantsOpen] = useState(false);
  const [mic, setMic] = useState(true);
  const [cam, setCam] = useState(true);
  const [screen, setScreen] = useState(false);
  const [incoming, setIncoming] = useState<{ roomId: string; fromPeer: string | null } | null>(null);

  const clientRef = useRef<CallClient | null>(null);
  const socketRef = useRef<Socket | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const screenStreamRef = useRef<MediaStream | null>(null);
  const selfIdRef = useRef<string | null>(null);
  const chatInputRef = useRef<HTMLInputElement | null>(null);
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [chatDraft, setChatDraft] = useState('');

  const upsertTrack = useCallback((entry: TrackEntry) => {
    setTracks((prev) => {
      // One track of the same (peer, source, kind) replaces the previous.
      const filtered = prev.filter((t) => !(t.peerId === entry.peerId && t.source === entry.source && t.kind === entry.kind));
      return [...filtered, entry];
    });
  }, []);

  const removePeerTracks = useCallback((peerId: string) => {
    setTracks((prev) => prev.filter((t) => t.peerId !== peerId));
  }, []);

  const teardown = useCallback(async () => {
    try { await clientRef.current?.leave(); } catch { /* ignore */ }
    clientRef.current = null;
    try { socketRef.current?.close(); } catch { /* ignore */ }
    socketRef.current = null;
    localStreamRef.current?.getTracks().forEach((t) => t.stop());
    screenStreamRef.current?.getTracks().forEach((t) => t.stop());
    localStreamRef.current = null;
    screenStreamRef.current = null;
    setLocalStream(null);
    setPeers([]); setTracks([]); setChat([]);
    setScreen(false);
    setWarning('');
    setPhase('idle');
  }, []);

  async function join() {
    if (!roomId) { setStatus('Enter a session code'); return; }
    setPhase('joining');
    setStatus('Connecting…');
    setWarning('');
    const displayName = name.trim() || 'Guest';
    localStorage.setItem('wa:name', displayName);
    try {
      const socket = io(SIGNALING_URL, { transports: ['websocket'] });
      socketRef.current = socket;
      await new Promise<void>((resolve, reject) => {
        socket.once('connect', () => resolve());
        socket.once('connect_error', (e) => reject(e));
      });
      const client = new CallClient(socket);
      clientRef.current = client;

      client.on('peerJoined', (p) => setPeers((prev) => [...prev.filter((x) => x.id !== p.id), p]));
      client.on('peerLeft', ({ peerId }) => {
        setPeers((prev) => prev.filter((p) => p.id !== peerId));
        removePeerTracks(peerId);
      });
      client.on('peerState', (s) => setPeers((prev) => prev.map((p) => p.id === s.peerId ? { ...p, ...s } : p)));
      client.on('chat', (m) => setChat((prev) => [...prev, m]));
      client.on('remoteTrack', ({ peerId, track, kind, source }) => {
        upsertTrack({ peerId, source, stream: new MediaStream([track]), kind });
      });
      client.on('trackEnded', () => {
        // Peer-tile removal is driven by peerLeft / peerState; no per-track action needed here.
      });

      socket.on('call:ring', (p: { roomId: string; fromPeer: string | null }) => {
        if (p.fromPeer && p.fromPeer !== selfIdRef.current) setIncoming({ roomId: p.roomId, fromPeer: p.fromPeer });
      });

      const joined = await client.join(roomId, displayName);
      selfIdRef.current = joined.self.id;
      setPeers(joined.peers);
      setChat(joined.chat);
  setWarning(buildMediaWarning(joined.mediaConfig));

      // Acquire mic+cam and start producing.
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
        video: { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 } },
      });
      localStreamRef.current = stream;
      setLocalStream(stream);
      const [audioTrack] = stream.getAudioTracks();
      const [videoTrack] = stream.getVideoTracks();
      if (audioTrack) await client.produceMic(audioTrack);
      if (videoTrack) await client.produceCam(videoTrack);

      setPhase('in-call');
      setStatus('In call');
    } catch (err) {
      setStatus((err as Error).message || 'Failed to join');
      setPhase('error');
      await teardown();
    }
  }

  async function toggleMic() {
    const next = !mic;
    setMic(next);
    const track = localStreamRef.current?.getAudioTracks()[0];
    if (track) track.enabled = next;
    await clientRef.current?.setState({ mic: next });
  }
  async function toggleCam() {
    const next = !cam;
    setCam(next);
    const track = localStreamRef.current?.getVideoTracks()[0];
    if (track) track.enabled = next;
    await clientRef.current?.setState({ cam: next });
  }
  async function toggleScreen() {
    const client = clientRef.current;
    if (!client) return;
    if (screen) {
      screenStreamRef.current?.getTracks().forEach((t) => t.stop());
      screenStreamRef.current = null;
      await client.closeProducer('screen');
      setScreen(false);
      await client.setState({ screen: false });
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 30 }, audio: false });
      screenStreamRef.current = stream;
      const [track] = stream.getVideoTracks();
      track.addEventListener('ended', () => { void toggleScreen(); });
      await client.produceScreen(track);
      setScreen(true);
      await client.setState({ screen: true });
    } catch (err) {
      setStatus(`Screen share failed: ${(err as Error).message}`);
    }
  }

  async function sendChat() {
    const text = chatDraft.trim();
    if (!text) return;
    try { await clientRef.current?.sendChat(text); setChatDraft(''); chatInputRef.current?.focus(); } catch { /* ignore */ }
  }

  function acceptIncoming() {
    if (!incoming) return;
    setRoomId(incoming.roomId);
    setIncoming(null);
    void join();
  }
  function declineIncoming() {
    if (!incoming) return;
    socketRef.current?.emit('call:ring-response', { roomId: incoming.roomId, accepted: false });
    setIncoming(null);
  }

  useEffect(() => () => { void teardown(); }, [teardown]);

  /* ---------------- render ---------------- */

  if (phase !== 'in-call') {
    return (
      <div className="login login-call">
        <div className="login-card call-card">
          <div className="brand">
            <div className="brand-mark">W</div>
            <div className="brand-name">Web-Access <span className="dim">· Call</span></div>
          </div>
          <div className="mode-pill mode-pill-call">Calling</div>
          <h1>Join a call</h1>
          <div className="login-sub">Enter the session code and your name to start an audio-video conversation.</div>

          <div className="flow-summary">
            <div className="flow-summary-title">This space is for conversation</div>
            <div className="flow-summary-copy">Best when you need voice, camera, or screen sharing with other people in the session.</div>
          </div>

          <label className="field-label">Session code</label>
          <input
            className="pair-input"
            value={roomId}
            onChange={(e) => setRoomId(e.target.value.toUpperCase().trim())}
            placeholder="ROOMID"
            maxLength={60}
            autoCapitalize="characters"
            autoCorrect="off"
            spellCheck={false}
          />

          <label className="field-label" style={{ marginTop: 12 }}>Your name</label>
          <input
            className="text-input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Alex"
            maxLength={40}
          />

          <div className="row-gap">
            <button className="btn-primary btn-block" onClick={() => void join()} disabled={phase === 'joining' || !roomId}>
              {phase === 'joining' ? 'Joining…' : 'Join call'}
            </button>
          </div>

          <div className="flow-switch">
            <div className="flow-switch-head">Need device control instead?</div>
            <a
              className="flow-option"
              href={roomId ? `/?code=${encodeURIComponent(roomId)}` : '/'}
            >
              <span className="flow-option-badge remote">Remote</span>
              <span className="flow-option-copy">
                <strong>Remote desktop control</strong>
                <span>Use the same session code to open the desktop stream and send input to the PC.</span>
              </span>
            </a>
          </div>

          <div className="status-line">
            <span className={`status-dot ${phase === 'joining' ? 'connecting' : phase === 'error' ? 'err' : 'ok'}`} />
            <span>{status || 'Ready'}</span>
          </div>
        </div>
      </div>
    );
  }

  const tiles = buildTiles(peers, tracks, selfIdRef.current, mic, cam, localStream, name || 'You');

  return (
    <div className="call">
      <header className="call-header">
        <div className="call-identity">
          <div className="brand">
            <div className="brand-mark">W</div>
            <div className="brand-name">Web-Access <span className="dim">· Call</span></div>
          </div>
          <div className="call-context">
            <span className="mode-pill mode-pill-call compact">Calling</span>
            <span className="call-room-label">Session {roomId}</span>
          </div>
        </div>
        <div className="call-meta">
          <span className="status-dot ok" />
          <span>{peers.length + 1} in call</span>
        </div>
        <button
          className="btn-ghost"
          title="Copy invite link"
          onClick={async () => {
            if (!roomId) return;
            const url = `${window.location.origin}/call?room=${encodeURIComponent(roomId)}`;
            try { await navigator.clipboard.writeText(url); } catch { /* ignore */ }
          }}
        >🔗 Copy link</button>
      </header>

      <main className="call-main">
        {warning && (
          <div className="call-warning" role="status">
            {warning}
          </div>
        )}
        <section className="tile-grid" data-count={tiles.length}>
          {tiles.map((t) => (
            <Tile
              key={t.key}
              title={t.title}
              mic={t.mic}
              cam={t.cam}
              source={t.source}
              stream={t.stream}
              mirrored={t.self && t.source === 'camera'}
              muted={t.self}
            />
          ))}
        </section>

        {chatOpen && (
          <aside className="side-panel">
            <header className="side-header">
              <strong>Chat</strong>
              <button className="btn-ghost" onClick={() => setChatOpen(false)}>Close</button>
            </header>
            <div className="chat-log">
              {chat.length === 0 && <div className="muted" style={{ padding: 16 }}>No messages yet.</div>}
              {chat.map((m) => (
                <div key={m.id} className={`chat-msg ${m.from === selfIdRef.current ? 'mine' : ''}`}>
                  <div className="chat-meta">{m.fromName} · {new Date(m.at).toLocaleTimeString()}</div>
                  <div className="chat-bubble">{m.text}</div>
                </div>
              ))}
            </div>
            <div className="chat-compose">
              <input
                ref={chatInputRef}
                className="text-input"
                value={chatDraft}
                onChange={(e) => setChatDraft(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void sendChat(); } }}
                placeholder="Say something…"
                maxLength={2000}
              />
              <button className="btn-primary" onClick={() => void sendChat()} disabled={!chatDraft.trim()}>Send</button>
            </div>
          </aside>
        )}

        {participantsOpen && (
          <aside className="side-panel">
            <header className="side-header">
              <strong>Participants ({peers.length + 1})</strong>
              <button className="btn-ghost" onClick={() => setParticipantsOpen(false)}>Close</button>
            </header>
            <ul className="participants">
              <li>
                <span className="avatar">{initials(name || 'You')}</span>
                <span className="who">{name || 'You'} <span className="dim">(you)</span></span>
                <span className="stateicons">
                  <span className={mic ? 'on' : 'off'} title="Mic">{mic ? '🎤' : '🔇'}</span>
                  <span className={cam ? 'on' : 'off'} title="Camera">{cam ? '🎥' : '📷'}</span>
                  {screen && <span className="on" title="Sharing">🖥️</span>}
                </span>
              </li>
              {peers.map((p) => (
                <li key={p.id}>
                  <span className="avatar">{initials(p.name)}</span>
                  <span className="who">{p.name}</span>
                  <span className="stateicons">
                    <span className={p.mic ? 'on' : 'off'} title="Mic">{p.mic ? '🎤' : '🔇'}</span>
                    <span className={p.cam ? 'on' : 'off'} title="Camera">{p.cam ? '🎥' : '📷'}</span>
                    {p.screen && <span className="on" title="Sharing">🖥️</span>}
                  </span>
                </li>
              ))}
            </ul>
          </aside>
        )}
      </main>

      <footer className="call-controls">
        <button className={`ctl ${!mic ? 'danger' : ''}`} onClick={() => void toggleMic()} title={mic ? 'Mute' : 'Unmute'}>
          <span className="ctl-icon">{mic ? '🎤' : '🔇'}</span>
          <span className="ctl-label">{mic ? 'Mute' : 'Unmute'}</span>
        </button>
        <button className={`ctl ${!cam ? 'danger' : ''}`} onClick={() => void toggleCam()} title={cam ? 'Stop video' : 'Start video'}>
          <span className="ctl-icon">{cam ? '🎥' : '📷'}</span>
          <span className="ctl-label">{cam ? 'Video off' : 'Video on'}</span>
        </button>
        <button className={`ctl ${screen ? 'active' : ''}`} onClick={() => void toggleScreen()} title="Share screen">
          <span className="ctl-icon">🖥️</span>
          <span className="ctl-label">{screen ? 'Stop share' : 'Share'}</span>
        </button>
        <div className="ctl-sep" />
        <button className={`ctl ${chatOpen ? 'active' : ''}`} onClick={() => { setChatOpen((v) => !v); setParticipantsOpen(false); }}>
          <span className="ctl-icon">💬</span>
          <span className="ctl-label">Chat</span>
        </button>
        <button className={`ctl ${participantsOpen ? 'active' : ''}`} onClick={() => { setParticipantsOpen((v) => !v); setChatOpen(false); }}>
          <span className="ctl-icon">👥</span>
          <span className="ctl-label">People</span>
        </button>
        <div className="ctl-sep" />
        <button className="ctl danger" onClick={() => void teardown()} title="Leave call">
          <span className="ctl-icon">⏻</span>
          <span className="ctl-label">Leave</span>
        </button>
      </footer>

      {incoming && (
        <div className="ring-modal" role="dialog" aria-modal="true">
          <div className="ring-card">
            <div className="ring-avatar">📞</div>
            <h2>Incoming call</h2>
            <div className="muted">Session {incoming.roomId}</div>
            <div className="ring-buttons">
              <button className="btn-primary" onClick={acceptIncoming}>Accept</button>
              <button className="btn-secondary" onClick={declineIncoming}>Decline</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

interface TileModel {
  key: string;
  title: string;
  mic: boolean;
  cam: boolean;
  source: 'camera' | 'mic' | 'screen';
  stream: MediaStream | null;
  self: boolean;
}

function buildTiles(peers: PeerInfo[], tracks: TrackEntry[], selfId: string | null, mic: boolean, cam: boolean, localStream: MediaStream | null, selfName: string): TileModel[] {
  const tiles: TileModel[] = [];
  // Self camera tile first.
  tiles.push({
    key: `${selfId || 'self'}:camera`,
    title: selfName,
    mic, cam,
    source: 'camera',
    stream: localStream,
    self: true,
  });
  // Per peer: one camera tile, plus a screen tile if they are sharing.
  for (const p of peers) {
    const camStream = pickStream(tracks, p.id, 'camera', 'video');
    const audioStream = pickStream(tracks, p.id, 'mic', 'audio'); // used as hidden <audio>
    tiles.push({
      key: `${p.id}:camera`,
      title: p.name,
      mic: p.mic,
      cam: p.cam,
      source: 'camera',
      stream: mergeStreams(camStream, audioStream),
      self: false,
    });
    if (p.screen) {
      const screenStream = pickStream(tracks, p.id, 'screen', 'video');
      tiles.push({
        key: `${p.id}:screen`,
        title: `${p.name} (screen)`,
        mic: p.mic, cam: p.cam,
        source: 'screen',
        stream: screenStream || null,
        self: false,
      });
    }
  }
  return tiles;
}
function pickStream(tracks: TrackEntry[], peerId: string, source: TileModel['source'], kind: 'audio' | 'video') {
  return tracks.find((t) => t.peerId === peerId && t.source === source && t.kind === kind)?.stream || null;
}
function mergeStreams(...streams: (MediaStream | null)[]) {
  const out = new MediaStream();
  let any = false;
  for (const s of streams) {
    if (!s) continue;
    for (const t of s.getTracks()) { out.addTrack(t); any = true; }
  }
  return any ? out : null;
}
function initials(name: string) {
  return name.split(/\s+/).map((x) => x[0] || '').join('').slice(0, 2).toUpperCase() || '·';
}

function buildMediaWarning(mediaConfig: CallMediaConfig | undefined) {
  if (!mediaConfig?.requiresDirectMediaPorts || !mediaConfig.announcedIp) return '';
  if (typeof window === 'undefined') return '';
  if (!isPrivateIpv4(mediaConfig.announcedIp)) return '';

  const hostname = window.location.hostname;
  if (hostname === 'localhost' || hostname === '127.0.0.1' || isPrivateIpv4(hostname)) return '';

  return `Call media is advertising private IP ${mediaConfig.announcedIp}. Camera, audio, and screen share usually fail from public URLs or Cloudflare Tunnel until the signaling server is deployed with a public MEDIASOUP_ANNOUNCED_IP and reachable media ports.`;
}

function isPrivateIpv4(host: string) {
  return /^10\./.test(host)
    || /^127\./.test(host)
    || /^192\.168\./.test(host)
    || /^169\.254\./.test(host)
    || /^172\.(1[6-9]|2\d|3[0-1])\./.test(host);
}

interface TileProps {
  title: string;
  mic: boolean;
  cam: boolean;
  source: 'camera' | 'mic' | 'screen';
  stream: MediaStream | null;
  mirrored?: boolean;
  muted?: boolean;
}
function Tile({ title, mic, cam, source, stream, mirrored, muted }: TileProps) {
  const vid = useRef<HTMLVideoElement | null>(null);
  useEffect(() => {
    const el = vid.current;
    if (!el) return;
    if (stream) {
      if (el.srcObject !== stream) {
        el.srcObject = stream;
        el.play().catch(() => { /* ignore */ });
      }
    } else if (el.srcObject) {
      el.srcObject = null;
    }
  }, [stream]);
  const showVideo = cam || source === 'screen';
  return (
    <div className={`tile ${mirrored ? 'mirror' : ''} ${source === 'screen' ? 'screen' : ''}`}>
      {showVideo && (
        <video ref={vid} autoPlay playsInline muted={!!muted} />
      )}
      {!showVideo && (
        <div className="tile-placeholder">
          <div className="avatar big">{initials(title)}</div>
        </div>
      )}
      <div className="tile-label">
        <span className="dot">{mic ? '🎤' : '🔇'}</span>
        <span>{title}</span>
      </div>
    </div>
  );
}

export default function CallPage() {
  return (
    <Suspense fallback={<div className="login login-call"><div className="login-card call-card"><div className="muted">Loading…</div></div></div>}>
      <CallInner />
    </Suspense>
  );
}
