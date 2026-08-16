import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { execSync } from 'node:child_process';

// A visible build stamp. Twice now a shipped feature was reported "missing"
// when the real problem was which bundle the device had loaded; reading a
// short id off the screen settles that in one second instead of an hour.
const buildId = (() => {
  try {
    return execSync('git rev-parse --short HEAD').toString().trim();
  } catch {
    return 'dev';
  }
})();

// Dev proxy: forward /api and /socket.io to the NestJS backend so the frontend
// can use same-origin relative URLs in dev and in production (Cloudflare Pages
// + Tunnel) alike. Override the target with VITE_PROXY_TARGET.
export default defineConfig({
  define: { __BUILD_ID__: JSON.stringify(buildId) },
  plugins: [react()],
  server: {
    proxy: {
      '/api': { target: process.env.VITE_PROXY_TARGET ?? 'http://localhost:3001', changeOrigin: true },
      '/socket.io': {
        target: process.env.VITE_PROXY_TARGET ?? 'http://localhost:3001',
        ws: true,
        changeOrigin: true,
      },
    },
  },
});
