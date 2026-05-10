# Deploying Web-Access On Firebase

This repo can be deployed on Firebase, but not as a single product toggle.

Recommended split:

- `web-client/` on Firebase App Hosting
- `signaling-server/` on Google Cloud Run inside the same Firebase project
- Firebase Auth + Cloud Firestore for the migrated backend data path
- TURN remains an external service such as Coturn because Firebase does not provide TURN
- `host-electron/` remains a desktop app and is not deployed to Firebase

## Architecture

Firebase App Hosting is the right target for the Next.js web client.
It is designed for Next.js and deploys through App Hosting backends configured
with `apphosting.yaml`.

The signaling server is a long-running Node process with Socket.IO and WebRTC
coordination logic. That belongs on Cloud Run, not Firebase Hosting.

## Prerequisites

1. Firebase project on the Blaze plan
2. Firebase CLI 13.15.4 or newer
3. Google Cloud SDK with `gcloud` authenticated to the same project
4. Cloud Run API enabled
5. Firestore and Firebase Auth enabled in the Firebase project
6. A TURN server reachable from the public internet

## Web Client On App Hosting

The repo now includes [web-client/apphosting.yaml](c:/Users/Jastice/Documents/web-access/web-client/apphosting.yaml) as the App Hosting config root.

Create the backend from the repo root:

```powershell
firebase apphosting:backends:create --project YOUR_FIREBASE_PROJECT_ID
```

Use these values during setup:

- Root directory: `web-client`
- Live branch: `main`
- Framework: auto-detect Next.js

Set at least this environment variable in App Hosting:

```text
NEXT_PUBLIC_SIGNALING_URL=https://YOUR_SIGNALING_URL
```

If you keep automatic rollouts enabled, pushing to `main` will redeploy the web
client backend.

## Signaling Server On Cloud Run

The repo now includes [scripts/deploy-firebase-signaling.ps1](c:/Users/Jastice/Documents/web-access/scripts/deploy-firebase-signaling.ps1) to build and deploy the signaling server with the existing container image.

Example:

```powershell
.
\scripts\deploy-firebase-signaling.ps1 `
  -ProjectId YOUR_FIREBASE_PROJECT_ID `
  -Region us-central1 `
  -ServiceName web-access-signaling `
  -ClientUrl https://YOUR_APP_HOSTING_DOMAIN `
  -PublicSignalingUrl https://web-access-signaling-xxxxx-uc.a.run.app `
  -SetSecrets @(
    'FIREBASE_CLIENT_EMAIL=fire-client-email:latest',
    'FIREBASE_PRIVATE_KEY=fire-private-key:latest',
    'TURN_SHARED_SECRET=turn-shared-secret:latest',
    'GOOGLE_CLIENT_SECRET=google-client-secret:latest',
    'GITHUB_CLIENT_SECRET=github-client-secret:latest'
  ) `
  -SetEnv @(
    'FIREBASE_PROJECT_ID=YOUR_FIREBASE_PROJECT_ID',
    'WEBAUTHN_RP_NAME=Web-Access'
  )
```

The script:

- builds `signaling-server/` with [infra/signaling.Dockerfile](c:/Users/Jastice/Documents/web-access/infra/signaling.Dockerfile)
- deploys the image to Cloud Run
- sets `STORAGE_BACKEND=firebase`
- optionally wires public URLs, WebAuthn origin/RP ID, and extra env vars/secrets

After deployment, verify the signaling service with the Cloud Run-safe readiness endpoint:

```powershell
curl.exe -i https://YOUR_SIGNALING_URL/readyz
```

## Required Runtime Configuration

At minimum, the signaling service needs:

- `STORAGE_BACKEND=firebase`
- `FIREBASE_PROJECT_ID`
- either `GOOGLE_APPLICATION_CREDENTIALS` or inline service-account secrets
- `CLIENT_URL`
- `PUBLIC_SIGNALING_URL`
- `WEBAUTHN_ORIGIN`
- `WEBAUTHN_RP_ID`
- TURN settings for real-world NAT traversal

Recommended Cloud Run secrets:

- `FIREBASE_CLIENT_EMAIL`
- `FIREBASE_PRIVATE_KEY`
- `TURN_SHARED_SECRET`
- `SIGNALING_SHARED_SECRET`
- OAuth provider client secrets
- WebAuthn/OAuth state secrets

## Important Limits

- Firebase does not host the Electron app. Distribute `host-electron/` separately.
- Firebase does not replace TURN. Keep Coturn or another TURN provider.
- Use `/readyz` for Cloud Run readiness checks. Some Google frontends reserve or intercept `/healthz`, while `/readyz` reaches the Express app directly.

## Rollout Order

1. Finish the remaining Firebase adapter methods
2. Enable Firestore/Auth in the Firebase project
3. Deploy signaling to Cloud Run with `STORAGE_BACKEND=firebase`
4. Create the App Hosting backend for `web-client`
5. Point `NEXT_PUBLIC_SIGNALING_URL` at the Cloud Run signaling URL
6. Add custom domains after the first healthy rollout