# Home Guardian

A self-hosted **Home Wi-Fi Monitoring & Parental Control dashboard**. It gives
you visibility into your network's DNS activity and per-profile control over
access — content categories, SafeSearch, time limits, bedtime, and bypass
detection — by orchestrating an [AdGuard Home](https://adguard.com/adguard-home/)
DNS sinkhole from a NestJS backend. No custom packet sniffing; everything runs
on your own hardware.

> Full design, data flow, DB schema, and the AdGuard integration strategy:
> [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Features

- **Device discovery & profiling** — track devices by IP/MAC, flag randomized
  ("private") MACs that evade controls, and group devices under one **User
  Profile** (a child's phone + tablet + console).
- **Activity & bandwidth monitoring** — DNS queries, top domains, active hours,
  per-device/-profile history from the AdGuard query log.
- **Parental controls** — instant block/unblock of domains and categories
  (adult, gaming, social, video, gambling); forced **SafeSearch** and **YouTube
  Restricted Mode** at the DNS level; **DoH/DoT bypass detection + blocking**.
- **Time management** — daily internet quotas and schedule-based blocking
  (bedtime), enforced on a cron heartbeat.
- **Real-time alerting** — WebSocket feed to the dashboard plus an optional
  outbound webhook on blocked access, bypass attempts, and new devices.

## Stack

| Layer | Tech |
|-------|------|
| Frontend | React + TypeScript (Vite) — `frontend/` |
| Backend | NestJS + Node — `backend/` |
| Database | PostgreSQL + TypeORM |
| Network/DNS | AdGuard Home (via its control API), behind a pluggable `NetworkProvider` |
| Deploy | Docker Compose (home server) + Cloudflare Pages/Tunnel for remote access |

## Quick start (local / home server)

```bash
cp .env.example .env      # set strong POSTGRES_PASSWORD + ADGUARD_PASSWORD
docker compose up -d --build
```

Then:

1. **AdGuard first-run** — open `http://<host>:3000`, complete the wizard, set the
   admin web port to **80** and use the same username/password you put in `.env`
   (`ADGUARD_USERNAME` / `ADGUARD_PASSWORD`). Recommended settings:
   [infra/adguard/AdGuardHome.example.yaml](infra/adguard/AdGuardHome.example.yaml).
2. **Point your network at it** — set your router's DHCP DNS server to `<host>`
   so all devices resolve through AdGuard.
3. **Open the dashboard** — `http://<host>:5173`. Hit **Scan network** on the
   Devices page, create Profiles, assign devices, and set rules.

Services: dashboard `:5173`, API `:3001/api`, AdGuard admin `:8080`, Postgres
`:5432` (internal).

## Develop

```bash
# backend
cd backend && npm install && npm run start:dev      # http://localhost:3001/api

# frontend (proxies /api + /socket.io to the backend)
cd frontend && npm install && npm run dev           # http://localhost:5173
```

The backend expects a reachable Postgres and AdGuard; the fastest path is
`docker compose up -d postgres adguardhome` and running the apps against them.

## Remote access with Cloudflare

Host the dashboard on **Cloudflare Pages** and reach the home API through a
**Cloudflare Tunnel** (no open router ports), gated by **Cloudflare Access** —
see [infra/cloudflare/README.md](infra/cloudflare/README.md).

## Project layout

```
backend/    NestJS API — entities, network provider (AdGuard), feature modules, cron
frontend/   React + TS dashboard (Vite)
infra/      AdGuard reference config, Cloudflare hosting notes
docs/        ARCHITECTURE.md
docker-compose.yml   Postgres + AdGuard + API + web (+ optional cloudflared)
```

## Note on scope

This tool controls **your own home network**. Bypass defense at the DNS layer
(DoH/DoT resolver blocking, SafeSearch enforcement) is strong but not absolute —
a determined user with a VPN needs router-level firewall rules to fully contain.
The architecture leaves a clean seam (`NetworkProvider`) for an OpenWrt/router
provider to add that later.
