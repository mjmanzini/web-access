# Khuloh Mobile -> Current Backend Contract

This document translates the imported mobile app in `khuloh-mobile/` from its
current Supabase assumptions to the backend that already exists in this
repository.

It is not a wire-level spec for every field. It is the integration contract for
the next implementation phase: make the mobile client talk to
`signaling-server/` instead of directly calling Supabase tables, RPCs, and Edge
Functions.

## Goal

Keep one backend authority:

- auth and profile/session identity from `signaling-server/src/auth/`
- direct chat from `signaling-server/src/chat/messages.js`
- Khuloh zones, wallet, trust, moderation, safe-spots, meetups, panic, and QR
  from `signaling-server/src/khuloh/`

The mobile app should replace direct Supabase access in `khuloh-mobile/src/`
with:

- authenticated HTTP calls to `/api/...`
- Socket.IO on `/chat` and `/khuloh`
- local persistence only for cache/offline queue, not as a second source of
  truth

## Auth Contract

### Current mobile assumption

The mobile app currently uses Supabase auth directly:

- `PhoneEntryScreen.tsx` -> `supabase.auth.signInWithOtp`
- `OtpVerifyScreen.tsx` -> `supabase.auth.verifyOtp`
- `AuthContext.tsx` -> `supabase.auth.getSession`, `onAuthStateChange`

### Current server reality

The current backend exposes token-based auth, not Supabase sessions:

- `POST /api/auth/register` in `signaling-server/src/auth/register.js`
- `GET /api/me` in `signaling-server/src/auth/register.js`
- bearer-token auth in `signaling-server/src/auth/sessions.js`

### Translation decision

Use the server token model as the mobile app session contract.

Initial client contract:

- `POST /api/auth/register`
  body: `{ displayName, phone?, email?, username? }`
  returns: `{ id, username, displayName, token }`
- `GET /api/me`
  header: `Authorization: Bearer <token>`
  returns: `{ user }`

Required mobile refactor:

- replace `supabase.auth` session state with local token storage
- hydrate current user via `/api/me`
- pass the same bearer token to Socket.IO `auth.token`

Gap:

- the current server does not implement OTP verification, so the imported mobile
  phone flow cannot be preserved as-is yet
- until OTP exists on the Node backend, mobile onboarding should use the
  existing token registration flow or a new Node-native OTP implementation

## Profile Contract

### Current mobile assumption

The mobile app reads and updates `profiles` directly:

- `AuthContext.tsx` selects from `profiles`
- `ProfileScreen.tsx` uses `update_own_profile`
- multiple screens read `vibe`, `ghost_mode_until`, `data_light_mode`, and
  other fields from `profiles`

### Current server reality

The current backend now exposes a unified Khuloh profile contract:

- `GET /api/khuloh/profile/me`
- `PATCH /api/khuloh/profile/me`
- `GET /api/khuloh/profile/:uid`

Implementation lives in `signaling-server/src/khuloh/profile.js`.

### Translation decision

Use the new Node-backed profile surface rather than preserving a Supabase-style
`profiles` table contract inside the client.

Recommended target endpoints:

- `GET /api/khuloh/profile/me`
- `PATCH /api/khuloh/profile/me`
- `GET /api/khuloh/profile/:uid`

Minimum fields the mobile app expects today:

- `id`
- `username`
- `displayName`
- `phone`
- `avatarUrl`
- `bio`
- `vibe`
- `city`
- `isVerified`
- `ghostModeUntil`
- `dataLightMode`
- `trustScore` or `trustTier`
- `vibePoints`

Gap:

- the mobile client still needs an adapter because field names are now served by
  the Node backend contract rather than direct table rows and RPCs

## Zones Contract

### Current mobile assumption

The mobile client uses Supabase tables and realtime channels:

- `ZonesDashboardScreen.tsx` reads `rooms_with_counts`
- `ZoneChatScreen.tsx` reads `zone_messages`, `room_members`, `profiles`,
  `zone_guardians`, and `shouts`
- `ZoneChatScreen.tsx` subscribes to `postgres_changes`

### Current server reality

The current backend already has a Khuloh zone runtime:

- `GET /api/khuloh/zones`
- `POST /api/khuloh/zones`
- `GET /api/khuloh/zones/:id/messages`
- Socket.IO `/khuloh` events from `signaling-server/src/khuloh/socket.js` and
  `signaling-server/src/khuloh/zones.js`

Available socket events:

- client -> `zone:join` `{ zoneId }`
- client -> `zone:leave` `{ zoneId }`
- client -> `zone:msg` `{ zoneId, body }`
- client -> `zone:typing` `{ zoneId, typing }`
- client -> `zone:presence:list` `{ zoneId }`
- client -> `shout` `{ zoneId, body }`
- server -> `zone:msg`
- server -> `zone:msg.b`
- server -> `zone:presence`
- server -> `zone:typing`
- server -> `shout`
- server -> `shout.b`
- server -> `zone:mute`
- server -> `zone:unmute`

