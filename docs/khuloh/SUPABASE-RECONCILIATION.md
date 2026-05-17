# Khuloh — Supabase Reconciliation

This document reconciles the imported mobile schema under
`khuloh-mobile/supabase/` with the backend already implemented in
`signaling-server/`.

## Decision

The canonical backend for this repository should remain the existing
`signaling-server/` data and transport model, not the imported Supabase schema.

Reasoning:

- The current repo already has a working runtime for auth, chat, presence,
  calls, remote sessions, rate limiting, moderation, wallet, zones,
  safe-spots, meetups, panic, partner QR, and binary wire flows.
- The storage layer already abstracts Postgres and Firebase in
  `signaling-server/src/storage/`, while the imported Supabase schema is a
  third backend design with overlapping but non-identical concepts.
- The mobile app is valuable as a client and product specification, but its
  Supabase tables should be treated as an imported model to translate from,
  not a second authoritative backend.

## Current Backend Of Record

The current server model is split across these surfaces:

- `users`, auth sessions, WebAuthn, OAuth, chat, presence, remote sessions:
  existing Postgres and Firebase adapters plus runtime routes
- direct chat and safety tables in
  `signaling-server/src/chat/messages.js`
- Khuloh wallet, trust, moderation, safe-spots, meetups, panic, partner QR,
  and wire support in `signaling-server/src/khuloh/`
- runtime registration in `signaling-server/src/server.js`

That means the backend already assumes these primitives:

- user identity lives in the existing `users` model, not `auth.users`
- direct messaging is `conversations` / `conversation_members` /
  `chat_messages_v2`, not `whispers`
- zone chat is driven by Socket.IO and lightweight room state, not purely SQL
  realtime tables
- Vibe Points and trust are implemented in app logic and Firestore-backed
  documents, not as Postgres stored procedures
- safe-spots, meetups, panic, and partner QR already exist as server modules

## Mapping

### Profiles and identity

Imported Supabase:

- `profiles` from
  `khuloh-mobile/supabase/migrations/001_create_profiles.sql`
  contains `phone`, `username`, `bio`, `trust_score`, `is_verified`,
  `avatar_url`, later `vibe_points`, `data_light_mode`, `reverify_required`,
  `ghost_mode_until`, `is_shadow_banned`
- identity is tied to `auth.users`

Current backend:

- identity is the existing `users` model plus auth sessions and WebAuthn
- wallet balance is denormalized on the user document in
  `signaling-server/src/khuloh/wallet.js`
- trust is computed from ledger activity in
  `signaling-server/src/khuloh/trust.js`, not stored as the source of truth
- blocking/reporting is modeled through `contacts`, `user_reports`, and
  runtime checks in `signaling-server/src/chat/messages.js` and
  `signaling-server/src/users.js`

Decision:

- Keep the existing `users` identity model as canonical.
- Treat imported `profiles` fields as a feature inventory to fold into the
  existing user profile surface where still needed.
- Do not introduce a second profile authority tied to Supabase auth.

### Zones, room presence, and messaging

Imported Supabase:

- `rooms`, `room_members`, `zone_messages`, `whispers` in
  `khuloh-mobile/supabase/migrations/003_create_zones.sql`
- presence and messages rely on database tables plus Supabase Realtime

Current backend:

- zones are implemented in `signaling-server/src/khuloh/zones.js`
- presence is in-memory and broadcast over Socket.IO in
  `signaling-server/src/khuloh/presence.js`
- direct messages are existing conversations in
  `signaling-server/src/chat/messages.js`
- the browser client already uses `web-client/app/zones/` and the Khuloh socket
  client in `web-client/lib/khuloh/client.ts`

Decision:

- Keep Socket.IO zone transport and current conversation-based DMs.
- The imported `whispers` table should not be adopted as a second DM model.
- The imported `rooms` seed data can be reused as zone seed content, but the
  runtime transport should stay on the current server implementation.

### Economy, shouts, guardians, and trust

Imported Supabase:

- `point_transactions`, `shouts`, `zone_guardians`, `mutes` and stored
  procedures in `khuloh-mobile/supabase/migrations/008_vibe_economy.sql`
- later extensions for `daily_logins`, `trust_badges`, `ghost_mode_until`, and
  revised point logic in
  `khuloh-mobile/supabase/migrations/012_economy_enhancements.sql`

Current backend:

- append-only wallet ledger in `signaling-server/src/khuloh/wallet.js`
- trust tiers computed from ledger reasons in
  `signaling-server/src/khuloh/trust.js`
- shout and ghost mode behavior on `/khuloh` socket in
  `signaling-server/src/khuloh/socket.js`
- zone mutes in `signaling-server/src/khuloh/moderation.js`

Key drift:

