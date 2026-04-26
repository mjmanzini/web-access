# Unified PWA — Architecture & Folder Structure

A single PWA that combines WhatsApp-style real-time comms (chat / voice / video)
with TeamViewer-style remote desktop, built on the existing
`signaling-server` + `web-client` + `host-electron` stack.

## Folder Structure (target)

```
web-access/
├── docs/
│   ├── ARCHITECTURE.md             # this file
│   ├── DEPLOY-CLOUDFLARE.md        # step-by-step Cloudflare guide
│   └── schema.sql                  # PostgreSQL schema
│
├── web-client/                     # Next.js PWA (frontend)
│   ├── app/
│   │   ├── layout.tsx              # ThemeProvider, AuthProvider, SW registration
│   │   ├── globals.css             # CSS variables for light/dark/system
│   │   ├── (auth)/
│   │   │   ├── onboarding/page.tsx # name + email/phone (frictionless)
│   │   │   └── login/page.tsx      # password + WebAuthn passkey
│   │   ├── (app)/
│   │   │   ├── chat/               # WhatsApp-style: contacts left, thread right
│   │   │   │   ├── layout.tsx      # 2-pane responsive layout
│   │   │   │   ├── page.tsx        # contact list (mobile: full screen)
│   │   │   │   └── [contactId]/page.tsx  # active thread + call bar
│   │   │   ├── call/page.tsx       # full-screen voice/video session
│   │   │   └── remote/             # TeamViewer-style dashboard
│   │   │       ├── page.tsx        # "Your ID / PIN" + "Partner ID" connect
│   │   │       └── [sessionId]/page.tsx  # remote screen viewer
│   │   └── api/                    # Next route handlers (BFF)
│   │       ├── auth/
│   │       │   ├── webauthn/register/route.ts
│   │       │   └── webauthn/authenticate/route.ts
│   │       └── contacts/route.ts
│   ├── components/
│   │   ├── theme/ThemeProvider.tsx
│   │   ├── chat/{ContactList,MessageList,Composer,PresenceDot}.tsx
│   │   ├── call/{CallBar,VideoTile,ControlsTray}.tsx
│   │   └── remote/{IdCard,PartnerConnect,RemoteCanvas,InputCapture}.tsx
│   ├── lib/
│   │   ├── auth/webauthn-client.ts # navigator.credentials wrappers
│   │   ├── call-client.ts          # (existing) WebRTC/mediasoup
│   │   ├── chat-client.ts          # Socket.IO chat namespace
│   │   ├── remote-client.ts        # remote-desktop signaling + input encoder
│   │   └── theme.ts                # light/dark/system CSS-var switcher
│   ├── public/
│   │   ├── manifest.webmanifest    # PWA manifest
│   │   ├── sw.js                   # service worker (cache + offline shell)
│   │   └── icons/
│   └── ...
│
├── signaling-server/               # Node + Socket.IO + mediasoup + Postgres
│   ├── src/
│   │   ├── server.js               # HTTP/HTTPS bootstrap
│   │   ├── db.js                   # pg pool + migrations runner
│   │   ├── users.js                # user directory
│   │   ├── auth/
│   │   │   ├── webauthn.js         # @simplewebauthn/server flows
│   │   │   └── sessions.js         # JWT/opaque token issue+verify
│   │   ├── chat/
│   │   │   ├── messages.js         # persist + fan-out
│   │   │   └── presence.js         # online / typing / last_seen
│   │   ├── call-signaling.js       # (existing)
│   │   ├── mediasoup-room.js       # (existing) SFU rooms
│   │   ├── remote/
│   │   │   ├── sessions.js         # PIN issue / partner-id lookup
│   │   │   └── input-relay.js      # validated input event relay
│   │   └── signaling.js            # Socket.IO namespaces wiring
│   └── migrations/
│       └── 001_init.sql            # = docs/schema.sql
│
├── host-electron/                  # remote-desktop host (existing)
│
└── infra/
    ├── docker-compose.yml          # signaling + web-client + postgres + coturn
    ├── Caddyfile                   # TLS in front of signaling + web
    ├── cloudflare/
    │   ├── pages.toml              # Cloudflare Pages build config
    │   ├── _headers                # security headers for Pages
    │   ├── _redirects              # SPA fallback
    │   └── wrangler.toml           # (optional) Workers/Tunnel config
    └── coturn/turnserver.conf
```

## Real-time Topology

| Channel              | Transport                  | Server module                       |
|----------------------|----------------------------|-------------------------------------|
| Auth / REST          | HTTPS (Next API + signaling REST) | `web-client/app/api/*`, signaling Express routes |
| Presence + typing    | Socket.IO `/presence`      | `chat/presence.js`                  |
| Text chat            | Socket.IO `/chat` + Postgres `chat_messages` | `chat/messages.js` |
| Voice/video calls    | WebRTC P2P (1:1) / mediasoup SFU (group) | `call-signaling.js`, `mediasoup-room.js` |
| Remote desktop video | WebRTC DataChannel + video track from host | `remote/sessions.js` |
| Remote input         | WebRTC DataChannel (ordered, reliable) | host-electron `input-executor.js` |

NAT traversal: STUN + coturn (already in `infra/coturn/`). TURN credentials are
short-lived, minted by the signaling server per session.

## Theming

`globals.css` exposes CSS variables; `ThemeProvider` toggles `data-theme` on
`<html>`. `prefers-color-scheme` is the default.

```css
:root[data-theme='light'] { --bg:#fff; --fg:#111; --accent:#25d366; --panel:#f0f2f5; }
:root[data-theme='dark']  { --bg:#0b141a; --fg:#e9edef; --accent:#00a884; --panel:#202c33; }
@media (prefers-color-scheme: dark) {
  :root:not([data-theme]) { color-scheme: dark; --bg:#0b141a; --fg:#e9edef; --accent:#00a884; --panel:#202c33; }
}
```

## Security boundaries

- All Socket.IO connections require a bearer token (issued at login or via
  WebAuthn assertion) verified in `io.use()` middleware.
- Remote-desktop sessions require the host to have *consented* via a 6-digit
  PIN with TTL = 5 min, single-use; brute-force protected with rate limiting.
- Input events are validated server-side against a session's allowed scope
  (no host filesystem APIs over the wire — only synthetic input).
- Database access is server-only; Postgres is never exposed publicly.
