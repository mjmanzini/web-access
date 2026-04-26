#!/usr/bin/env bash
# bootstrap-vps.sh — first-time provisioning on a fresh Ubuntu 22.04/24.04 box.
#
# Usage (as a sudo-capable user):
#   curl -fsSL <repo>/infra/bootstrap-vps.sh | bash
# or after cloning:
#   sudo bash infra/bootstrap-vps.sh
#
# Idempotent: re-running is safe.

set -euo pipefail

log() { printf '\033[1;36m[bootstrap]\033[0m %s\n' "$*"; }

if [[ $EUID -ne 0 ]]; then
  log "must be run as root (use sudo)" >&2
  exit 1
fi

log "updating apt"
apt-get update -y
apt-get upgrade -y

log "installing base packages"
apt-get install -y --no-install-recommends \
  ca-certificates curl git make jq ufw netcat-openbsd \
  unattended-upgrades

if ! command -v docker >/dev/null 2>&1; then
  log "installing docker engine"
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg \
    | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
  chmod a+r /etc/apt/keyrings/docker.gpg
  . /etc/os-release
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] \
https://download.docker.com/linux/ubuntu $VERSION_CODENAME stable" \
    > /etc/apt/sources.list.d/docker.list
  apt-get update -y
  apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
fi

log "configuring ufw"
ufw allow 22/tcp || true
ufw allow 80/tcp || true
ufw allow 443/tcp || true
ufw allow 3478/tcp || true
ufw allow 3478/udp || true
ufw allow 49160:49200/udp || true
ufw allow 40000:40200/udp || true
yes | ufw enable || true
ufw status

log "enabling unattended-upgrades"
dpkg-reconfigure -fnoninteractive unattended-upgrades || true

DEPLOY_USER="${SUDO_USER:-$USER}"
if [[ "$DEPLOY_USER" != "root" ]]; then
  log "adding $DEPLOY_USER to docker group"
  usermod -aG docker "$DEPLOY_USER" || true
fi

log "done. log out and back in so docker group membership applies."
log "next: cd web-access/infra && cp .env.example .env && \$EDITOR .env && bash deploy-ubuntu.sh"
