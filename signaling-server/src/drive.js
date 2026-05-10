/**
 * drive.js — upload chat attachments to a user's Google Drive (drive.file scope).
 *
 * Endpoint: POST /api/drive/upload  (Bearer auth required)
 *   Body: { filename: string, mime: string, dataUrl: string, folder?: string }
 *   Resp: { id, name, webViewLink, webContentLink }
 *
 * Notes:
 *   - Uses each user's Google refresh token captured at OAuth login.
 *   - No googleapis dependency; calls REST endpoints directly.
 *   - Files are placed in a per-user "Web-Access Backups" folder, created lazily.
 *   - Caps payload at ~10MB to match the Express JSON limit headroom.
 */
import { logEvent } from './db.js';

const DRIVE_FOLDER_NAME = 'Web-Access Backups';
const MAX_BYTES = 10 * 1024 * 1024;

function decodeDataUrl(dataUrl) {
  const m = /^data:([^;,]+)?(;base64)?,(.*)$/.exec(String(dataUrl || ''));
  if (!m) return null;
  const mime = m[1] || 'application/octet-stream';
  const isB64 = !!m[2];
  const payload = m[3] || '';
  const buf = isB64
    ? Buffer.from(payload, 'base64')
    : Buffer.from(decodeURIComponent(payload), 'utf8');
  return { mime, buf };
}

async function refreshGoogleAccessToken(refreshToken) {
  const params = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID || '',
    client_secret: process.env.GOOGLE_CLIENT_SECRET || '',
    refresh_token: refreshToken,
    grant_type: 'refresh_token',
  });
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params,
  });
  if (!r.ok) {
    const txt = await r.text().catch(() => '');
    throw new Error(`refresh_failed: ${r.status} ${txt.slice(0, 200)}`);
  }
  const j = await r.json();
  return {
    accessToken: j.access_token,
    expiresAt: j.expires_in ? Date.now() + (Number(j.expires_in) - 60) * 1000 : null,
  };
}

async function ensureValidAccessToken(storage, userId) {
  const tok = await storage.auth.getOAuthTokensForUser({ userId, provider: 'google' });
  if (!tok || !tok.refreshToken) {
    const e = new Error('no_drive_consent'); e.statusCode = 412; throw e;
  }
  if (tok.accessToken && tok.accessTokenExp && tok.accessTokenExp > Date.now() + 30_000) {
    return tok.accessToken;
  }
  const fresh = await refreshGoogleAccessToken(tok.refreshToken);
  if (!fresh.accessToken) {
    const e = new Error('refresh_failed'); e.statusCode = 502; throw e;
  }
  await storage.auth.setOAuthTokens({
    provider: 'google',
    providerUserId: tok.providerUserId,
    refreshToken: null,
    accessToken: fresh.accessToken,
    expiresAt: fresh.expiresAt,
  });
  return fresh.accessToken;
}

async function findOrCreateBackupFolder(accessToken, name) {
  const q = encodeURIComponent(
    `mimeType='application/vnd.google-apps.folder' and name='${name.replace(/'/g, "\\'")}' and trashed=false`,
  );
  const lookup = await fetch(`https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id,name)&spaces=drive`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (lookup.ok) {
    const j = await lookup.json();
    if (Array.isArray(j.files) && j.files.length > 0) return j.files[0].id;
  }
  const create = await fetch('https://www.googleapis.com/drive/v3/files?fields=id', {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, mimeType: 'application/vnd.google-apps.folder' }),
  });
  if (!create.ok) {
    const txt = await create.text().catch(() => '');
    throw new Error(`folder_create_failed: ${create.status} ${txt.slice(0, 200)}`);
  }
  const j = await create.json();
  return j.id;
}

async function uploadToDrive(accessToken, { name, mime, buf, parentId }) {
  const boundary = '-------web-access-' + Math.random().toString(16).slice(2);
  const meta = JSON.stringify({ name, mimeType: mime, parents: parentId ? [parentId] : undefined });
  const body = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${meta}\r\n`, 'utf8'),
    Buffer.from(`--${boundary}\r\nContent-Type: ${mime}\r\n\r\n`, 'utf8'),
    buf,
    Buffer.from(`\r\n--${boundary}--`, 'utf8'),
  ]);
  const r = await fetch(
    'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,webViewLink,webContentLink',
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': `multipart/related; boundary=${boundary}`,
        'Content-Length': String(body.length),
      },
      body,
    },
  );
  if (!r.ok) {
    const txt = await r.text().catch(() => '');
    const err = new Error(`drive_upload_failed: ${r.status} ${txt.slice(0, 240)}`);
    err.statusCode = r.status === 401 ? 401 : 502;
    throw err;
  }
  return await r.json();
}

export function attachDriveRoutes(app, storage, requireAuth) {
  app.get('/api/drive/status', requireAuth, async (req, res) => {
    try {
      const tok = await storage.auth.getOAuthTokensForUser({
        userId: req.user.id,
        provider: 'google',
      });
      res.json({ connected: !!(tok && tok.refreshToken) });
    } catch {
      res.json({ connected: false });
    }
  });

  app.post('/api/drive/upload', requireAuth, async (req, res) => {
    try {
      const { filename, mime, dataUrl } = req.body || {};
      if (!filename || !dataUrl) return res.status(400).json({ error: 'missing_fields' });
      const decoded = decodeDataUrl(dataUrl);
      if (!decoded) return res.status(400).json({ error: 'invalid_data_url' });
      if (decoded.buf.length > MAX_BYTES) {
        return res.status(413).json({ error: 'too_large', maxBytes: MAX_BYTES });
      }
      const finalMime = mime || decoded.mime || 'application/octet-stream';
      const accessToken = await ensureValidAccessToken(storage, req.user.id);
      const parentId = await findOrCreateBackupFolder(accessToken, DRIVE_FOLDER_NAME);
      const file = await uploadToDrive(accessToken, {
        name: String(filename).slice(0, 200),
        mime: finalMime,
        buf: decoded.buf,
        parentId,
      });
      logEvent('drive_upload', {
        userId: req.user.id,
        payload: { name: file.name, bytes: decoded.buf.length, mime: finalMime },
      });
      res.json(file);
    } catch (e) {
      const status = e?.statusCode || 500;
      const msg = String(e?.message || 'drive_failed');
      console.warn('[drive] upload error:', msg);
      res.status(status).json({ error: msg });
    }
  });
}
