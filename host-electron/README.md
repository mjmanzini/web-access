# Web-Access Host (Electron)

Captures the desktop with Electron's `desktopCapturer` + `getDisplayMedia()`
and streams it to the web client over WebRTC. Uses the signaling-server for
pairing codes and SDP/ICE exchange.

## Run

```powershell
cd host-electron
npm install
# optional: Copy-Item .env.example .env
# copy the vendor scripts into src/renderer/vendor/ (see note below)
npm start
```

### Vendor scripts

The renderer loads `qrcode` and `socket.io-client` from `src/renderer/vendor/`
(kept out of node_modules so the strict CSP works). After `npm install`, copy:

```powershell
New-Item -ItemType Directory -Force src/renderer/vendor | Out-Null
Copy-Item node_modules/qrcode/build/qrcode.min.js src/renderer/vendor/qrcode.min.js
Copy-Item node_modules/socket.io-client/dist/socket.io.min.js src/renderer/vendor/socket.io.min.js
```

A postinstall script does this automatically — see `package.json`.

## How it works

1. On launch the host calls `POST /pair/new` on the signaling server and shows
   the 6-char code + a QR pointing at `CLIENT_URL/?code=XXXXXX`.
2. It opens a Socket.IO connection and `join`s as `host`.
3. When a `client` peer joins, the host calls `getDisplayMedia`, builds an
   `RTCPeerConnection` with a `control` data channel, adds the video track,
   and emits an SDP offer through the signaling relay.
4. ICE candidates flow both ways until the peer connection is established.
5. Input messages from the control data channel are forwarded over IPC to the
   main process, which executes them via `@nut-tree-fork/nut-js`
   (optional dependency — falls back to no-op logging if the native module
   isn't available).
6. `quality` messages adjust the video sender's `maxBitrate` /
   `maxFramerate` / `scaleResolutionDownBy` via `RTCRtpSender.setParameters`.

## Env

The host now loads `.env` automatically on startup.

- Local dev: copy `.env.example` to `.env`
- VPS/public signaling: start from `.env.production.example` and update `CLIENT_URL`

Set `SIGNALING_URL` / `CLIENT_URL` for non-local setups.
