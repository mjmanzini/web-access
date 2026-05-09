# VPS Deployment Checklist

Use this checklist for the `mjjsmanzini.com` production rollout.

## 0. First-time provisioning (fresh box)

```bash
ssh ubuntu@<vps-ip>
git clone <repo> web-access
cd web-access
sudo bash infra/bootstrap-vps.sh   # docker, ufw, unattended-upgrades
exit && ssh ubuntu@<vps-ip>        # reconnect so docker-group applies
```

## 1. Cloudflare DNS

- Create `A` record: `mjjsmanzini.com` -> `154.115.158.177`
- Create `A` record: `signal.mjjsmanzini.com` -> `154.115.158.177`
- Create `A` record: `turn.mjjsmanzini.com` -> `154.115.158.177`
- Set `mjjsmanzini.com` to proxied if you want Cloudflare in front of the public web app
- Set `signal.mjjsmanzini.com` to proxied if you want Cloudflare in front of HTTPS signaling
- Set `turn.mjjsmanzini.com` to `DNS only`

## 2. VPS Firewall

Run on Ubuntu:

```bash
sudo ufw allow 22/tcp
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw allow 3478/tcp
sudo ufw allow 3478/udp
sudo ufw allow 49160:49200/udp
sudo ufw allow 40000:40200/udp
sudo ufw enable
sudo ufw status
```

## 3. Server Files

- Copy the repository to the VPS
- Go to `web-access/infra`
- Review `.env`
- Confirm these values are correct:

```env
PUBLIC_IP=154.115.158.177
MEDIASOUP_ANNOUNCED_IP=154.115.158.177
WEB_HOSTNAME=mjjsmanzini.com
SIGNALING_HOSTNAME=signal.mjjsmanzini.com
TURN_REALM=turn.mjjsmanzini.com
SIGNALING_PUBLIC_URL=https://signal.mjjsmanzini.com
POSTGRES_PASSWORD=<openssl rand -hex 32>
```

- Rotate `TURN_SHARED_SECRET` *and* `POSTGRES_PASSWORD` before first public deploy

## 4. Start Infra

Run on the VPS:

```bash
cd web-access/infra
chmod +x deploy-ubuntu.sh verify-vps.sh
./deploy-ubuntu.sh
```

## 5. Verify Infra

Run:

```bash
cd web-access/infra
./verify-vps.sh https://signal.mjjsmanzini.com turn.mjjsmanzini.com
```

Expected results:

- `https://signal.mjjsmanzini.com/healthz` returns JSON
- `https://signal.mjjsmanzini.com/ice` returns `iceServers`
- `https://mjjsmanzini.com` returns HTTP 200
- `turn.mjjsmanzini.com:3478` is reachable

## 6. Web Client Deploy

- The VPS infra stack now includes the web client directly
- It is served by Caddy at `https://mjjsmanzini.com`
- It is built with:

```env
NEXT_PUBLIC_SIGNALING_URL=https://signal.mjjsmanzini.com
```

- This value is already present in `web-client/.env.production`

## 7. Electron Host Config

Create `host-electron/.env` with:

```env
SIGNALING_URL=https://signal.mjjsmanzini.com
CLIENT_URL=https://mjjsmanzini.com
SIGNALING_SHARED_SECRET=
```

Then run:

```bash
cd host-electron
npm install
npm start
```

## 8. Public Test

- Open `https://mjjsmanzini.com`
- Start the Electron host
- Confirm the pairing code appears
- Join from the browser
- Check that `/healthz` and `/ice` work if pairing fails

## 9. If Call Media Fails

Check these first:

- `MEDIASOUP_ANNOUNCED_IP` is the VPS public IP
- UDP `40000-40200` is open
- UDP `49160-49200` is open
- `turn.mjjsmanzini.com` is `DNS only`
- `signal.mjjsmanzini.com` resolves to the VPS

## 10. Continuous Deployment (GitHub Actions)

The repo ships with two workflows under `.github/workflows/`:

- `ci.yml` — runs on every PR and push: syntax-checks the signaling
  server, builds the Next.js client, and verifies both Docker images build.
- `deploy.yml` — runs on push to `main` on a self-hosted runner installed on
  the VPS, `git fetch`es the checked-out repo, rebuilds `signaling` +
  `web-client` only (postgres / caddy / coturn keep running), then smoke-tests
  the public endpoints.

Required GitHub environment secret (Settings → Secrets and variables → Actions → Environments → `production`):

| Secret | Example |
|---|---|
| `DEPLOY_PATH` | `/home/ubuntu/web-access` |

Optional repository variables (used by the smoke test):

| Variable | Example |
|---|---|
| `WEB_URL` | `https://mjjsmanzini.com` |
| `SIGNAL_URL` | `https://signal.mjjsmanzini.com` |

Required self-hosted runner setup on the VPS:

```bash
gh api -X POST repos/mjmanzini/web-access/actions/runners/registration-token --jq .token
# copy the token output, then run on the VPS:
sudo GITHUB_RUNNER_TOKEN=<token> bash infra/install-gh-runner.sh --runner-user ubuntu
```

The workflow expects the runner to advertise the labels `self-hosted`,
`linux`, `x64`, and `web-access-vps`.

The repository must already be checked out on the VPS at `DEPLOY_PATH`, and
that checkout must contain `infra/.env`.

Manual redeploy from a workstation:

```bash
make deploy-pull   # on the VPS
# or, locally:
gh workflow run deploy.yml
```