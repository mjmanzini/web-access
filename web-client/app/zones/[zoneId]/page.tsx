'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { TopBar } from '../../../components/theme/TopBar';
import {
  KhulohClient,
  fetchZoneMessages,
  type ShoutEvent,
  type ZoneMessage,
  type TrustTier,
  type PresenceSnapshot,
} from '../../../lib/khuloh/client';
import { loadStoredUser, signalingUrl } from '../../../lib/user-session';

export default function ZoneRoomPage() {
  const params = useParams<{ zoneId: string }>();
  const zoneId = params?.zoneId as string;

  const [messages, setMessages] = useState<ZoneMessage[]>([]);
  const [shouts, setShouts]     = useState<ShoutEvent[]>([]);
  const [draft, setDraft]       = useState('');
  const [error, setError]       = useState<string | null>(null);
  const [client, setClient]     = useState<KhulohClient | null>(null);
  const [myTier, setMyTier]     = useState<TrustTier>('new');
  const [mutedSet, setMutedSet] = useState<Set<string>>(new Set());
  const [presence, setPresence] = useState<PresenceSnapshot>({ zoneId: '', count: 0, members: [] });
  const [typers, setTypers]     = useState<Map<string, { handle: string | null; expires: number }>>(new Map());
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const typingTimerRef = useRef<number | null>(null);
  const lastTypingSentRef = useRef<number>(0);

  useEffect(() => {
    if (!zoneId) return;
    const stored = loadStoredUser();
    if (!stored) { setError('Sign in to enter this Zone.'); return; }

    const c = new KhulohClient(signalingUrl(), stored.token);
    setClient(c);
    c.joinZone(zoneId);
    // Phase 8 data-lite: cut zone traffic by ~35-50%. Failure is harmless,
    // server still emits JSON events too.
    c.enableBinaryWire().catch(() => {});

    fetchZoneMessages(signalingUrl(), stored.token, zoneId)
      .then(setMessages)
      .catch((err) => setError((err as Error).message));

    const offMsg   = c.onZoneMessage((m) => { if (m.zoneId === zoneId) setMessages((prev) => [...prev, m]); });
    const offShout = c.onShout((s) => { if (s.zoneId === zoneId) setShouts((prev) => [...prev.slice(-9), s]); });
    const offMute   = c.onMute((m) => { if (m.zone_id === zoneId) setMutedSet((s) => new Set(s).add(m.target_uid)); });
    const offUnmute = c.onUnmute((m) => { if (m.zoneId === zoneId) setMutedSet((s) => { const n = new Set(s); n.delete(m.targetUid); return n; }); });
    const offPresence = c.onPresence((p) => { if (p.zoneId === zoneId) setPresence(p); });
    const offTyping = c.onTyping((t) => {
      if (t.zoneId !== zoneId) return;
      const myId = loadStoredUser()?.id;
      if (t.uid === myId) return;
      setTypers((prev) => {
        const next = new Map(prev);
        if (t.typing) next.set(t.uid, { handle: t.handle, expires: Date.now() + 4000 });
        else next.delete(t.uid);
        return next;
      });
    });

    c.myTrust().then((t) => setMyTier(t.tier)).catch(() => {});
    c.listPresence(zoneId).then((p) => setPresence(p)).catch(() => {});

    return () => {
      offMsg(); offShout(); offMute(); offUnmute(); offPresence(); offTyping();
      c.setTyping(zoneId, false);
      c.leaveZone(zoneId); c.close();
    };
  }, [zoneId]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages.length]);

  // Sweep expired typing indicators every second.
  useEffect(() => {
    const id = window.setInterval(() => {
      setTypers((prev) => {
        const now = Date.now();
        let changed = false;
        const next = new Map(prev);
        for (const [uid, v] of prev) if (v.expires < now) { next.delete(uid); changed = true; }
        return changed ? next : prev;
      });
    }, 1000);
    return () => window.clearInterval(id);
  }, []);

  function handleDraftChange(value: string) {
    setDraft(value);
    if (!client) return;
    const now = Date.now();
    // Throttle typing=true to once per 2s.
    if (value && now - lastTypingSentRef.current > 2000) {
      client.setTyping(zoneId, true);
      lastTypingSentRef.current = now;
    }
    if (typingTimerRef.current) window.clearTimeout(typingTimerRef.current);
    typingTimerRef.current = window.setTimeout(() => {
      client.setTyping(zoneId, false);
      lastTypingSentRef.current = 0;
    }, 2500);
  }

  async function send() {
    if (!client || !draft.trim()) return;
    setError(null);
    try {
      await client.sendZoneMessage(zoneId, draft);
      setDraft('');
      client.setTyping(zoneId, false);
      lastTypingSentRef.current = 0;
    } catch (err) {
      const e = err as Error & { notice?: string };
      setError(e.notice || e.message);
    }
  }

  async function shout() {
    if (!client || !draft.trim()) return;
    setError(null);
    try {
      await client.shout(zoneId, draft);
      setDraft('');
    } catch (err) {
      const e = err as Error & { notice?: string };
      setError(e.notice || e.message);
    }
  }

  async function muteUser(uid: string) {
    if (!client) return;
    try { await client.muteUserInZone(zoneId, uid, 10); }
    catch (err) { setError((err as Error).message); }
  }
  async function unmuteUser(uid: string) {
    if (!client) return;
    try { await client.unmuteUserInZone(zoneId, uid); }
    catch (err) { setError((err as Error).message); }
  }

  return (
    <main style={{ padding: 16, maxWidth: 720, margin: '0 auto', display: 'flex', flexDirection: 'column', height: '100dvh' }}>
      <TopBar />
      <Link href="/zones" style={{ marginTop: 8, fontSize: 13, opacity: 0.8 }}>← Back to Zones</Link>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', margin: '12px 0' }}>
        <h1 style={{ fontSize: 20, margin: 0 }}>Zone</h1>
        <span
          title={presence.members.map((m) => m.handle || m.uid.slice(0, 6)).join(', ')}
          style={{
            fontSize: 12, padding: '4px 8px', borderRadius: 999,
            background: 'rgba(74,222,128,0.15)', color: '#4ade80',
          }}
        >
          ● {presence.count} {presence.count === 1 ? 'online' : 'online'}
        </span>
      </div>
      {myTier === 'guardian' && (
        <p style={{ fontSize: 12, color: 'gold' }}>✨ Guardian mode — you can mute disruptive users for up to 60 minutes.</p>
      )}

      {shouts.length > 0 && (
        <section style={{ marginBottom: 8 }}>
          {shouts.slice(-3).map((s, i) => (
            <div key={i} style={{ background: '#3b1f5c', color: 'white', padding: 8, borderRadius: 8, marginBottom: 4 }}>
              📣 <strong>{s.fromHandle || s.fromId.slice(0, 6)}</strong>: {s.body}
            </div>
          ))}
        </section>
      )}

      <div
        ref={scrollRef}
        style={{
          flex: 1, overflowY: 'auto', borderRadius: 12,
          background: 'var(--surface, #111)', padding: 12, marginBottom: 8,
        }}
      >
        {messages.length === 0 ? (
          <p style={{ opacity: 0.6 }}>Quiet here. Say hi.</p>
        ) : messages.map((m) => (
          <div key={m.id} style={{ marginBottom: 8 }}>
            <div style={{ fontSize: 12, opacity: 0.6, display: 'flex', gap: 8, alignItems: 'center' }}>
              <span>{m.fromHandle || m.fromId.slice(0, 6)} · {new Date(m.ts).toLocaleTimeString()}</span>
              {myTier === 'guardian' && m.fromId !== loadStoredUser()?.id && (
                mutedSet.has(m.fromId)
                  ? <button onClick={() => unmuteUser(m.fromId)} style={{ fontSize: 11 }}>Unmute</button>
                  : <button onClick={() => muteUser(m.fromId)} style={{ fontSize: 11 }}>Mute 10m</button>
              )}
            </div>
            <div style={{ opacity: mutedSet.has(m.fromId) ? 0.4 : 1 }}>{m.body}</div>
          </div>
        ))}
      </div>

      {error && <p style={{ color: 'tomato', marginBottom: 8 }}>{error}</p>}

      {typers.size > 0 && (
        <p style={{ fontSize: 12, opacity: 0.7, margin: '0 0 6px', minHeight: 16 }}>
          {Array.from(typers.values()).slice(0, 3).map((t) => t.handle || 'someone').join(', ')}
          {typers.size === 1 ? ' is typing…' : ' are typing…'}
        </p>
      )}

      <div style={{ display: 'flex', gap: 8 }}>
        <input
          value={draft}
          onChange={(e) => handleDraftChange(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void send(); } }}
          placeholder="Say something…"
          style={{ flex: 1, padding: 10, borderRadius: 8 }}
        />
        <button onClick={send} disabled={!draft.trim()}>Send</button>
        <button onClick={shout} disabled={!draft.trim()} title="Costs 20 Vibe Points">📣 Shout</button>
      </div>
    </main>
  );
}
