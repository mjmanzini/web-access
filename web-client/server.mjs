/**
 * Custom Next.js server that serves HTTPS using a self-signed certificate.
 * Only used by `npm run start:https` — the normal `start` still uses next-cli.
 *
 * The cert covers localhost, 127.0.0.1, and the detected LAN IP, so you can
 * load it from any device on the same Wi-Fi (you will have to accept the
 * "not trusted" warning once, because it's self-signed).
 */
import https from 'node:https';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import next from 'next';
import selfsigned from 'selfsigned';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const CERT_DIR = path.resolve(__dirname, 'certs');
const PORT = Number(process.env.PORT || 3000);

function detectLanIp() {
  const ifaces = os.networkInterfaces();
  for (const name of Object.keys(ifaces)) {
    for (const info of ifaces[name] || []) {
      if (info.family === 'IPv4' && !info.internal) return info.address;
    }
  }
  return '127.0.0.1';
}

function loadOrCreateCert(hosts) {
  const keyPath = path.join(CERT_DIR, 'server.key');
  const certPath = path.join(CERT_DIR, 'server.crt');
  const metaPath = path.join(CERT_DIR, 'server.meta.json');
  const hostsSorted = [...new Set(hosts)].sort().join(',');

  if (fs.existsSync(keyPath) && fs.existsSync(certPath) && fs.existsSync(metaPath)) {
    try {
      const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
      if (meta.hosts === hostsSorted) {
        return {
          key: fs.readFileSync(keyPath, 'utf8'),
          cert: fs.readFileSync(certPath, 'utf8'),
        };
      }
    } catch { /* regenerate */ }
  }

  fs.mkdirSync(CERT_DIR, { recursive: true });
  const altNames = hosts.map((h) => {
    const isIp = /^\d+\.\d+\.\d+\.\d+$/.test(h);
    return isIp ? { type: 7, ip: h } : { type: 2, value: h };
  });
  const pems = selfsigned.generate(
    [{ name: 'commonName', value: hosts[0] }],
    { days: 365, keySize: 2048, algorithm: 'sha256', extensions: [{ name: 'subjectAltName', altNames }] },
  );
  fs.writeFileSync(keyPath, pems.private);
  fs.writeFileSync(certPath, pems.cert);
  fs.writeFileSync(metaPath, JSON.stringify({ hosts: hostsSorted, createdAt: Date.now() }, null, 2));
  return { key: pems.private, cert: pems.cert };
}

const lanIp = detectLanIp();
const { key, cert } = loadOrCreateCert(['localhost', '127.0.0.1', lanIp]);

const app = next({ dev: false, hostname: '0.0.0.0', port: PORT });
const handle = app.getRequestHandler();

app.prepare().then(() => {
  https.createServer({ key, cert }, (req, res) => handle(req, res)).listen(PORT, '0.0.0.0', () => {
    // eslint-disable-next-line no-console
    console.log(`[web-client] HTTPS ready on https://${lanIp}:${PORT} (self-signed)`);
  });
});
