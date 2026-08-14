# web-access

Web-based remote desktop plus real-time comms: an Electron host streams the
screen over WebRTC to a Next.js PWA client that runs in any mobile or desktop
browser. The same platform also powers WhatsApp-style chat, voice/video calls,
and a set of Khuloh safety features (wallet, zones, safe-spots, panic, trust)
built directly into the signaling server and web client.

## Components

- [signaling-server/](signaling-server/README.md) — Node + Socket.IO, auth, chat, remote sessions, Khuloh server modules, SDP and ICE relay
- [host-electron/](host-electron/README.md) — Electron host with screen capture and host-side input execution
- [web-client/](web-client/README.md) — Next.js PWA for chat, calls, remote access, wallet, zones, safe-spots, and other browser flows

## Run the loop locally

Three terminals:

```powershell
# 1. signaling
cd signaling-server; npm install; npm run dev

# 2. host (Electron)
cd host-electron; npm install; npm start

# 3. web client
cd web-client; npm install; npm run dev
```

Open http://localhost:3000 on a second device on the same Wi-Fi (or the host PC itself), enter the 6-character pairing code shown in the Electron window, and the desktop stream appears.

## Progress

- **Phase 1** (done) — Hybrid architecture: signaling, Electron host, Next.js client.
- **Phase 2** (done) — Mobile viewport: trackpad and touch input, pinch zoom, virtual modifier keys.
- **Phase 3** (done) — NAT traversal: [`infra/`](infra/README.md) with Coturn + signaling Docker image; clients fetch `/ice` for time-limited TURN credentials.
- **Phase 4** (done) — Host-side input execution plus adaptive stream quality.
- **Khuloh extension work** (active) — wallet, zones, trust, moderation, safe-spots, partner QR, panic flows, and binary wire support on top of the existing platform.

## Khuloh feature set

Khuloh is a data-lite social safety feature set built on top of the web-access
platform — wallet/Vibe Points, live Zones, Safe-Spots, QR trust badges, and
panic check-in flows. These run entirely in the signaling server
(`signaling-server/src/khuloh/`, backed by Firestore/Postgres) and the web
client (`/wallet`, `/zones`, `/zones/safe-spots`). Implementation docs are in
[docs/khuloh/README.md](docs/khuloh/README.md).

## Deployment notes

- Cheapest practical frontend hosting: [docs/DEPLOY-CLOUDFLARE.md](docs/DEPLOY-CLOUDFLARE.md)
- Development deployment workflow and environment setup: [docs/DEPLOY-DEV.md](docs/DEPLOY-DEV.md)
- Free-hosting tradeoffs and recommended split: [docs/FREE-HOSTING.md](docs/FREE-HOSTING.md)
- Cheapest full-stack path: [docs/DEPLOY-ORACLE-FREE.md](docs/DEPLOY-ORACLE-FREE.md)
- Firebase full-stack deployment prep: [docs/DEPLOY-FIREBASE.md](docs/DEPLOY-FIREBASE.md)
- Firebase migration plan: [docs/FIREBASE-MIGRATION.md](docs/FIREBASE-MIGRATION.md)
- Khuloh implementation docs: [docs/khuloh/README.md](docs/khuloh/README.md)
