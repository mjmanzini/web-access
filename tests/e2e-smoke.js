// E2E smoke test for Web-Access.
// Exercises:
//   - signaling HTTP: /healthz, /ice, POST /pair/new, GET /pair/resolve/:code
//   - signaling socket.io: two peers (host+client) join the same session, each
//     receives peer-joined, SDP/ICE-shaped messages relay in both directions,
//     peer-left fires when one disconnects.
//   - web-client: / returns 200 HTML, /manifest.webmanifest is served, /sw.js
//     is served, /icons/icon-192.svg is served.
// Prints PASS/FAIL per check and exits non-zero on any failure.

const { io } = require('socket.io-client');

const SIGNAL = process.env.SIGNAL_URL || 'http://127.0.0.1:4000';
const WEB = process.env.WEB_URL || 'http://127.0.0.1:3000';

const results = [];
function record(name, ok, detail = '') {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
}

async function getJson(url) {
  const res = await fetch(url);
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { /* not json */ }
  return { status: res.status, text, json, headers: res.headers };
}

async function postJson(url, body) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body || {}),
  });
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { /* not json */ }
  return { status: res.status, text, json };
}

function waitEvent(socket, event, timeoutMs = 3000) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`timeout waiting for ${event}`)), timeoutMs);
    socket.once(event, (payload) => { clearTimeout(t); resolve(payload); });
  });
}

