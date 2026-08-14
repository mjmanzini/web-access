# Home Guardian — Architecture

Home Wi-Fi monitoring + parental control. The backend is the brain and the
**database is the source of truth**; AdGuard Home is the enforcement point that
the backend continuously reconciles to. No custom packet sniffing — all
visibility and control flow through the DNS layer's API.

## 1. System data flow

```
                         ┌───────────────────────────────────────────┐
                         │                Home LAN                     │
   Kids' / family        │                                             │
   devices  ──DNS(53)──► │  AdGuard Home  ──query log / clients API──┐ │
   (phone, tablet,       │   (DNS sinkhole,                          │ │
    console)             │    SafeSearch, categories,                │ │
        ▲                │    per-client rules)                      │ │
        │ enforce        │        ▲                                  ▼ │
        │ (block/allow,  │        │ control API (REST, Basic auth)   ▲ │
        │  pause)        │        │                                  │ │
        │                │  ┌─────┴───────────────┐   ┌──────────────┴┐│
        └────────────────┼──│  NestJS API         │◄─►│  PostgreSQL    ││
                         │  │  (profiles/devices/ │   │  (TypeORM)     ││
                         │  │   rules/activity/   │   └───────────────┘│
                         │  │   schedules + cron) │                    │
                         │  └─────────┬───────────┘                    │
                         └────────────┼────────────────────────────────┘
                                      │ REST /api  +  WebSocket /socket.io
                                      ▼
                        React + TS dashboard (Cloudflare Pages)
                        reached remotely via Cloudflare Tunnel + Access
```

Loops that keep the system live (all in `SchedulerService`):

- **every 30s** — pull AdGuard query log → persist `ActivityLog`, map to device/
  profile by client IP, emit `blocked_access` / `bypass_attempt` alerts.
- **every 2m** — pull AdGuard clients + DHCP leases → upsert `Device`, flag
  randomized MACs, emit `device_new` / `mac_randomized` alerts.
- **every 1m** — evaluate `Schedule` windows + daily quotas → pause/resume
  profiles (manual pause always wins).

Any dashboard action (block a domain, assign a device, pause a profile) writes
the DB then calls the provider so AdGuard immediately matches.

## 2. Database schema (TypeORM entities)

| Entity | Table | Purpose | Key columns |
|--------|-------|---------|-------------|
| `Profile` | `profiles` | A person; groups devices under one policy | `blockedCategories[]`, `safeSearchEnforced`, `youtubeRestricted`, `blockDnsBypass`, `dailyTimeLimitMinutes`, `internetPaused`, `pausedReason` |
| `Device` | `devices` | One tracked device | `ipAddress`, `macAddress`, `macRandomized`, `isOnline`, `blocked`, `profileId → profiles` |
| `Rule` | `rules` | A filtering rule | `type(domain\|category)`, `value`, `action(block\|allow)`, `scope(global\|profile\|device)`, `profileId`, `deviceId`, `syncedAt` |
| `ActivityLog` | `activity_logs` | One DNS query (activity feed) | `timestamp`, `clientIp`, `deviceId`, `profileId`, `domain`, `action`, `category` — indexed on `timestamp`, `(deviceId,timestamp)`, `domain` |
| `Schedule` | `schedules` | Recurring block window (bedtime) | `daysOfWeek[]`, `startTime`, `endTime`, `profileId` |
| `DailyUsage` | `daily_usage` | Accrued active minutes/day for quotas | unique `(profileId, date)`, `usedMinutes` |
| `ActivityRollup` | `activity_rollups` | Daily aggregate kept after raw pruning | PK `(date, profileId, domain, action)`, `hits` |
| `AdminUser` | `admin_users` | Dashboard admin (parent) login | `username`, `passwordHash` (bcrypt) |

Relationships: `Profile 1─* Device`, `Profile 1─* Rule`, `Profile 1─* Schedule`,
`Device 1─* Rule`. `Device.profileId` is `SET NULL` on profile delete; rules
cascade. Entities live in `backend/src/entities/`. Dev uses TypeORM
`synchronize`; for production, generate migrations and turn it off.

