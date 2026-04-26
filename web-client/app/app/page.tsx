'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { io, Socket } from 'socket.io-client';
import {
  clearStoredUser,
  listUsers,
  loadStoredUser,
  PublicUser,
  registerUser,
  signalingUrl,
  StoredUser,
  verifyToken,
  saveStoredUser,
} from '../../lib/user-session';

type Phase = 'loading' | 'anon' | 'ready';

interface IncomingInvite {
  roomId: string;
  from: { id: string; username: string; displayName: string };
}

export default function AppHome() {
  const [phase, setPhase] = useState<Phase>('loading');
  const [me, setMe] = useState<StoredUser | null>(null);
  const [users, setUsers] = useState<PublicUser[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [invite, setInvite] = useState<IncomingInvite | null>(null);
  const [ringing, setRinging] = useState<{ toUserId: string; roomId: string } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const socketRef = useRef<Socket | null>(null);

  // --- boot: hydrate from localStorage ---------------------------------------
  useEffect(() => {
    const stored = loadStoredUser();
    if (!stored) { setPhase('anon'); return; }
    void (async () => {
      const ok = await verifyToken(stored.token);
      if (!ok) { clearStoredUser(); setPhase('anon'); return; }
      setMe(stored); setPhase('ready');
    })();
  }, []);

  // --- socket + presence -----------------------------------------------------
  useEffect(() => {
    if (phase !== 'ready' || !me) return;
    const socket = io(signalingUrl(), { transports: ['websocket', 'polling'] });
    socketRef.current = socket;

    socket.emit('user:hello', { token: me.token }, (res: { ok: boolean }) => {
      if (!res?.ok) setNotice('Could not authenticate with signaling server.');
    });
    socket.on('user:presence', ({ userId, online }: { userId: string; online: boolean }) => {
      setUsers((prev) => prev.map((u) => (u.id === userId ? { ...u, online } : u)));
    });
    socket.on('user:incoming-call', (payload: IncomingInvite) => {
      setInvite(payload);
    });
    socket.on('user:call-answered', ({ roomId, accepted, fromUserId }: { roomId: string; accepted: boolean; fromUserId: string }) => {
      setRinging((cur) => (cur && cur.toUserId === fromUserId ? null : cur));
      if (accepted) window.location.href = `/call?room=${encodeURIComponent(roomId)}`;
      else setNotice('Call was declined.');
    });
    socket.on('user:call-cancelled', () => { setInvite(null); });

    void (async () => setUsers(await listUsers()))();
    const t = setInterval(async () => setUsers(await listUsers()), 15000);
    return () => { clearInterval(t); socket.close(); socketRef.current = null; };
  }, [phase, me]);

  const onlineOthers = useMemo(() => users.filter((u) => u.id !== me?.id), [users, me]);
  const selectedUser = useMemo(() => onlineOthers.find((u) => u.id === selected) || null, [onlineOthers, selected]);

  // --- actions ---------------------------------------------------------------
  const handleRegister = useCallback(async (username: string, displayName: string) => {
    try {
      const u = await registerUser(username, displayName);
      saveStoredUser(u);
      setMe(u);
      setPhase('ready');
    } catch (e) {
      const msg = (e as Error).message;
      setNotice(msg === 'username_taken' ? 'That username is already taken.' : msg === 'invalid_username' ? 'Usernames must be 2+ chars (letters, digits, _.-).' : 'Registration failed.');
    }
  }, []);

  const handleLogout = useCallback(() => {
    clearStoredUser();
    socketRef.current?.close();
    setMe(null); setUsers([]); setSelected(null); setPhase('anon');
  }, []);

  const callUser = useCallback((target: PublicUser) => {
    if (!socketRef.current || !me) return;
    const roomId = `dm-${[me.id, target.id].sort().join('-')}-${Math.random().toString(36).slice(2, 8)}`;
    setRinging({ toUserId: target.id, roomId });
    socketRef.current.emit('user:call', { toUserId: target.id, roomId }, (res: { ok: boolean; error?: string; roomId?: string }) => {
      if (!res?.ok) {
        setRinging(null);
        setNotice(res?.error === 'user_offline' ? `${target.displayName} is offline.` : 'Call could not be placed.');
      }
    });
  }, [me]);

  const cancelRing = useCallback(() => {
    if (!socketRef.current || !ringing) return;
    socketRef.current.emit('user:call-cancel', { toUserId: ringing.toUserId, roomId: ringing.roomId });
    setRinging(null);
  }, [ringing]);

  const acceptInvite = useCallback(() => {
    if (!socketRef.current || !invite) return;
    socketRef.current.emit('user:call-response', { toUserId: invite.from.id, roomId: invite.roomId, accepted: true });
    window.location.href = `/call?room=${encodeURIComponent(invite.roomId)}`;
  }, [invite]);
  const declineInvite = useCallback(() => {
    if (!socketRef.current || !invite) return;
    socketRef.current.emit('user:call-response', { toUserId: invite.from.id, roomId: invite.roomId, accepted: false });
    setInvite(null);
  }, [invite]);

  const newMeetingRoom = useCallback(() => {
    const id = `m-${Math.random().toString(36).slice(2, 10)}`;
    window.location.href = `/call?room=${encodeURIComponent(id)}`;
  }, []);

  const copyInviteLink = useCallback(async () => {
    const id = `m-${Math.random().toString(36).slice(2, 10)}`;
    const url = `${window.location.origin}/call?room=${encodeURIComponent(id)}`;
    await navigator.clipboard.writeText(url);
    setCopied(true); setTimeout(() => setCopied(false), 1800);
    setNotice(`Link copied · session ${id}`);
  }, []);

  // --- render ----------------------------------------------------------------
  if (phase === 'loading') {
    return (
      <div className="login"><div className="login-card"><div className="muted">Loading…</div></div></div>
    );
  }
  if (phase === 'anon' || !me) {
    return <RegisterScreen onSubmit={handleRegister} notice={notice} onDismissNotice={() => setNotice(null)} />;
  }

  return (
    <div className="dc-shell">
      {/* Left sidebar: guilds/servers — simple logo column for now */}
      <nav className="dc-rail" aria-label="Servers">
        <div className="dc-rail-item active" title="Direct Messages">W</div>
        <div className="dc-rail-sep" />
        <button className="dc-rail-item ghost" title="New session" onClick={newMeetingRoom}>＋</button>
      </nav>

      {/* Channel/contacts column */}
      <aside className="dc-side">
        <div className="dc-side-head">
          <div className="dc-section-title">Direct Messages</div>
          <button className="btn-ghost" onClick={copyInviteLink} title="Copy a public session link">{copied ? '✓ Copied' : '🔗 Invite'}</button>
        </div>
        <div className="dc-search">
          <input className="text-input" placeholder="Find or start a conversation" onChange={() => { /* client-side filter hook */ }} />
        </div>
        <ul className="dc-user-list">
          {onlineOthers.length === 0 && (
            <li className="muted" style={{ padding: 12 }}>No other users yet. Share a session link.</li>
          )}
          {onlineOthers.map((u) => (
            <li key={u.id}>
              <button className={`dc-user ${selected === u.id ? 'selected' : ''}`} onClick={() => setSelected(u.id)}>
                <span className="dc-avatar"><span>{initials(u.displayName)}</span><span className={`dc-presence ${u.online ? 'online' : 'offline'}`} /></span>
                <span className="dc-user-names">
                  <span className="dc-user-display">{u.displayName}</span>
                  <span className="dc-user-handle">@{u.username}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>

        <div className="dc-me">
          <span className="dc-avatar"><span>{initials(me.displayName)}</span><span className="dc-presence online" /></span>
          <span className="dc-user-names">
            <span className="dc-user-display">{me.displayName}</span>
            <span className="dc-user-handle">@{me.username}</span>
          </span>
          <button className="btn-ghost" onClick={handleLogout} title="Sign out">⎋</button>
        </div>
      </aside>

      {/* Main pane */}
      <main className="dc-main">
        {selectedUser ? (
          <ConversationPane user={selectedUser} onCall={() => callUser(selectedUser)} />
        ) : (
          <EmptyPane onNewMeeting={newMeetingRoom} onCopyInvite={copyInviteLink} copied={copied} />
        )}
      </main>

      {/* Outgoing ringing modal */}
      {ringing && (
        <div className="ring-modal">
          <div className="ring-card">
            <div className="ring-avatar">📞</div>
            <h3>Ringing…</h3>
            <div className="muted">Waiting for the other party to answer</div>
            <div className="ring-buttons">
              <button className="btn-secondary" onClick={cancelRing}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      {/* Incoming call modal */}
      {invite && (
        <div className="ring-modal">
          <div className="ring-card">
            <div className="ring-avatar">📞</div>
            <h3>{invite.from.displayName} is calling</h3>
            <div className="muted">@{invite.from.username} · Session {invite.roomId}</div>
            <div className="ring-buttons">
              <button className="btn-primary" onClick={acceptInvite}>Accept</button>
              <button className="btn-secondary" onClick={declineInvite}>Decline</button>
            </div>
          </div>
        </div>
      )}

      {/* Transient notice */}
      {notice && (
        <div className="dc-toast" onClick={() => setNotice(null)}>{notice}</div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
function RegisterScreen({ onSubmit, notice, onDismissNotice }: { onSubmit: (u: string, d: string) => void; notice: string | null; onDismissNotice: () => void; }) {
  const [username, setUsername] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <div className="login">
      <div className="login-card">
        <div className="brand">
          <div className="brand-mark">W</div>
          <div className="brand-name">Web-Access <span className="dim">· Accounts</span></div>
        </div>
        <h1>Create your handle</h1>
        <div className="login-sub">Pick a unique username and a display name. No password — we save a private token in this browser so you stay signed in.</div>
        <label className="field-label">Username</label>
        <input className="text-input" value={username} onChange={(e) => setUsername(e.target.value)} placeholder="jane" autoFocus />
        <label className="field-label">Display name</label>
        <input className="text-input" value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder="Jane Doe" />
        <div className="row-gap">
          <button
            className="btn-primary btn-block"
            disabled={busy || username.trim().length < 2}
            onClick={async () => { setBusy(true); try { await onSubmit(username.trim(), displayName.trim() || username.trim()); } finally { setBusy(false); } }}
          >{busy ? 'Creating…' : 'Create account'}</button>
        </div>
        {notice && <div className="status-line" onClick={onDismissNotice}><span className="status-dot err" /><span>{notice}</span></div>}
        <div className="muted-2" style={{ marginTop: 12 }}>Already have a link? Just open it — you can join a meeting without registering.</div>
      </div>
    </div>
  );
}

function ConversationPane({ user, onCall }: { user: PublicUser; onCall: () => void }) {
  return (
    <div className="dc-convo">
      <header className="dc-convo-head">
        <span className="dc-avatar big"><span>{initials(user.displayName)}</span><span className={`dc-presence ${user.online ? 'online' : 'offline'}`} /></span>
        <div>
          <div className="dc-convo-name">{user.displayName}</div>
          <div className="dc-user-handle">@{user.username} · {user.online ? 'Online' : 'Offline'}</div>
        </div>
        <div className="dc-convo-actions">
          <button className="btn-primary" onClick={onCall} disabled={!user.online} title={user.online ? 'Start a call' : 'User is offline'}>📞 Call</button>
        </div>
      </header>
      <div className="dc-convo-body">
        <div className="dc-placeholder">
          <div className="avatar big">{initials(user.displayName)}</div>
          <h2>This is the beginning of your conversation with {user.displayName}</h2>
          <div className="muted">Tap <strong>Call</strong> to start an audio &amp; video chat. Chat messages are available once you&apos;re in the call.</div>
        </div>
      </div>
    </div>
  );
}

function EmptyPane({ onNewMeeting, onCopyInvite, copied }: { onNewMeeting: () => void; onCopyInvite: () => void; copied: boolean }) {
  return (
    <div className="dc-convo">
      <div className="dc-convo-body">
        <div className="dc-placeholder">
          <div className="avatar big">💬</div>
          <h2>Welcome back</h2>
          <div className="muted" style={{ maxWidth: 460, textAlign: 'center' }}>
            Pick someone from the left to start a call, or create a new session and share the link with anyone.
          </div>
          <div style={{ display: 'flex', gap: 10, marginTop: 18 }}>
            <button className="btn-primary" onClick={onNewMeeting}>🎥 Start new session</button>
            <button className="btn-secondary" onClick={onCopyInvite}>{copied ? '✓ Link copied' : '🔗 Copy session link'}</button>
          </div>
        </div>
      </div>
    </div>
  );
}

function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((s) => s[0]?.toUpperCase() || '')
    .join('') || '?';
}
