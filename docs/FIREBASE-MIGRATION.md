# Firebase Migration Plan

This repo can move from Postgres to Firebase, but it is a backend redesign, not
a config change.

The current signaling server depends on SQL semantics in multiple modules:

- `signaling-server/src/users.js` for user directory and token login
- `signaling-server/src/auth/webauthn.js` for passkeys, challenges, and session tokens
- `signaling-server/src/auth/oauth.js` for social account linking
- `signaling-server/src/chat/messages.js` for conversations, membership, messages, and receipts
- `signaling-server/src/chat/presence.js` for last-seen persistence
- `signaling-server/src/remote/sessions.js` for remote ID allocation, PIN validation, and single-use session creation
- `signaling-server/src/call-signaling.js` and `signaling-server/src/db.js` for call/event logging

## Recommendation

If the goal is a Firebase-based backend, use:

- Firebase Auth for user identity
- Cloud Firestore for persistent app data
- Keep the Node signaling server for Socket.IO, `/pair/*`, `/ice`, and WebRTC relay coordination

Do not try to replace the signaling server with client-only Firebase logic.
The WebRTC/session flows still need trusted server logic.

## Proposed Target Architecture

### Keep in Node server

- `/healthz`
- `/ice`
- `/pair/new`
- `/pair/resolve/:code`
- Socket.IO signaling and pairing registry
- Remote-desktop validation logic
- OAuth callback handlers if you keep server-side provider exchange

### Move from Postgres to Firebase

- users
- session tokens or Firebase ID token verification
- passkey credential metadata and challenges
- OAuth identity links
- conversations and conversation membership
- chat messages and receipts
- remote announcements and remote session logs
- audit/event log entries

## Data Model Mapping

### Firestore collections

- `users/{userId}`
  - `username`
  - `displayName`
  - `email`
  - `remoteId`
  - `createdAt`
  - `lastSeenAt`

- `usernames/{username}`
  - `userId`

- `oauthIdentities/{provider}:{providerUserId}`
  - `provider`
  - `providerUserId`
  - `userId`
  - `email`
  - `createdAt`
  - `lastLoginAt`

- `authChallenges/{challengeId}`
  - `userId`
  - `purpose`
  - `challenge`
  - `expiresAt`
  - `createdAt`

- `authCredentials/{credentialId}`
  - `userId`
  - `type`
  - `webauthnCredId`
  - `publicKey`
  - `counter`
  - `transports`
  - `deviceLabel`
  - `tokenHash`
  - `expiresAt`
  - `createdAt`
  - `lastUsedAt`

- `conversations/{conversationId}`
  - `isGroup`
  - `title`
  - `createdBy`
  - `createdAt`
  - `lastMsgAt`

- `conversations/{conversationId}/members/{userId}`
  - `joinedAt`
  - `lastReadAt`
  - `role`

- `conversations/{conversationId}/messages/{messageId}`
  - `senderId`
  - `body`
  - `clientId`
  - `createdAt`
  - `editedAt`
  - `deletedAt`

- `conversations/{conversationId}/receipts/{messageId}_{userId}`
  - `messageId`
  - `userId`
  - `deliveredAt`
  - `readAt`

- `remoteAnnouncements/{hostUserId}`
  - `pinHash`
  - `pinSalt`
  - `pinAttempts`
  - `expiresAt`
  - `sessionId`
  - `updatedAt`

- `remoteSessionLogs/{logId}`
  - `sessionId`
  - `hostUserId`
  - `viewerUserId`
  - `startedAt`
  - `endedAt`
  - `endReason`

- `events/{eventId}`
  - `roomId`
  - `userId`
  - `type`
  - `payload`
  - `createdAt`

## File-By-File Migration

### `signaling-server/src/db.js`

Replace the Postgres pool and schema bootstrap with a storage abstraction.

Suggested shape:

- `storage/index.js`
- `storage/postgres.js`
- `storage/firebase.js`

The rest of the server should stop importing `pool` directly.

### `signaling-server/src/users.js`

Current dependencies:

- username uniqueness via SQL constraint
- token lookup via `auth_credentials`
- ordered public user list

Firebase rewrite:

- reserve usernames through `usernames/{username}` in a Firestore transaction
- load user profile from `users/{userId}`
- if keeping opaque session tokens, look up `authCredentials` by token hash
- if moving to Firebase Auth, replace token lookup with Firebase Admin ID token verification

### `signaling-server/src/auth/webauthn.js`

Current dependencies:

- stores challenges in `webauthn_challenges`
- stores passkeys and session tokens in `auth_credentials`
- uses SQL ordering/expiry checks

Firebase rewrite:

- write challenges as Firestore docs with TTL fields
- store passkey docs keyed by credential ID
- update counters atomically in Firestore transactions
- either:
  - keep server-issued opaque session tokens in Firestore, or
  - replace them with Firebase Auth custom tokens / session cookies

Preferred end state: use Firebase Auth for sessions and keep Firestore only for
passkey metadata and challenges.

### `signaling-server/src/auth/oauth.js`

