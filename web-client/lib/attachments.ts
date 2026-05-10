/**
 * Attachment payload helpers.
 *
 * Attachments are encoded into the chat message body as a single text token:
 *   waatt:v1:<base64-of-utf8-json>
 *
 * The body still flows through the existing E2E encryption layer, so the
 * server only sees ciphertext. Inline base64 keeps things simple and avoids
 * a new storage backend, at the cost of a hard size cap per message.
 */

export const ATTACHMENT_PREFIX = 'waatt:v1:';

/** Hard cap for inline payload bytes (raw, before base64 inflation).
 *  Firestore's 1MB document limit + base64 overhead ≈ 700 KB safe. */
export const MAX_ATTACHMENT_BYTES = 700 * 1024;

export type AttachmentKind =
  | 'audio'
  | 'video'
  | 'image'
  | 'document'
  | 'location'
  | 'contact';

export interface AttachmentPayloadBase {
  kind: AttachmentKind;
}

export interface MediaAttachment extends AttachmentPayloadBase {
  kind: 'audio' | 'video' | 'image' | 'document';
  mime: string;
  name?: string;
  size: number;
  /** data URL: data:<mime>;base64,... */
  data: string;
  /** seconds, for audio/video */
  duration?: number;
  /** for video/image preview */
  width?: number;
  height?: number;
}

export interface LocationAttachment extends AttachmentPayloadBase {
  kind: 'location';
  lat: number;
  lng: number;
  accuracy?: number;
  label?: string;
}

export interface ContactAttachment extends AttachmentPayloadBase {
  kind: 'contact';
  name: string;
  tel?: string[];
  email?: string[];
}

export type AttachmentPayload =
  | MediaAttachment
  | LocationAttachment
  | ContactAttachment;

export function isAttachmentBody(body: string): boolean {
  return typeof body === 'string' && body.startsWith(ATTACHMENT_PREFIX);
}

export function encodeAttachment(payload: AttachmentPayload): string {
  const json = JSON.stringify(payload);
  const bytes = new TextEncoder().encode(json);
  let binary = '';
  bytes.forEach((b) => { binary += String.fromCharCode(b); });
  return ATTACHMENT_PREFIX + btoa(binary);
}

export function decodeAttachment(body: string): AttachmentPayload | null {
  if (!isAttachmentBody(body)) return null;
  try {
    const b64 = body.slice(ATTACHMENT_PREFIX.length);
    const binary = atob(b64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    const json = new TextDecoder().decode(bytes);
    const parsed = JSON.parse(json) as AttachmentPayload;
    if (!parsed || typeof parsed !== 'object' || !parsed.kind) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function describeAttachment(payload: AttachmentPayload): string {
  switch (payload.kind) {
    case 'audio': return '🎤 Voice message';
    case 'video': return '🎥 Video';
    case 'image': return '📷 Photo';
    case 'document': return `📄 ${payload.name || 'Document'}`;
    case 'location': return '📍 Location';
    case 'contact': return `👤 ${payload.name}`;
    default: return 'Attachment';
  }
}

export function previewBody(body: string): string {
  if (!isAttachmentBody(body)) return body;
  const a = decodeAttachment(body);
  return a ? describeAttachment(a) : 'Attachment';
}

export async function fileToDataAttachment(
  file: File,
  kind: MediaAttachment['kind'],
  extra: Partial<MediaAttachment> = {},
): Promise<MediaAttachment> {
  if (file.size > MAX_ATTACHMENT_BYTES) {
    throw new Error(
      `File is too large (${Math.round(file.size / 1024)} KB). ` +
      `Limit is ${Math.round(MAX_ATTACHMENT_BYTES / 1024)} KB per message.`,
    );
  }
  const data = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(reader.error || new Error('read_failed'));
    reader.readAsDataURL(file);
  });
  return {
    kind,
    mime: file.type || 'application/octet-stream',
    name: file.name,
    size: file.size,
    data,
    ...extra,
  };
}

export async function blobToDataAttachment(
  blob: Blob,
  kind: MediaAttachment['kind'],
  extra: Partial<MediaAttachment> = {},
): Promise<MediaAttachment> {
  if (blob.size > MAX_ATTACHMENT_BYTES) {
    throw new Error(
      `Recording is too large (${Math.round(blob.size / 1024)} KB). ` +
      `Limit is ${Math.round(MAX_ATTACHMENT_BYTES / 1024)} KB.`,
    );
  }
  const data = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(reader.error || new Error('read_failed'));
    reader.readAsDataURL(blob);
  });
  return {
    kind,
    mime: blob.type || (kind === 'audio' ? 'audio/webm' : 'video/webm'),
    size: blob.size,
    data,
    ...extra,
  };
}

export function pickRecorderMime(kind: 'audio' | 'video'): string | undefined {
  if (typeof MediaRecorder === 'undefined') return undefined;
  const candidates = kind === 'audio'
    ? ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg']
    : ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm', 'video/mp4'];
  for (const mime of candidates) {
    if (MediaRecorder.isTypeSupported?.(mime)) return mime;
  }
  return undefined;
}
