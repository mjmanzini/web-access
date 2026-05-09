# web-access

Web-based remote desktop: Electron host streams the screen over WebRTC to a
Next.js PWA client that runs in any mobile or desktop browser.

## Phase 1 — Hybrid Architecture (done)

- [signaling-server/](signaling-server/README.md) — Node + Socket.IO, pairing codes, SDP/ICE relay
- [host-electron/](host-electron/README.md) — Electron + `desktopCapturer` + `RTCPeerConnection`, QR for phone
- [web-client/](web-client/README.md) — Next.js viewer, joins by pairing code or `?code=` QR link

### Run the full loop locally

Three terminals:

```powershell
# 1. signaling
cd signaling-server; npm install; npm run dev

# 2. host (Electron)
cd host-electron; npm install; npm start

# 3. web client
cd web-client; npm install; npm run dev
```

Open http://localhost:3000 on a second device on the same Wi-Fi (or the Host
PC itself), enter the 6-char code shown in the Electron window, and the
desktop stream appears.

## Progress

- **Phase 1** (done) — Hybrid architecture: signaling, Electron host, Next.js client.
- **Phase 2** (done) — Mobile viewport: trackpad/touch input, pinch-zoom, virtual modifier keys.
- **Phase 3** (done) — NAT traversal: [`infra/`](infra/README.md) with Coturn + signaling Docker image; clients fetch `/ice` for time-limited TURN credentials.
- **Phase 4** (done) — Host-side input execution via `@nut-tree-fork/nut-js` (optional native dep, graceful no-op fallback); client quality cycle (low / medium / high) adjusts `RTCRtpSender.setParameters` on the host; auto-downgrade to low on `saveData` / 2g–3g `connection.effectiveType`.

## Deployment Notes

- Cheapest practical frontend hosting: [docs/DEPLOY-CLOUDFLARE.md](c:/Users/Jastice/Documents/web-access/docs/DEPLOY-CLOUDFLARE.md)
- Free-hosting tradeoffs and recommended split: [docs/FREE-HOSTING.md](c:/Users/Jastice/Documents/web-access/docs/FREE-HOSTING.md)
- Cheapest full-stack path: [docs/DEPLOY-ORACLE-FREE.md](c:/Users/Jastice/Documents/web-access/docs/DEPLOY-ORACLE-FREE.md)
- Firebase migration plan: [docs/FIREBASE-MIGRATION.md](c:/Users/Jastice/Documents/web-access/docs/FIREBASE-MIGRATION.md)