'use client';

import { useEffect, useRef, useState } from 'react';
import { AppShell } from '../../components/app/AppShell';
import { ThemeToggle } from '../../components/theme/ThemeProvider';
import {
  loadStoredUser,
  saveStoredUser,
  signalingUrl,
  type StoredUser,
} from '../../lib/user-session';

const MAX_RAW_BYTES = 200 * 1024;
const TARGET_DIM = 256;

async function compressImage(file: File): Promise<string> {
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result || ''));
    r.onerror = () => reject(new Error('read_failed'));
    r.readAsDataURL(file);
  });
  if (typeof Image === 'undefined' || typeof document === 'undefined') return dataUrl;

  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const i = new Image();
    i.onload = () => resolve(i);
    i.onerror = () => reject(new Error('decode_failed'));
    i.src = dataUrl;
  });

  const ratio = Math.min(1, TARGET_DIM / Math.max(img.width, img.height));
  const w = Math.max(1, Math.round(img.width * ratio));
  const h = Math.max(1, Math.round(img.height * ratio));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) return dataUrl;
  ctx.drawImage(img, 0, 0, w, h);

  for (const quality of [0.85, 0.7, 0.55, 0.4]) {
    const out = canvas.toDataURL('image/jpeg', quality);
    if (out.length <= Math.floor(MAX_RAW_BYTES * 1.4)) return out;
  }
  return canvas.toDataURL('image/jpeg', 0.4);
}

export default function SettingsPage() {
  const [user, setUser] = useState<StoredUser | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setUser(loadStoredUser());
  }, []);

  const onPick = () => {
    setError(null);
    fileRef.current?.click();
  };

  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || !user) return;
    if (!/^image\//.test(file.type)) {
      setError('Pick an image file.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const dataUrl = await compressImage(file);
      const res = await fetch(`${signalingUrl()}/api/me/avatar`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${user.token}`,
        },
        body: JSON.stringify({ avatarUrl: dataUrl }),
      });
      if (!res.ok) {
        const msg = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(msg.error || `upload_failed_${res.status}`);
      }
      const body = (await res.json()) as { user: { avatarUrl?: string | null } };
      const next: StoredUser = { ...user, avatarUrl: body.user?.avatarUrl ?? dataUrl };
      saveStoredUser(next);
      setUser(next);
    } catch (err) {
      setError((err as Error).message || 'Could not update photo.');
    } finally {
      setBusy(false);
    }
  };

  const onRemove = async () => {
    if (!user) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`${signalingUrl()}/api/me/avatar`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${user.token}`,
        },
        body: JSON.stringify({ avatarUrl: '' }),
      });
      if (!res.ok) throw new Error('remove_failed');
      const next: StoredUser = { ...user, avatarUrl: null };
      saveStoredUser(next);
      setUser(next);
    } catch (err) {
      setError((err as Error).message || 'Could not remove photo.');
    } finally {
      setBusy(false);
    }
  };

  const initial = user?.displayName?.[0]?.toUpperCase() ?? '?';

  return (
    <AppShell title="Settings" subtitle="Profile and app preferences">
      <div className="wa-hub">
        <div className="wa-hub-head">
          <span className="wa-kicker">Settings</span>
          <h2>Preferences</h2>
          <p>Profile, device, notification, and privacy controls will appear here.</p>
        </div>

        {user && (
          <section className="wa-waiting-room">
            <h3 className="wa-settings-title">Profile</h3>
            <div className="wa-settings-row profile-avatar-row">
              <div className="profile-avatar" aria-hidden>
                {user.avatarUrl ? <img src={user.avatarUrl} alt="" /> : initial}
              </div>
              <div className="profile-avatar-actions">
                <strong>{user.displayName}</strong>
                <span style={{ color: 'var(--wa-muted)', fontSize: 13 }}>@{user.username}</span>
                <p className="profile-avatar-hint">PNG, JPG, or WebP. Auto-resized to 256px, max ~200&nbsp;KB.</p>
                <div className="row">
                  <button
                    type="button"
                    className="wa-primary-btn"
                    onClick={onPick}
                    disabled={busy}
                  >
                    {busy ? 'Saving…' : user.avatarUrl ? 'Change photo' : 'Upload photo'}
                  </button>
                  {user.avatarUrl && (
                    <button
                      type="button"
                      className="add-contact-secondary"
                      onClick={() => void onRemove()}
                      disabled={busy}
                    >
                      Remove
                    </button>
                  )}
                </div>
                {error && <span className="profile-avatar-error">{error}</span>}
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/*"
                  hidden
                  onChange={(e) => void onFile(e)}
                />
              </div>
            </div>
          </section>
        )}

        <section className="wa-waiting-room">
          <h3 className="wa-settings-title">Appearance</h3>
          <div className="wa-settings-row">
            <div>
              <strong>Theme</strong>
              <span>Switch between WhatsApp light, WhatsApp dark, and system mode.</span>
            </div>
            <ThemeToggle className="wa-theme-toggle settings" />
          </div>
        </section>
      </div>
    </AppShell>
  );
}