### Translation decision

Replace all Supabase zone table access with `/api/khuloh/zones` plus the
`/khuloh` Socket.IO namespace.

Client mapping:

- `rooms_with_counts` -> `GET /api/khuloh/zones`
- `zone_messages` history -> `GET /api/khuloh/zones/:id/messages`
- realtime `zone_messages` insert subscription -> `zone:msg`
- `room_members` and guardian lookups -> `zone:presence` and trust/mute events
- `send_shout` RPC -> `shout` socket event

Gap:

- the current server returns `zones`, not the Supabase `rooms_with_counts`
  shape, so the client will need a small adapter
- member profile lists are presence-based rather than SQL-join-based

## Whisper / Direct Message Contract

### Current mobile assumption

The mobile app treats whispers as their own table:

- `ChatsListScreen.tsx` reads `whispers`
- `WhisperChatScreen.tsx` reads and inserts into `whispers`
- realtime is a Supabase `postgres_changes` subscription on `whispers`

### Current server reality

The current backend already has durable direct chat:

- `GET /api/conversations`
- `POST /api/conversations` `{ peerUserId }`
- `GET /api/conversations/:id/messages`
- Socket.IO `/chat` from `signaling-server/src/chat/messages.js`

### Translation decision

Treat mobile “whispers” as 1:1 conversations in the current chat subsystem.

Client mapping:

- start whisper with user -> `POST /api/conversations` `{ peerUserId }`
- load whisper history -> `GET /api/conversations/:id/messages`
- send whisper -> `/chat` socket `send` event
- receipts -> `/chat` socket `receipt` event
- typing -> `/chat` socket `typing` event

Gap:

- if product requirements still demand 24h whisper expiry, that behavior must be
  implemented on top of the conversation model; it does not exist yet

## Wallet / Trust / Ghost Mode Contract

### Current mobile assumption

The mobile app uses a mix of table reads, RPCs, and Edge Functions:

- `getVibeBalance` reads `profiles.vibe_points`
- `getTransactions` reads `point_transactions`
- `claimDailyLogin` calls `claim_daily_login`
- `activateGhostMode` calls `activate_ghost_mode`
- `sendShout` calls `send_shout`
- guardian status reads `zone_guardians`
- mutes read and write `mutes`

### Current server reality

The current backend implements this behavior in the `/khuloh` socket namespace
and wallet/trust modules:

- `wallet_sync`
- `ghost_mode`
- `shout`
- `trust:me`
- `zone:mute`
- `zone:unmute`
- ledger and balance in `signaling-server/src/khuloh/wallet.js`
- trust in `signaling-server/src/khuloh/trust.js`

### Translation decision

Use the `/khuloh` socket namespace as the primary wallet and zone-economy
transport.

Client mapping:

- `getVibeBalance` + `getTransactions` -> `wallet_sync`
- `claim_daily_login` -> implicit server-side `creditDailyLogin` on connect,
  plus optional explicit endpoint later if the UI needs a manual claim action
- `activate_ghost_mode` -> `ghost_mode`
- `send_shout` -> `shout`
- `isGuardian` and `getRoomGuardians` -> `trust:me` plus zone moderation state
- `muteUser` -> `zone:mute`
- `isUserMuted` -> local mute-state cache from server events or a new read
  endpoint if needed

Gap:

- the current server does not expose a REST read endpoint for wallet history
  because it expects socket sync
- ghost mode is charged server-side, but profile visibility suppression is not
  yet exposed as a unified profile contract to the client

## Safe-Spots / Meetups / Reviews Contract

### Current mobile assumption

The mobile app currently depends on these Supabase resources:

- `safe_spots`
- `pair_checkins`
- `pending_reviews`
- `confirm_pair_checkin`
- `submit_meetup_review`
- `setDataLightMode` via `profiles`

### Current server reality

The current backend already supports:

- `GET /api/khuloh/safe-spots`
- `POST /api/khuloh/meetups`
- `POST /api/khuloh/meetups/:id/check-in`
- `POST /api/khuloh/meetups/:id/safe`
- `POST /api/khuloh/meetups/:id/panic`
- `GET /api/khuloh/meetups/mine`
- `POST /api/khuloh/partner/qr/verify`

### Translation decision

Move the client from `pair_checkins` to `meetups`.

Client mapping:

