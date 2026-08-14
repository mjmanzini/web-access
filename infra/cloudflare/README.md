# Cloudflare hosting

Two Cloudflare pieces, both optional but recommended:

## 1. Dashboard on Cloudflare Pages (static)

The React app is a static SPA — deploy `frontend/dist` to Cloudflare Pages.

```
# Build settings (Pages > Create project > Connect to Git)
Build command:        npm run build
Build output dir:     frontend/dist
Root directory:       frontend
Environment variable: VITE_API_BASE = https://guardian-api.<your-domain>
```

`frontend/public/_redirects` and `frontend/public/_headers` ship with the app so
Pages picks them up automatically (SPA fallback + security headers). Because the dashboard
talks to your home API cross-origin in this setup, set `VITE_API_BASE` to the
tunnel hostname (below) and keep `CORS_ORIGIN` on the API locked to the Pages
domain.

## 2. Home API via Cloudflare Tunnel (no open ports)

The API + AdGuard must stay on the home LAN. Expose them safely with a tunnel:

1. Cloudflare Zero Trust → Networks → Tunnels → Create a tunnel.
2. Add a public hostname, e.g. `guardian-api.<your-domain>` → `http://web:5173`
   (or `http://api:3001` if you host the dashboard on Pages and only need the API).
3. Copy the tunnel token into `.env` as `TUNNEL_TOKEN`.
4. `docker compose --profile cloudflare up -d`
5. Put Cloudflare Access in front of the hostname (email/OTP or your IdP) so only
   you can reach the dashboard.

This keeps your router closed to inbound traffic while giving you remote control.
