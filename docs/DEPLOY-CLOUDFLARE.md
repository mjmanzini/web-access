# Cloudflare Deployment Guide

Goal: PWA frontend on **Cloudflare Pages**, signaling/mediasoup/Postgres on a
VPS behind a public hostname, traffic protected by **Cloudflare DNS + WAF +
Access**, with optional **Cloudflare Tunnel** so the VPS exposes no public
ports.

```
                           ┌────────────────────────────┐
   browser  ───TLS───►     │  Cloudflare edge           │
   (PWA)                   │  • Pages (static)          │
                           │  • DNS / WAF / Access      │
                           │  • Tunnel ingress          │
                           └──────────────┬─────────────┘
                                          │ cloudflared
                                          ▼
                                  VPS (Docker compose)
                          ┌────────────────────────────────┐
                          │ Caddy → signaling-server       │
                          │       → mediasoup (UDP direct) │
                          │       → postgres (private)     │
                          │ coturn (UDP 3478 / TCP 5349)   │
                          └────────────────────────────────┘
```

> WebRTC media (mediasoup + coturn) **must stay on UDP direct to the VPS**.
> Cloudflare cannot proxy arbitrary UDP. Only the HTTPS / WebSocket signaling
> goes through Cloudflare.

---

## 0. Prerequisites
- Cloudflare account; domain added (e.g. `example.com`).
- VPS with Docker + docker-compose; `infra/docker-compose.yml` already builds.
- `wrangler` CLI: `npm i -g wrangler` and `wrangler login`.
- Records you will use:
  - `app.example.com`     → Pages (PWA)
  - `api.example.com`     → signaling REST + Socket.IO  (proxied / via Tunnel)
  - `turn.example.com`    → coturn (DNS only — grey cloud)

---

## 1. Frontend on Cloudflare Pages

### 1a. Configure Next.js for static / edge export
The PWA is mostly client-side. Two supported approaches:

**Option A — Static export (simplest):**
```js
// web-client/next.config.js
module.exports = {
  output: 'export',
  images: { unoptimized: true },
  trailingSlash: true,
};
```

**Option B — `@cloudflare/next-on-pages`** (keeps API routes as Workers):
```bash
cd web-client
pnpm add -D @cloudflare/next-on-pages
npx @cloudflare/next-on-pages
```

### 1b. Connect repo in Cloudflare dashboard
Pages → *Create project* → *Connect to Git* → pick repo:
- **Root directory:** `web-client`
- **Build command:**
  - Option A: `pnpm install && pnpm build`
  - Option B: `pnpm install && npx @cloudflare/next-on-pages`
- **Build output directory:**
  - Option A: `out`
  - Option B: `.vercel/output/static`
- **Environment variables:**
  ```
  NEXT_PUBLIC_API_BASE=https://api.example.com
  NEXT_PUBLIC_SOCKET_URL=wss://api.example.com
  NODE_VERSION=20
  ```

### 1c. Custom domain
Pages project → *Custom domains* → add `app.example.com`. Cloudflare creates
the CNAME automatically.

### 1d. Headers + SPA fallback
Place these in `web-client/public/` so they get copied into the build output.

`_headers`:
```
/*
  Strict-Transport-Security: max-age=63072000; includeSubDomains; preload
  X-Content-Type-Options: nosniff
  Referrer-Policy: strict-origin-when-cross-origin
  Permissions-Policy: camera=(self), microphone=(self), display-capture=(self), publickey-credentials-get=(self), publickey-credentials-create=(self)
  Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' blob:; connect-src 'self' https://api.example.com wss://api.example.com; frame-ancestors 'none'

/sw.js
  Cache-Control: no-cache
/manifest.webmanifest
  Cache-Control: public, max-age=3600
```

`_redirects` (only needed for Option A static export with client routing):
```
/*    /index.html   200
```

---

## 2. Backend on the VPS

`infra/docker-compose.yml` should expose:
- `signaling-server` on `127.0.0.1:4000` (Caddy proxies to it)
- `postgres` on the internal Docker network only (no host port)
- `coturn` on `0.0.0.0:3478/udp` and `0.0.0.0:5349/tcp`
- `caddy` listening on `127.0.0.1:8443` (when fronted by Tunnel) or `:443`

`infra/Caddyfile` (Tunnel-friendly variant):
```caddy
{
    auto_https off
}
:8080 {
    @ws {
        path /socket.io/*
        header Connection *Upgrade*
        header Upgrade websocket
    }
    reverse_proxy @ws  signaling-server:4000
    reverse_proxy /api/* signaling-server:4000
    reverse_proxy /healthz signaling-server:4000
    encode zstd gzip
}
```

