# Deploying to Cloudflare

Home Guardian splits across two places, and only the **dashboard** goes on
Cloudflare's edge:

- **Dashboard (static React SPA)** → **Cloudflare Pages**.
- **Backend + AdGuard + Postgres** → stay on your **home server** (the backend
  must reach your LAN's AdGuard and Postgres; it can't run on Workers). It's
  reached from the internet through a **Cloudflare Tunnel**, gated by
  **Cloudflare Access**.

```
  Browser ──▶ dashboard.<domain>   (Cloudflare Pages: frontend/dist)
                   │  fetch/WebSocket  VITE_API_BASE = https://api.<domain>
                   ▼
             api.<domain>  ──(Cloudflare Tunnel, no open ports)──▶  home: api:3001
                                                                     ├─ AdGuard (LAN DNS)
                                                                     └─ Postgres
```

## 1. Dashboard on Cloudflare Pages

**Option A — one command.** With `VITE_API_BASE` (and, for non-interactive runs,
`CLOUDFLARE_API_TOKEN` + `CLOUDFLARE_ACCOUNT_ID`) in `.env`:

```bash
make deploy-cloudflare
# or override inline:
make deploy-cloudflare VITE_API_BASE=https://api.example.com
```

It builds `frontend/dist` with your API URL and runs `wrangler pages deploy`
(first run creates the `home-guardian` Pages project). Without a token it opens
an interactive `wrangler login`.

**Option B — Git integration (no tokens).** In the Cloudflare
dashboard → Workers & Pages → Create → Pages → Connect to Git → pick this repo:

| Setting | Value |
|--------|-------|
| Framework preset | None |
| Build command | `cd frontend && npm ci && npm run build` |
| Build output directory | `frontend/dist` |
| Environment variable | `VITE_API_BASE = https://api.<your-domain>` |

Cloudflare rebuilds on every push to `main`. `frontend/public/_redirects`
(SPA fallback) and `_headers` (security headers) are picked up automatically.

**Option C — GitHub Actions.** Use the included
[`deploy-cloudflare.yml`](../../.github/workflows/deploy-cloudflare.yml). Set in
GitHub → Settings → Secrets and variables → Actions:

- Variable `CLOUDFLARE_DEPLOY = true`, Variable `VITE_API_BASE = https://api.<domain>`
- Secret `CLOUDFLARE_API_TOKEN` (Pages:Edit), Secret `CLOUDFLARE_ACCOUNT_ID`

It builds `frontend/dist` and runs `wrangler pages deploy` on push.

## 2. Backend via Cloudflare Tunnel

1. Cloudflare Zero Trust → Networks → Tunnels → **Create a tunnel** (Cloudflared).
2. Add a **public hostname**: `api.<your-domain>` → service `http://api:3001`
   (Socket.IO rides the same hostname — Cloudflare supports WebSockets).
3. Copy the tunnel token into your home `.env` as `TUNNEL_TOKEN`, then:
   ```bash
   docker compose --profile cloudflare up -d
   ```
   (For a locally-configured tunnel instead of a token, see
   [`tunnel-config.example.yml`](tunnel-config.example.yml).)

## 3. Lock it down + wire the two origins together

- **Cloudflare Access**: put an Access application in front of both
  `dashboard.<domain>` and `api.<domain>` (email OTP or your IdP) so only you
  can reach them.
- **CORS**: the dashboard (Pages) and API (tunnel) are different origins, so set
  the backend `CORS_ORIGIN` in `.env` to the Pages URL, e.g.
  `CORS_ORIGIN=https://dashboard.<your-domain>`, and restart the API. This is
  what lets the dashboard's fetches and WebSocket reach the API.

## Checklist

- [ ] Pages project builds `frontend/dist`, `VITE_API_BASE` set to the API host
- [ ] Tunnel routes `api.<domain>` → `api:3001`, `TUNNEL_TOKEN` in `.env`
- [ ] `CORS_ORIGIN` on the API = the Pages URL
- [ ] Cloudflare Access in front of both hostnames
- [ ] Log in at the Pages URL with `AUTH_ADMIN_USERNAME` / `AUTH_ADMIN_PASSWORD`
