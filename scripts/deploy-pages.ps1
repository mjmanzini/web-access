param(
  [Parameter(Mandatory = $true)]
  [string]$SignalingUrl,

  [string]$ProjectName = 'web-access',
  [string]$Branch = 'main'
)

$ErrorActionPreference = 'Stop'

if (-not $env:CLOUDFLARE_API_TOKEN) {
  throw 'CLOUDFLARE_API_TOKEN is required.'
}

if (-not $env:CLOUDFLARE_ACCOUNT_ID) {
  throw 'CLOUDFLARE_ACCOUNT_ID is required.'
}

$repoRoot = Split-Path -Parent $PSScriptRoot
$clientDir = Join-Path $repoRoot 'web-client'

Push-Location $clientDir
try {
  $env:NEXT_PUBLIC_SIGNALING_URL = $SignalingUrl
  $env:WEB_CLIENT_OUTPUT_MODE = 'export'

  Write-Host "[pages] building static export for $SignalingUrl" -ForegroundColor Cyan
  npm run build:pages
  if ($LASTEXITCODE -ne 0) {
    throw 'Next.js Pages build failed.'
  }

  Write-Host "[pages] deploying project '$ProjectName' on branch '$Branch'" -ForegroundColor Cyan
  npm exec --yes --package wrangler@latest -- wrangler pages deploy out --project-name $ProjectName --branch $Branch --commit-dirty=true
  if ($LASTEXITCODE -ne 0) {
    throw 'Cloudflare Pages deploy failed.'
  }
}
finally {
  Pop-Location
}