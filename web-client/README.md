# Web-Access Web Client (Next.js)

Mobile-first WebRTC viewer for the Web-Access remote desktop tool.

## Run

```powershell
cd web-client
npm install
Copy-Item .env.example .env.local
npm run dev
```

Then open http://localhost:3000 and enter the 6-char code shown in the Host
Electron window (or scan its QR).

## Production

For the VPS deployment prepared in `infra/`, the web client should point at:

```env
NEXT_PUBLIC_SIGNALING_URL=https://signal.mjjsmanzini.com
```

That value is already provided in `.env.production`.

## Cloudflare Pages

This app is configured for static export so it can be deployed from
`web-client/` to Cloudflare Pages.

Suggested Pages settings:

```text
Root directory: web-client
Build command: npm install ; npm run build:pages
Build output directory: out
```

Required environment variable:

```env
NEXT_PUBLIC_SIGNALING_URL=https://signal.example.com
```

Repeatable deploy from the repo root:

```powershell
$env:CLOUDFLARE_API_TOKEN='...'
$env:CLOUDFLARE_ACCOUNT_ID='...'
.\scripts\deploy-pages.ps1 -SignalingUrl 'https://your-signal-url.example.com'
```

If you just need a temporary public signaling URL, start a quick tunnel first:

```powershell
.\scripts\start-tunnel.ps1 -ServiceUrl 'http://host.docker.internal:8088'
```

Then redeploy Pages with the `https://...trycloudflare.com` URL that script prints.

The remote desktop session route uses `/remote?sessionId=...` so the app stays
compatible with static hosting.

## What's here (Phase 1)

- `app/page.tsx` — pairing form + WebRTC viewer (`RTCPeerConnection` + video `<video>`)
- Auto-connects when the URL has `?code=XXXXXX` (QR scan path)
- Receives the host's SDP offer, answers it, renders the incoming track

## Coming next

- Phase 3: TURN server config (`NEXT_PUBLIC_TURN_URL` / credentials)
- Phase 4: low-bandwidth toggle (constrain incoming track / request simulcast layer)
- PWA manifest + service worker for install-to-home-screen