---

## 3. Cloudflare Tunnel (recommended — no inbound ports for HTTPS)

```bash
# On the VPS
cloudflared tunnel login
cloudflared tunnel create web-access
cloudflared tunnel route dns web-access api.example.com
```

`/etc/cloudflared/config.yml`:
```yaml
tunnel: web-access
credentials-file: /root/.cloudflared/<TUNNEL_UUID>.json
ingress:
  - hostname: api.example.com
    service: http://localhost:8080
  - service: http_status:404
```

```bash
sudo cloudflared service install
sudo systemctl enable --now cloudflared
```

Now `api.example.com` reaches the VPS without opening port 80/443.
**Keep UDP 3478 (and 5349/tcp for TURN-over-TLS) open directly on the VPS firewall**
— `turn.example.com` must be DNS-only (grey cloud) so STUN/TURN bypass the proxy.

---

## 4. Cloudflare DNS + Security

### 4a. DNS records
| Name              | Type  | Target                  | Proxy  |
|-------------------|-------|-------------------------|--------|
| `app`             | CNAME | (auto, Pages)           | orange |
| `api`             | CNAME | `<tunnel>.cfargotunnel.com` | orange |
| `turn`            | A     | `<VPS public IP>`       | grey   |

### 4b. WAF rule — block direct origin scans on `api`
Security → WAF → Custom rules:
```
Field: Hostname  equals  api.example.com
AND   URI Path   does not start with  /api/
AND   URI Path   does not start with  /socket.io/
AND   URI Path   does not equal       /healthz
Action: Block
```

### 4c. Rate limiting
- `api.example.com/api/auth/*` → 10 req / 10 s / IP, mitigation = block 10 min.
- `api.example.com/api/auth/webauthn/authenticate/*` → 5 req / 10 s / IP.

### 4d. Cloudflare Access (optional — for admin endpoints)
Zero Trust → Access → *Add an application* → Self-hosted →
hostname `api.example.com`, path `/admin/*`, policy = email domain.

### 4e. SSL/TLS
- Mode: **Full (strict)**.
- Always Use HTTPS: on.
- HSTS: enable (max-age 1 year, include subdomains).
- Min TLS 1.2.

---

## 5. Database

Postgres stays inside the Docker network; nothing to expose.

```bash
# one-shot bootstrap
docker compose -f infra/docker-compose.yml exec -T postgres \
    psql -U app -d webaccess < docs/schema.sql
```

For backups: `pg_dump` via a cron job to an R2 bucket (Cloudflare’s S3-compat
object storage):
```bash
pg_dump "$DATABASE_URL" | gzip | \
  aws --endpoint-url "$R2_ENDPOINT" s3 cp - "s3://web-access-backups/$(date -u +%Y%m%dT%H%M).sql.gz"
```

---

## 6. Deployment checklist

- [ ] `docs/schema.sql` applied to Postgres.
- [ ] `signaling-server` env: `DATABASE_URL`, `WEBAUTHN_RP_ID=app.example.com`,
      `WEBAUTHN_ORIGIN=https://app.example.com`, `TURN_SECRET=…`.
- [ ] Pages project deployed; `app.example.com` serves the PWA.
- [ ] `curl https://api.example.com/healthz` returns 200 through the Tunnel.
- [ ] `wss://api.example.com/socket.io/?EIO=4&transport=websocket` upgrades.
- [ ] `turn.example.com:3478` reachable on UDP (use `turnutils_uclient`).
- [ ] WAF + rate-limit rules visible under Security → Events.
- [ ] Service worker (`/sw.js`) registers and PWA install prompt appears on
      Android Chrome / iOS Safari.
- [ ] WebAuthn passkey registration succeeds end-to-end on a real iPhone /
      Android device (`userVerification: 'required'` triggers Face ID / fingerprint).

---

## 7. Local dev quickstart

```bash
# Backend
docker compose -f infra/docker-compose.yml up -d postgres
psql "$DATABASE_URL" -f docs/schema.sql
cd signaling-server && npm i && npm run dev

# Frontend
cd web-client && pnpm i && pnpm dev
# open http://localhost:3000
```

WebAuthn requires a **secure context**. For local mobile testing use
`pnpm start:https` (the existing self-signed HTTPS server) and add the cert
to the device trust store, or use a Cloudflare Quick Tunnel:
```bash
cloudflared tunnel --url http://localhost:3000
```
