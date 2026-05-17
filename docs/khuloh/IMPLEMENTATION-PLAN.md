# Khuloh — Phase 6, 7, 8 Implementation Plan

> Concrete engineering plan that extends the existing
> [signaling-server](../../signaling-server) and
> [web-client](../../web-client) to deliver the Vibe Economy, Safe-Spot
> network, and data-lite messaging.

Each phase lists: data model, server changes, client changes, and an AI prompt
you can paste into a coding assistant to scaffold the work.

---

## Phase 6 — Vibe Economy & Community Governance

> **Status:** complete (Dec 2025).
> Implemented: wallet ledger (`khuloh/wallet.js`), `/khuloh` socket with
> `shout` / `ghost_mode` / `wallet_sync`, scam-shield message filter,
> Zones (REST + socket rooms), `/wallet` and `/zones` pages, trust-score
> (`khuloh/trust.js` — tiers new/regular/trusted/guardian) and mute-in-zone
> (`khuloh/moderation.js`) with Guardian-only socket events
> `zone:mute` / `zone:unmute` and in-room mute UI.

### Goals
- Reward safe, helpful behaviour with **Vibe Points** (free, non-cashable).
- Let trusted users moderate Zones as **Guardians**.
- Spend points on cosmetic / amplification features (`Shout`, `Ghost-Mode`,
  custom chat-bubble colour).

### Data model

```
profiles.vibe_points     int   (denormalised current balance)
profiles.trust_score     int   (0-100; computed daily)

vibe_ledger              append-only
  - id           uuid
  - uid          fk profiles
  - delta        int          (positive = earn, negative = spend)
  - reason       enum         (daily_login | safe_meetup | report_upheld
                              | shout | ghost_mode | guardian_bonus | refund)
  - ref          string?      (zone_id, meetup_id, message_id, ...)
  - created_at   timestamp

zone_guardians
  - zone_id, uid, granted_at, granted_by
```

**Why append-only?** Lets the client sync only `WHERE created_at > last_sync`
(delta sync), which is critical for Phase 8 data-lite mode.

### Server (`signaling-server/src/khuloh/wallet.js`)

```js
// pseudo-API
export async function credit(uid, delta, reason, ref) { /* insert ledger row, bump profile */ }
export async function debit(uid, delta, reason, ref)  { /* same, refuses if balance < delta */ }
export async function balance(uid) { /* read denormalised, fall back to SUM(delta) */ }
export async function ledgerSince(uid, sinceIso) { /* returns delta rows */ }
```

Hook points (Socket.IO events to add to `server.js`):

| Event in                        | Action                                                       |
| ------------------------------- | ------------------------------------------------------------ |
| `connection` (first of the day) | `credit(uid, 10, 'daily_login')`                             |
| `khuloh:shout`                  | `debit(uid, 20, 'shout', zoneId)` then broadcast to zone     |
| `khuloh:ghost_mode`             | `debit(uid, 100, 'ghost_mode')` for 30-min window            |
| `khuloh:wallet_sync`            | returns `{ balance, ledger_delta }`                          |

### Community Guardians

- Promotion rule: `trust_score >= 80 AND verified AND no_strikes_30d`.
- Powers: 5-minute mute on a user **inside their zone only**, flag-for-review.
- Abuse circuit-breaker: a Guardian who is reverse-reported by 3 distinct
  verified users in 24 h is auto-demoted.

### Client

- New route `web-client/app/wallet/page.tsx` — balance + last-30 ledger rows.
- Add `Shout` and `Ghost-Mode` buttons to the Zone composer
  ([Composer.tsx](../../web-client/components/chat/Composer.tsx)) gated by
  `balance >= cost`.
- Profile badge component: 🛡️ for Guardian, ✓ for Verified, dot color for
  intent (Chat / Connect / Ignite).

### Phase-6 AI prompt