## 3. Network integration strategy (AdGuard Home)

The backend never touches AdGuard's wire format directly. Three layers:

1. **`AdguardApiClient`** (`network/adguard/adguard.client.ts`) — typed HTTP over
   the control API (`/control/*`, HTTP Basic auth). Knows only AdGuard shapes.
2. **`AdguardService`** (`network/adguard/adguard.service.ts`) — implements the
   vendor-neutral **`NetworkProvider`** interface. Compiles app concepts into
   AdGuard calls.
3. **Feature services** depend only on `NETWORK_PROVIDER`. Swapping to Pi-hole or
   OpenWrt = one new provider class + one binding in `network.module.ts`.

Mapping app policy → AdGuard:

| App concept | AdGuard mechanism | API call |
|-------------|-------------------|----------|
| Profile | a **client** named `hg-<profileId>` with `ids` = its devices' MAC/IP | `POST /control/clients/{add,update}` |
| Block category (social/gaming/video) | client `blocked_services` ids | client update |
| Block category (adult) | client `parental_enabled` | client update |
| Block category (gambling) | hosted blocklist filter | `POST /control/filtering/add_url` |
| SafeSearch + YouTube Restricted | client `safe_search.{enabled,youtube,…}` | client update |
| Block a domain (per profile) | user rule `\|\|domain^$client='hg-<id>'` | `POST /control/filtering/set_rules` |
| Block a domain (everyone) | user rule `\|\|domain^` | `POST /control/filtering/set_rules` |
| Pause / bedtime / quota cutoff | add device ids to **disallowed_clients** | `POST /control/access/set` |
| Anti-bypass (DoH/DoT) | user rules blocking public DoH resolvers + Firefox canary | `POST /control/filtering/set_rules` |
| Activity feed | query log | `GET /control/querylog` |
| Device discovery | clients + DHCP leases (IP↔MAC↔hostname) | `GET /control/clients`, `/control/dhcp/status` |

**Managed user_rules are fenced.** `AdguardService` only ever rewrites the block
of `user_rules` below a `# home-guardian:managed` marker, split into per-client
buckets, so admin-authored rules and other profiles are never clobbered.

**Bypass defense, honestly scoped.** DNS-layer rules stop the easy escapes
(public DoH hostnames, Firefox's `use-application-dns.net` canary, forced
SafeSearch). The *complete* defense also needs router firewall rules the DNS
layer can't do — block outbound TCP 853 (DoT), redirect/hijack outbound port 53
to AdGuard, and block known VPN ports/DoH IP ranges. That belongs to a future
**OpenWrt provider** implementing the same `NetworkProvider` interface; the
architecture already has the seam for it.

## 4. Security & data retention

- **Auth (fail-closed).** A global `JwtAuthGuard` (`APP_GUARD`) requires a valid
  Bearer JWT on every route except those marked `@Public()` (login, health). The
  Socket.IO gateway verifies the same JWT in its handshake and disconnects
  unauthenticated sockets. A single parent/admin is seeded from
  `AUTH_ADMIN_USERNAME` / `AUTH_ADMIN_PASSWORD` on first boot (bcrypt-hashed);
  password change is available in-app. Tokens are signed with `JWT_SECRET`. For
  remote access, keep **Cloudflare Access** in front as the outer layer.
- **Retention.** `RetentionService` runs nightly: it aggregates raw
  `activity_logs` older than `ACTIVITY_RETENTION_DAYS` (default 14) into
  `activity_rollups` (idempotent upsert on the natural key), then deletes the raw
  rows. Recent detail stays queryable; long-range history lives in the rollups
  (`GET /api/activity/history`), and the raw table stays bounded.

## 5. Extending

- **New enforcement backend:** implement `NetworkProvider`, bind it in
  `network.module.ts`. Nothing else changes.
- **New category:** add an entry to `common/categories.ts` (services / parental /
  blocklistUrl) — the UI and enforcement pick it up.
- **Outbound notifications:** `EventsGateway.emitAlert()` already posts to
  `ALERT_WEBHOOK_URL`; add Slack/Discord/ntfy formatting there.
