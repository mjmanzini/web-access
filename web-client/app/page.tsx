'use client';

import { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { io, type Socket } from 'socket.io-client';
import type { ControlMessage, InputMode } from '../lib/control-protocol';
import { sendEncoded, useVideoInput, type Transform } from '../lib/use-video-input';
import { VirtualKeys } from '../lib/virtual-keys';

/**
 * Default the signaling URL to the same origin/host the page was served from,
 * just on port 4000. This means when the phone loads http(s)://<LAN-IP>:3000
 * it automatically talks to port 4000 on the same host with the matching
 * protocol — no per-device config needed.
 */
function defaultSignalingUrl(): string {
  if (typeof window !== 'undefined') {
    const { protocol, hostname, host, port } = window.location;
    if (port === '3000' || port === '3001') return `${protocol}//${hostname}:4000`;
    return `${protocol}//${host}`;
  }
  return 'http://localhost:4000';
}
const SIGNALING_URL = process.env.NEXT_PUBLIC_SIGNALING_URL || defaultSignalingUrl();
const FALLBACK_ICE: RTCIceServer[] = [{ urls: 'stun:stun.l.google.com:19302' }];

async function fetchIceServers(): Promise<RTCIceServer[]> {
  try {
    const res = await fetch(`${SIGNALING_URL}/ice`, { cache: 'no-store' });
    if (!res.ok) throw new Error(`ice http ${res.status}`);
    const data = (await res.json()) as { iceServers?: RTCIceServer[] };
    if (Array.isArray(data.iceServers) && data.iceServers.length) return data.iceServers;
  } catch (err) {
    console.warn('[client] /ice fetch failed, using fallback STUN', err);
  }
  return FALLBACK_ICE;
}

type Phase = 'enter-code' | 'connecting' | 'connected' | 'error';

function ViewerInner() {
  const params = useSearchParams();
  const [code, setCode] = useState((params.get('code') || '').toUpperCase());
  const [phase, setPhase] = useState<Phase>('enter-code');
  const [status, setStatus] = useState('Ready to connect');
  const [mode, setMode] = useState<InputMode>('trackpad');
  const [showKeys, setShowKeys] = useState(false);
  const [showDebug, setShowDebug] = useState(false);
  const [sticky, setSticky] = useState<Record<string, boolean>>({});
  const [transform, setTransform] = useState<Transform>({ scale: 1, tx: 0, ty: 0 });
  const [quality, setQuality] = useState<'low' | 'medium' | 'high'>('high');
  const [log, setLog] = useState<string[]>([]);
  const [toolbarVisible, setToolbarVisible] = useState(true);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const socketRef = useRef<Socket | null>(null);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const controlRef = useRef<RTCDataChannel | null>(null);
  const typeInputRef = useRef<HTMLInputElement | null>(null);
  const pendingStreamRef = useRef<MediaStream | null>(null);
  const toolbarHideTimer = useRef<number | null>(null);
  const [streamReady, setStreamReady] = useState(false);

  const addLog = useCallback((line: string) => {
    // eslint-disable-next-line no-console
    console.log('[client]', line);
    setLog((prev) => [...prev.slice(-50), `${new Date().toLocaleTimeString()} ${line}`]);
  }, []);

  const send = useCallback((msg: ControlMessage) => {
    sendEncoded(controlRef.current, msg);
  }, []);

  const showToolbar = useCallback(() => {
    setToolbarVisible(true);
    if (toolbarHideTimer.current) window.clearTimeout(toolbarHideTimer.current);
    toolbarHideTimer.current = window.setTimeout(() => setToolbarVisible(false), 3200);
  }, []);

  useVideoInput(videoRef, phase === 'connected' ? send : null, {
    mode,
    onTransformChange: setTransform,
    onActivity: showToolbar,
  });

  useEffect(() => {
    if (params.get('code') && phase === 'enter-code') {
      void join((params.get('code') || '').toUpperCase());
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function join(pairCode: string) {
    if (!pairCode || pairCode.length < 4) {
      setStatus('Enter a pairing code');
      return;
    }
    setPhase('connecting');
    setStatus('Resolving code…');
    addLog(`join: resolving ${pairCode} at ${SIGNALING_URL}`);
    try {
      const res = await fetch(`${SIGNALING_URL}/pair/resolve/${pairCode}`);
      addLog(`resolve status=${res.status}`);
      if (!res.ok) throw new Error('Invalid or expired code');
      const { sessionId } = await res.json();
      addLog(`resolved sessionId=${sessionId.slice(0, 8)}…`);
      await connect(sessionId);
    } catch (err) {
      addLog(`join error: ${(err as Error).message}`);
      setPhase('error');
      setStatus((err as Error).message);
    }
  }

  async function connect(sessionId: string) {
    setStatus('Connecting to signaling…');
    addLog('fetching /ice');
    const iceServers = await fetchIceServers();
    addLog(`ice servers: ${iceServers.length}`);
    addLog(`opening socket to ${SIGNALING_URL}`);
    const socket = io(SIGNALING_URL, { transports: ['websocket'] });
    socketRef.current = socket;

    const pc = new RTCPeerConnection({ iceServers });
    pcRef.current = pc;

    pc.ontrack = (ev) => {
      addLog(`ontrack fired (streams=${ev.streams.length})`);
      const stream = ev.streams[0];
      if (!stream) return;
      pendingStreamRef.current = stream;
      setStreamReady(true);
      setPhase('connected');
      setStatus('Connected');
      showToolbar();
    };
    pc.ondatachannel = (ev) => {
      if (ev.channel.label === 'control') {
        controlRef.current = ev.channel;
        ev.channel.onopen = () => addLog('control channel open');
      }
    };
    pc.onicecandidate = (ev) => {
      if (ev.candidate) socket.emit('signal', { candidate: ev.candidate });
    };
    pc.oniceconnectionstatechange = () => addLog(`ice: ${pc.iceConnectionState}`);
    pc.onconnectionstatechange = () => {
      addLog(`pc: ${pc.connectionState}`);
      if (pc.connectionState === 'connected') setStatus('Connected');
      else if (pc.connectionState === 'failed') {
        setPhase('error');
        setStatus('Connection failed');
      }
    };

    socket.on('connect', () => {
      addLog(`socket connected id=${socket.id}`);
      socket.emit('join', { sessionId, role: 'client' }, (ack: { ok: boolean; error?: string }) => {
        addLog(`join ack: ${JSON.stringify(ack)}`);
        if (!ack?.ok) {
          setPhase('error');
          setStatus(`Join failed: ${ack?.error}`);
        } else {
          setStatus('Waiting for host…');
        }
      });
    });
    socket.on('connect_error', (e: Error) => addLog(`socket connect_error: ${e.message}`));

    socket.on('signal', async (msg: { sdp?: RTCSessionDescriptionInit; candidate?: RTCIceCandidateInit }) => {
      if (msg.sdp) {
        addLog(`recv sdp ${msg.sdp.type}`);
        await pc.setRemoteDescription(msg.sdp);
        if (msg.sdp.type === 'offer') {
          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);
          socket.emit('signal', { sdp: pc.localDescription });
          addLog('sent answer');
        }
      } else if (msg.candidate) {
        try {
          await pc.addIceCandidate(msg.candidate);
        } catch (err) {
          addLog(`addIceCandidate err: ${(err as Error).message}`);
        }
      }
    });

    socket.on('peer-left', () => {
      addLog('peer-left');
      setStatus('Host disconnected');
    });
    socket.on('disconnect', (reason: string) => {
      addLog(`socket disconnect: ${reason}`);
      setStatus('Signaling disconnected');
    });
  }

  function disconnect() {
    try { controlRef.current?.close(); } catch { /* ignore */ }
    try { pcRef.current?.close(); } catch { /* ignore */ }
    try { socketRef.current?.close(); } catch { /* ignore */ }
    controlRef.current = null;
    pcRef.current = null;
    socketRef.current = null;
    pendingStreamRef.current = null;
    setStreamReady(false);
    setTransform({ scale: 1, tx: 0, ty: 0 });
    setSticky({});
    setShowKeys(false);
    setPhase('enter-code');
    setStatus('Disconnected');
  }

  const toggleSticky = (k: string) => setSticky((prev) => ({ ...prev, [k]: !prev[k] }));

  const cycleQuality = () => {
    const next = quality === 'high' ? 'medium' : quality === 'medium' ? 'low' : 'high';
    setQuality(next);
    send({ t: 'quality', level: next });
  };

  const openTyping = () => {
    setTimeout(() => typeInputRef.current?.focus(), 0);
  };

  const onTypingKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    const keyMap: Record<string, string> = {
      Backspace: 'backspace', Enter: 'enter', Tab: 'tab', Escape: 'esc',
      ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right',
    };
    const mapped = keyMap[e.key];
    if (mapped) { e.preventDefault(); send({ t: 'key', key: mapped, action: 'tap' }); }
  };
  const onTypingChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const text = e.target.value;
    if (text.length) { send({ t: 'text', text }); e.target.value = ''; }
  };

  // Auto-downgrade to 'low' on mobile cellular connections when we first connect.
  useEffect(() => {
    if (phase !== 'connected') return;
    const nav = navigator as Navigator & { connection?: { effectiveType?: string; saveData?: boolean } };
    const conn = nav.connection;
    if (conn?.saveData || conn?.effectiveType === '2g' || conn?.effectiveType === '3g') {
      setQuality('low');
      send({ t: 'quality', level: 'low' });
    }
  }, [phase, send]);

  // Attach the pending MediaStream once the <video> element is mounted.
  useEffect(() => {
    if (!streamReady) return;
    const v = videoRef.current;
    const stream = pendingStreamRef.current;
    if (!v || !stream) return;
    v.srcObject = stream;
    v.play().catch((err) => addLog(`video.play() failed: ${(err as Error).message}`));
  }, [streamReady, addLog]);

  // Auto-hide toolbar after entering connected state.
  useEffect(() => {
    if (phase === 'connected') showToolbar();
  }, [phase, showToolbar]);

  const clickButton = (button: 'left' | 'right' | 'middle') => () => {
    send({ t: 'click', button });
    showToolbar();
  };

  /* ---------------------------------------------------------------------- */
  /* Connected (streaming) view                                              */
  /* ---------------------------------------------------------------------- */
  if (phase === 'connected') {
    const stageStyle = {
      transform: `translate(${transform.tx}px, ${transform.ty}px) scale(${transform.scale})`,
      transformOrigin: '0 0',
    } as const;
    const chipHidden = !toolbarVisible;

    return (
      <div className="stage" onClick={showToolbar}>
        <div className={`live-mode live-mode-remote ${chipHidden ? 'hidden' : ''}`}>
          <div className="live-mode-topline">
            <span className="mode-pill mode-pill-remote compact">Remote Desktop</span>
            {code && <span className="live-mode-room">Code {code}</span>}
          </div>
          <div className="live-mode-title">Desktop control is live</div>
          <div className="live-mode-status">
            <span className="status-dot ok" />
            <span>{status}</span>
            {transform.scale > 1.02 && <span style={{ opacity: 0.7 }}>· {transform.scale.toFixed(1)}×</span>}
          </div>
        </div>

        <div className="stage-inner" style={stageStyle}>
          <video ref={videoRef} autoPlay playsInline muted />
        </div>

        <div className={`controls ${toolbarVisible ? '' : 'hidden'}`} role="toolbar" aria-label="Remote controls">
          <button
            className={`ctl ${mode === 'touch' ? 'active' : ''}`}
            onClick={() => setMode((m) => (m === 'trackpad' ? 'touch' : 'trackpad'))}
            aria-pressed={mode === 'touch'}
            title="Toggle trackpad / direct-touch"
          >
            <span className="ctl-icon">{mode === 'trackpad' ? '🖱️' : '👆'}</span>
            <span className="ctl-label">{mode === 'trackpad' ? 'Trackpad' : 'Touch'}</span>
          </button>
          <button className="ctl" onClick={clickButton('left')} title="Left click">
            <span className="ctl-icon">👈</span>
            <span className="ctl-label">Click</span>
          </button>
          <button className="ctl" onClick={clickButton('right')} title="Right click">
            <span className="ctl-icon">👉</span>
            <span className="ctl-label">Right</span>
          </button>

          <div className="ctl-sep" />

          <button
            className={`ctl ${showKeys ? 'active' : ''}`}
            onClick={() => { setShowKeys((v) => !v); showToolbar(); }}
            aria-pressed={showKeys}
            title="Modifier keys"
          >
            <span className="ctl-icon">⌨︎</span>
            <span className="ctl-label">Keys</span>
          </button>
          <button className="ctl" onClick={openTyping} title="Type text">
            <span className="ctl-icon">✎</span>
            <span className="ctl-label">Type</span>
          </button>

          <div className="ctl-sep" />

          <button className="ctl" onClick={cycleQuality} title="Video quality">
            <span className="ctl-icon">{quality === 'high' ? '📶' : quality === 'medium' ? '📊' : '🐢'}</span>
            <span className="ctl-label">{quality}</span>
          </button>
          <button
            className="ctl"
            onClick={() => { setTransform({ scale: 1, tx: 0, ty: 0 }); showToolbar(); }}
            disabled={transform.scale === 1 && transform.tx === 0 && transform.ty === 0}
            title="Reset zoom"
          >
            <span className="ctl-icon">⟲</span>
            <span className="ctl-label">Fit</span>
          </button>

          <div className="ctl-sep" />

          <button className="ctl danger" onClick={disconnect} title="Disconnect">
            <span className="ctl-icon">⏻</span>
            <span className="ctl-label">End</span>
          </button>
        </div>

        {showKeys && (
          <VirtualKeys send={send} sticky={sticky} onToggleSticky={toggleSticky} />
        )}

        <input
          ref={typeInputRef}
          className="typing-capture"
          onChange={onTypingChange}
          onKeyDown={onTypingKeyDown}
          autoCorrect="off"
          autoCapitalize="off"
          spellCheck={false}
        />
      </div>
    );
  }

  /* ---------------------------------------------------------------------- */
  /* Login / pairing view                                                    */
  /* ---------------------------------------------------------------------- */
  const dotClass =
    phase === 'connecting' ? 'connecting' :
    phase === 'error' ? 'err' :
    'ok';

  return (
    <div className="login login-remote">
      <div className="login-card remote-card hub-card">
        <div className="brand">
          <div className="brand-mark">W</div>
          <div className="brand-name">Web-Access <span className="dim">· Choose mode</span></div>
        </div>

        <div className="mode-pill mode-pill-remote">Choose mode</div>

        <h1>Remote or Call?</h1>
        <div className="login-sub">Enter the code once, then tap the mode you want.</div>

        <div className="hub-code-card">
          <label className="field-label">Session code</label>
          <input
            className="pair-input"
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase().trim())}
            placeholder="ABC123"
            maxLength={8}
            inputMode="text"
            autoCapitalize="characters"
            autoCorrect="off"
            spellCheck={false}
            onKeyDown={(e) => { if (e.key === 'Enter') void join(code); }}
          />
        </div>

        <div className="mode-grid visual-grid">
          <section className="mode-choice mode-choice-remote">
            <div className="mode-choice-head">
              <div className="mode-choice-icon remote">🖥️</div>
              <span className="flow-option-badge remote">Remote</span>
              <strong>Remote Desktop</strong>
            </div>
            <p className="mode-choice-copy">Control the PC</p>

            <div className="row-gap">
              <button
                className="btn-primary btn-block"
                onClick={() => join(code)}
                disabled={phase === 'connecting' || code.length < 4}
              >
                {phase === 'connecting' ? 'Connecting…' : 'Open desktop'}
              </button>
            </div>
          </section>

          <section className="mode-choice mode-choice-call">
            <div className="mode-choice-head">
              <div className="mode-choice-icon call">📞</div>
              <span className="flow-option-badge call">Call</span>
              <strong>Audio and Video</strong>
            </div>
            <p className="mode-choice-copy">Talk and share screen</p>
            <div className="mode-choice-actions">
              <a
                className="btn-secondary btn-block"
                href={code ? `/call?room=${encodeURIComponent(code)}` : '/call'}
                style={{ textDecoration: 'none', display: 'inline-flex' }}
              >
                Open call
              </a>
              <div className="mode-choice-note">{code ? `Code ${code} ready` : 'Add code to join a session fast'}</div>
            </div>
          </section>
        </div>

        <div className="flow-switch">
          <div className="flow-switch-head">More</div>
          <a
            className="flow-option"
            href="/app"
          >
            <span className="flow-option-badge remote">Hub</span>
            <span className="flow-option-copy">
              <strong>Contacts and meetings</strong>
              <span>Open the full directory.</span>
            </span>
          </a>
        </div>

        <div className="status-line">
          <span className={`status-dot ${dotClass}`} />
          <span>{status}</span>
        </div>

        <div className="row-gap" style={{ textAlign: 'right' }}>
          <button className="btn-ghost" onClick={() => setShowDebug((v) => !v)} type="button">
            {showDebug ? 'Hide diagnostics' : 'Show diagnostics'}
          </button>
        </div>
        {showDebug && (
          <div className="debug">
            <h4>Diagnostics · {SIGNALING_URL}</h4>
            <pre>{log.length ? log.join('\n') : 'No events yet.'}</pre>
          </div>
        )}
      </div>
    </div>
  );
}

export default function Page() {
  return (
    <Suspense fallback={<div className="login login-remote"><div className="login-card remote-card"><div className="muted">Loading…</div></div></div>}>
      <ViewerInner />
    </Suspense>
  );
}
