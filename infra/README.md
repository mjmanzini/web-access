# Web-Access infrastructure (Phase 3)

Production rendezvous stack: the **signaling-server** and a **TURN relay**
(coturn), both behind one host, with **Caddy** terminating HTTPS for the
public browser app and signaling hostnames.

## Layout

```
infra/
├── docker-compose.yml     # web-client + signaling + caddy + coturn
├── Caddyfile             # HTTPS reverse proxy for the app + signaling hostnames
├── web-client.Dockerfile # production Next.js image build
├── coturn/
│   └── turnserver.conf    # coturn config (edit realm + secret before deploying)
└── .env.example           # shared secrets & public URLs
```

## Quick start on a VPS

1. Point DNS records for `example.com`, `signal.example.com`, and `turn.example.com` at the VPS.
2. Open TCP **80/443** (HTTPS for signaling), UDP/TCP **3478** (STUN/TURN), UDP **49160–49200** (TURN relay range), and UDP **40000–40200** (mediasoup media).
   If you want TURN over TLS, also open TCP **5349** and mount a cert.
3. Copy `.env.example` to `.env` and fill in:
   - `WEB_HOSTNAME` — e.g. `example.com`
   - `SIGNALING_HOSTNAME` — e.g. `signal.example.com`
   - `TURN_REALM` — your domain, e.g. `turn.example.com`
   - `TURN_SHARED_SECRET` — any long random string
   - `PUBLIC_IP` — the VPS's public IPv4
   - `MEDIASOUP_ANNOUNCED_IP` — usually the same public IP or a public hostname for the VPS
   - `SIGNALING_PUBLIC_URL` — e.g. `https://signal.example.com`
4. `docker compose up -d`
5. Verify:
   ```
   curl https://example.com
   curl https://signal.example.com/healthz
   curl https://signal.example.com/ice   # should list your turn: URL
   ```

For the concrete VPS deployment in this repo, you can also run:

```bash
cd infra
chmod +x verify-vps.sh
./verify-vps.sh https://signal.mjjsmanzini.com turn.mjjsmanzini.com
```

That checks:
- `https://mjjsmanzini.com`
- `https://signal.mjjsmanzini.com/healthz`
- `https://signal.mjjsmanzini.com/ice`
- DNS resolution for the signaling and TURN hosts
- TCP/UDP reachability to `turn.mjjsmanzini.com:3478`

## Ubuntu Deployment

Assuming Docker and the Docker Compose plugin are already installed on the VPS:

```bash
git clone <your-repo-url>
cd web-access/infra
chmod +x deploy-ubuntu.sh verify-vps.sh
./deploy-ubuntu.sh
./verify-vps.sh https://signal.mjjsmanzini.com turn.mjjsmanzini.com
```

## GitHub Actions setup

To provision the `production` GitHub environment and the deploy secrets/vars
used by [.github/workflows/deploy.yml](../.github/workflows/deploy.yml), run:

```powershell
pwsh ./scripts/setup-github-deploy.ps1 \
   -DeployHost "your-vps-host" \
   -DeployUser "ubuntu" \
   -DeployPath "/home/ubuntu/web-access" \
   -DeployKeyPath "$HOME/.ssh/id_ed25519" \
   -WebUrl "https://example.com" \
   -SignalUrl "https://signal.example.com"
```

Prerequisites:
- GitHub CLI (`gh`) installed and authenticated with access to the repo
- PowerShell 7+ (`pwsh`)
- Optional: `ssh-keyscan` available to pre-populate `DEPLOY_KNOWN_HOSTS`

If you omit optional values, the script prompts for what it needs and leaves the
smoke-test variables unset.

## Cloudflare DNS

Use these DNS records for the VPS deployment:

- `mjjsmanzini.com` → `A` → `154.115.158.177`
- `signal.mjjsmanzini.com` → `A` → `154.115.158.177`
- `turn.mjjsmanzini.com` → `A` → `154.115.158.177`

Cloudflare proxy mode:

- `mjjsmanzini.com` → proxied is acceptable for the public web app
- `signal.mjjsmanzini.com` → proxied is acceptable for HTTPS signaling
- `turn.mjjsmanzini.com` → must be `DNS only`

The mediasoup worker must advertise a public IP/hostname and the UDP media
port range must be reachable from the internet. Cloudflare Tunnel can front the
web app and signaling HTTP endpoints, but it does not proxy mediasoup's direct
media ports.

Point the web client at the public signaling URL:

```env
NEXT_PUBLIC_SIGNALING_URL=https://signal.example.com
```

The VPS compose stack injects that value into the production `web-client`
image build automatically.

## How credentials work

The signaling server hands out **time-limited TURN credentials** via `/ice`
using the RFC 5766-TURN-REST scheme (`use-auth-secret` in coturn). Clients
request fresh ones each session, so rotating `TURN_SHARED_SECRET` instantly
invalidates old credentials without restarting anything but the signaling
server.

Set the *same* `TURN_SHARED_SECRET` in both:

- `infra/.env`       → coturn's `static-auth-secret`
- `signaling-server/.env` → the env the signaling server reads