- `getSafeSpots` -> `GET /api/khuloh/safe-spots?city=`
- `getNearbySafeSpots` -> `GET /api/khuloh/safe-spots?lat=&lng=&radiusKm=`
- `initiatePairCheckin` -> `POST /api/khuloh/meetups`
- `confirmPairCheckin` / GPS check-in -> `POST /api/khuloh/meetups/:id/check-in`
- “I’m safe” after meetup -> `POST /api/khuloh/meetups/:id/safe`
- QR verification -> `POST /api/khuloh/partner/qr/verify`

Gap:

- review persistence and `pending_reviews` are not implemented in the Node
  backend yet
- if reviews remain part of the product, add them on top of `meetups` instead of
  reviving `pair_checkins`

## Panic Contacts Contract

### Current mobile assumption

The mobile app stores emergency contacts in `emergency_contacts` and uses
`safety_checkins` plus `respond_safe` RPC.

### Current server reality

The current backend already supports encrypted panic contacts and manual panic:

- `GET /api/khuloh/panic/contacts`
- `PUT /api/khuloh/panic/contacts`
- `POST /api/khuloh/panic/trigger`

### Translation decision

Replace `emergency_contacts` table access with the panic REST API.

Client mapping:

- list contacts -> `GET /api/khuloh/panic/contacts`
- replace contacts -> `PUT /api/khuloh/panic/contacts`
- panic button -> `POST /api/khuloh/panic/trigger`

Gap:

- the mobile app still needs an adapter because the Node contract is route-based
  and uses `panic.js` fan-out, not Supabase RPCs or table subscriptions

## Safety Check-In Gap

This was the largest functional gap between the mobile client and the current
backend. The Node backend now has a first-pass replacement contract.

### Current mobile expectation

`SafetyCheckinScreen.tsx` expects:

- list check-ins for current user
- create a pending check-in for a met user
- mark a pending check-in safe
- local polling for due check-ins

### Current server status

The current backend now exposes:

- `GET /api/khuloh/safety-checkins`
- `POST /api/khuloh/safety-checkins`
- `POST /api/khuloh/safety-checkins/:id/safe`

Implementation lives in `signaling-server/src/khuloh/safety-checkins.js` and
reuses panic fan-out from `signaling-server/src/khuloh/panic.js` for overdue
check-ins.

### Current Node contract

- `GET /api/khuloh/safety-checkins`
- `POST /api/khuloh/safety-checkins`
  body: `{ metUserId, checkAt, lat?, lng?, meetupId? }`
- `POST /api/khuloh/safety-checkins/:id/safe`
- overdue escalation currently runs through the backend check-in processor;
  a dedicated cron or worker can be added later if background scheduling needs
  to be more reliable than request-driven processing

Implementation note:

- this should reuse the encrypted panic-contact storage and event fan-out in
  `signaling-server/src/khuloh/panic.js`, not reintroduce Supabase plaintext
  contact rows

## Edge Function Replacement Map

Supabase Edge Functions currently used by the mobile app:

- `verify-liveness`
- `scan-message`
- `award-points`
- `gps-checkin`
- `verify-badge`

Translation:

- `scan-message` -> current server already performs scam scanning inline for
  zone messages and shouts; direct-message scanning should move to the Node chat
  pipeline instead of a separate mobile-triggered function
- `award-points` -> current wallet logic should stay server-owned in Node
- `gps-checkin` -> use meetup check-in and QR verification routes
- `verify-badge` -> `POST /api/khuloh/partner/qr/verify` and admin QR issue API
- `verify-liveness` -> separate gap; no current Node replacement yet

## Suggested Mobile Adapter Layers

Replace the current Supabase-centric modules with backend adapters:

- `src/lib/backend/auth.ts`
- `src/lib/backend/profile.ts`
- `src/lib/backend/zones.ts`
- `src/lib/backend/chat.ts`
- `src/lib/backend/wallet.ts`
- `src/lib/backend/safety.ts`

These modules should hide transport choice from the screens:

- HTTP for fetch and mutations with request/response bodies
- Socket.IO for zone/chat realtime and wallet sync
- AsyncStorage or SecureStore only for token/cache/offline queue

## Immediate Implementation Order

1. Replace `AuthContext` and `src/lib/supabase.ts` as the session authority.
2. Move zones from Supabase table reads to `/api/khuloh/zones` plus `/khuloh`
   sockets.
3. Move whispers to `/api/conversations` plus `/chat` sockets.
4. Replace emergency contacts with `/api/khuloh/panic/contacts`.
5. Wire the mobile safety-checkin screens to the new Node `safety-checkins`
  routes and remove the Supabase `respond_safe` RPC dependency.
6. Rewire mobile profile screens and auth-adjacent state to the new profile
  endpoints so ghost mode, vibe, trust, and verification stop leaking through
  ad hoc storage reads.

## Bottom Line

The mobile app should be treated as a client port, not as a Supabase-backed app
that happens to live in this repository. The integration target is the current
Node backend, and the main missing backend feature to add next is
`safety-checkins`.