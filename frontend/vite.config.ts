import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Dev proxy: forward /api and /socket.io to the NestJS backend so the frontend
// can use same-origin relative URLs in dev and in production (Cloudflare Pages
// + Tunnel) alike. Override the target with VITE_PROXY_TARGET.
export default defineConfig({
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
