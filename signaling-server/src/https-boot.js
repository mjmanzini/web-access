/**
 * HTTPS boot helper. Generates (or reuses) a self-signed cert for the host's
 * LAN IP so the web-client can be served over HTTPS — required on iOS/Safari
 * and useful everywhere.
 *
 * Usage:
 *   import { loadOrCreateCert } from './https-boot.js';
 *   const { key, cert } = await loadOrCreateCert({ hosts: ['localhost', lanIp] });
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import os from 'node:os';
import selfsigned from 'selfsigned';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const CERT_DIR = path.resolve(__dirname, '..', 'certs');

export function detectLanIp() {
  const ifaces = os.networkInterfaces();
  for (const name of Object.keys(ifaces)) {
    for (const info of ifaces[name] || []) {
      if (info.family === 'IPv4' && !info.internal) return info.address;
    }
  }
  return '127.0.0.1';
}

export async function loadOrCreateCert({ hosts = [] } = {}) {
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
          reused: true,
          path: CERT_DIR,
        };
      }
    } catch { /* fall through and regenerate */ }
  }

  fs.mkdirSync(CERT_DIR, { recursive: true });
  const attrs = [{ name: 'commonName', value: hosts[0] || 'localhost' }];
  const altNames = hosts.map((h) => {
    // IPv4 or DNS
    const isIp = /^\d+\.\d+\.\d+\.\d+$/.test(h);
    return isIp ? { type: 7, ip: h } : { type: 2, value: h };
  });
  const pems = selfsigned.generate(attrs, {
    days: 365,
    keySize: 2048,
    algorithm: 'sha256',
    extensions: [{ name: 'subjectAltName', altNames }],
  });
  fs.writeFileSync(keyPath, pems.private);
  fs.writeFileSync(certPath, pems.cert);
  fs.writeFileSync(metaPath, JSON.stringify({ hosts: hostsSorted, createdAt: Date.now() }, null, 2));
  return { key: pems.private, cert: pems.cert, reused: false, path: CERT_DIR };
}
