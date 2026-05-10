'use strict';

/* global io */

const FALLBACK_ICE = [{ urls: 'stun:stun.l.google.com:19302' }];

async function fetchIceServers() {
  try {
    const res = await fetch(`${config.signalingUrl}/ice`, { cache: 'no-store' });
    if (!res.ok) throw new Error(`ice http ${res.status}`);
    const data = await res.json();
    if (Array.isArray(data.iceServers) && data.iceServers.length) return data.iceServers;
  } catch (err) {
    console.warn('[host] /ice fetch failed, using fallback STUN', err);
  }
  return FALLBACK_ICE;
}

const statusEl = document.getElementById('status');
const statusDot = document.getElementById('statusDot');
const tokenDot = document.getElementById('tokenDot');
const tokenState = document.getElementById('tokenState');
const modeSwitch = document.getElementById('modeSwitch');
const remotePanel = document.getElementById('remotePanel');
const legacyPanel = document.getElementById('legacyPanel');
const hostTokenInput = document.getElementById('hostToken');
const saveTokenBtn = document.getElementById('saveToken');
const generateRemoteBtn = document.getElementById('generateRemote');
const cancelRemoteBtn = document.getElementById('cancelRemote');
const copyRemoteIdBtn = document.getElementById('copyRemoteId');
const copyPinBtn = document.getElementById('copyPin');
const remoteIdEl = document.getElementById('remoteId');
const pinEl = document.getElementById('pin');
const remoteExpiryEl = document.getElementById('remoteExpiry');
const remoteInviteUrlEl = document.getElementById('remoteInviteUrl');
const copyRemoteLinkBtn = document.getElementById('copyRemoteLink');
const viewerAlertEl = document.getElementById('viewerAlert');
const codeEl = document.getElementById('code');
const qrImg = document.getElementById('qr');
const qrEmpty = document.getElementById('qrEmpty');
const clientUrlEl = document.getElementById('clientUrl');
const newCodeBtn = document.getElementById('newCode');
const copyLinkBtn = document.getElementById('copyLink');
const startCallBtn = document.getElementById('startCall');
const startBtn = document.getElementById('start');
const preview = document.getElementById('preview');
const previewPlaceholder = document.getElementById('previewPlaceholder');
const metaSignal = document.getElementById('metaSignal');
const metaConn = document.getElementById('metaConn');
const logEl = document.getElementById('log');

function setDot(state) {
  if (!statusDot) return;
  statusDot.classList.remove('ok', 'warn', 'err');
  statusDot.classList.add(state);
}
function appendLog(line) {
  if (!logEl) return;
  const ts = new Date().toLocaleTimeString();
  logEl.textContent = `${ts} · ${line}`;
}

function setQrPlaceholder(text, hidden = false) {
  if (!qrEmpty) return;
  qrEmpty.textContent = text;
  qrEmpty.classList.toggle('hidden', hidden);
}

let config = null;
let socket = null;
let pc = null;
let localStream = null;
let controlChannel = null;
let currentSession = null;
let videoSender = null;
let sessionMode = 'remote';
let expiryTimer = null;
let remoteStatusTimer = null;

const STORAGE_KEYS = {
  mode: 'web-access.host.mode',
  token: 'web-access.host.token',
};

// Encoder presets applied on a 'quality' message from the client.
const QUALITY_PRESETS = {
  low:    { maxBitrate: 400_000,  maxFramerate: 15, scaleResolutionDownBy: 2 },
  medium: { maxBitrate: 1_500_000, maxFramerate: 24, scaleResolutionDownBy: 1.25 },
  high:   { maxBitrate: 4_000_000, maxFramerate: 30, scaleResolutionDownBy: 1 },
};

function setStatus(msg) {
  statusEl.textContent = msg;
  appendLog(msg);
  // eslint-disable-next-line no-console
  console.log('[host]', msg);
}

function savedToken() {
  try { return localStorage.getItem(STORAGE_KEYS.token) || ''; } catch { return ''; }
}

