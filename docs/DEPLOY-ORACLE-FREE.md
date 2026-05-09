# Oracle Cloud Free VM Deployment

This is the cheapest full-stack path for this repo when you do not control an
existing VPS.

Recommended split:
- `web-client/` on Cloudflare Pages
- backend stack on an **Oracle Cloud Always Free** VM

Backend stack means:
- `signaling-server/`
- Postgres
- coturn
- Caddy
- mediasoup UDP media ports

## Why Oracle Free fits better than free app hosts

This repo needs:
- long-running Docker services
- direct UDP for TURN and mediasoup
- persistent Postgres storage
- full control of firewall and system services

That makes a VM the right primitive.

## 1. Create the VM

In Oracle Cloud:
- create an Always Free compute instance
- Ubuntu 22.04 or 24.04 is fine
- assign a public IPv4 address
- use a shape that stays in the Always Free pool

Use an SSH key you control when creating the instance.

## 2. Open the required ports

Oracle requires both:
- VCN security list / network security group rules
- instance firewall rules

Open these inbound ports in Oracle networking:
- TCP `22`
- TCP `80`
- TCP `443`
- TCP `3478`
- UDP `3478`
- UDP `49160-49200`
- UDP `40000-40200`
- optional TCP `5349` for TURN over TLS

Then on the VM itself, run the repo bootstrap later to open matching `ufw` rules.

## 3. Point DNS

Point these records at the VM public IP:
- `app.your-domain.com` or your root host for the web app
- `signal.your-domain.com` for signaling
- `turn.your-domain.com` for TURN

Cloudflare mode:
- web host: proxied is fine
- signaling host: proxied is fine if you use HTTPS/WebSocket via Caddy or Tunnel
- TURN host: must be `DNS only`

## 4. Bootstrap the VM

SSH into the Oracle VM and clone the repo:

```bash
git clone https://github.com/mjmanzini/web-access.git
cd web-access
sudo bash infra/bootstrap-vps.sh
exit
```

Reconnect so docker-group membership applies.

## 5. Configure the stack

On the VM:

```bash
cd /home/ubuntu/web-access/infra
cp .env.example .env
```

Edit `.env` and set at minimum:

```env
PUBLIC_IP=<oracle-vm-public-ip>
MEDIASOUP_ANNOUNCED_IP=<oracle-vm-public-ip>
WEB_HOSTNAME=app.your-domain.com
SIGNALING_HOSTNAME=signal.your-domain.com
TURN_REALM=turn.your-domain.com
SIGNALING_PUBLIC_URL=https://signal.your-domain.com
POSTGRES_PASSWORD=<long-random-string>
TURN_SHARED_SECRET=<long-random-string>
```

If you want the backend to serve the frontend too, keep using the bundled
`web-client` image from `infra/docker-compose.yml`.

If you want the cheapest split, host the frontend on Cloudflare Pages and point
`NEXT_PUBLIC_SIGNALING_URL` at your signaling host.

## 6. Start services

```bash
cd /home/ubuntu/web-access/infra
chmod +x deploy-ubuntu.sh verify-vps.sh
./deploy-ubuntu.sh
./verify-vps.sh https://signal.your-domain.com turn.your-domain.com
```

## 7. Frontend hosting choice

### Option A: Frontend on Cloudflare Pages

Use this if you want the cheapest recurring setup.

- deploy `web-client/` to Cloudflare Pages
- set `NEXT_PUBLIC_SIGNALING_URL=https://signal.your-domain.com`
- keep backend services on the Oracle VM

See [docs/DEPLOY-CLOUDFLARE.md](c:/Users/Jastice/Documents/web-access/docs/DEPLOY-CLOUDFLARE.md).

### Option B: Frontend on the same Oracle VM

Use the existing compose stack as-is.

- Caddy serves the app and signaling
- Oracle VM hosts everything except Cloudflare edge services

This is simpler, but not as globally cache-friendly as Pages.

## 8. GitHub Actions deploys

If you control the Oracle VM, install the self-hosted runner there:

```bash
cd /home/ubuntu/web-access
sudo GITHUB_RUNNER_TOKEN=<token> bash infra/install-gh-runner.sh --runner-user ubuntu
```

That is the repo’s current Cloudflare-compatible deploy model.

## 9. Known limits

- Oracle free capacity is not always available in every region
- low-resource shapes may struggle under heavy call/media usage
- TURN and mediasoup still require direct UDP reachability
- Cloudflare Tunnel helps HTTPS ingress, but does not replace TURN/media ports

## 10. Bottom line

If you want the nearest thing to a free full deployment for this repo:

1. Oracle Cloud Always Free VM for backend
2. Cloudflare Pages for frontend
3. Cloudflare DNS/Tunnel for HTTPS ingress
4. TURN host left DNS-only