- imported Supabase cost and reward values do not fully match the current
  server values
- imported guardian promotion uses persisted trust score in SQL; current server
  derives trust from ledger activity
- imported schema models `zone_guardians` as a durable table; current server
  derives privilege from trust tier and keeps only mute state durable

Decision:

- Keep current wallet, trust, and moderation behavior as canonical.
- Pull only missing product features from the imported mobile app where they
  improve UX, not database semantics.
- If durable guardian assignment becomes necessary, add it to the current
  server model explicitly instead of adopting the Supabase table wholesale.

### Scam shield, reports, and safety check-ins

Imported Supabase:

- `message_flags`, `user_reports`, `emergency_contacts`, `safety_checkins` in
  `khuloh-mobile/supabase/migrations/006_scam_shield.sql`
- shadow-ban and overdue safety-checkin logic is implemented in SQL functions

Current backend:

- scam filtering is synchronous runtime logic in
  `signaling-server/src/khuloh/scam-shield.js`
- user reports exist in `user_reports` under
  `signaling-server/src/chat/messages.js`
- panic contacts and fan-out live in `signaling-server/src/khuloh/panic.js`
- meetup panic is tied to `meetups` status in
  `signaling-server/src/khuloh/meetups.js`

Key drift:

- imported `user_reports` is pair-unique and detached from conversation data;
  current server permits richer report payloads
- imported `emergency_contacts` stores plaintext phone rows; current server
  stores encrypted panic-contact blobs
- imported `safety_checkins` is a separate “are you safe?” reminder system that
  does not currently exist in the Node backend

Decision:

- Keep current report and encrypted panic-contact model as canonical.
- `safety_checkins` is the most interesting missing feature from the imported
  schema and should be treated as a candidate to port into the current backend.
- Do not import the SQL shadow-ban design directly; if needed, implement
  account restriction on top of existing report and scam-shield signals.

### Safe-spots, pair check-ins, reviews, and trust badges

Imported Supabase:

- `safe_spots`, `pair_checkins`, `post_meetup_reviews`, `pending_reviews` in
  `khuloh-mobile/supabase/migrations/010_safespots_reviews.sql`
- `trust_badges` in
  `khuloh-mobile/supabase/migrations/012_economy_enhancements.sql`
- a code-confirmed pair-checkin flow and review-trigger pipeline

Current backend:

- safe-spots CRUD and nearby listing in
  `signaling-server/src/khuloh/safe-spots.js`
- meetups in `signaling-server/src/khuloh/meetups.js`
- partner QR issue and verify in `signaling-server/src/khuloh/partner-qr.js`
- trust score is driven by wallet ledger, not meetup review rows

Key drift:

- current server uses `meetups` with GPS-gated check-in and safe/panic state,
  but does not yet implement pair-review persistence
- imported Supabase distinguishes `pair_checkins` from subsequent reviews and
  trust-badge issuance
- current partner QR flow verifies venue presence and optional meetup check-in,
  but does not yet persist a standalone trust-badge record

Decision:

- Keep current `safe-spots` and `meetups` runtime model.
- Port the post-meetup review concept and optional trust-badge history into the
  current backend if those features are still desired.
- Do not adopt `pair_checkins` as a separate canonical object unless it solves
  a specific problem not covered by current `meetups`.

## Port vs Drop

Port into the current backend:

- mobile client UX and screen flow from `khuloh-mobile/src/`
- zone seed content and product language from Supabase migrations
- post-meetup review flow if review-based trust remains a product goal
- safety-checkin reminder flow if you want a softer alternative to full panic
- trust-badge history if partner verification needs a user-visible audit trail

Do not port directly:

- Supabase auth coupling via `auth.users`
- `whispers` as a second private-message system
- SQL stored procedures as the source of truth for economy and moderation
- plaintext emergency-contact rows when encrypted panic contacts already exist
- a parallel Realtime transport for zones and chat

## Recommended Next Implementation Order

1. Keep the Node backend as the only authoritative runtime and data contract.
2. Make the mobile app talk to that backend instead of assuming Supabase as its
   primary runtime.
3. Create a translation layer document for mobile client API needs:
   auth/session, zones, whispers-to-conversations, wallet sync, safe-spots,
   meetups, panic contacts, QR verify.
4. Port only the missing product features with clear value:
   safety-checkins, post-meetup reviews, trust-badge history.
5. Archive the imported Supabase migrations as reference material once the
   equivalent backend behavior is implemented in the current stack.

## Bottom Line

The imported `khuloh-mobile/supabase/` schema is best used as a feature and
data-model reference, not as a second backend to keep alive. The repo already
has a more advanced runtime in `signaling-server/`; the correct move is to
translate the mobile app and any missing Khuloh concepts onto that backend.