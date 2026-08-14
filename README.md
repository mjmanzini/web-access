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
  Profile** (a child's phone + tablet + console). Each device gets a stable
  **AdGuard ClientID** so its controls follow it across IP changes and MAC
  randomization (per-device DoT/DoH setup on the Devices page).
- **Activity & bandwidth monitoring** — DNS queries, top domains, and active
  hours from the AdGuard query log; **real per-device bandwidth** (today's ↓/↑ +
  live rate) when an OpenWrt router is attached.
- **Parental controls** — instant block/unblock of domains and categories
  (adult, gaming, social, video, gambling); forced **SafeSearch** and **YouTube
  Restricted Mode** at the DNS level; **DoH/DoT bypass detection + blocking**, and
  (with a router) firewall-level **VPN/DoT/bypass containment** + true internet
  cutoffs.
- **Time management** — daily internet quotas and schedule-based blocking
  (bedtime), enforced on a cron heartbeat.
- **Real-time alerting** — WebSocket feed to the dashboard plus an optional
  outbound webhook on blocked access, bypass attempts, and new devices.
- **Offline detection** — a heartbeat alerts you if AdGuard/the router goes
  unreachable (filter down), plus an optional dead-man's-switch ping so an
  external monitor catches the whole box losing power.
- **Everyday controls** — an "ask to unblock" request queue (kid requests a
  domain, parent approves → allow rule), **bonus time** and one-tap **pause all**,
  per-profile **screen-time reports** (7-day usage + top domains), a **weekly
  digest** to your webhook, and automatic device naming by MAC vendor (OUI).

## Stack

| Layer | Tech |
|-------|------|
| Frontend | React + TypeScript (Vite) — `frontend/` |
| Backend | NestJS + Node — `backend/` |
| Database | PostgreSQL + TypeORM |
| Network/DNS | AdGuard Home (via its control API), behind a pluggable `NetworkProvider` |
| Router (optional) | OpenWrt via ubus, behind a pluggable `RouterProvider` — firewall + bandwidth |
| Deploy | Docker Compose (home server) + Cloudflare Pages/Tunnel for remote access |

## Quick start (local / home server)

```bash
cp .env.example .env
# Fill in the required secrets (see "Configuration & secrets" below):
#   POSTGRES_PASSWORD=$(openssl rand -base64 24)
#   ADGUARD_PASSWORD=$(openssl rand -base64 24)
docker compose up -d --build
```

Compose fails fast if the required secrets aren't set — there are no baked-in
default passwords.

Then:

1. **AdGuard first-run** — open `http://<host>:3000`, complete the wizard, set the
   admin web port to **80** and use the same username/password you put in `.env`
   (`ADGUARD_USERNAME` / `ADGUARD_PASSWORD`). Recommended settings:
   [infra/adguard/AdGuardHome.example.yaml](infra/adguard/AdGuardHome.example.yaml).
2. **Point your network at it** — set your router's DHCP DNS server to `<host>`
   so all devices resolve through AdGuard.
3. **Open the dashboard** — `http://<host>:5173` and sign in with
   `AUTH_ADMIN_USERNAME` / `AUTH_ADMIN_PASSWORD` (the admin is seeded on first
   boot). Then hit **Scan network** on the Devices page, create Profiles, assign
   devices, and set rules. Change the admin password from the app once you're in.

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

## Configuration & secrets

No secrets are committed to this repo — `.env` is gitignored and
[`.env.example`](.env.example) ships with blank secret values. Where each secret
lives:

| Secret | Used by | Where it lives |
|--------|---------|----------------|
| `POSTGRES_PASSWORD` | API ↔ Postgres | `.env` on the home server only |
| `ADGUARD_PASSWORD` | API ↔ AdGuard control API | `.env` on the home server only |
| `JWT_SECRET` | Dashboard login token signing | `.env` on the home server only |
| `AUTH_ADMIN_PASSWORD` | Seeds the parent/admin login | `.env` on the home server only |
| `TUNNEL_TOKEN` | Cloudflare Tunnel | Cloudflare Zero Trust dashboard → `.env` on the host |
| `VITE_API_BASE` | Dashboard → API URL | Cloudflare Pages build env var (not a secret) |

`docker-compose.yml` references these via `${VAR:?…}` for the required ones, so
the stack refuses to start rather than fall back to a weak default. To rotate a
password, update `.env` and `docker compose up -d` (and the AdGuard admin user in
its UI for `ADGUARD_PASSWORD`).

## Optional: OpenWrt router (real bandwidth + full bypass containment)

AdGuard filters DNS; it can't meter bytes or stop a VPN. Attach an OpenWrt router
to add per-device **bandwidth**, **true internet cutoffs** at the firewall, and
**bypass containment** (force DNS→AdGuard, drop DoT/known-DoH/VPN). It's fully
optional — the app runs AdGuard-only by default.

> **Router compatibility.** Full router features (firewall cutoffs, bandwidth,
> VPN/DoT containment) require **OpenWrt** (`ROUTER_PROVIDER=openwrt`). For a
> **Huawei HiLink LTE CPE** (e.g. B525) set `ROUTER_PROVIDER=huawei` for a
> partial provider — device discovery + per-device Wi-Fi **MAC-block cutoff**
> (real pause/bedtime), but no bandwidth or containment (those stay DNS-layer via
> AdGuard). Other stock ISP routers: run **AdGuard-only** (point the router's
> DHCP DNS at the AdGuard box as the *only* resolver, or use per-device DoT/DoH
> ClientID), or add an OpenWrt device inline for the full feature set.
>
> **Huawei LTE (`ROUTER_PROVIDER=huawei`).** Set `HUAWEI_URL` / `HUAWEI_USERNAME`
> / `HUAWEI_PASSWORD` (the router admin login). The driver talks to the HiLink
> XML API (SCRAM login). MAC-block affects Wi-Fi clients; a randomized MAC can
> evade it, so AdGuard blocks in parallel by ClientID/IP. Implemented to the B525
> API spec but **validate against your device** — Huawei firmwares vary in the
> MAC-filter field names.

To enable (OpenWrt only): install `uhttpd-mod-ubus` (the `/ubus` endpoint), grant
the API user rpcd `file` (read + exec) ACLs, and install `nlbwmon` for bandwidth.
Then set in `.env`:

```
ROUTER_PROVIDER=openwrt
OPENWRT_URL=http://192.168.1.1
OPENWRT_USERNAME=root
OPENWRT_PASSWORD=…        # host .env only, never committed
ADGUARD_LAN_IP=192.168.1.2
```

Home Guardian keeps all its firewall state in a dedicated, fenced nftables table
(`inet home_guardian`) so it never touches OpenWrt's own `fw4` rules. Apply
containment from the dashboard's **Router** card. (These nft/ubus calls are
implemented to spec but should be validated on your hardware before you rely on
them.)

## Deploy to Cloudflare

Only the **dashboard** goes on Cloudflare's edge — the backend stays on your home
server (it has to reach your LAN's AdGuard + Postgres and can't run on Workers).

- **Dashboard → Cloudflare Pages** — one command: `make deploy-cloudflare`
  (with `VITE_API_BASE` in `.env`). Or connect the repo in the Pages dashboard,
  or use the included [`deploy-cloudflare.yml`](.github/workflows/deploy-cloudflare.yml)
  workflow (opt in with the `CLOUDFLARE_DEPLOY` repo variable).
- **Backend → Cloudflare Tunnel + Access** — expose the home API with no open
  router ports (`docker compose --profile cloudflare up -d`), gated by Access.

Secrets stay out of the repo: the tunnel token comes from the Zero Trust
dashboard, and the API URL is a Pages build variable. **Full step-by-step
runbook: [infra/cloudflare/README.md](infra/cloudflare/README.md).**

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
That's exactly what the optional **OpenWrt router provider** adds (VPN/DoT
containment, forced DNS, true cutoffs); without a router, controls are
DNS-only.
