# web-access / signaling-server

WebRTC signaling + pairing server for the **Web-Access** remote desktop tool.

This is the rendezvous point between the **Host** (Electron desktop capturer) and
the **Client** (Next.js mobile/desktop viewer). It does **not** carry media —
video and input travel peer-to-peer over WebRTC once the two sides have
exchanged SDP/ICE through this server.

## Responsibilities

1. Issue short-lived **pairing codes** (6 chars, 5 min TTL) so the phone can
   join a session by scanning a QR on the Host PC.
2. Track sessions (`host` socket + `client` socket) and relay `signal` messages
   (SDP offers/answers, ICE candidates) between them.
3. Expose a `/healthz` endpoint for uptime checks.

## Run locally

```powershell
cd signaling-server
npm install
Copy-Item .env.example .env
npm run dev
```

Server defaults to `http://localhost:4000`.

## HTTP API

| Method | Path                   | Purpose                                         |
| ------ | ---------------------- | ----------------------------------------------- |
| GET    | `/healthz`             | Liveness probe                                  |
| GET    | `/ice`                 | ICE server list (STUN + time-limited TURN)      |
| POST   | `/pair/new`            | Host requests a new pairing code + `sessionId`  |
| GET    | `/pair/resolve/:code`  | Client exchanges a code for its `sessionId`     |

Optionally set `SIGNALING_SHARED_SECRET` and send it as `x-shared-secret` on
`/pair/new` to keep random hosts off your deployment.

## Socket.IO events

Client -> Server:

- `join` `{ sessionId, role: "host" | "client" }` with ack `{ ok, error? }`
- `signal` `{ sdp? , candidate? }` — relayed to the other peer in the room

Server -> Client:

- `peer-joined` `{ role }`
- `peer-left`   `{ role }`
- `signal`      `{ from, sdp? | candidate? }`

## Next steps

- Phase 1 cont.: Electron **Host App** using `desktopCapturer` + `RTCPeerConnection`.
- Phase 1 cont.: Next.js **Web Client** that joins by pairing code / QR scan.
- Phase 3: deploy this server to a VPS and stand up **Coturn** for TURN.