function setSavedToken(token) {
  try { localStorage.setItem(STORAGE_KEYS.token, token); } catch {}
}

function setSavedMode(mode) {
  try { localStorage.setItem(STORAGE_KEYS.mode, mode); } catch {}
}

function loadSavedMode() {
  try { return localStorage.getItem(STORAGE_KEYS.mode) || 'remote'; } catch { return 'remote'; }
}

function maskRemoteId(id) {
  const digits = String(id || '').replace(/\D/g, '').slice(0, 12);
  if (!digits) return '——— ——— ———';
  return digits.replace(/(\d{3})(?=\d)/g, '$1 ').trim();
}

function setTokenState(ok, text) {
  if (!tokenDot || !tokenState) return;
  tokenDot.classList.remove('ok', 'warn', 'err');
  tokenDot.classList.add(ok ? 'ok' : 'warn');
  tokenState.textContent = text;
}

function fmtExpiry(iso) {
  const remaining = new Date(iso).getTime() - Date.now();
  if (remaining <= 0) return 'Expired';
  const minutes = Math.floor(remaining / 60000);
  const seconds = Math.floor((remaining % 60000) / 1000);
  return `Expires in ${minutes}:${String(seconds).padStart(2, '0')}`;
}

function updateRemoteExpiry() {
  if (!remoteExpiryEl) return;
  if (!currentSession || currentSession.mode !== 'remote' || !currentSession.expiresAt) {
    remoteExpiryEl.textContent = 'Generate a one-time PIN to start accepting remote connections.';
    return;
  }
  remoteExpiryEl.textContent = fmtExpiry(currentSession.expiresAt);
  if (new Date(currentSession.expiresAt).getTime() <= Date.now()) {
    currentSession = null;
    remoteIdEl.textContent = maskRemoteId('');
    pinEl.textContent = '——————';
    if (expiryTimer) { clearInterval(expiryTimer); expiryTimer = null; }
    setStatus('remote PIN expired');
  }
}

function startRemoteStatusPolling() {
  if (remoteStatusTimer) clearInterval(remoteStatusTimer);
  remoteStatusTimer = setInterval(() => {
    void syncRemoteStatus();
  }, 5000);
}

async function syncRemoteStatus() {
  if (!config || sessionMode !== 'remote') return;
  const token = hostTokenInput.value.trim() || savedToken();
  if (!token) return;
  const result = await window.hostBridge.remoteStatus(token).catch(() => null);
  if (!result?.ok || !result.ready || !result.sessionId) return;
  if (currentSession?.sessionId === result.sessionId && socket?.connected) return;
  currentSession = {
    mode: 'remote',
    remoteId: currentSession?.remoteId || '',
    pin: currentSession?.pin || '',
    sessionId: result.sessionId,
    expiresAt: result.pinExpiresAt,
  };
  setRemoteInviteLink();
  updateRemoteExpiry();
  setStatus(`web-created remote session detected. Listening on ${remoteInviteUrl()}`);
  await connectSignaling(result.sessionId);
  await startCapture().catch(() => {});
}

function remoteInviteUrl() {
  return currentSession?.sessionId ? `${config.clientUrl}/remote?sessionId=${encodeURIComponent(currentSession.sessionId)}` : '';
}

function setRemoteInviteLink() {
  if (!remoteInviteUrlEl) return;
  remoteInviteUrlEl.textContent = remoteInviteUrl() || 'Generate a session first';
}

function showViewerAlert(message) {
  if (!viewerAlertEl) return;
  viewerAlertEl.textContent = message;
  viewerAlertEl.classList.add('show');
  setTimeout(() => viewerAlertEl.classList.remove('show'), 8000);
}

function setMode(mode) {
  sessionMode = mode;
  setSavedMode(mode);
  remotePanel.classList.toggle('hidden', mode !== 'remote');
  legacyPanel.classList.toggle('hidden', mode !== 'legacy');
  for (const button of modeSwitch.querySelectorAll('button[data-mode]')) {
    button.classList.toggle('active', button.dataset.mode === mode);
  }
}

