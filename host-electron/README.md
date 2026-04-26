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

1. The renderer supports two host modes:
   - `Remote access`: the preferred production flow. Paste the host user's
     bearer token once, then the app calls `POST /api/remote/announce` and
     shows a Partner ID + one-time PIN.
   - `Legacy pairing`: the older `POST /pair/new` flow with a 6-char code + QR.
2. In either mode the host opens a Socket.IO connection and `join`s the room as
   `host`.
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

## Remote access mode

1. In the browser, complete onboarding once so the host account gets a bearer
   token from `POST /api/auth/register`.
2. Paste that token into the Electron host's `Remote access` tab and click
   `Save token`.
3. Click `Generate PIN`.
4. Share the displayed Partner ID and one-time PIN with the remote user.
5. The browser user opens `/remote`, enters the Partner ID + PIN, and the
   session joins the host as the same signaling room.

The token is stored in `localStorage` on that host machine only. It is not read
from `.env`, so operators can rotate it without editing deployment files.

## Env

The host now loads `.env` automatically on startup.

- Local dev: copy `.env.example` to `.env`
- VPS/public signaling: start from `.env.production.example` and update `CLIENT_URL`

Set `SIGNALING_URL` / `CLIENT_URL` for non-local setups.