async function main() {
  // ---------- HTTP: signaling ----------
  try {
    const r = await getJson(`${SIGNAL}/healthz`);
    record('signaling /healthz 200', r.status === 200 && (r.json?.ok === true || /ok/i.test(r.text)), `status=${r.status}`);
  } catch (e) { record('signaling /healthz 200', false, e.message); }

  try {
    const r = await getJson(`${SIGNAL}/ice`);
    const list = r.json?.iceServers;
    record('signaling /ice returns iceServers[]', Array.isArray(list) && list.length > 0, `got ${list?.length ?? 0}`);
  } catch (e) { record('signaling /ice returns iceServers[]', false, e.message); }

  let pair;
  try {
    const r = await postJson(`${SIGNAL}/pair/new`, {});
    pair = r.json;
    const okShape = !!pair?.code && !!pair?.sessionId && typeof pair.expiresAt === 'number';
    record('POST /pair/new returns code+sessionId+expiresAt', okShape, JSON.stringify(pair));
  } catch (e) { record('POST /pair/new returns code+sessionId+expiresAt', false, e.message); }

  if (pair?.code) {
    try {
      const r = await getJson(`${SIGNAL}/pair/resolve/${pair.code}`);
      record('GET /pair/resolve/:code returns sessionId', r.status === 200 && r.json?.sessionId === pair.sessionId, JSON.stringify(r.json));
    } catch (e) { record('GET /pair/resolve/:code returns sessionId', false, e.message); }

    try {
      const r = await getJson(`${SIGNAL}/pair/resolve/ZZZZZZ`);
      record('GET /pair/resolve/:bad returns 404', r.status === 404, `status=${r.status}`);
    } catch (e) { record('GET /pair/resolve/:bad returns 404', false, e.message); }
  }

  // ---------- Socket.IO: two-peer relay ----------
  if (pair?.sessionId) {
    const host = io(SIGNAL, { transports: ['websocket'], reconnection: false, forceNew: true });
    const client = io(SIGNAL, { transports: ['websocket'], reconnection: false, forceNew: true });

    try {
      await Promise.all([waitEvent(host, 'connect'), waitEvent(client, 'connect')]);
      record('two socket.io peers connect', true);

      const hostJoinAck = await new Promise((res, rej) => {
        const t = setTimeout(() => rej(new Error('join ack timeout')), 3000);
        host.emit('join', { sessionId: pair.sessionId, role: 'host' }, (ack) => { clearTimeout(t); res(ack); });
      });
      record('host join ack ok', hostJoinAck?.ok === true, JSON.stringify(hostJoinAck));

      // Client joins and host should receive peer-joined with role=client.
      const hostPeerJoined = waitEvent(host, 'peer-joined', 3000);
      const clientJoinAck = await new Promise((res, rej) => {
        const t = setTimeout(() => rej(new Error('join ack timeout')), 3000);
        client.emit('join', { sessionId: pair.sessionId, role: 'client' }, (ack) => { clearTimeout(t); res(ack); });
      });
      record('client join ack ok', clientJoinAck?.ok === true, JSON.stringify(clientJoinAck));

      const pj = await hostPeerJoined;
      record('host receives peer-joined(role=client)', pj?.role === 'client', JSON.stringify(pj));

      // Client->Host signal (SDP offer shape).
      const hostGotSignal = waitEvent(host, 'signal', 3000);
      client.emit('signal', { sessionId: pair.sessionId, data: { type: 'offer', sdp: 'v=0\r\no=- 0 0 IN IP4 0.0.0.0' } });
      const sig = await hostGotSignal;
      record('client->host signal relayed', sig?.data?.type === 'offer', JSON.stringify(sig?.data?.type));

      // Host->Client signal (ICE candidate shape).
      const clientGotSignal = waitEvent(client, 'signal', 3000);
      host.emit('signal', { sessionId: pair.sessionId, data: { candidate: 'candidate:1 1 UDP 1 127.0.0.1 1000 typ host' } });
      const sig2 = await clientGotSignal;
      record('host->client signal relayed', !!sig2?.data?.candidate, JSON.stringify(!!sig2?.data?.candidate));

      // Duplicate-role rejection: another client joining the same session should fail.
      const dup = io(SIGNAL, { transports: ['websocket'], reconnection: false, forceNew: true });
      await waitEvent(dup, 'connect');
      const dupAck = await new Promise((res) => {
        dup.emit('join', { sessionId: pair.sessionId, role: 'client' }, (ack) => res(ack));
        setTimeout(() => res({ ok: 'timeout' }), 2000);
      });
      record('duplicate client role rejected', dupAck?.ok === false, JSON.stringify(dupAck));
      dup.close();

      // peer-left propagates.
      const hostGotLeft = waitEvent(host, 'peer-left', 3000);
      client.close();
      const left = await hostGotLeft;
      record('host receives peer-left on client disconnect', left?.role === 'client' || !!left, JSON.stringify(left));

      host.close();
    } catch (e) {
      record('socket.io relay', false, e.message);
      try { host.close(); client.close(); } catch { /* ignore */ }
    }
  }

  // ---------- Web client ----------
  try {
    const r = await fetch(WEB + '/');
    const body = await r.text();
    record('web-client / returns 200 HTML', r.status === 200 && /<html/i.test(body), `status=${r.status}`);
  } catch (e) { record('web-client / returns 200 HTML', false, e.message); }

  try {
    const r = await fetch(WEB + '/manifest.webmanifest');
    const body = await r.text();
    const json = JSON.parse(body);
    record('web-client /manifest.webmanifest valid', r.status === 200 && json.name === 'Web-Access', `status=${r.status}`);
  } catch (e) { record('web-client /manifest.webmanifest valid', false, e.message); }

  try {
    const r = await fetch(WEB + '/sw.js');
    const body = await r.text();
    record('web-client /sw.js served', r.status === 200 && /service worker|STATIC_CACHE|addEventListener/i.test(body), `status=${r.status}`);
  } catch (e) { record('web-client /sw.js served', false, e.message); }

  try {
    const r = await fetch(WEB + '/icons/icon-192.svg');
    record('web-client /icons/icon-192.svg served', r.status === 200, `status=${r.status}`);
  } catch (e) { record('web-client /icons/icon-192.svg served', false, e.message); }

  // ---------- Summary ----------
  const pass = results.filter((r) => r.ok).length;
  const fail = results.length - pass;
  console.log(`\n${pass}/${results.length} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => { console.error('fatal', e); process.exit(2); });
