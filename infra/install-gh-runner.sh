#!/usr/bin/env bash
set -euo pipefail

log() { printf '\033[1;36m[runner]\033[0m %s\n' "$*"; }

usage() {
  cat <<'EOF'
Usage:
  GITHUB_RUNNER_TOKEN=<token> bash infra/install-gh-runner.sh [options]

Options:
  --repo-url <url>       GitHub repository URL.
                         Default: https://github.com/mjmanzini/web-access
  --runner-dir <path>    Install directory for the runner.
                         Default: /home/<user>/actions-runner
  --runner-user <user>   Linux user that owns and runs the service.
                         Default: current user, or SUDO_USER when run with sudo
  --labels <csv>         Extra runner labels.
                         Default: web-access-vps
  --name <name>          Runner name shown in GitHub.
                         Default: hostname
  --version <version>    actions/runner version to install.
                         Default: latest from GitHub API

Environment:
  GITHUB_RUNNER_TOKEN    Required. Short-lived registration token from GitHub.

Examples:
  gh api -X POST repos/mjmanzini/web-access/actions/runners/registration-token --jq .token

  GITHUB_RUNNER_TOKEN=<token> sudo bash infra/install-gh-runner.sh \
    --runner-user ubuntu \
    --runner-dir /home/ubuntu/actions-runner \
    --labels web-access-vps
EOF
}

REPO_URL="https://github.com/mjmanzini/web-access"
RUNNER_USER="${SUDO_USER:-${USER}}"
RUNNER_DIR=""
RUNNER_LABELS="web-access-vps"
RUNNER_NAME="$(hostname)"
RUNNER_VERSION=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --repo-url)
      REPO_URL="$2"
      shift 2
      ;;
    --runner-dir)
      RUNNER_DIR="$2"
      shift 2
      ;;
    --runner-user)
      RUNNER_USER="$2"
      shift 2
      ;;
    --labels)
      RUNNER_LABELS="$2"
      shift 2
      ;;
    --name)
      RUNNER_NAME="$2"
      shift 2
      ;;
    --version)
      RUNNER_VERSION="$2"
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown option: $1" >&2
      usage >&2
      exit 1
      ;;
  esac
done

if [[ -z "${GITHUB_RUNNER_TOKEN:-}" ]]; then
  echo "GITHUB_RUNNER_TOKEN is required." >&2
  usage >&2
  exit 1
fi

if ! id "$RUNNER_USER" >/dev/null 2>&1; then
  echo "Runner user '$RUNNER_USER' does not exist." >&2
  exit 1
fi

if [[ -z "$RUNNER_DIR" ]]; then
  RUNNER_DIR="/home/${RUNNER_USER}/actions-runner"
fi

if [[ $EUID -ne 0 ]]; then
  echo "Run this script with sudo or as root so it can install the systemd service." >&2
  exit 1
fi

apt-get update -y
apt-get install -y --no-install-recommends curl jq tar ca-certificates

if [[ -z "$RUNNER_VERSION" ]]; then
  RUNNER_VERSION="$(curl -fsSL https://api.github.com/repos/actions/runner/releases/latest | jq -r .tag_name | sed 's/^v//')"
fi

RUNNER_ARCHIVE="actions-runner-linux-x64-${RUNNER_VERSION}.tar.gz"
RUNNER_URL="https://github.com/actions/runner/releases/download/v${RUNNER_VERSION}/${RUNNER_ARCHIVE}"

log "installing runner ${RUNNER_VERSION} for ${REPO_URL}"
install -d -m 0755 -o "$RUNNER_USER" -g "$RUNNER_USER" "$RUNNER_DIR"

if [[ ! -f "$RUNNER_DIR/.runner" ]]; then
  log "downloading runner archive"
  sudo -u "$RUNNER_USER" bash -lc "cd '$RUNNER_DIR' && curl -fsSLo '$RUNNER_ARCHIVE' '$RUNNER_URL'"
  sudo -u "$RUNNER_USER" bash -lc "cd '$RUNNER_DIR' && tar xzf '$RUNNER_ARCHIVE' && rm -f '$RUNNER_ARCHIVE'"
else
  log "runner already configured at $RUNNER_DIR"
fi

if [[ ! -f "$RUNNER_DIR/.runner" ]]; then
  log "configuring runner"
  sudo -u "$RUNNER_USER" bash -lc "cd '$RUNNER_DIR' && ./config.sh --url '$REPO_URL' --token '$GITHUB_RUNNER_TOKEN' --labels '$RUNNER_LABELS' --name '$RUNNER_NAME' --unattended --replace"
fi

log "installing and starting systemd service"
cd "$RUNNER_DIR"
./svc.sh install "$RUNNER_USER"
./svc.sh start

log "runner service status"
./svc.sh status || true
log "done"