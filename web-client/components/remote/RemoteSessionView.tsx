'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { io, type Socket } from 'socket.io-client';
import { sendEncoded, useVideoInput } from '../../lib/use-video-input';
import type { ControlMessage, InputMode } from '../../lib/control-protocol';
import { signalingUrl } from '../../lib/user-session';

type Phase = 'connecting' | 'waiting-host' | 'connected' | 'error' | 'ended';

const FALLBACK_ICE: RTCIceServer[] = [{ urls: 'stun:stun.l.google.com:19302' }];

async function fetchIceServers(base: string): Promise<RTCIceServer[]> {
  try {
    const res = await fetch(`${base}/ice`, { cache: 'no-store' });
    if (!res.ok) return FALLBACK_ICE;
    const data = (await res.json()) as { iceServers?: RTCIceServer[] };
    return data.iceServers?.length ? data.iceServers : FALLBACK_ICE;
  } catch {
    return FALLBACK_ICE;
  }
}

export function RemoteSessionView({ sessionId }: { sessionId: string }) {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>('connecting');
  const [status, setStatus] = useState('Joining session…');
  const [mode, setMode] = useState<InputMode>('trackpad');
  const [streamReady, setStreamReady] = useState(false);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const socketRef = useRef<Socket | null>(null);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const controlRef = useRef<RTCDataChannel | null>(null);
  const pendingStreamRef = useRef<MediaStream | null>(null);

  const send = useCallback((msg: ControlMessage) => {
    sendEncoded(controlRef.current, msg);
  }, []);

  useVideoInput(videoRef, phase === 'connected' ? send : null, { mode });

  useEffect(() => {
    if (!sessionId) return;
    let cancelled = false;
    const base = signalingUrl();

    (async () => {
      const iceServers = await fetchIceServers(base);
      if (cancelled) return;

      const socket = io(base, { transports: ['websocket'] });
      socketRef.current = socket;
      const pc = new RTCPeerConnection({ iceServers });
      pcRef.current = pc;

      pc.ontrack = (ev) => {
        const stream = ev.streams[0];
        if (!stream) return;
        pendingStreamRef.current = stream;
        setStreamReady(true);
        setPhase('connected');
        setStatus('Connected');
      };
      pc.ondatachannel = (ev) => {
        if (ev.channel.label === 'control') controlRef.current = ev.channel;
      };
      pc.onicecandidate = (ev) => {
        if (ev.candidate) socket.emit('signal', { candidate: ev.candidate });
      };
      pc.onconnectionstatechange = () => {
        if (pc.connectionState === 'failed') {
          setPhase('error');
          setStatus('Connection failed');
        } else if (pc.connectionState === 'disconnected' || pc.connectionState === 'closed') {
          setPhase((p) => (p === 'connected' ? 'ended' : p));
        }
      };

      socket.on('connect', () => {
        socket.emit('join', { sessionId, role: 'client' }, (ack: { ok: boolean; error?: string }) => {
          if (!ack?.ok) {
            setPhase('error');
            setStatus(`Cannot join: ${ack?.error ?? 'unknown'}`);
            return;
          }
          setPhase('waiting-host');
          setStatus('Waiting for host to respond…');
        });
      });

      socket.on('peer-joined', () => {
        setStatus('Negotiating connection…');
      });
      socket.on('peer-left', () => {
        setPhase('ended');
        setStatus('The host disconnected.');
      });

      socket.on('signal', async (msg: { sdp?: RTCSessionDescriptionInit; candidate?: RTCIceCandidateInit }) => {
        try {
          if (msg.sdp) {
            await pc.setRemoteDescription(msg.sdp);
            if (msg.sdp.type === 'offer') {
              const answer = await pc.createAnswer();
              await pc.setLocalDescription(answer);
              socket.emit('signal', { sdp: answer });
            }
          } else if (msg.candidate) {
            await pc.addIceCandidate(msg.candidate).catch(() => {});
          }
        } catch (e) {
          setPhase('error');
          setStatus(`Signal error: ${(e as Error).message}`);
        }
      });
    })();

    return () => {
      cancelled = true;
      try { controlRef.current?.close(); } catch {}
      try { pcRef.current?.close(); } catch {}
      try { socketRef.current?.disconnect(); } catch {}
    };
  }, [sessionId]);

  useEffect(() => {
    if (!streamReady) return;
    const video = videoRef.current;
    const stream = pendingStreamRef.current;
    if (!video || !stream) return;
    video.srcObject = stream;
    video.muted = true;
    video.play().catch(() => {});
  }, [streamReady]);

  const endSession = useCallback(() => {
    try { socketRef.current?.disconnect(); } catch {}
    try { pcRef.current?.close(); } catch {}
    router.replace('/remote');
  }, [router]);

  const overlay = useMemo(() => {
    if (phase === 'connected') return null;
    return (
      <div style={{
        position: 'absolute', inset: 0, display: 'grid', placeItems: 'center',
        background: 'rgba(11,20,26,.85)', color: 'var(--wa-text)',
        fontFamily: 'inherit', textAlign: 'center', padding: 24,
      }}>
        <div>
          <div style={{ fontSize: 18, fontWeight: 500, marginBottom: 8 }}>{status}</div>
          <div style={{ color: 'var(--wa-muted)', fontSize: 13 }}>
            Session <code>{sessionId.slice(0, 8)}…</code>
          </div>
          {(phase === 'waiting-host' || phase === 'error' || phase === 'ended') && (
            <button className="btn-primary" style={{ marginTop: 18, maxWidth: 240, pointerEvents: 'auto' }} onClick={endSession}>
              Back to dashboard
            </button>
          )}
        </div>
      </div>
    );
  }, [endSession, phase, sessionId, status]);

  return (
    <div style={{ position: 'fixed', inset: 0, background: '#000', overflow: 'hidden' }}>
      <video
        ref={videoRef}
        playsInline
        autoPlay
        style={{
          position: 'absolute', inset: 0, width: '100%', height: '100%',
          objectFit: 'contain', background: '#000',
          touchAction: 'none', userSelect: 'none',
        }}
      />
      <div style={{
        position: 'absolute', top: 12, left: 12, right: 12,
        display: 'flex', gap: 8, alignItems: 'center',
        zIndex: 2, pointerEvents: 'auto',
      }}>
        <button onClick={endSession} style={{
          background: 'rgba(0,0,0,.55)', color: '#fff',
          padding: '8px 14px', borderRadius: 8, fontSize: 13,
          backdropFilter: 'blur(8px)',
        }}>← Disconnect</button>
        <div style={{ flex: 1 }} />
        <div style={{
          background: 'rgba(0,0,0,.55)', color: '#fff', padding: '6px 12px',
          borderRadius: 8, fontSize: 12, backdropFilter: 'blur(8px)',
        }}>
          {phase === 'connected' ? '● Live' : status}
        </div>
        <button
          onClick={() => setMode((current) => (current === 'trackpad' ? 'touch' : 'trackpad'))}
          style={{
            background: 'rgba(0,0,0,.55)', color: '#fff',
            padding: '8px 14px', borderRadius: 8, fontSize: 13,
            backdropFilter: 'blur(8px)',
          }}
          title="Toggle input mode"
          aria-label="Toggle input mode"
        >
          {mode === 'trackpad' ? 'Trackpad' : 'Touch'}
        </button>
      </div>
      {overlay}
    </div>
  );
}