'use client';

import { useEffect, useRef } from 'react';
import type { ChatMessage } from '../../lib/chat-client';

function formatTime(iso: string) {
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}
function formatDay(iso: string) {
  const d = new Date(iso);
  const today = new Date();
  const yest = new Date(); yest.setDate(today.getDate() - 1);
  if (d.toDateString() === today.toDateString()) return 'Today';
  if (d.toDateString() === yest.toDateString()) return 'Yesterday';
  return d.toLocaleDateString([], { weekday: 'long', month: 'short', day: 'numeric' });
}

function Tick({ status }: { status?: ChatMessage['status'] }) {
  if (!status || status === 'sending') return <span className="tick unread">⏱</span>;
  if (status === 'sent')      return <span className="tick unread">✓</span>;
  if (status === 'delivered') return <span className="tick unread">✓✓</span>;
  return <span className="tick">✓✓</span>;
}

export function MessageList({
  messages, meId,
}: { messages: ChatMessage[]; meId: string }) {
  const endRef = useRef<HTMLDivElement>(null);
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages.length]);

  const items: React.ReactNode[] = [];
  let lastDay = '';
  let lastSender = '';
  messages.forEach((m, i) => {
    const day = formatDay(m.createdAt);
    if (day !== lastDay) {
      items.push(<div key={`d-${i}`} className="day-sep">{day}</div>);
      lastDay = day; lastSender = '';
    }
    const mine = m.senderId === meId;
    const same = lastSender === m.senderId;
    items.push(
      <div key={m.id} className={`bubble ${mine ? 'out' : 'in'}${same ? ' same' : ''}`}>
        {m.body}
        <span className="meta-line">
          {formatTime(m.createdAt)}
          {mine && <Tick status={m.status} />}
        </span>
      </div>,
    );
    lastSender = m.senderId;
  });

  return (
    <div className="messages">
      {items}
      <div ref={endRef} />
    </div>
  );
}