async function copyText(value, okLabel) {
  if (!value) return;
  try {
    await navigator.clipboard.writeText(value);
    setStatus(okLabel);
  } catch (err) {
    setStatus(`copy failed: ${err.message}`);
  }
}

function teardownPeerConnection() {
  try { controlChannel?.close(); } catch {}
  try { pc?.close(); } catch {}
  controlChannel = null;
  pc = null;
  videoSender = null;
}

function disconnectSignaling() {
  if (!socket) return;
  socket.disconnect();
  socket = null;
}

async function resetSessionState() {
  disconnectSignaling();
  teardownPeerConnection();
  await window.hostBridge.inputReleaseAll().catch(() => {});
  if (metaConn) metaConn.textContent = '—';
  setDot('warn');
}

window.hostBridge.onConfig(async (cfg) => {
  config = cfg;
  clientUrlEl.textContent = cfg.clientUrl;
  if (metaSignal) metaSignal.textContent = cfg.signalingUrl;
  const token = savedToken();
  hostTokenInput.value = token;
  setTokenState(Boolean(token), token ? 'token saved locally' : 'token required');
  setMode(loadSavedMode());
  updateRemoteExpiry();
  startRemoteStatusPolling();
  if (sessionMode === 'remote' && token) await requestRemoteSession();
  else if (sessionMode === 'legacy') await requestNewCode();
});

modeSwitch.addEventListener('click', async (event) => {
  const button = event.target.closest('button[data-mode]');
  if (!button) return;
  const nextMode = button.dataset.mode;
  if (!nextMode || nextMode === sessionMode) return;
  await resetSessionState();
  currentSession = null;
  setMode(nextMode);
  if (nextMode === 'remote') {
    remoteIdEl.textContent = maskRemoteId('');
    pinEl.textContent = '——————';
    updateRemoteExpiry();
    if (savedToken()) await requestRemoteSession();
  } else {
    codeEl.textContent = '——————';
    qrImg.removeAttribute('src');
    setQrPlaceholder('Generating QR code…');
    await requestNewCode();
  }
});

saveTokenBtn.addEventListener('click', async () => {
  const token = hostTokenInput.value.trim();
  setSavedToken(token);
  setTokenState(Boolean(token), token ? 'token saved locally' : 'token required');
  if (!token) {
    await cancelRemoteSession(false);
    setStatus('host token cleared');
    return;
  }
  setStatus('host token saved');
  startRemoteStatusPolling();
  await syncRemoteStatus();
});

generateRemoteBtn.addEventListener('click', () => requestRemoteSession());
cancelRemoteBtn.addEventListener('click', () => cancelRemoteSession(true));
copyRemoteIdBtn.addEventListener('click', () => copyText(currentSession?.remoteId, 'partner ID copied'));
copyPinBtn.addEventListener('click', () => copyText(currentSession?.pin, 'one-time PIN copied'));
copyRemoteLinkBtn.addEventListener('click', () => copyText(remoteInviteUrl(), 'remote invite link copied'));

hostTokenInput.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') {
    event.preventDefault();
    saveTokenBtn.click();
  }
});

newCodeBtn.addEventListener('click', () => requestNewCode());
copyLinkBtn.addEventListener('click', async () => {
  const joinUrl = currentSession ? `${config.clientUrl}/?code=${currentSession.code}` : config?.clientUrl;
  if (!joinUrl) return;
  try {
    await navigator.clipboard.writeText(joinUrl);
    setStatus('phone link copied');
  } catch (err) {
    setStatus(`copy failed: ${err.message}`);
  }
});
startBtn.addEventListener('click', () => startCapture());

startCallBtn.addEventListener('click', async () => {
  if (!currentSession) {
    setStatus('waiting for a code before starting a call…');
    return;
  }
  try {
    await window.hostBridge.openCallWindow(currentSession.code);
    setStatus(`call window opened for room ${currentSession.code}`);
  } catch (err) {
    setStatus(`open call failed: ${err.message}`);
  }
});

