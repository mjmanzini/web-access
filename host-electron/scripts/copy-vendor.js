'use strict';

const fs = require('node:fs');
const path = require('node:path');

const targets = [
  ['socket.io-client/dist/socket.io.min.js', 'socket.io.min.js'],
];

const vendorDir = path.join(__dirname, '..', 'src', 'renderer', 'vendor');
fs.mkdirSync(vendorDir, { recursive: true });

for (const [src, dest] of targets) {
  const from = path.join(__dirname, '..', 'node_modules', src);
  const to = path.join(vendorDir, dest);
  try {
    fs.copyFileSync(from, to);
    // eslint-disable-next-line no-console
    console.log(`[vendor] ${dest}`);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn(`[vendor] skip ${dest}: ${err.message}`);
  }
}
