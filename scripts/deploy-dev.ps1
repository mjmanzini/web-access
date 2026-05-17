param(
  [Parameter(Mandatory = $true)]
  [string]$ProjectId,

  [string]$Region = 'us-central1',
  [string]$SignalServiceName = 'web-access-signaling-dev',
  [string]$SignalImageName = 'web-access-signaling-dev',
  [string]$PagesProjectName = 'web-access',
  [string]$PagesBranch = 'development',
  [string]$ClientUrl,
  [string]$StorageBackend = 'firebase',
  [string[]]$SetEnv = @(),
  [string[]]$SetSecrets = @()
)

$ErrorActionPreference = 'Stop'

$repoRoot = Split-Path -Parent $PSScriptRoot
$deploySignalScript = Join-Path $PSScriptRoot 'deploy-firebase-signaling.ps1'
$deployPagesScript = Join-Path $PSScriptRoot 'deploy-pages.ps1'

if (-not (Test-Path $deploySignalScript)) {
  throw "Missing signaling deploy script: $deploySignalScript"
}

function Resolve-GcloudPath {
  $gcloudCommand = Get-Command gcloud -ErrorAction SilentlyContinue
  if ($gcloudCommand) {
    return $gcloudCommand.Source
  }

  $fallbackGcloud = Join-Path $env:LocalAppData 'Google\Cloud SDK\google-cloud-sdk\bin\gcloud.cmd'
  if (Test-Path $fallbackGcloud) {
    return $fallbackGcloud
  }

  throw 'gcloud was not found on PATH or at the default LocalAppData install location.'
}

$signalClientUrl = $ClientUrl
if (-not $signalClientUrl) {
  $signalClientUrl = 'https://development.example.com'
}

Write-Host "[dev-deploy] deploying signaling service '$SignalServiceName'" -ForegroundColor Cyan
& $deploySignalScript `
  -ProjectId $ProjectId `
  -Region $Region `
  -ServiceName $SignalServiceName `
  -ImageName $SignalImageName `
  -ClientUrl $signalClientUrl `
  -StorageBackend $StorageBackend `
  -SetEnv $SetEnv `
  -SetSecrets $SetSecrets
if ($LASTEXITCODE -ne 0) {
  throw 'Development signaling deploy failed.'
}

$gcloud = Resolve-GcloudPath
$serviceUrl = & $gcloud run services describe $SignalServiceName --project $ProjectId --region $Region --format 'value(status.url)'
if ($LASTEXITCODE -ne 0 -or -not $serviceUrl) {
  throw 'Could not resolve the deployed Cloud Run URL.'
}

$serviceUrl = $serviceUrl.Trim()
Write-Host "[dev-deploy] signaling URL: $serviceUrl" -ForegroundColor Green

if ($env:CLOUDFLARE_API_TOKEN -and $env:CLOUDFLARE_ACCOUNT_ID -and (Test-Path $deployPagesScript)) {
  Write-Host "[dev-deploy] deploying web-client to Cloudflare Pages branch '$PagesBranch'" -ForegroundColor Cyan
  & $deployPagesScript -SignalingUrl $serviceUrl -ProjectName $PagesProjectName -Branch $PagesBranch
  if ($LASTEXITCODE -ne 0) {
    throw 'Development Pages deploy failed.'
  }
} else {
  Write-Host '[dev-deploy] skipping Cloudflare Pages deploy because CLOUDFLARE_API_TOKEN/CLOUDFLARE_ACCOUNT_ID is not configured.' -ForegroundColor Yellow
}

Write-Host '[dev-deploy] complete' -ForegroundColor Green