> Build the Khuloh Vibe Economy on top of the existing
> `signaling-server` (Node + Socket.IO + Firestore via
> `signaling-server/src/storage/firebase.js`).
>
> 1. Create `signaling-server/src/khuloh/wallet.js` exposing `credit`,
>    `debit`, `balance`, `ledgerSince`. Use an append-only `vibe_ledger`
>    collection plus a denormalised `vibe_points` field on `profiles`.
>    Wrap mutations in a Firestore transaction so the denormalised value
>    can never drift.
> 2. Wire Socket.IO events `khuloh:shout`, `khuloh:ghost_mode`,
>    `khuloh:wallet_sync` in `server.js`. Reject events when balance is
>    insufficient and reply with `{ ok:false, reason:'insufficient' }`.
> 3. On the first connection per UTC day, credit `+10` with reason
>    `daily_login` (idempotent — track `last_login_credit_day` on profile).
> 4. Add a Guardian helper that promotes profiles where
>    `trust_score >= 80 && is_verified && strikes_30d == 0` and exposes
>    `muteInZone(guardianUid, targetUid, zoneId, 300_seconds)`.
> 5. Add Next.js page `web-client/app/wallet/page.tsx` showing balance
>    and ledger via `khuloh:wallet_sync`. Reuse the existing socket
>    connection from `chat-client.ts` — do not open a second socket.

---

## Phase 7 — Safe-Spot Network & Panic Check-in

> **Status:** Phase 7 server complete (Dec 2025).
> Implemented: `safe-spots.js`, `meetups.js`, `panic.js`, `partner-qr.js`,
> `sms.js` (Twilio / Clickatell / log adapter), Firestore + in-memory
> fallback, AES-256-GCM encrypted panic contacts, signed Safe-Spot QR
> (`KHULOH_QR_SIGNING_KEY`), client lib helpers (`verifyPartnerQr`,
> `parsePartnerQrPayload`), `/zones/safe-spots` page, panic-contacts
> settings, long-press `<PanicButton>`.
> Pending UI: in-app QR scanner page, Mapbox vector tiles, partners admin UI.

### Goals
- Curated map of partner venues (cafés, lounges, malls) where verified users
  meet safely.
- Reward verified meetups; penalise no-shows.
- One-tap panic flow that alerts pre-set contacts.

### Data model

```
safe_spots
  - id, partner_id, name, lat, lng, hours_json, deal_text, active

partners
  - id, business_name, contact_email, payout_terms

meetups
  - id, a_uid, b_uid, spot_id, scheduled_for, started_at,
    a_checked_in, b_checked_in, a_safe_signal_at, b_safe_signal_at,
    status enum(scheduled|in_progress|safe|missed|panic)

panic_contacts
  - uid, contacts: [{ name, phone, email }]   -- ENCRYPTED column
  - last_updated
```

PII (panic contacts) is encrypted at rest using a server-side KMS key. Only
the panic worker and the user themselves can read it.

### Server (`signaling-server/src/khuloh/`)

- `safe-spots.js` — CRUD + `nearby({lat,lng,radiusKm})`. Cache with 60-s TTL.
- `meetups.js` — schedule, check-in (GPS within 100 m of spot),
  `markSafe()`, `markPanic()`.
- `panic.js` — when triggered: SMS via existing `email/mailer.js` provider
  (or a Twilio/Clickatell adapter), email fan-out, push via existing
  notifications channel, and a webhook to a configurable security operator.
- Reward hook: `meetups.markSafe()` → `wallet.credit(both_uids, 50,
  'safe_meetup', meetup_id)`.

### Partner QR flow

1. Partner generates a per-venue QR via `/api/partner/qr?spot_id=…`.
2. User scans QR in-app → client posts
   `{ spot_id, lat, lng }`.
3. Server validates GPS-within-100 m of `safe_spots.lat/lng` →
   creates / updates `meetups`, applies discount voucher, credits points.

### Client

- `web-client/app/zones/safe-spots/page.tsx` — Mapbox vector-tile map
  (cached locally), pins for active spots.
- `web-client/lib/khuloh/panic.ts` — long-press FAB anywhere in app →
  confirm modal → POSTs to `/api/khuloh/panic`.
- `web-client/app/settings/page.tsx` adds Panic Contacts section.

### Phase-7 AI prompt

