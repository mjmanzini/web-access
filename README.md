# web-access + Khuloh

This repository now contains two connected product surfaces:

- `web-access` — the existing WebRTC remote-access and realtime platform built from `signaling-server/`, `host-electron/`, and `web-client/`
- `Khuloh` — an imported Expo / React Native client plus Supabase schema and protobuf assets under `khuloh-mobile/`

The current direction is to converge the platform work already in this repo with the imported Khuloh mobile client and its data-lite / safety product model.

## Existing web-access platform

Web-based remote desktop: Electron host streams the screen over WebRTC to a Next.js PWA client that runs in any mobile or desktop browser.

### Current components

- [signaling-server/](signaling-server/README.md) — Node + Socket.IO, auth, chat, remote sessions, Khuloh server modules, SDP and ICE relay
- [host-electron/](host-electron/README.md) — Electron host with screen capture and host-side input execution
- [web-client/](web-client/README.md) — Next.js PWA for chat, calls, remote access, wallet, zones, safe-spots, and other browser flows

### Run the existing web-access loop locally

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

### web-access progress

- **Phase 1** (done) — Hybrid architecture: signaling, Electron host, Next.js client.
- **Phase 2** (done) — Mobile viewport: trackpad and touch input, pinch zoom, virtual modifier keys.
- **Phase 3** (done) — NAT traversal: [`infra/`](infra/README.md) with Coturn + signaling Docker image; clients fetch `/ice` for time-limited TURN credentials.
- **Phase 4** (done) — Host-side input execution plus adaptive stream quality.
- **Khuloh extension work** (active) — wallet, zones, trust, moderation, safe-spots, partner QR, panic flows, and binary wire support on top of the existing platform.

## Imported Khuloh mobile client

The fetched remote project from `https://github.com/mjmanzini/khuloh.git` is now present in this repo as an Expo / React Native client in `khuloh-mobile/`.

### Imported mobile app layout

- `khuloh-mobile/App.tsx`, `khuloh-mobile/index.ts`, `khuloh-mobile/src/`, `khuloh-mobile/assets/` — Expo client application
- `khuloh-mobile/package.json`, `khuloh-mobile/package-lock.json`, `khuloh-mobile/tsconfig.json`, `khuloh-mobile/app.json` — Expo toolchain configuration
- `khuloh-mobile/supabase/` — database, policy, and backend assets from the Khuloh repo
- `khuloh-mobile/proto/` — protobuf definitions for data-lite messaging

### Run the imported Khuloh app locally

```powershell
cd khuloh-mobile
npm install
npm start
```

Other Expo targets:

```powershell
npm run android
npm run ios
npm run web
```

### Khuloh architecture summary

Khuloh is a data-lite social safety app optimized for the South African context. The imported client is built around:

- React Native UI with local-first caching
- Protocol Buffers for compact messaging payloads
- delta sync and smart thumbnailing
- Supabase-backed profiles, economy, safety, and partner venue flows
- Safe-Spots, QR trust badges, Vibe Points, and ghost mode concepts

## Deployment and migration notes

- Cheapest practical frontend hosting: [docs/DEPLOY-CLOUDFLARE.md](docs/DEPLOY-CLOUDFLARE.md)
- Development deployment workflow and environment setup: [docs/DEPLOY-DEV.md](docs/DEPLOY-DEV.md)
- Free-hosting tradeoffs and recommended split: [docs/FREE-HOSTING.md](docs/FREE-HOSTING.md)
- Cheapest full-stack path: [docs/DEPLOY-ORACLE-FREE.md](docs/DEPLOY-ORACLE-FREE.md)
- Firebase full-stack deployment prep: [docs/DEPLOY-FIREBASE.md](docs/DEPLOY-FIREBASE.md)
- Firebase migration plan: [docs/FIREBASE-MIGRATION.md](docs/FIREBASE-MIGRATION.md)
- Khuloh implementation docs already authored in this repo: [docs/khuloh/README.md](docs/khuloh/README.md)

## Integration note

This is currently a content merge, not a finalized history merge. The repo now contains both the existing web-access stack and the imported Khuloh Expo client in a dedicated subfolder so they can be reconciled deliberately instead of staying in separate repositories.