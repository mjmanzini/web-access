'use client';

import { useEffect, useRef } from 'react';
import type { ChatMessage } from '../../lib/chat-client';
import { decodeAttachment, isAttachmentBody, AttachmentPayload } from '../../lib/attachments';

function formatTime(iso: string) {
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function fmtDuration(s?: number) {
  if (!s || s < 0) return '';
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${String(r).padStart(2, '0')}`;
}

function fmtSize(b: number) {
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(0)} KB`;
  return `${(b / 1024 / 1024).toFixed(1)} MB`;
}

function AttachmentBubble({ payload }: { payload: AttachmentPayload }) {
  if (payload.kind === 'audio') {
    return (
      <div className="att att-audio">
        <audio controls src={payload.data} />
        <span className="att-meta">Voice · {fmtDuration(payload.duration)} · {fmtSize(payload.size)}</span>
      </div>
    );
  }
  if (payload.kind === 'video') {
    return (
      <div className="att att-video">
        <video controls src={payload.data} preload="metadata" />
        <span className="att-meta">Video{payload.duration ? ` · ${fmtDuration(payload.duration)}` : ''} · {fmtSize(payload.size)}</span>
      </div>
    );
  }
  if (payload.kind === 'image') {
    return (
      <div className="att att-image">
        <a href={payload.data} download={payload.name || 'image'} target="_blank" rel="noreferrer">
          <img src={payload.data} alt={payload.name || 'image'} />
        </a>
        <span className="att-meta">{payload.name || 'Photo'} · {fmtSize(payload.size)}</span>
      </div>
    );
  }
  if (payload.kind === 'document') {
    return (
      <a className="att att-doc" href={payload.data} download={payload.name || 'document'} target="_blank" rel="noreferrer">
        <span className="att-doc-icon" aria-hidden>📄</span>
        <span className="att-doc-info">
          <strong>{payload.name || 'Document'}</strong>
          <em>{payload.mime} · {fmtSize(payload.size)}</em>
        </span>
      </a>
    );
  }
  if (payload.kind === 'location') {
    const href = `https://www.openstreetmap.org/?mlat=${payload.lat}&mlon=${payload.lng}#map=16/${payload.lat}/${payload.lng}`;
    return (
      <a className="att att-loc" href={href} target="_blank" rel="noreferrer">
        <span className="att-loc-icon" aria-hidden>📍</span>
        <span className="att-loc-info">
          <strong>{payload.label || 'Location'}</strong>
          <em>{payload.lat.toFixed(5)}, {payload.lng.toFixed(5)}{payload.accuracy ? ` · ±${Math.round(payload.accuracy)}m` : ''}</em>
        </span>
      </a>
    );
  }
  if (payload.kind === 'contact') {
    return (
      <div className="att att-contact">
        <span className="att-contact-icon" aria-hidden>👤</span>
        <span className="att-contact-info">
          <strong>{payload.name}</strong>
          {payload.tel?.length ? <em>{payload.tel.join(', ')}</em> : null}
          {payload.email?.length ? <em>{payload.email.join(', ')}</em> : null}
        </span>
      </div>
    );
  }
  return <span className="att-unknown">Attachment</span>;
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
    const attachment = isAttachmentBody(m.body) ? decodeAttachment(m.body) : null;
    items.push(
      <div key={m.id} className={`bubble ${mine ? 'out' : 'in'}${same ? ' same' : ''}${attachment ? ' has-attachment' : ''}`}>
        {attachment ? <AttachmentBubble payload={attachment} /> : m.body}
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
