#!/usr/bin/env bash
set -euo pipefail

SIGNAL_URL="${1:-https://signal.mjjsmanzini.com}"
TURN_HOST="${2:-turn.mjjsmanzini.com}"
TURN_PORT="${3:-3478}"
WEB_URL="${4:-https://mjjsmanzini.com}"

echo "[verify] web app: ${WEB_URL}"
curl -fsS -I "${WEB_URL}"
echo
echo

echo "[verify] signaling health: ${SIGNAL_URL}/healthz"
curl -fsS "${SIGNAL_URL}/healthz"
echo
echo

echo "[verify] signaling ice: ${SIGNAL_URL}/ice"
curl -fsS "${SIGNAL_URL}/ice"
echo
echo

echo "[verify] DNS resolution"
getent hosts "$(printf '%s' "$SIGNAL_URL" | sed -E 's#^https?://([^/]+).*$#\1#')" || true
getent hosts "$TURN_HOST" || true
echo

echo "[verify] TURN TCP reachability: ${TURN_HOST}:${TURN_PORT}"
nc -zv "$TURN_HOST" "$TURN_PORT"
echo

echo "[verify] TURN UDP reachability: ${TURN_HOST}:${TURN_PORT}"
nc -zvu -w 3 "$TURN_HOST" "$TURN_PORT" || true
echo

echo "[verify] done"