qrImg.addEventListener('load', () => setQrPlaceholder('', true));
qrImg.addEventListener('error', () => setQrPlaceholder('QR unavailable. Use the code or copy the phone link.', false));

async function requestNewCode() {
  if (!config) return;
  await resetSessionState();
  setStatus('requesting pairing code…');
  qrImg.removeAttribute('src');
  setQrPlaceholder('Generating QR code…');
  try {
    const headers = { 'content-type': 'application/json' };
    if (config.sharedSecret) headers['x-shared-secret'] = config.sharedSecret;
    const res = await fetch(`${config.signalingUrl}/pair/new`, { method: 'POST', headers });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const { code, sessionId } = await res.json();
    currentSession = { code, sessionId };
    setRemoteInviteLink();
    codeEl.textContent = code;
    const joinUrl = `${config.clientUrl}/?code=${code}`;
    try {
      qrImg.src = await window.hostBridge.makeQr(joinUrl);
    } catch (err) {
      setQrPlaceholder('QR unavailable. Use the code or copy the phone link.', false);
      appendLog(`qr failed: ${err.message}`);
    }
    setStatus(`ready. share code ${code} with the client.`);
    await connectSignaling(sessionId);
  } catch (err) {
    setQrPlaceholder('Could not get a pairing code yet.', false);
    setStatus(`failed to get code: ${err.message}`);
  }
}

async function requestRemoteSession() {
  if (!config) return;
  const token = hostTokenInput.value.trim() || savedToken();
  if (!token) {
    setTokenState(false, 'token required');
    setStatus('paste and save a host token first');
    hostTokenInput.focus();
    return;
  }
  setSavedToken(token);
  setTokenState(true, 'requesting remote PIN…');
  await resetSessionState();
  remoteIdEl.textContent = maskRemoteId('');
  pinEl.textContent = '——————';
  updateRemoteExpiry();
  const result = await window.hostBridge.remoteAnnounce(token);
  if (!result?.ok) {
    setTokenState(false, result?.error ? `token rejected: ${result.error}` : 'request failed');
    setStatus(`remote announce failed: ${result?.error || 'unknown error'}`);
    return;
  }
  currentSession = {
    mode: 'remote',
    remoteId: result.remoteId,
    pin: result.pin,
    sessionId: result.sessionId,
    expiresAt: result.expiresAt,
  };
  setRemoteInviteLink();
  remoteIdEl.textContent = maskRemoteId(result.remoteId);
  pinEl.textContent = result.pin;
  setTokenState(true, 'token saved locally');
  updateRemoteExpiry();
  if (expiryTimer) clearInterval(expiryTimer);
  expiryTimer = setInterval(updateRemoteExpiry, 1000);
  setStatus(`remote PIN ready for partner ${maskRemoteId(result.remoteId)}`);
  setStatus(`remote session started. Share ${remoteInviteUrl()}`);
  await connectSignaling(result.sessionId);
  await startCapture().catch(() => {});
}

async function cancelRemoteSession(report = true) {
  if (expiryTimer) { clearInterval(expiryTimer); expiryTimer = null; }
  const token = hostTokenInput.value.trim() || savedToken();
  if (token) await window.hostBridge.remoteCancel(token).catch(() => {});
  currentSession = null;
  setRemoteInviteLink();
  remoteIdEl.textContent = maskRemoteId('');
  pinEl.textContent = '——————';
  updateRemoteExpiry();
  await resetSessionState();
  if (report) setStatus('remote session cancelled');
}

