# Development Deployment

This repository already has a production VPS deploy on push to `main` via
GitHub Actions. Development deployment should stay separate so test rollouts do
not mutate the live environment.

## What Exists Now

- Manual GitHub workflow: `.github/workflows/deploy-dev.yml`
- Wrapper script: `scripts/deploy-dev.ps1`
- Existing helpers reused under the hood:
  - `scripts/deploy-firebase-signaling.ps1`
  - `scripts/deploy-pages.ps1`

The dev workflow deploys the signaling server to a separate Cloud Run service
and, when Cloudflare credentials are present, deploys the static web client to
the configured Pages branch.

## GitHub Environment

Create a GitHub environment named `development` and configure these secrets:

- `GCP_PROJECT_ID`
- `GCP_WORKLOAD_IDENTITY_PROVIDER`
- `GCP_SERVICE_ACCOUNT`
- `CLOUDFLARE_API_TOKEN` (optional if you only want signaling)
- `CLOUDFLARE_ACCOUNT_ID` (optional if you only want signaling)

Configure these environment variables on the same `development` environment as
needed:

- `GCP_REGION` default: `us-central1`
- `DEV_SIGNALING_SERVICE` default: `web-access-signaling-dev`
- `DEV_SIGNALING_IMAGE` default: `web-access-signaling-dev`
- `DEV_CLIENT_URL` default: `https://development.example.com`
- `DEV_PAGES_PROJECT` default: `web-access`
- `DEV_PAGES_BRANCH` default: `development`
- `DEV_SET_ENV` optional comma-separated extra Cloud Run env values
- `DEV_SET_SECRETS` optional comma-separated Cloud Run Secret Manager mappings

Example `DEV_SET_SECRETS` value:

- `FIREBASE_CLIENT_EMAIL=fire-client-email:latest,FIREBASE_PRIVATE_KEY=fire-private-key:latest,KHULOH_QR_SIGNING_KEY=khuloh-qr-signing-key:latest,KHULOH_KMS_KEY=khuloh-kms-key:latest`

## How It Works

1. `deploy-dev.yml` authenticates to Google Cloud through workload identity.
2. It calls `scripts/deploy-dev.ps1`.
3. The wrapper deploys `signaling-server/` to Cloud Run using the existing
   Firebase-oriented helper.
4. The wrapper resolves the new Cloud Run URL and passes it to the existing
   Cloudflare Pages deploy helper.
5. If Cloudflare credentials are not configured, the workflow still deploys the
   signaling service and skips the Pages step.

## Local Manual Use

You can run the same path from a PowerShell shell:

```powershell
.\scripts\deploy-dev.ps1 `
  -ProjectId YOUR_GCP_PROJECT `
  -ClientUrl https://development.example.com
```

If `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` are set in the shell,
the script also publishes the web client to the configured Pages branch.

## Notes

- This does not change the production workflow in `.github/workflows/deploy.yml`.
- The development deploy is manual by design.
- The current root `.firebaserc` still points at the existing Firebase project;
  the dev path relies on explicit GitHub environment secrets instead of repo-wide
  defaults.
