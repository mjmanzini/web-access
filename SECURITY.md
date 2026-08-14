# Security

## Secrets

No secrets are committed to this repository. All credentials come from the
environment at runtime:

- `POSTGRES_PASSWORD`, `ADGUARD_PASSWORD`, `JWT_SECRET`, `AUTH_ADMIN_PASSWORD`,
  `OPENWRT_PASSWORD` — live in `.env` on the host only (gitignored). `.env` is
  never committed; [`.env.example`](.env.example) ships with blank values.
- `TUNNEL_TOKEN` — from the Cloudflare Zero Trust dashboard, kept in the host
  `.env`.
- `docker-compose.yml` requires the sensitive ones via `${VAR:?…}`, so the stack
  fails fast rather than starting with a weak default.

Keys, certificates, and credential files (`*.pem`, `*.key`, `*.crt`, `certs/`,
`service-account*.json`, …) are gitignored so they can't be added by accident.

## Historical note

Earlier history (on `main`, before this app existed) contained an imported
mobile client with a Supabase **publishable** (public, RLS-protected) anon key
and self-signed localhost dev certificates. The current tree contains none of
these. The publishable key was neutralized by pausing/deleting the associated
Supabase project; the dev certs were self-signed for localhost and carry no
value. If you want that key scrubbed from git history as well, that requires a
history rewrite + force-push of `main` (coordinate before doing so).

## Reporting

This is a self-hosted home tool. If you find a vulnerability, open a private
report to the repository owner rather than a public issue.
