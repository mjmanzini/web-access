# Free Hosting Guide

This repo does not fit a single free static host.

The hard constraint is the backend topology:
- `web-client/` can run on a frontend host
- `signaling-server/` needs a long-running Node process
- `infra/coturn/` needs direct TURN access
- mediasoup needs reachable UDP media ports
- Postgres needs persistent storage

That means the practical low-cost path is:
- frontend on **Cloudflare Pages**
- backend on a **free VPS you control**

## Best free option

### Frontend

Use **Cloudflare Pages** for `web-client/`.

Why:
- generous free tier
- good fit for the Next.js client
- pairs well with Cloudflare DNS and Tunnel
- cheap to keep even if you outgrow the free tier

### Backend

Use a **free VPS** rather than a "free app host".

Best realistic candidates:
- **Oracle Cloud Always Free** VM
- any comparable free ARM/x86 VM with public UDP support

Why not free PaaS hosts:
- TURN and mediasoup need UDP port exposure
- long-running signaling and database services are a poor fit for serverless/free dynos
- tunnel-only ingress does not remove the need to control the machine running coturn, Postgres, and Docker

## Recommended split

### Option A: Cheapest workable production-style setup

- `web-client/` on Cloudflare Pages
- `signaling-server`, Postgres, coturn, and Caddy on a free VPS
- Cloudflare Tunnel only for HTTPS signaling ingress
- TURN host kept `DNS only`

This is the best match for the current repo.

Related docs:
- [docs/DEPLOY-CLOUDFLARE.md](c:/Users/Jastice/Documents/web-access/docs/DEPLOY-CLOUDFLARE.md)
- [docs/DEPLOY-ORACLE-FREE.md](c:/Users/Jastice/Documents/web-access/docs/DEPLOY-ORACLE-FREE.md)
- [infra/README.md](c:/Users/Jastice/Documents/web-access/infra/README.md)

### Option B: Full stack on one VPS

- keep both frontend and backend on the VPS
- use Cloudflare only for DNS / proxy / tunnel

This is simpler operationally, but not as free if your VPS provider has no forever-free tier.

## What will not work well

These are fine for experiments, but not a good target for this repo as-is:
- Vercel for the entire stack
- Render for the entire stack
- Railway for the entire stack
- Netlify for the entire stack

They can host the frontend, but not the full signaling/TURN/media system cleanly.

## Fastest path if you want "free"

1. Deploy the frontend from `web-client/` to Cloudflare Pages.
2. Provision a free VPS.
3. Deploy the backend stack from `infra/` to that VPS.
4. Point the client at the backend public signaling URL.
5. Keep TURN on a direct DNS-only hostname.

## If you only want a demo

For a short-lived demo:
- use Cloudflare Pages for the frontend
- use a cheap or trial VPS for the backend

Trying to avoid the VPS entirely will fight the architecture instead of deploying it.