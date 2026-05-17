# Khuloh — Adaptation Plan on top of `web-access`

> Khuloh is a South-African-first social discovery app: WhatsApp-simple chat,
> Mxit-style "Zones" (live rooms), biometric verification, and an offline-safe
> "Vibe Economy". This document maps Khuloh's product pillars onto the existing
> [web-access](../../README.md) Next.js + Node signaling codebase so we reuse
> what works instead of starting from scratch.

## 1. Why reuse `web-access`

`web-access` already ships several of Khuloh's hardest pieces:

| Khuloh requirement              | Already in `web-access`                                                                                  |
| ------------------------------- | -------------------------------------------------------------------------------------------------------- |
| Real-time messaging             | [signaling-server/src/chat/messages.js](../../signaling-server/src/chat/messages.js), Socket.IO bus      |
| Presence ("who is online now")  | [signaling-server/src/chat/presence.js](../../signaling-server/src/chat/presence.js)                     |
| WhatsApp-style chat UI          | [web-client/components/chat/](../../web-client/components/chat)                                          |
| In-app VoIP / video             | [web-client/lib/call-client.ts](../../web-client/lib/call-client.ts), [call-protocol.ts](../../web-client/lib/call-protocol.ts), [signaling-server/src/call-signaling.js](../../signaling-server/src/call-signaling.js) |
| Phone/OTP-style onboarding hook | [web-client/app/onboarding/](../../web-client/app/onboarding), [signaling-server/src/auth/](../../signaling-server/src/auth) |
| Strong auth (WebAuthn / OAuth)  | [signaling-server/src/auth/webauthn.js](../../signaling-server/src/auth/webauthn.js), [oauth.js](../../signaling-server/src/auth/oauth.js) |
| Storage abstraction (Firebase)  | [signaling-server/src/storage/](../../signaling-server/src/storage)                                      |
| Rate limiting                   | [signaling-server/src/rate-limit.js](../../signaling-server/src/rate-limit.js)                           |
| TURN/ICE for NAT traversal      | [signaling-server/src/ice.js](../../signaling-server/src/ice.js), [infra/coturn/](../../infra/coturn)    |
| PWA shell (installable, offline)| [web-client/public/sw.js](../../web-client/public/sw.js), [manifest.webmanifest](../../web-client/public/manifest.webmanifest) |

The remote-desktop pieces (`host-electron/`, `web-client/app/remote/`,
`virtual-keys.tsx`, `control-protocol.ts`) are **not** part of Khuloh and stay
isolated — Khuloh is a sibling product that reuses the platform.

## 2. Feature → file mapping

| Khuloh feature                     | New / changed file (web-client + signaling-server)                                                       |
| ---------------------------------- | -------------------------------------------------------------------------------------------------------- |
| Zones (live rooms)                 | `web-client/app/zones/page.tsx`, `web-client/app/zones/[zoneId]/page.tsx`, `signaling-server/src/zones/` |
| Whisper (DM from a Zone)           | extends existing `chat-client.ts` — open or focus a 1:1 thread keyed by `userId`                         |
| Intent toggle (Chat / Connect / Ignite) | `web-client/lib/khuloh/intent.ts`, profile field in `users.js`                                       |
| Biometric "Trust Badge"            | `web-client/lib/khuloh/liveness.ts` (FaceTec / AWS Rekognition / on-device WebRTC `getUserMedia` capture) → `signaling-server/src/khuloh/verify.js` |
| Scam-Shield NLP                    | `signaling-server/src/khuloh/scam-shield.js` runs on every inbound message before fan-out                |
| Vibe Points wallet                 | `signaling-server/src/khuloh/wallet.js` + new Firestore collection `vibe_ledger`                         |
| Safe-Spot map                      | `web-client/app/zones/safe-spots/page.tsx` + Mapbox vector tiles, partner table in storage              |
| Panic check-in                     | `web-client/lib/khuloh/panic.ts` + `signaling-server/src/khuloh/panic.js` (SMS/email via existing `email/mailer.js`) |
| Data-lite messaging                | swap chat payloads to **Protobuf over Socket.IO binary**, see [IMPLEMENTATION-PLAN.md](IMPLEMENTATION-PLAN.md#phase-7-data-lite) |

Everything lives under a `khuloh/` namespace so it can later split into its own
repo if needed.

## 3. URL / route plan

```
/                       → marketing splash (or redirect to /zones if logged in)
/onboarding             → phone OTP + liveness scan (reuses existing onboarding)
/zones                  → list of live Zones for current city
/zones/[zoneId]         → live Zone chat (group)
/zones/safe-spots       → Mapbox map of partner venues
/chats                  → 1:1 message list (existing /chat repurposed)
/chats/[peerId]         → DM thread (Whisper)
/wallet                 → Vibe Points balance + history
/settings               → existing settings + intent toggle, panic contacts
/legal/terms            → see TERMS-OF-SERVICE.md
/legal/privacy          → see PRIVACY-POLICY.md
```

## 4. Data model additions

New Firestore collections (or Postgres tables — `storage/index.js` already
abstracts both):

- `profiles` — `{ uid, handle, city, intent, trust_score, is_verified, verified_at, vibe_points }`
- `zones` — `{ id, city, name, topic, is_official, member_count }`
- `zone_members` — `{ zone_id, uid, joined_at, role }` (`role` ∈ `member|guardian`)
- `vibe_ledger` — append-only `{ uid, delta, reason, ref, created_at }` (delta-syncable)
- `scam_flags` — `{ uid, message_id, pattern, created_at, action }`
- `safe_spots` — `{ id, name, lat, lng, partner_id, deal_text, active }`
- `meetups` — `{ a_uid, b_uid, spot_id, started_at, checked_in_at, safe_signal_at }`
- `panic_contacts` — `{ uid, contacts: [{name, phone}] }` (PII — encrypt at rest)

See [IMPLEMENTATION-PLAN.md](IMPLEMENTATION-PLAN.md) for indexes and access
rules.

The imported mobile schema and the current server model are reconciled in
[SUPABASE-RECONCILIATION.md](SUPABASE-RECONCILIATION.md).

The mobile client translation layer for this backend lives in
[MOBILE-BACKEND-CONTRACT.md](MOBILE-BACKEND-CONTRACT.md).

## 5. Phasing summary

| Phase | What                                            | Status |
| ----- | ----------------------------------------------- | ------ |
| 1–5   | Auth, Zones, Whisper, Intent toggle, Scam-Shield, WhatsApp UI | spec'd in this folder; build on existing files |
| 6     | Vibe Economy + Community Guardians              | [IMPLEMENTATION-PLAN.md#phase-6](IMPLEMENTATION-PLAN.md#phase-6-vibe-economy--community-governance) |
| 7     | Safe-Spot partner network + Panic check-in      | [IMPLEMENTATION-PLAN.md#phase-7](IMPLEMENTATION-PLAN.md#phase-7-safe-spot-network--panic-check-in) |
| 8     | Data-lite (Protobuf, delta sync, zero-rating)   | [IMPLEMENTATION-PLAN.md#phase-8](IMPLEMENTATION-PLAN.md#phase-8-data-lite--zero-rating) |

## 6. Legal

Khuloh is a South-African product → **POPIA** (Protection of Personal
Information Act, 2013) is the binding privacy regime, with **Films &
Publications Act** and **Electronic Communications and Transactions Act**
(ECTA) also in scope.

- [TERMS-OF-SERVICE.md](TERMS-OF-SERVICE.md)
- [PRIVACY-POLICY.md](PRIVACY-POLICY.md)

Both documents are **drafts for review by a qualified South African attorney**
before launch — they are not legal advice.
