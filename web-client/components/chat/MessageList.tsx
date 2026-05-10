'use client';

import { useEffect, useRef, useState } from 'react';
import type { ChatMessage } from '../../lib/chat-client';
import { decodeAttachment, isAttachmentBody, AttachmentPayload } from '../../lib/attachments';
import { api } from '../../lib/user-session';
import { pushToast } from '../../lib/notifications';

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

function defaultName(payload: AttachmentPayload): string {
  if ('name' in payload && payload.name) return payload.name;
  if (payload.kind === 'audio') return `voice-${Date.now()}.webm`;
  if (payload.kind === 'video') return `video-${Date.now()}.webm`;
  if (payload.kind === 'image') return `photo-${Date.now()}.jpg`;
  return `attachment-${Date.now()}`;
}

function SaveToDrive({ payload }: { payload: AttachmentPayload }) {
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  if (payload.kind !== 'audio' && payload.kind !== 'video'
      && payload.kind !== 'image' && payload.kind !== 'document') return null;
  const dataUrl = (payload as { data?: string }).data;
  if (!dataUrl) return null;
  const onClick = async (e: React.MouseEvent) => {
    e.preventDefault(); e.stopPropagation();
    if (busy || done) return;
    setBusy(true);
    try {
      const filename = defaultName(payload);
      const mime = (payload as { mime?: string }).mime || 'application/octet-stream';
      await api('/api/drive/upload', {
        method: 'POST',
        body: JSON.stringify({ filename, mime, dataUrl }),
      });
      setDone(true);
      pushToast({ kind: 'success', title: 'Saved to Drive', body: filename });
    } catch (err) {
      const msg = String((err as Error).message || '');
      if (msg.includes('no_drive_consent') || msg.includes('412')) {
        pushToast({
          kind: 'info',
          title: 'Connect Google Drive',
          body: 'Sign in again with Google to enable Drive backup.',
          href: '/onboarding',
        });
      } else if (msg.includes('413') || msg.includes('too_large')) {
        pushToast({ kind: 'error', title: 'Too large for Drive backup' });
      } else {
        pushToast({ kind: 'error', title: 'Drive upload failed', body: msg.slice(0, 120) });
      }
    } finally { setBusy(false); }
  };
  return (
    <button
      type="button"
      className={`att-drive-btn${done ? ' done' : ''}`}
      onClick={onClick}
      disabled={busy || done}
      title={done ? 'Saved to Google Drive' : 'Save to Google Drive'}
    >
      {done ? '✓ Drive' : busy ? '…' : '☁ Drive'}
    </button>
  );
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
        {attachment ? (
          <>
            <AttachmentBubble payload={attachment} />
            <SaveToDrive payload={attachment} />
          </>
        ) : m.body}
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
