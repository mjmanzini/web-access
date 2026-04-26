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

window.hostBridge.onConfig(async (cfg) => {
  config = cfg;
  clientUrlEl.textContent = cfg.clientUrl;
  if (metaSignal) metaSignal.textContent = cfg.signalingUrl;
  await requestNewCode();
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

async function connectSignaling(sessionId) {
  if (socket) {
    socket.disconnect();
    socket = null;
  }
  socket = io(config.signalingUrl, { transports: ['websocket'] });
  socket.on('connect', () => {
    setStatus(`signaling connected (id=${socket.id})`);
    socket.emit('join', { sessionId, role: 'host' }, (ack) => {
      if (!ack?.ok) setStatus(`join failed: ${ack?.error}`);
      else setStatus('waiting for client to join…');
    });
  });
  socket.on('connect_error', (err) => setStatus(`signaling error: ${err.message}`));
  socket.on('peer-joined', async ({ role }) => {
    if (role !== 'client') return;
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