async function connectSignaling(sessionId) {
  disconnectSignaling();
  socket = io(config.signalingUrl, { transports: ['websocket'] });
  socket.on('connect', () => {
    setStatus(`signaling connected (id=${socket.id})`);
    socket.emit('join', { sessionId, role: 'host', token: hostTokenInput.value.trim() || savedToken() }, (ack) => {
      if (!ack?.ok) setStatus(`join failed: ${ack?.error}`);
      else setStatus('waiting for client to join…');
    });
  });
  socket.on('connect_error', (err) => setStatus(`signaling error: ${err.message}`));
  socket.on('peer-joined', async ({ role }) => {
    if (role !== 'client') return;
    showViewerAlert('Viewer opened the invite link. Starting secure desktop stream…');
    setStatus('client joined, starting capture…');
    await startCapture();
    await createOffer();
  });
  socket.on('peer-left', ({ role }) => {
    if (role === 'client') {
      setStatus('client disconnected');
      window.hostBridge.inputReleaseAll().catch(() => {});
    }
  });
  socket.on('signal', async (msg) => {
    if (!pc) return;
    if (msg.sdp) {
      await pc.setRemoteDescription(msg.sdp);
    } else if (msg.candidate) {
      try { await pc.addIceCandidate(msg.candidate); } catch (e) { console.warn(e); }
    }
  });
  socket.on('disconnect', () => setStatus('signaling disconnected'));
}

async function startCapture() {
  if (localStream) return localStream;
  try {
    // Electron routes this to our setDisplayMediaRequestHandler in main.js.
    localStream = await navigator.mediaDevices.getDisplayMedia({
      video: { frameRate: 30 },
      audio: false,
    });
    preview.srcObject = localStream;
    if (previewPlaceholder) previewPlaceholder.style.display = 'none';
    setStatus('capturing screen');
    return localStream;
  } catch (err) {
    setStatus(`capture failed: ${err.message}`);
    throw err;
  }
}

async function createOffer() {
  if (!localStream) await startCapture();
  teardownPeerConnection();
  const iceServers = await fetchIceServers();
  pc = new RTCPeerConnection({ iceServers });

  // Data channel for low-latency input (mouse/keyboard from client -> host).
  // Unordered + no retransmits: input freshness matters far more than delivery
  // of stale events. Video frames stay on their own SCTP stream.
  controlChannel = pc.createDataChannel('control', { ordered: false, maxRetransmits: 0 });
  controlChannel.onopen = () => setStatus('control channel open');
  controlChannel.onmessage = (ev) => handleControlMessage(ev.data);

  localStream.getTracks().forEach((t) => {
    const sender = pc.addTrack(t, localStream);
    if (t.kind === 'video') videoSender = sender;
  });

  pc.onicecandidate = (ev) => {
    if (ev.candidate) socket.emit('signal', { candidate: ev.candidate });
  };
  pc.onconnectionstatechange = () => {
    setStatus(`pc: ${pc.connectionState}`);
    if (metaConn) metaConn.textContent = pc.connectionState;
    if (pc.connectionState === 'connected') setDot('ok');
    else if (pc.connectionState === 'failed' || pc.connectionState === 'disconnected') setDot('err');
    else setDot('warn');
  };

  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);
  socket.emit('signal', { sdp: pc.localDescription });
}

function handleControlMessage(data) {
  let msg;
  try {
    msg = typeof data === 'string' ? JSON.parse(data) : JSON.parse(new TextDecoder().decode(data));
  } catch {
    console.warn('[host] control: could not parse', data);
    return;
  }

  if (msg.t === 'quality') {
    void applyQuality(msg.level);
    return;
  }

  // Everything else is OS input — forward to the main process executor.
  window.hostBridge.inputEvent(msg).catch((err) => {
    console.warn('[host] inputEvent failed', err);
  });
}

async function applyQuality(level) {
  const preset = QUALITY_PRESETS[level];
  if (!preset || !videoSender) return;
  try {
    const params = videoSender.getParameters();
    params.encodings = params.encodings && params.encodings.length ? params.encodings : [{}];
    for (const e of params.encodings) {
      e.maxBitrate = preset.maxBitrate;
      e.maxFramerate = preset.maxFramerate;
      e.scaleResolutionDownBy = preset.scaleResolutionDownBy;
    }
    await videoSender.setParameters(params);
    setStatus(`quality: ${level} (${Math.round(preset.maxBitrate / 1000)} kbps, ${preset.maxFramerate} fps)`);
  } catch (err) {
    console.warn('[host] setParameters failed', err);
  }
}
