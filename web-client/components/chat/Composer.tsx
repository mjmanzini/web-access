'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AttachmentPayload,
  blobToDataAttachment,
  encodeAttachment,
  fileToDataAttachment,
  MAX_ATTACHMENT_BYTES,
  pickRecorderMime,
} from '../../lib/attachments';

type SheetItem =
  | 'image'
  | 'document'
  | 'gallery'
  | 'camera'
  | 'video-camera';

export function Composer({
  onSend, onTyping, disabled,
}: {
  onSend: (text: string) => void;
  onTyping?: (typing: boolean) => void;
  disabled?: boolean;
}) {
  const [text, setText] = useState('');
  const [sheetOpen, setSheetOpen] = useState(false);
  const [recording, setRecording] = useState<null | { kind: 'audio' | 'video'; startedAt: number }>(null);
  const [recError, setRecError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const taRef = useRef<HTMLTextAreaElement>(null);
  const typingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const docInputRef = useRef<HTMLInputElement>(null);
  const galleryInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const videoCameraInputRef = useRef<HTMLInputElement>(null);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const recStreamRef = useRef<MediaStream | null>(null);
  const recChunksRef = useRef<Blob[]>([]);

  const autosize = useCallback(() => {
    const ta = taRef.current; if (!ta) return;
    ta.style.height = 'auto';
    ta.style.height = Math.min(ta.scrollHeight, 120) + 'px';
  }, []);
  useEffect(autosize, [text, autosize]);

  const submit = () => {
    const v = text.trim(); if (!v || disabled) return;
    onSend(v); setText(''); onTyping?.(false);
  };

  const onKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(); }
  };

  const onChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setText(e.target.value);
    if (onTyping) {
      onTyping(true);
      if (typingTimer.current) clearTimeout(typingTimer.current);
      typingTimer.current = setTimeout(() => onTyping(false), 1500);
    }
  };

  const sendAttachment = useCallback((payload: AttachmentPayload) => {
    onSend(encodeAttachment(payload));
  }, [onSend]);

  // ---------- Attachment sheet handlers ----------
  const openInput = (which: SheetItem) => {
    setSheetOpen(false);
    if (which === 'image' || which === 'gallery') galleryInputRef.current?.click();
    else if (which === 'document') docInputRef.current?.click();
    else if (which === 'camera') cameraInputRef.current?.click();
    else if (which === 'video-camera') videoCameraInputRef.current?.click();
  };

  const handleFile = useCallback(async (
    files: FileList | null,
    kind: 'image' | 'document' | 'video',
  ) => {
    if (!files || !files[0]) return;
    setRecError(null);
    setBusy(true);
    try {
      const a = await fileToDataAttachment(files[0], kind);
      sendAttachment(a);
    } catch (e) {
      setRecError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }, [sendAttachment]);

  // ---------- Location ----------
  const sendLocation = useCallback(() => {
    setSheetOpen(false);
    setRecError(null);
    if (!('geolocation' in navigator)) {
      setRecError('Location is not supported on this browser.');
      return;
    }
    setBusy(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        sendAttachment({
          kind: 'location',
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          accuracy: pos.coords.accuracy,
        });
        setBusy(false);
      },
      (err) => {
        setRecError(err.message || 'Could not read location.');
        setBusy(false);
      },
      { enableHighAccuracy: true, timeout: 10000 },
    );
  }, [sendAttachment]);

  // ---------- Contact picker (Contacts API where available) ----------
  const sendContact = useCallback(async () => {
    setSheetOpen(false);
    setRecError(null);
    type ContactsAPI = {
      select: (props: string[], opts?: { multiple?: boolean }) =>
        Promise<Array<{ name?: string[]; tel?: string[]; email?: string[] }>>;
    };
    const navWithContacts = navigator as Navigator & { contacts?: ContactsAPI };
    if (navWithContacts.contacts?.select) {
      try {
        const picked = await navWithContacts.contacts.select(
          ['name', 'tel', 'email'],
          { multiple: false },
        );
        if (picked && picked[0]) {
          const c = picked[0];
          sendAttachment({
            kind: 'contact',
            name: (c.name && c.name[0]) || 'Contact',
            tel: c.tel,
            email: c.email,
          });
          return;
        }
      } catch (e) {
        setRecError((e as Error).message || 'Contact picker cancelled.');
        return;
      }
    }
    // Fallback: minimal manual entry prompt
    const name = window.prompt('Contact name');
    if (!name) return;
    const tel = window.prompt('Phone number (optional)') || '';
    const email = window.prompt('Email (optional)') || '';
    sendAttachment({
      kind: 'contact',
      name,
      tel: tel ? [tel] : undefined,
      email: email ? [email] : undefined,
    });
  }, [sendAttachment]);

  // ---------- Voice / video recording ----------
  const startRecording = useCallback(async (kind: 'audio' | 'video') => {
    setRecError(null);
    if (typeof MediaRecorder === 'undefined') {
      setRecError('Recording is not supported on this browser.');
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia(
        kind === 'audio' ? { audio: true } : { audio: true, video: { width: 480, height: 360 } },
      );
      recStreamRef.current = stream;
      const mimeType = pickRecorderMime(kind);
      const rec = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      const startedAt = Date.now();
      recChunksRef.current = [];
      rec.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) recChunksRef.current.push(e.data);
      };
      rec.onstop = async () => {
        const blob = new Blob(recChunksRef.current, { type: rec.mimeType });
        recStreamRef.current?.getTracks().forEach((t) => t.stop());
        recStreamRef.current = null;
        recorderRef.current = null;
        try {
          const duration = Math.max(1, Math.round((Date.now() - startedAt) / 1000));
          const a = await blobToDataAttachment(blob, kind, { duration });
          sendAttachment(a);
        } catch (e) {
          setRecError((e as Error).message);
        }
      };
      rec.start();
      recorderRef.current = rec;
      setRecording({ kind, startedAt });
    } catch (e) {
      setRecError((e as Error).message || 'Microphone/camera blocked.');
    }
  }, [sendAttachment]);

  const stopRecording = useCallback(() => {
    const rec = recorderRef.current;
    if (rec && rec.state !== 'inactive') rec.stop();
    setRecording(null);
  }, []);

  const cancelRecording = useCallback(() => {
    const rec = recorderRef.current;
    recChunksRef.current = []; // discard
    if (rec) {
      rec.ondataavailable = null;
      rec.onstop = null;
      try { rec.stop(); } catch { /* noop */ }
    }
    recStreamRef.current?.getTracks().forEach((t) => t.stop());
    recStreamRef.current = null;
    recorderRef.current = null;
    setRecording(null);
  }, []);

  // Cleanup on unmount
  useEffect(() => () => {
    recStreamRef.current?.getTracks().forEach((t) => t.stop());
    if (recorderRef.current && recorderRef.current.state !== 'inactive') {
      try { recorderRef.current.stop(); } catch { /* noop */ }
    }
  }, []);

  // Live timer label for the recording pill
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!recording) return;
    const id = setInterval(() => setTick((n) => n + 1), 250);
    return () => clearInterval(id);
  }, [recording]);
  const elapsed = useMemo(() => {
    if (!recording) return '';
    const s = Math.max(0, Math.floor((Date.now() - recording.startedAt) / 1000));
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recording, tick]);

  // ---------- Render ----------
  if (recording) {
    return (
      <div className="composer recording-bar">
        <button className="icon-btn rec-cancel" aria-label="Cancel recording" onClick={cancelRecording}>✕</button>
        <span className="rec-dot" aria-hidden />
        <span className="rec-label">
          {recording.kind === 'audio' ? 'Recording voice' : 'Recording video'} · {elapsed}
        </span>
        <button className="send" aria-label="Send recording" onClick={stopRecording}>➤</button>
      </div>
    );
  }

  return (
    <>
      {recError && (
        <div className="composer-error" role="alert">
          {recError}
          <button onClick={() => setRecError(null)} aria-label="Dismiss error">×</button>
        </div>
      )}
      <div className="composer">
        <div className="composer-attach">
          <button
            className="icon-btn"
            type="button"
            aria-label="Attach"
            aria-expanded={sheetOpen}
            onClick={() => setSheetOpen((v) => !v)}
            disabled={busy}
          >
            📎
          </button>
          {sheetOpen && (
            <div className="attach-sheet" role="menu" onMouseLeave={() => setSheetOpen(false)}>
              <button role="menuitem" onClick={() => openInput('gallery')}>
                <span className="ai" style={{ background: '#7e57c2' }}>🖼️</span>
                <span>Gallery</span>
              </button>
              <button role="menuitem" onClick={() => openInput('camera')}>
                <span className="ai" style={{ background: '#e91e63' }}>📷</span>
                <span>Camera</span>
              </button>
              <button role="menuitem" onClick={() => openInput('video-camera')}>
                <span className="ai" style={{ background: '#ef5350' }}>🎥</span>
                <span>Video</span>
              </button>
              <button role="menuitem" onClick={() => openInput('document')}>
                <span className="ai" style={{ background: '#5e8df8' }}>📄</span>
                <span>Document</span>
              </button>
              <button role="menuitem" onClick={sendLocation}>
                <span className="ai" style={{ background: '#2e7d32' }}>📍</span>
                <span>Location</span>
              </button>
              <button role="menuitem" onClick={() => void sendContact()}>
                <span className="ai" style={{ background: '#0288d1' }}>👤</span>
                <span>Contact</span>
              </button>
            </div>
          )}
        </div>

        <textarea
          ref={taRef}
          rows={1}
          placeholder="Type a message"
          value={text}
          onChange={onChange}
          onKeyDown={onKey}
          disabled={disabled || busy}
        />

        {text.trim() ? (
          <button className="send" onClick={submit} aria-label="Send" disabled={disabled || !text.trim()}>
            ➤
          </button>
        ) : (
          <>
            <button
              className="icon-btn"
              type="button"
              aria-label="Record video"
              onClick={() => void startRecording('video')}
              disabled={disabled || busy}
              title="Record video"
            >
              🎥
            </button>
            <button
              className="icon-btn rec-mic"
              type="button"
              aria-label="Record voice"
              onClick={() => void startRecording('audio')}
              disabled={disabled || busy}
              title="Record voice"
            >
              🎤
            </button>
          </>
        )}

        {/* Hidden file inputs */}
        <input
          ref={galleryInputRef}
          type="file"
          accept="image/*,video/*"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            const kind: 'image' | 'video' = f && f.type.startsWith('video/') ? 'video' : 'image';
            void handleFile(e.target.files, kind);
            e.target.value = '';
          }}
        />
        <input
          ref={cameraInputRef}
          type="file"
          accept="image/*"
          capture="environment"
          hidden
          onChange={(e) => {
            void handleFile(e.target.files, 'image');
            e.target.value = '';
          }}
        />
        <input
          ref={videoCameraInputRef}
          type="file"
          accept="video/*"
          capture="environment"
          hidden
          onChange={(e) => {
            void handleFile(e.target.files, 'video');
            e.target.value = '';
          }}
        />
        <input
          ref={docInputRef}
          type="file"
          hidden
          onChange={(e) => {
            void handleFile(e.target.files, 'document');
            e.target.value = '';
          }}
        />
      </div>
      <noscript data-max-attachment-bytes={MAX_ATTACHMENT_BYTES} />
    </>
  );
}
