'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { io, type Socket } from 'socket.io-client';
import { TopBar } from '../../components/theme/TopBar';
import { ContactList, type Contact } from '../../components/chat/ContactList';
import { MessageList } from '../../components/chat/MessageList';
import { Composer } from '../../components/chat/Composer';
import { ChatClient, decryptChatMessage, isEncryptedBody, type ChatMessage } from '../../lib/chat-client';
import {
  api, clearStoredUser, listUsers, loadStoredUser, signalingUrl, verifyToken, type StoredUser, type PublicUser,
} from '../../lib/user-session';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

interface ConvSummary {
  id: string;
  is_group: boolean;
  title: string | null;
  members: { id: string; displayName: string }[] | null;
  last_msg_at: string | null;
  last_body: string | null;
  unread: number;
}

interface KnownContact {
  id: string;
  username?: string;
  displayName: string;
  online?: boolean;
  reason?: string;
  lastContactAt?: string | null;
}

interface IncomingInvite {
  roomId: string;
  from: { id: string; username: string; displayName: string };
}

interface AddContactResult {
  mode: 'existing' | 'email';
  email?: string;
  conversationId?: string;
  contact?: { id: string; username?: string; displayName: string };
}

function contactKey(user: { id: string; username?: string; displayName: string }) {
  return user.id || user.username || user.displayName.toLowerCase();
}