> Extend Khuloh with the Safe-Spot network and panic flow.
>
> 1. Add Firestore collections `safe_spots`, `partners`, `meetups`,
>    `panic_contacts` (panic_contacts JSON column encrypted with the
>    server's `KHULOH_KMS_KEY` via Node `crypto.createCipheriv` / `aes-256-gcm`).
> 2. Create `signaling-server/src/khuloh/safe-spots.js` with
>    `nearby({lat,lng,radiusKm})` returning active spots, cached 60 s.
> 3. Create `signaling-server/src/khuloh/meetups.js` with `checkIn`,
>    `markSafe`, `markPanic`. `checkIn` rejects if GPS is more than 100 m
>    from the spot or the spot is inactive. On `markSafe`, call
>    `wallet.credit` for both users with reason `safe_meetup`.
> 4. Create `signaling-server/src/khuloh/panic.js`. On trigger, fan out
>    SMS + email + push to all `panic_contacts.contacts`, write a row to
>    `meetups.status = 'panic'`, and POST to a configurable
>    `KHULOH_SECURITY_WEBHOOK_URL`. Rate-limit to 3/hour/user.
> 5. Add Next.js routes:
>    - `web-client/app/zones/safe-spots/page.tsx` (Mapbox GL JS, vector tiles)
>    - `web-client/lib/khuloh/panic.ts` (helper + long-press hook)
>    - `web-client/app/api/khuloh/panic/route.ts` (server action)
>    - Settings section to manage panic contacts (max 3).
> 6. Add a partner QR endpoint
>    `web-client/app/api/partner/qr/route.ts` that returns a signed,
>    short-lived QR payload `{ spot_id, exp }`.

---

## Phase 8 — Data-Lite & Zero-Rating

> **Status:** wire codec + adaptive image downscaler landed (May 2026).
> Hand-rolled, dependency-free protobuf subset in
> `signaling-server/src/khuloh/wire.js` + `web-client/lib/khuloh/wire.ts`.
> Server emits legacy JSON (`zone:msg`, `shout`) and binary mirrors
> (`zone:msg.b`, `shout.b`). Clients call
> `KhulohClient.enableBinaryWire()` to opt in; zone-room page opts in
> automatically. Adaptive image downscaler in
> `web-client/lib/khuloh/image.ts` reads
> `navigator.connection.effectiveType` / `saveData` and re-encodes JPEGs
> client-side per tier (slow-2g→320px@0.55, 2g→480px@0.60, 3g→720px@0.70,
> 4g→1280px@0.80, wifi→1920px@0.85). Wired through
> `fileToDataAttachment` so chat photos auto-shrink. Round-trip / unicode
> / wire-type tests in `signaling-server/test/wire.test.js` (5/5) and
> presence tests in `presence.test.js` (3/3). Still pending: zero-rated
> MNO partnerships, binary REST endpoints.

> **Status:** wire codec landed (Dec 2025). Hand-rolled, dependency-free
> protobuf subset in `signaling-server/src/khuloh/wire.js` +
> `web-client/lib/khuloh/wire.ts`. Server emits legacy JSON
> (`zone:msg`, `shout`) and binary mirrors (`zone:msg.b`, `shout.b`).
> Clients call `KhulohClient.enableBinaryWire()` to opt in; zone-room page
> opts in automatically. Round-trip / unicode / wire-type tests in
> `signaling-server/test/wire.test.js` (5/5). Typical zone message shrinks
> ~35–50% vs JSON. Still pending: zero-rated MNO partnerships, image
> down-tier, REST endpoints binary mode.

### Goals
- Match WhatsApp / Telegram payload sizes.
- Continue to work on 2G / EDGE (rural SA) and on capped data.
- Zero-rating partnership readiness with MTN / Vodacom / Cell C.

### Tactics

1. **Protocol Buffers over Socket.IO binary**
   - New file `signaling-server/proto/khuloh.proto` defines
     `ChatMessage`, `LedgerDelta`, `PresencePing`, `ZoneEvent`.
   - Replace JSON payloads on hot paths
     ([chat/messages.js](../../signaling-server/src/chat/messages.js),
     [chat/presence.js](../../signaling-server/src/chat/presence.js),
     `wallet.js`) with binary-encoded protobuf using
     [`protobufjs`](https://www.npmjs.com/package/protobufjs).
   - Keep JSON envelopes for low-frequency control events
     (auth, settings) so dev ergonomics stay sane.

2. **Delta wallet sync**
   - Client stores `last_ledger_seen_iso` in `localStorage`.
   - On reconnect, server returns only rows after that timestamp.

3. **Smart thumbnailing**
   - Profile pictures stored as 32×32 BlurHash + 128×128 webp + 512×512 webp.
   - Zone view fetches BlurHash only; 128 px on tap; 512 px on profile open.
   - BlurHash is ~25 bytes vs ~30 KB for a JPEG.

4. **Map vector tiles cached locally**
   - Mapbox tiles cached in IndexedDB by tile id; only "live deal" overlay
     refreshes (a few hundred bytes per spot).

5. **Service-worker offline first** — already exists at
   [web-client/public/sw.js](../../web-client/public/sw.js); extend to:
   - Queue outgoing chats when offline, flush on reconnect.
   - Cache the last 200 messages per active thread.

6. **Zero-rating readiness**
   - Pin all hot traffic to a single domain (e.g. `m.khuloh.app`) — networks
     zero-rate by hostname, not path.
   - Avoid third-party CDNs for runtime traffic; bundle assets into the PWA.
   - Publish a public `/.well-known/khuloh-traffic.json` listing IP ranges
     and hostnames so MNO ops teams can configure rules quickly.

### Phase-8 AI prompt

> Convert Khuloh hot-path messaging from JSON to Protocol Buffers to
> reduce mobile data usage by ~70 %.
>
> 1. Create `signaling-server/proto/khuloh.proto` with messages
>    `ChatMessage { string id; string thread_id; string from; bytes body; int64 ts; }`,
>    `LedgerDelta { string id; int32 delta; string reason; int64 ts; }`,
>    `PresencePing { string uid; int32 intent; int64 ts; }`.
> 2. Use `protobufjs` to load the proto file in
>    `signaling-server/src/khuloh/codec.js` and expose `encodeChat`,
>    `decodeChat`, etc.
> 3. Update `chat/messages.js` to send/receive binary buffers on event
>    `khuloh:msg` (keep the legacy JSON event for one release as
>    fallback for old clients).
> 4. On the web client, add `web-client/lib/khuloh/codec.ts` using
>    `protobufjs/light` and a generated bundle to keep the JS payload small.
> 5. Add a `vibe_ledger` delta-sync endpoint that streams binary
>    `LedgerDelta` rows since `last_seen`.
> 6. Extend the existing service worker to queue outbound `khuloh:msg`
>    buffers in IndexedDB while offline and replay on reconnect.

---

## Cross-cutting concerns

### Privacy & POPIA

- Liveness scans must not be retained in raw form; store only the
  derived face-template hash and discard the video within 24 h.
- Panic contact phone numbers are PII → encrypted column, audit log on
  read.
- Vibe ledger is pseudonymous; never expose other users' UIDs in client
  payloads beyond the user's own rows.

See [PRIVACY-POLICY.md](PRIVACY-POLICY.md) for the full data inventory.

### Observability

- Reuse existing rate-limit middleware
  ([rate-limit.js](../../signaling-server/src/rate-limit.js)) for all
  Khuloh endpoints.
- Add a structured-log line per ledger mutation
  (`event=vibe_ledger uid=… delta=… reason=…`) — this is your audit
  trail for disputes.

### Test plan

| Layer            | Tooling                                                |
| ---------------- | ------------------------------------------------------ |
| Wallet ledger    | Vitest, property-test that balance == sum(deltas)      |
| Scam-Shield NLP  | Golden-file tests of message → action                  |
| Panic flow       | Integration test mocks SMS + webhook, asserts fan-out  |
| Protobuf codec   | Round-trip fuzz test                                   |
| E2E              | Extend [tests/e2e-smoke.js](../../tests/e2e-smoke.js)  |
