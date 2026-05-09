# start-tunnel.ps1
#
# Starts a Cloudflare quick-tunnel and prints the public HTTPS URL.
# Requires: the signaling server running on the host.
#
# No Cloudflare account, no signup. The URL is ephemeral (changes every run).

param([string]$ServiceUrl = 'http://host.docker.internal:4000')

Write-Host "[tunnel] starting Cloudflare quick-tunnel -> $ServiceUrl" -ForegroundColor Cyan

docker run --rm `
  --add-host=host.docker.internal:host-gateway `
  cloudflare/cloudflared:latest tunnel --no-autoupdate --url $ServiceUrl