export default function ChatPage() {
  const router = useRouter();
  const [me, setMe] = useState<StoredUser | null>(null);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [activeId, setActiveId] = useState<string | undefined>(undefined);
  const [query, setQuery] = useState('');
  const [threads, setThreads] = useState<Record<string, ChatMessage[]>>({});
  const [peerTyping, setPeerTyping] = useState<Record<string, boolean>>({});
  const [invite, setInvite] = useState<IncomingInvite | null>(null);
  const [ringing, setRinging] = useState<{ toUserId: string; roomId: string } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [showAddContact, setShowAddContact] = useState(false);
  const [contactDraft, setContactDraft] = useState({ displayName: '', email: '' });
  const [contactBusy, setContactBusy] = useState(false);
  const [contactError, setContactError] = useState<string | null>(null);
  const clientRef = useRef<ChatClient | null>(null);
  const socketRef = useRef<Socket | null>(null);
  // Map peerUserId <-> conversationId for 1:1 chats so the contact list
  // can be keyed by user while the server uses conversation IDs.
  const userToConv = useRef<Map<string, string>>(new Map());
  const convToUser = useRef<Map<string, string>>(new Map());
  const activeIdRef = useRef<string | undefined>(undefined);

  // Bootstrap: require a logged-in session, otherwise send to onboarding.
  useEffect(() => {
    const u = loadStoredUser();
    if (!u) { router.replace('/onboarding'); return; }
    void (async () => {
      const ok = await verifyToken(u.token);
      if (!ok) {
        clearStoredUser();
        router.replace('/onboarding');
        return;
      }
      setMe(u);
    })();
  }, [router]);

  // Load contact directory + my conversations
  useEffect(() => {
    if (!me) return;
    let cancelled = false;
    (async () => {
      const [users, known, conv] = await Promise.all([
        listUsers().catch(() => [] as PublicUser[]),
        api<{ contacts: KnownContact[] }>('/api/contacts')
          .then((r) => r.contacts)
          .catch(() => [] as KnownContact[]),
        api<{ conversations: ConvSummary[] }>('/api/conversations')
          .then((r) => r.conversations)
          .catch(() => [] as ConvSummary[]),
      ]);
      if (cancelled) return;

      for (const c of conv) {
        const peer = (c.members ?? []).find((m) => m && m.id !== me.id);
        if (!peer || c.is_group) continue;
        userToConv.current.set(peer.id, c.id);
        convToUser.current.set(c.id, peer.id);
      }

      const mergedUsers = new Map<string, KnownContact>();
      for (const u of users) {
        if (u.id !== me.id) mergedUsers.set(contactKey(u), u);
      }
      for (const u of known) {
        if (u.id !== me.id) mergedUsers.set(contactKey(u), { ...(mergedUsers.get(contactKey(u)) || {}), ...u });
      }

      const list: Contact[] = [...mergedUsers.values()]
        .map((u) => {
          const cid = userToConv.current.get(u.id);
          const meta = cid ? conv.find((c) => c.id === cid) : null;
          return {
            id: u.id,
            displayName: u.displayName,
            online: u.online,
            lastMessage: meta?.last_body
              ? (isEncryptedBody(meta.last_body) ? 'Encrypted message' : meta.last_body)
              : u.reason ? `Known from ${u.reason}` : undefined,
            lastMessageAt: meta?.last_msg_at ?? u.lastContactAt ?? undefined,
            unread: meta?.unread ?? 0,
          };
        })
        .sort((a, b) => {
          const aT = a.lastMessageAt ?? ''; const bT = b.lastMessageAt ?? '';
          if (aT && !bT) return -1; if (!aT && bT) return 1;
          if (aT !== bT) return aT < bT ? 1 : -1;
          return a.displayName.localeCompare(b.displayName);
        });
      setContacts(list);
    })();
    return () => { cancelled = true; };
  }, [me]);

  // Open chat socket
  useEffect(() => {
    if (!me) return;
    const cc = new ChatClient(signalingUrl(), me.token);
    clientRef.current = cc;

    const offMsg = cc.onMessage((m) => {
      setThreads((prev) => {
        const list = prev[m.conversationId] ?? [];
        const idx = m.clientId ? list.findIndex((x) => x.clientId === m.clientId) : -1;
        const next: ChatMessage[] = idx >= 0
          ? list.map((x, i) => (i === idx ? { ...m, status: x.status === 'read' ? 'read' : 'sent' } : x))
          : [...list, m];
        return { ...prev, [m.conversationId]: next };
      });
      const peerId = convToUser.current.get(m.conversationId);
      if (peerId) {
        setContacts((prev) => prev.map((c) => c.id === peerId ? {
          ...c,
          lastMessage: m.body,
          lastMessageAt: m.createdAt,
          unread: m.senderId !== me.id && peerId !== activeIdRef.current
                  ? (c.unread ?? 0) + 1 : 0,
        } : c));
      }
      if (m.senderId !== me.id && convToUser.current.get(m.conversationId) === activeIdRef.current) {
        cc.markRead(m.conversationId, m.id);
      }
    });

    const offRcpt = cc.onReceipt(({ messageId, userId, kind }) => {
      if (userId === me.id) return;
      setThreads((prev) => {
        const out: Record<string, ChatMessage[]> = {};
        for (const [cid, msgs] of Object.entries(prev)) {
          out[cid] = msgs.map((m) => m.id === messageId
            ? { ...m, status: kind === 'read' ? 'read' : (m.status === 'read' ? 'read' : 'delivered') }
            : m);
        }
        return out;
      });
    });

    const offTyping = cc.onTyping(({ conversationId, userId, typing }) => {
      if (userId === me.id) return;
      const peerId = convToUser.current.get(conversationId);
      if (!peerId) return;
      setPeerTyping((prev) => ({ ...prev, [peerId]: typing }));
    });

    const offPresence = cc.onPresence(({ userId, online }) => {
      setContacts((prev) => prev.map((c) => c.id === userId ? { ...c, online } : c));
    });

    return () => { offMsg(); offRcpt(); offTyping(); offPresence(); cc.disconnect(); };
  }, [me]);

  useEffect(() => {
    if (!me) return;
    const socket = io(signalingUrl(), { transports: ['websocket', 'polling'] });
    socketRef.current = socket;
    socket.emit('user:hello', { token: me.token }, (res: { ok: boolean }) => {
      if (!res?.ok) setNotice('Could not connect calling.');
    });
    socket.on('user:presence', ({ userId, online }: { userId: string; online: boolean }) => {
      setContacts((prev) => prev.map((c) => c.id === userId ? { ...c, online } : c));
    });
    socket.on('user:incoming-call', (payload: IncomingInvite) => {
      setInvite(payload);
      setNotice(null);
    });
    socket.on('user:call-answered', ({ roomId, accepted, fromUserId }: { roomId: string; accepted: boolean; fromUserId: string }) => {
      setRinging((cur) => (cur && cur.toUserId === fromUserId ? null : cur));
      if (accepted) window.location.href = `/call?room=${encodeURIComponent(roomId)}`;
      else setNotice('Call was declined.');
    });
    socket.on('user:call-cancelled', () => setInvite(null));
    return () => { socket.close(); socketRef.current = null; };
  }, [me]);

  useEffect(() => { activeIdRef.current = activeId; }, [activeId]);

  const active = useMemo(() => contacts.find((c) => c.id === activeId), [contacts, activeId]);

  const openContact = async (peerUserId: string) => {
    if (!me) return;
    setActiveId(peerUserId);
    setContacts((prev) => prev.map((c) => c.id === peerUserId ? { ...c, unread: 0 } : c));

    let cid = userToConv.current.get(peerUserId);
    if (!cid) {
      const r = await api<{ id: string }>('/api/conversations', {
        method: 'POST', body: JSON.stringify({ peerUserId }),
      }).catch(() => null);
      if (!r) return;
      cid = r.id;
      userToConv.current.set(peerUserId, cid);
      convToUser.current.set(cid, peerUserId);
    }
    if (!threads[cid]) {
      const r = await api<{ messages: ChatMessage[] }>(
        `/api/conversations/${cid}/messages`,
      ).catch(() => ({ messages: [] }));
      const decryptedMessages = await Promise.all(r.messages.map(decryptChatMessage));
      setThreads((prev) => ({ ...prev, [cid!]: decryptedMessages }));
      const last = r.messages[r.messages.length - 1];
      if (last && last.senderId !== me.id) clientRef.current?.markRead(cid, last.id);
    }
  };

  const startCall = useCallback((kind: 'voice' | 'video') => {
    if (!active || !me || !socketRef.current) return;
    const roomId = `dm-${[me.id, active.id].sort().join('-')}-${Math.random().toString(36).slice(2, 8)}`;
    setRinging({ toUserId: active.id, roomId });
    setNotice(`${kind === 'video' ? 'Video' : 'Voice'} calling ${active.displayName}...`);
    socketRef.current.emit('user:call', { toUserId: active.id, roomId }, (res: { ok: boolean; error?: string }) => {
      if (!res?.ok) {
        setRinging(null);
        setNotice(res?.error === 'user_offline' ? `${active.displayName} is offline.` : 'Call could not be placed.');
      }
    });
  }, [active, me]);

  const cancelCall = useCallback(() => {
    if (!ringing || !socketRef.current) return;
    socketRef.current.emit('user:call-cancel', { toUserId: ringing.toUserId, roomId: ringing.roomId });
    setRinging(null);
    setNotice(null);
  }, [ringing]);

  const acceptInvite = useCallback(() => {
    if (!invite || !socketRef.current) return;
    socketRef.current.emit('user:call-response', { toUserId: invite.from.id, roomId: invite.roomId, accepted: true });
    window.location.href = `/call?room=${encodeURIComponent(invite.roomId)}`;
  }, [invite]);

  const declineInvite = useCallback(() => {
    if (!invite || !socketRef.current) return;
    socketRef.current.emit('user:call-response', { toUserId: invite.from.id, roomId: invite.roomId, accepted: false });
    setInvite(null);
  }, [invite]);

  const closeAddContact = useCallback(() => {
    if (contactBusy) return;
    setShowAddContact(false);
    setContactError(null);
  }, [contactBusy]);

  const submitAddContact = useCallback(async () => {
    const displayName = contactDraft.displayName.trim();
    const email = contactDraft.email.trim().toLowerCase();
    if (displayName.length < 2) {
      setContactError('Enter the contact\'s full name.');
      return;
    }
    if (!EMAIL_RE.test(email)) {
      setContactError('Enter a valid email address.');
      return;
    }

    setContactBusy(true);
    setContactError(null);
    try {
      const result = await api<AddContactResult>('/api/contacts/invite', {
        method: 'POST',
        body: JSON.stringify({ displayName, email }),
      });

      if (result.mode === 'existing' && result.contact?.id) {
        const addedContact = result.contact;
        if (result.conversationId) {
          userToConv.current.set(addedContact.id, result.conversationId);
          convToUser.current.set(result.conversationId, addedContact.id);
        }
        setContacts((prev) => {
          const existingEntry = prev.find((entry) => entry.id === addedContact.id);
          const rest = prev.filter((entry) => entry.id !== addedContact.id);
          return [
            {
              id: addedContact.id,
              displayName: addedContact.displayName,
              online: existingEntry?.online,
              lastMessage: existingEntry?.lastMessage ?? 'Tap to start chatting',
              lastMessageAt: existingEntry?.lastMessageAt,
              unread: existingEntry?.unread ?? 0,
            },
            ...rest,
          ];
        });
        setShowAddContact(false);
        setContactDraft({ displayName: '', email: '' });
        setNotice(`${addedContact.displayName} is now in your contacts.`);
        await openContact(addedContact.id);
        return;
      }

      setShowAddContact(false);
      setContactDraft({ displayName: '', email: '' });
      setNotice(`Invite email sent to ${email}.`);
    } catch (e) {
      const message = (e as Error).message || 'Could not add contact.';
      if (message.includes('smtp_not_configured')) {
        setContactError('SMTP is not configured on the server yet. Add SMTP settings and redeploy to send invites.');
      } else if (message.includes('cannot_add_self')) {
        setContactError('Use a different email address.');
      } else if (message.includes('invalid_email')) {
        setContactError('Enter a valid email address.');
      } else {
        setContactError('Could not add contact right now.');
      }
    } finally {
      setContactBusy(false);
    }
  }, [contactDraft, openContact]);

  const send = (text: string) => {
    if (!activeId || !me) return;
    const cid = userToConv.current.get(activeId);
    if (!cid) return;
    const clientId = clientRef.current?.send(cid, text) ?? String(Date.now());
    const tempId = `tmp-${clientId}`;
    const msg: ChatMessage = {
      id: tempId, conversationId: cid, senderId: me.id, body: text,
      createdAt: new Date().toISOString(), status: 'sending', clientId,
    };
    setThreads((prev) => ({ ...prev, [cid]: [...(prev[cid] ?? []), msg] }));
  };

  const onTyping = (typing: boolean) => {
    if (!activeId) return;
    const cid = userToConv.current.get(activeId);
    if (cid) clientRef.current?.setTyping(cid, typing);
  };

  const messages = useMemo(() => {
    if (!activeId) return [];
    const cid = userToConv.current.get(activeId);
    return cid ? (threads[cid] ?? []) : [];
  }, [activeId, threads]);

  return (
    <>
      <TopBar user={me ?? undefined} />
      <div className={`app-shell${activeId ? ' has-active' : ''}`}>
        <aside>
          <div className="side-head">
            <div className="me" aria-hidden>{me?.displayName?.[0]?.toUpperCase() ?? '?'}</div>
            <div className="grow" />
            <button className="icon-btn" aria-label="New chat" onClick={() => {
              setContactDraft({ displayName: '', email: '' });
              setContactError(null);
              setShowAddContact(true);
            }}>＋</button>
            <button className="icon-btn" aria-label="Menu">⋮</button>
          </div>
          <ContactList
            contacts={contacts}
            typingById={peerTyping}
            activeId={activeId}
            onSelect={openContact}
            query={query}
            onQuery={setQuery}
          />
        </aside>

        <main>
          {!active && (
            <div className="empty-pane">
              <h2>Web-Access Chat</h2>
              <p>
                Send messages, place voice/video calls, or jump into a remote-desktop
                session. Pick a contact on the left to start.
              </p>
            </div>
          )}
          {active && (
            <>
              <div className="chat-head">
                <button className="icon-btn" aria-label="Back" onClick={() => setActiveId(undefined)}>←</button>
                <div className="avatar">{active.displayName[0]}</div>
                <div className="info">
                  <div className="name">{active.displayName}</div>
                  <div className="status">
                    {peerTyping[active.id] ? 'typing…'
                      : active.online ? 'online' : 'offline'}
                  </div>
                </div>
                <div className="actions">
                  <button title="Voice call" aria-label="Voice call" onClick={() => startCall('voice')}>📞</button>
                  <button title="Video call" aria-label="Video call" onClick={() => startCall('video')}>📹</button>
                  <button title="Remote desktop" aria-label="Remote desktop"
                          onClick={() => router.push('/remote')}>🖥️</button>
                  <button title="Search">🔍</button>
                  <button title="Menu">⋮</button>
                </div>
              </div>
              {invite && (
                <div className="call-banner">
                  <span>{invite.from.displayName} is calling</span>
                  <button onClick={declineInvite}>Decline</button>
                  <button className="accept" onClick={acceptInvite}>Answer</button>
                </div>
              )}
              {ringing && (
                <div className="call-banner">
                  <span>Calling {active.displayName}</span>
                  <button onClick={cancelCall}>Cancel</button>
                </div>
              )}
              {notice && !invite && !ringing && (
                <div className="call-banner notice">
                  <span>{notice}</span>
                  <button onClick={() => setNotice(null)}>Dismiss</button>
                </div>
              )}
              <MessageList messages={messages} meId={me?.id ?? ''} />
              <Composer onSend={send} onTyping={onTyping} />
            </>
          )}
        </main>
      </div>
      {showAddContact && (
        <div className="wa-modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="add-contact-title">
          <div className="wa-modal add-contact-modal">
            <button className="wa-modal-close" type="button" aria-label="Close" onClick={closeAddContact}>×</button>
            <h2 id="add-contact-title">Add Contact</h2>
            <p>Enter the person&apos;s full name and email. Existing users are added immediately; new users receive an invite email.</p>
            <label className="wa-floating-field">
              <input
                value={contactDraft.displayName}
                onChange={(e) => setContactDraft((current) => ({ ...current, displayName: e.target.value }))}
                placeholder=" "
                autoFocus
              />
              <span>Full Name</span>
            </label>
            <label className="wa-floating-field">
              <input
                value={contactDraft.email}
                onChange={(e) => setContactDraft((current) => ({ ...current, email: e.target.value }))}
                placeholder=" "
                type="email"
                autoComplete="email"
                onKeyDown={(e) => { if (e.key === 'Enter') void submitAddContact(); }}
              />
              <span>Email Address</span>
            </label>
            {contactError && <div className="wa-form-error">{contactError}</div>}
            <div className="add-contact-actions">
              <button type="button" className="add-contact-secondary" onClick={closeAddContact} disabled={contactBusy}>Cancel</button>
              <button
                type="button"
                className="wa-primary-btn add-contact-primary"
                onClick={() => void submitAddContact()}
                disabled={contactBusy || contactDraft.displayName.trim().length < 2 || !EMAIL_RE.test(contactDraft.email.trim())}
              >
                {contactBusy ? 'Sending…' : 'Add Contact'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
