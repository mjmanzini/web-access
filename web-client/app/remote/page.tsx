'use client';

import { Suspense, useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { AppShell } from '../../components/app/AppShell';
import { api, loadStoredUser, registerOrLoginUser, type StoredUser } from '../../lib/user-session';
import { RemoteSessionView } from '../../components/remote/RemoteSessionView';

interface AnnounceResponse {
  remoteId: string;
  pin: string;
  sessionId: string;
  expiresAt: string;
}

type ModalMode = 'create' | 'join' | null;

interface VisitorIdentity {
  fullName: string;
  email: string;
}

const IDENTITY_KEY = 'wa:identity';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function validateIdentity(identity: VisitorIdentity) {
  const fullName = identity.fullName.trim();
  const email = identity.email.trim().toLowerCase();
  if (fullName.length < 2) return 'Enter your full name.';
  if (fullName.length > 80) return 'Full name must be 80 characters or less.';
  if (!EMAIL_RE.test(email)) return 'Enter a valid email address.';
  return '';
}

function validateSessionId(value: string) {
  const cleaned = value.replace(/[^a-zA-Z0-9_-]/g, '').trim();
  if (cleaned.length < 4) return 'Enter a valid Session ID.';
  if (cleaned.length > 80) return 'Session ID is too long.';
  return '';
}

function loadIdentity(): VisitorIdentity {
  if (typeof window === 'undefined') return { fullName: '', email: '' };
  try {
    const raw = localStorage.getItem(IDENTITY_KEY);
    if (!raw) return { fullName: localStorage.getItem('wa:name') || '', email: '' };
    const parsed = JSON.parse(raw) as Partial<VisitorIdentity>;
    return { fullName: parsed.fullName || '', email: parsed.email || '' };
  } catch {
    return { fullName: '', email: '' };
  }
}

function saveIdentity(identity: VisitorIdentity) {
  localStorage.setItem(IDENTITY_KEY, JSON.stringify(identity));
  localStorage.setItem('wa:name', identity.fullName);
}

function formatSessionId(value: string) {
  const clean = value.replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
  if (clean.length === 9) return clean.replace(/(.{3})(.{3})(.{3})/, '$1-$2-$3');
  if (clean.length > 9) return clean.slice(0, 12).replace(/(.{3})/g, '$1-').replace(/-$/, '');
  return clean;
}

function generateFallbackSessionId() {
  const digits = Array.from({ length: 9 }, () => Math.floor(Math.random() * 10)).join('');
  return digits.replace(/(.{3})(.{3})(.{3})/, '$1-$2-$3');
}

function RemotePageInner() {
  const router = useRouter();
  const params = useSearchParams();
  const sessionId = params.get('sessionId')?.trim() || '';
  const waitingSessionId = params.get('waitingSessionId')?.trim() || '';
  const codeParam = params.get('code')?.trim() || '';
  const [me, setMe] = useState<StoredUser | null>(null);
  const [modal, setModal] = useState<ModalMode>(null);
  const [identity, setIdentity] = useState<VisitorIdentity>({ fullName: '', email: '' });
  const [joinCode, setJoinCode] = useState(codeParam.toUpperCase());
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [waiting, setWaiting] = useState<AnnounceResponse | null>(null);
  const [copied, setCopied] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteSent, setInviteSent] = useState(false);

  useEffect(() => {
    setMe(loadStoredUser());
    setIdentity(loadIdentity());
  }, []);

  useEffect(() => {
    if (!waitingSessionId) return;
    setWaiting({
      remoteId: '',
      pin: '',
      sessionId: waitingSessionId,
      expiresAt: new Date(Date.now() + 30 * 60_000).toISOString(),
    });
  }, [waitingSessionId]);

  useEffect(() => {
    if (codeParam) {
      setJoinCode(codeParam.toUpperCase());
      setModal('join');
    }
  }, [codeParam]);

  const identityKnown = identity.fullName.trim().length > 1 && /@/.test(identity.email);
  const displaySessionId = waiting ? formatSessionId(waiting.sessionId) : '';
  const inviteLink = waiting && typeof window !== 'undefined'
    ? `${window.location.origin}/remote?sessionId=${encodeURIComponent(waiting.sessionId)}`
    : '';

  async function ensureUser() {
    const existing = loadStoredUser();
    if (existing) {
      setMe(existing);
      return existing;
    }
    const fullName = identity.fullName.trim();
    const email = identity.email.trim().toLowerCase();
    const validation = validateIdentity(identity);
    if (validation) throw new Error(validation);
    saveIdentity({ fullName, email });
    const user = await registerOrLoginUser({ fullName, email });
    setMe(user);
    return user;
  }

  async function continueToRemoteSession() {
    setErr(null);
    setBusy(true);
    try {
      await ensureUser();
    } catch (e) {
      setErr((e as Error).message || 'Could not continue.');
    } finally {
      setBusy(false);
    }
  }

  async function createSession() {
    setErr(null);
    setBusy(true);
    try {
      await ensureUser();
      const announcement = await api<AnnounceResponse>('/api/remote/announce', { method: 'POST', body: '{}' });
      setWaiting(announcement);
      setModal(null);
    } catch (e) {
      setErr((e as Error).message || 'Could not create the session.');
    } finally {
      setBusy(false);
    }
  }

  async function joinSession() {
    setErr(null);
    setBusy(true);
    try {
      await ensureUser();
      const cleaned = joinCode.replace(/[^a-zA-Z0-9_-]/g, '').trim();
      const validation = validateSessionId(joinCode);
      if (validation) throw new Error(validation);
      router.push(`/remote?sessionId=${encodeURIComponent(cleaned)}`);
    } catch (e) {
      setErr((e as Error).message || 'Could not join the session.');
      setBusy(false);
    }
  }

  const copyInvite = async () => {
    if (!inviteLink) return;
    await navigator.clipboard?.writeText(inviteLink).catch(() => {});
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  };

  const sendInvite = () => {
    if (!EMAIL_RE.test(inviteEmail.trim()) || !inviteLink) {
      setErr('Enter a valid invite email address.');
      return;
    }
    setErr(null);
    const subject = encodeURIComponent('Join my Web-Access remote session');
    const body = encodeURIComponent(`Join my secure remote session: ${inviteLink}`);
    window.location.href = `mailto:${inviteEmail.trim()}?subject=${subject}&body=${body}`;
    setInviteSent(true);
  };

  const openWaitingWindow = () => {
    if (!waiting || typeof window === 'undefined') return;
    const url = `${window.location.origin}/remote?waitingSessionId=${encodeURIComponent(waiting.sessionId)}`;
    window.open(url, 'web-access-remote-waiting', 'popup=yes,width=520,height=760');
  };

  const recentList = useMemo(() => (
    <div className="wa-session-list">
      <button className="wa-session-row active" onClick={() => setWaiting(null)}>
        <span className="wa-session-dot" />
        <span>
          <strong>Remote Desktop</strong>
          <em>{me ? `Signed in as ${me.displayName}` : 'Create or join a secure session'}</em>
        </span>
      </button>
      {waiting && (
        <button className="wa-session-row" onClick={() => setWaiting(waiting)}>
          <span className="wa-session-dot live" />
          <span>
            <strong>{displaySessionId}</strong>
            <em>Waiting room active</em>
          </span>
        </button>
      )}
    </div>
  ), [displaySessionId, me, waiting]);

  const hub = (
    <div className="wa-hub">
      <div className="wa-hub-head">
        <span className="wa-kicker">Remote Desktop</span>
        <h2>{waiting ? 'Session waiting room' : 'Start with what you need'}</h2>
        <p>
          {waiting
            ? 'Share the invite link, then start when everyone is ready.'
            : 'Create a secure session for others to join, or connect to an existing session.'}
        </p>
      </div>

      {!waiting && (
        <div className="wa-choice-grid">
          <button className="wa-action-card" onClick={() => { setErr(null); setModal('create'); }}>
            <span className="wa-action-icon create" aria-hidden="true">+</span>
            <span>
              <strong>Create New Session</strong>
              <em>Start a secure session and invite others.</em>
            </span>
          </button>
          <button className="wa-action-card" onClick={() => { setErr(null); setModal('join'); }}>
            <span className="wa-action-icon join" aria-hidden="true">→</span>
            <span>
              <strong>Join Existing Session</strong>
              <em>Enter a Session ID to connect.</em>
            </span>
          </button>
        </div>
      )}

      {waiting && (
        <section className="wa-waiting-room">
          <div className="wa-session-code">{displaySessionId}</div>
          <div className="wa-link-box" title={inviteLink}>{inviteLink}</div>
          <div className="wa-waiting-actions">
            <button className="wa-copy-btn" onClick={copyInvite}>
              <span aria-hidden="true">□</span>
              {copied ? 'Copied' : 'Copy Invite Link'}
            </button>
            <button className="wa-copy-btn" onClick={openWaitingWindow}>Open Waiting Room Window</button>
          </div>
          <div className="wa-invite-line">
            <label className="wa-floating-field">
              <input
                value={inviteEmail}
                onChange={(e) => setInviteEmail(e.target.value)}
                placeholder=" "
                type="email"
              />
              <span>Email Address</span>
            </label>
            <button className="wa-primary-btn" onClick={sendInvite} disabled={!EMAIL_RE.test(inviteEmail.trim())}>
              {inviteSent ? 'Invite Ready' : 'Send Invite'}
            </button>
          </div>
          {err && <div className="wa-form-error">{err}</div>}
          <p className="wa-helper">This secure link will expire automatically when all users leave the session.</p>
          <button className="wa-start-btn" onClick={() => router.push(`/remote?sessionId=${encodeURIComponent(waiting.sessionId)}`)}>
            Start Session
          </button>
        </section>
      )}
    </div>
  );

  if (sessionId && me) {
    return <RemoteSessionView sessionId={sessionId} />;
  }

  if (sessionId) {
    return (
      <AppShell title="Remote Desktop" subtitle="Secure support session" list={recentList}>
        <div className="wa-hub">
          <div className="wa-hub-head">
            <span className="wa-kicker">Remote invite</span>
            <h2>Confirm who is joining</h2>
            <p>Enter your full name and email. If this email already exists, we will sign you back into that account.</p>
          </div>
          <section className="wa-waiting-room">
            <div className="wa-session-code">{formatSessionId(sessionId)}</div>
            <label className="wa-floating-field">
              <input
                value={identity.fullName}
                onChange={(e) => setIdentity((current) => ({ ...current, fullName: e.target.value }))}
                placeholder=" "
                autoComplete="name"
              />
              <span>Your Full Name</span>
            </label>
            <label className="wa-floating-field">
              <input
                value={identity.email}
                onChange={(e) => setIdentity((current) => ({ ...current, email: e.target.value }))}
                placeholder=" "
                type="email"
                autoComplete="email"
              />
              <span>Email Address</span>
            </label>
            {err && <div className="wa-form-error">{err}</div>}
            <button className="wa-primary-btn" onClick={() => { void continueToRemoteSession(); }} disabled={busy}>
              {busy ? 'Checking…' : 'Join Support Session'}
            </button>
          </section>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell title="Remote Desktop" subtitle="Sessions, invites, and secure access" list={recentList}>
      {hub}
      {modal && (
        <div className="wa-modal-backdrop" role="presentation" onMouseDown={(e) => { if (e.target === e.currentTarget) setModal(null); }}>
          <section className="wa-modal" role="dialog" aria-modal="true" aria-labelledby="remote-modal-title">
            <button className="wa-modal-close" onClick={() => setModal(null)} aria-label="Close">×</button>
            <span className="wa-kicker">{modal === 'join' ? 'Join session' : 'Create session'}</span>
            <h2 id="remote-modal-title">{modal === 'join' ? 'Connect to a remote desktop' : 'Generate a new session'}</h2>

            {modal === 'join' && (
              <label className="wa-floating-field">
                <input
                  value={joinCode}
                  onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
                  placeholder=" "
                  autoCapitalize="characters"
                  autoCorrect="off"
                  spellCheck={false}
                />
                <span>Session ID</span>
              </label>
            )}

            {!identityKnown && (
              <>
                <label className="wa-floating-field">
                  <input
                    value={identity.fullName}
                    onChange={(e) => setIdentity((current) => ({ ...current, fullName: e.target.value }))}
                    placeholder=" "
                    autoComplete="name"
                  />
                  <span>Your Full Name</span>
                </label>
                <label className="wa-floating-field">
                  <input
                    value={identity.email}
                    onChange={(e) => setIdentity((current) => ({ ...current, email: e.target.value }))}
                    placeholder=" "
                    type="email"
                    autoComplete="email"
                  />
                  <span>Email Address</span>
                </label>
              </>
            )}

            {identityKnown && (
              <div className="wa-known-user">
                <strong>{identity.fullName}</strong>
                <span>{identity.email}</span>
              </div>
            )}

            {err && <div className="wa-form-error">{err}</div>}

            <button
              className="wa-primary-btn"
              onClick={() => { void (modal === 'join' ? joinSession() : createSession()); }}
              disabled={busy}
            >
              {busy ? 'Working…' : modal === 'join' ? 'Connect' : 'Generate Session'}
            </button>
          </section>
        </div>
      )}
    </AppShell>
  );
}

export default function RemoteDashPage() {
  return (
    <Suspense fallback={<div className="wa-hub"><div className="wa-list-empty">Loading…</div></div>}>
      <RemotePageInner />
    </Suspense>
  );
}
