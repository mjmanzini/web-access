#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

cd "$ROOT_DIR"

if ! command -v docker >/dev/null 2>&1; then
  echo "[deploy] docker is not installed" >&2
  exit 1
fi

if ! docker compose version >/dev/null 2>&1; then
  echo "[deploy] docker compose plugin is not available" >&2
  exit 1
fi

if [[ ! -f .env ]]; then
  echo "[deploy] missing $ROOT_DIR/.env" >&2
  echo "[deploy] copy .env.example to .env and fill in the real values first" >&2
  exit 1
fi

echo "[deploy] rendering compose config"
docker compose --env-file .env config >/dev/null

echo "[deploy] building and starting services"
docker compose --env-file .env up -d --build

echo
echo "[deploy] running containers"
docker compose --env-file .env ps
echo

echo "[deploy] web app"
curl -fsS -I https://mjjsmanzini.com
echo

echo "[deploy] signaling health"
curl -fsS https://signal.mjjsmanzini.com/healthz
echo