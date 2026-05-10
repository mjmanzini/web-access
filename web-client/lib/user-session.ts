'use client';

/**
 * user-session.ts — browser-side user session persisted in localStorage.
 *
 * - `register(username, displayName)` → calls POST /users/register, stores token.
 * - `loadSession()` → re-hydrates from storage + verifies via POST /users/login.
 * - `listUsers()` → GET /users.
 * - `signalingUrl()` → shared with call-client.
 */

export interface StoredUser {
  id: string;
  username: string;
  displayName: string;
  token: string;
}
export interface PublicUser {
  id: string;
  username: string;
  displayName: string;
  online: boolean;
}

const STORAGE_KEY = 'web-access.user';

export function signalingUrl(): string {
  if (typeof window === 'undefined') return 'http://localhost:4000';
  const envUrl = (process.env.NEXT_PUBLIC_SIGNALING_URL || '').trim();
  if (envUrl) return envUrl;
  const { protocol, hostname, port } = window.location;
  // If the page is served from a dev port (3000) assume signaling is on :4000
  // of the same host. Otherwise (behind reverse proxy / tunnel) use same origin.
  if (port === '3000' || port === '3001') {
    return `${protocol}//${hostname}:4000`;
  }
  return `${protocol}//${window.location.host}`;
}

export function loadStoredUser(): StoredUser | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const u = JSON.parse(raw) as StoredUser;
    if (!u?.id || !u?.token) return null;
    return u;
  } catch {
    return null;
  }
}
export function saveStoredUser(u: StoredUser) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(u));
}
export function clearStoredUser() {
  localStorage.removeItem(STORAGE_KEY);
}

export async function registerUser(username: string, displayName: string): Promise<StoredUser> {
  const res = await fetch(`${signalingUrl()}/users/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, displayName }),
  });
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(err.error || `register_failed_${res.status}`);
  }
  const u = (await res.json()) as StoredUser;
  saveStoredUser(u);
  return u;
}

export async function registerOrLoginUser({
  fullName,
  email,
  phone,
}: {
  fullName: string;
  email?: string;
  phone?: string;
}): Promise<StoredUser> {
  const res = await fetch(`${signalingUrl()}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      displayName: fullName.trim(),
      email: email?.trim().toLowerCase() || undefined,
      phone: phone?.trim() || undefined,
    }),
  });
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(err.error || `register_failed_${res.status}`);
  }
  const user = (await res.json()) as StoredUser;
  saveStoredUser(user);
  return user;
}

export async function verifyToken(token: string): Promise<{ id: string; username: string; displayName: string } | null> {
  try {
    const res = await fetch(`${signalingUrl()}/users/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token }),
    });
    if (!res.ok) return null;
    return (await res.json()) as { id: string; username: string; displayName: string };
  } catch {
    return null;
  }
}

export async function loginWithToken(token: string): Promise<StoredUser | null> {
  const user = await verifyToken(token);
  if (!user) return null;
  const stored = { ...user, token };
  saveStoredUser(stored);
  return stored;
}

export async function listUsers(): Promise<PublicUser[]> {
  const res = await fetch(`${signalingUrl()}/users`);
  if (!res.ok) return [];
  const body = (await res.json()) as { users: PublicUser[] };
  return body.users || [];
}

/**
 * Authenticated fetch helper used by /chat and /remote pages.
 * Attaches `Authorization: Bearer <token>` from the stored session.
 */
export async function api<T = unknown>(
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const u = loadStoredUser();
  const headers = new Headers(init.headers);
  if (init.body && !headers.has('content-type')) headers.set('content-type', 'application/json');
  if (u?.token) headers.set('authorization', `Bearer ${u.token}`);
  const url = path.startsWith('http') ? path : `${signalingUrl()}${path}`;
  const res = await fetch(url, { ...init, headers });
  if (!res.ok) {
    let detail = '';
    try { detail = JSON.stringify(await res.json()); } catch {}
    throw new Error(`${res.status} ${res.statusText} ${detail}`);
  }
  return (await res.json()) as T;
}
