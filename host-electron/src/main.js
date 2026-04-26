'use strict';

require('dotenv').config();

const { app, BrowserWindow, desktopCapturer, ipcMain, session } = require('electron');
const path = require('node:path');
const os = require('node:os');
const QRCode = require('qrcode');
const inputExecutor = require('./input-executor');

// Pick the first non-internal IPv4 LAN address so QR URLs and signaling both
// point at something the phone can actually reach. Falls back to localhost if
// no LAN interface is up (rare dev case).
function detectLanIp() {
  const ifaces = os.networkInterfaces();
  for (const list of Object.values(ifaces)) {
    for (const i of list || []) {
      if (i.family === 'IPv4' && !i.internal) return i.address;
    }
  }
  return 'localhost';
}

const LAN_IP = detectLanIp();
const DEFAULT_SCHEME = process.env.HTTPS === '1' || process.env.HTTPS === 'true' ? 'https' : 'http';
const SIGNALING_URL = process.env.SIGNALING_URL || `${DEFAULT_SCHEME}://${LAN_IP}:4000`;
const CLIENT_URL = process.env.CLIENT_URL || `${DEFAULT_SCHEME}://${LAN_IP}:3000`;
const SHARED_SECRET = process.env.SIGNALING_SHARED_SECRET || '';
console.log(`[host] LAN ip=${LAN_IP}  signaling=${SIGNALING_URL}  client=${CLIENT_URL}`);

function createWindow() {
  const win = new BrowserWindow({
    width: 720,
    height: 520,
    title: 'Web-Access Host',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  // Inject runtime config for the renderer.
  win.webContents.on('did-finish-load', () => {
    win.webContents.send('config', {
      signalingUrl: SIGNALING_URL,
      clientUrl: CLIENT_URL,
      sharedSecret: SHARED_SECRET,
    });
  });

  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
}

// Modern Electron requires an explicit display-media handler to use getDisplayMedia().
app.whenReady().then(async () => {
  await inputExecutor.init();

  session.defaultSession.setDisplayMediaRequestHandler((_request, callback) => {
    desktopCapturer
      .getSources({ types: ['screen'] })
      .then((sources) => {
        // Prefer the primary screen; fall back to whatever is available.
        const screen = sources[0];
        if (!screen) return callback({});
        // Using { video: screen } lets Chromium build a MediaStreamTrack directly.
        callback({ video: screen });
      })
      .catch(() => callback({}));
  });

  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// IPC: renderer asks main for the list of capturable sources (optional UI).
ipcMain.handle('list-sources', async () => {
  const sources = await desktopCapturer.getSources({
    types: ['screen', 'window'],
    thumbnailSize: { width: 320, height: 180 },
  });
  return sources.map((s) => ({
    id: s.id,
    name: s.name,
    thumbnail: s.thumbnail.toDataURL(),
  }));
});

// IPC: generate a QR code data URL in the main process (keeps renderer CSP strict).
ipcMain.handle('make-qr', async (_e, text) => {
  return QRCode.toDataURL(String(text), { margin: 1, width: 180 });
});

// IPC: renderer -> main control messages from the WebRTC data channel.
ipcMain.handle('input-event', async (_e, msg) => {
  await inputExecutor.handle(msg);
  return { ok: true, available: inputExecutor.available };
});
ipcMain.handle('input-release-all', async () => {
  await inputExecutor.releaseAll();
  return { ok: true };
});
ipcMain.handle('input-status', () => ({ available: inputExecutor.available }));

// IPC: ask the signaling server to mint a fresh remote-control PIN for this
// host. The renderer can call `window.hostBridge.remoteAnnounce(token)` from
// the new TeamViewer-style flow; `token` is the bearer token of the host's
// account (issued by /api/auth/register on the web client and pasted into the
// host once via Settings).
ipcMain.handle('remote-announce', async (_e, { token }) => {
  if (!token) return { ok: false, error: 'missing token' };
  try {
    const res = await fetch(`${SIGNALING_URL}/api/remote/announce`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: '{}',
    });
    const text = await res.text();
    let data; try { data = JSON.parse(text); } catch { data = { raw: text }; }
    if (!res.ok) return { ok: false, status: res.status, error: data.error || text };
    return { ok: true, ...data };
  } catch (err) {
    return { ok: false, error: err && err.message ? err.message : String(err) };
  }
});
ipcMain.handle('remote-cancel', async (_e, { token }) => {
  if (!token) return { ok: false, error: 'missing token' };
  try {
    const res = await fetch(`${SIGNALING_URL}/api/remote/cancel`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: '{}',
    });
    return { ok: res.ok };
  } catch (err) {
    return { ok: false, error: err && err.message ? err.message : String(err) };
  }
});

// IPC: open the call UI in a second BrowserWindow pointed at the web-client
// `/call?room=<code>` route. Reusing the web-client means the Electron host
// inherits the full Teams-style UI (mic/cam/screen/chat) without duplicating it.
ipcMain.handle('open-call-window', async (_e, { code }) => {
  const url = `${CLIENT_URL}/call?room=${encodeURIComponent(String(code || ''))}`;
  const win = new BrowserWindow({
    width: 1100,
    height: 720,
    title: 'Web-Access Call',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });
  await win.loadURL(url);
  return { ok: true };
});