Current dependencies:

- joins users with `oauth_identities`
- links by email
- creates local users with unique usernames

Firebase rewrite:

- store provider identity mapping in `oauthIdentities`
- resolve by exact provider key first
- fall back to `users` lookup by normalized email
- reserve username with the same transaction that creates the user doc

If you move fully to Firebase Auth, this module should eventually issue Firebase
custom tokens or rely on provider sign-in directly.

### `signaling-server/src/chat/messages.js`

Current dependencies:

- joins to find or create 1:1 conversations
- transaction for conversation + membership creation
- ordered message history queries
- per-user receipts

Firebase rewrite:

- keep each conversation as a document
- keep membership as a subcollection
- query conversation membership by user via collection group query or mirrored index documents
- write messages and update `lastMsgAt` in a transaction/batched write
- write receipts as separate docs keyed by message+user

Main redesign note: Firestore does not do SQL joins. You will likely need
duplicated summary fields for conversation lists.

### `signaling-server/src/chat/presence.js`

Current dependencies:

- additive schema changes on `users`
- `last_seen_at` updates

Firebase rewrite:

- move `lastSeenAt`, `email`, and `phone` into the user document
- keep in-memory online presence in the Node process unless you need multi-node scale
- optionally mirror live presence to Firestore for cross-process visibility

### `signaling-server/src/remote/sessions.js`

This is the most sensitive migration slice.

Current dependencies:

- unique `remote_id`
- single active announcement per host
- transaction + lock (`FOR UPDATE`) around PIN verification
- max-attempt enforcement
- single-use session consumption

Firebase rewrite:

- keep `remoteId` on the user document
- store active PIN state in `remoteAnnouncements/{hostUserId}`
- use a Firestore transaction to:
  - load the active announcement
  - reject expired or locked-out entries
  - increment attempt count on bad PIN
  - delete the announcement on success
  - write the remote session log

Do not migrate this endpoint until the transaction design is explicit and tested.

### `signaling-server/src/call-signaling.js`

Current dependencies:

- append-only call logs
- participant join/leave rows
- chat message persistence fallback

Firebase rewrite:

- log call rooms under `calls/{roomId}`
- log participants in `calls/{roomId}/participants/{participantId}`
- append events to `events` or `calls/{roomId}/events`

This slice is comparatively straightforward because failures are already handled
best-effort in several call paths.

## Migration Sequence

### Phase 1: Introduce storage interface

Goal: stop importing `pool` outside one backend adapter.

Deliverables:

- `signaling-server/src/storage/`
- repository-style methods for users, auth, chat, remote, and events
- Postgres implementation only at first

### Phase 2: Move auth boundary first

Pick one:

- keep existing local auth and store credentials in Firestore
- or adopt Firebase Auth as the primary session authority

If the end goal is truly Firebase, choose Firebase Auth early. Otherwise you end
up migrating sessions twice.

### Phase 3: Migrate user directory and remote IDs

Migrate:

- users
- username reservation
- remote ID allocation
- last seen fields

This unlocks remote-desktop flows without immediately touching chat history.

### Phase 4: Migrate remote PIN flow

Implement and test Firestore transactions for:

- announce
- status
- connect
- cancel

This is the first must-not-race migration checkpoint.

### Phase 5: Migrate chat conversations and receipts

Add Firestore-backed:

- conversation list
- 1:1 conversation creation
- message history
- message send
- delivered/read receipts

Expect frontend payload shaping changes because Firestore prefers denormalized
read models.

### Phase 6: Migrate WebAuthn storage

Move:

- challenges
- credential metadata
- counters
- session issue path if not already on Firebase Auth

### Phase 7: Remove Postgres bootstrap

Only after all modules stop relying on `pool`:

- delete schema bootstrap in `db.js`
- remove Postgres container/docs from the default local path
- keep an export script for historical data if needed

## Required Firebase Services

- Firebase project
- Firestore in native mode
- Firebase Admin SDK on the signaling server
- Firebase Auth if chosen for sessions

## Operational Tradeoffs

### Pros

- managed backend instead of self-hosted Postgres
- simpler local setup once the migration is complete
- Firebase Auth can simplify session handling

### Cons

- significant rewrite cost
- more denormalized data and duplicated indexes
- transaction limits and query-shape constraints in Firestore
- WebAuthn and OAuth flows still require trusted server logic

## Minimum Viable Cutover

If the goal is to get off local Postgres quickly, the smallest credible cutover is:

1. Keep the Node signaling server.
2. Add a storage abstraction.
3. Move `users.js` and `remote/sessions.js` first.
4. Keep chat and passkeys on Postgres temporarily.
5. Then migrate chat, then WebAuthn/session storage.

That hybrid path is less risky than a one-shot rewrite.

## Recommended Next Implementation Task

The best first code change is not “replace db with Firebase.”

It is:

1. create a storage interface
2. move `users.js` behind it
3. move `remote/sessions.js` behind it
4. keep the current Postgres implementation as the baseline

That gives the repo a safe seam for a Firebase backend without breaking current behavior.