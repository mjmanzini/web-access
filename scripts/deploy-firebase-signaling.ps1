param(
  [Parameter(Mandatory = $true)]
  [string]$ProjectId,

  [string]$Region = 'us-central1',
  [string]$ServiceName = 'web-access-signaling',
  [string]$ImageName = 'web-access-signaling',
  [string]$ClientUrl,
  [string]$PublicSignalingUrl,
  [string]$StorageBackend = 'firebase',
  [string[]]$SetEnv = @(),
  [string[]]$SetSecrets = @()
)

$ErrorActionPreference = 'Stop'

$repoRoot = Split-Path -Parent $PSScriptRoot
$signalDir = Join-Path $repoRoot 'signaling-server'
$dockerfile = Join-Path $repoRoot 'infra/signaling.Dockerfile'
$imageTag = "gcr.io/$ProjectId/$ImageName"
$cloudBuildConfig = Join-Path $repoRoot '.firebase-signaling.cloudbuild.yaml'

$gcloudCommand = Get-Command gcloud -ErrorAction SilentlyContinue
if ($gcloudCommand) {
  $gcloud = $gcloudCommand.Source
} else {
  $fallbackGcloud = Join-Path $env:LocalAppData 'Google\Cloud SDK\google-cloud-sdk\bin\gcloud.cmd'
  if (-not (Test-Path $fallbackGcloud)) {
    throw 'gcloud was not found on PATH or at the default LocalAppData install location.'
  }
  $gcloud = $fallbackGcloud
}

$envArgs = @(
  "STORAGE_BACKEND=$StorageBackend"
)

if ($ClientUrl) {
  $envArgs += "CLIENT_URL=$ClientUrl"
  $envArgs += "WEBAUTHN_ORIGIN=$ClientUrl"
  try {
    $rpId = ([uri]$ClientUrl).Host
    if ($rpId) {
      $envArgs += "WEBAUTHN_RP_ID=$rpId"
    }
  } catch {
    throw "ClientUrl must be a valid absolute URL: $ClientUrl"
  }
}

if ($PublicSignalingUrl) {
  $envArgs += "PUBLIC_SIGNALING_URL=$PublicSignalingUrl"
  $envArgs += "OAUTH_CALLBACK_BASE=$PublicSignalingUrl"
  if ($ClientUrl) {
    $envArgs += "CORS_ORIGIN=$ClientUrl"
  }
}

if ($SetEnv) {
  $envArgs += $SetEnv
}

Write-Host "[firebase] building signaling image $imageTag" -ForegroundColor Cyan
@"
steps:
  - name: gcr.io/cloud-builders/docker
    dir: signaling-server
    args:
      - build
      - -f
      - ../infra/signaling.Dockerfile
      - -t
      - $imageTag
      - .
images:
  - $imageTag
"@ | Set-Content -Path $cloudBuildConfig -Encoding ascii

try {
  & $gcloud builds submit $repoRoot --config $cloudBuildConfig --project $ProjectId
} finally {
  if (Test-Path $cloudBuildConfig) {
    Remove-Item $cloudBuildConfig -Force
  }
}
if ($LASTEXITCODE -ne 0) {
  throw 'Cloud Build failed.'
}

$deployArgs = @(
  'run', 'deploy', $ServiceName,
  '--project', $ProjectId,
  '--region', $Region,
  '--image', $imageTag,
  '--allow-unauthenticated',
  '--platform', 'managed'
)

if ($envArgs.Count -gt 0) {
  $deployArgs += @('--set-env-vars', ($envArgs -join ','))
}

if ($SetSecrets.Count -gt 0) {
  $deployArgs += @('--set-secrets', ($SetSecrets -join ','))
}

Write-Host "[firebase] deploying Cloud Run service $ServiceName in $Region" -ForegroundColor Cyan
& $gcloud @deployArgs
if ($LASTEXITCODE -ne 0) {
  throw 'Cloud Run deploy failed.'
}