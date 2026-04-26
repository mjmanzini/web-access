'use client';

import { useMemo } from 'react';

export interface Contact {
  id: string;
  displayName: string;
  lastMessage?: string;
  lastMessageAt?: string;
  unread?: number;
  online?: boolean;
}

function initials(name: string) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map(s => s[0]?.toUpperCase()).join('') || '?';
}
function formatTime(iso?: string) {
  if (!iso) return '';
  const d = new Date(iso);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  return sameDay ? d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
                 : d.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

export function ContactList({
  contacts, activeId, onSelect, query, onQuery,
}: {
  contacts: Contact[];
  activeId?: string;
  onSelect: (id: string) => void;
  query: string;
  onQuery: (q: string) => void;
}) {
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return contacts;
    return contacts.filter(c => c.displayName.toLowerCase().includes(q));
  }, [contacts, query]);

  return (
    <>
      <div className="search">
        <input
          type="text"
          placeholder="Search or start new chat"
          value={query}
          onChange={(e) => onQuery(e.target.value)}
        />
      </div>
      <div className="contacts" role="list">
        {filtered.map(c => (
          <div
            key={c.id}
            role="listitem"
            className={`contact-row${c.id === activeId ? ' active' : ''}`}
            onClick={() => onSelect(c.id)}
          >
            <div className="avatar" aria-hidden>
              {initials(c.displayName)}
              <span className={`presence-dot${c.online ? ' online' : ''}`} />
            </div>
            <div className="meta">
              <div className="name">{c.displayName}</div>
              <div className="preview">{c.lastMessage ?? 'Tap to start chatting'}</div>
            </div>
            <div className="right">
              <div className="time">{formatTime(c.lastMessageAt)}</div>
              {c.unread ? <div className="badge">{c.unread}</div> : null}
            </div>
          </div>
        ))}
        {filtered.length === 0 && (
          <div style={{ padding: 24, color: 'var(--wa-muted)', textAlign: 'center', fontSize: 14 }}>
            No contacts match “{query}”.
          </div>
        )}
      </div>
    </>
  );
}
