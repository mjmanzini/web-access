param(
  [string]$RepoOwner,
  [string]$RepoName,
  [string]$EnvironmentName = 'production',
  [string]$DeployHost,
  [string]$DeployUser,
  [string]$DeployPath,
  [string]$DeployKeyPath,
  [string]$DeployKnownHosts,
  [string]$WebUrl,
  [string]$SignalUrl
)

$ErrorActionPreference = 'Stop'

function Require-Command {
  param([string]$Name)

  if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
    throw "Required command '$Name' was not found in PATH."
  }
}

function Read-RequiredValue {
  param(
    [string]$Prompt,
    [string]$CurrentValue
  )

  if ($CurrentValue) {
    return $CurrentValue
  }

  $value = Read-Host $Prompt
  if (-not $value) {
    throw "Missing required value for '$Prompt'."
  }

  return $value
}

function Set-GhSecret {
  param(
    [string]$Repo,
    [string]$Environment,
    [string]$Name,
    [string]$Value
  )

  if (-not $Value) {
    throw "Secret '$Name' cannot be empty."
  }

  $Value | gh secret set $Name --repo $Repo --env $Environment
}

function Set-GhVariable {
  param(
    [string]$Repo,
    [string]$Environment,
    [string]$Name,
    [string]$Value
  )

  if (-not $Value) {
    return
  }

  gh variable set $Name --repo $Repo --env $Environment --body $Value | Out-Null
}

function Get-RepoFromGitRemote {
  $origin = git config --get remote.origin.url
  if (-not $origin) {
    throw 'Could not determine origin remote URL. Pass -RepoOwner and -RepoName explicitly.'
  }

  if ($origin -match 'github\.com[:/](?<owner>[^/]+)/(?<repo>[^/.]+)(\.git)?$') {
    return @($Matches.owner, $Matches.repo)
  }

  throw "Origin remote '$origin' is not a GitHub repository URL."
}

Require-Command git
Require-Command gh

$authCheck = $null
try {
  $authCheck = gh auth status 2>&1
} catch {
  throw "GitHub CLI is not authenticated. Run 'gh auth login' first."
}

if (-not $RepoOwner -or -not $RepoName) {
  $repoParts = Get-RepoFromGitRemote
  if (-not $RepoOwner) { $RepoOwner = $repoParts[0] }
  if (-not $RepoName) { $RepoName = $repoParts[1] }
}

$repo = "$RepoOwner/$RepoName"

$DeployHost = Read-RequiredValue 'Deploy host (DEPLOY_HOST)' $DeployHost
$DeployUser = Read-RequiredValue 'Deploy user (DEPLOY_USER)' $DeployUser
$DeployPath = Read-RequiredValue 'Deploy path on VPS (DEPLOY_PATH)' $DeployPath
$DeployKeyPath = Read-RequiredValue 'Path to private SSH key for DEPLOY_SSH_KEY' $DeployKeyPath

if (-not (Test-Path $DeployKeyPath)) {
  throw "SSH key file '$DeployKeyPath' does not exist."
}

if (-not $WebUrl) {
  $WebUrl = Read-Host 'Public web URL for smoke tests (WEB_URL, optional)'
}

if (-not $SignalUrl) {
  $SignalUrl = Read-Host 'Public signaling URL for smoke tests (SIGNAL_URL, optional)'
}

if (-not $DeployKnownHosts -and (Get-Command ssh-keyscan -ErrorAction SilentlyContinue)) {
  try {
    $DeployKnownHosts = (& ssh-keyscan -H $DeployHost 2>$null) -join "`n"
  } catch {
    $DeployKnownHosts = ''
  }
}

$deployKey = Get-Content -Path $DeployKeyPath -Raw
if (-not $deployKey.Trim()) {
  throw "SSH key file '$DeployKeyPath' is empty."
}

Write-Host "Creating or updating GitHub environment '$EnvironmentName' in $repo..."
gh api --method PUT -H 'Accept: application/vnd.github+json' "/repos/$repo/environments/$EnvironmentName" | Out-Null

Write-Host 'Setting required deploy secrets...'
Set-GhSecret -Repo $repo -Environment $EnvironmentName -Name 'DEPLOY_HOST' -Value $DeployHost
Set-GhSecret -Repo $repo -Environment $EnvironmentName -Name 'DEPLOY_USER' -Value $DeployUser
Set-GhSecret -Repo $repo -Environment $EnvironmentName -Name 'DEPLOY_PATH' -Value $DeployPath
Set-GhSecret -Repo $repo -Environment $EnvironmentName -Name 'DEPLOY_SSH_KEY' -Value $deployKey

if ($DeployKnownHosts) {
  Write-Host 'Setting optional DEPLOY_KNOWN_HOSTS secret...'
  Set-GhSecret -Repo $repo -Environment $EnvironmentName -Name 'DEPLOY_KNOWN_HOSTS' -Value $DeployKnownHosts
} else {
  Write-Host 'Skipping DEPLOY_KNOWN_HOSTS; workflow will fall back to ssh-keyscan.'
}

if ($WebUrl -or $SignalUrl) {
  Write-Host 'Setting environment variables for smoke tests...'
  Set-GhVariable -Repo $repo -Environment $EnvironmentName -Name 'WEB_URL' -Value $WebUrl
  Set-GhVariable -Repo $repo -Environment $EnvironmentName -Name 'SIGNAL_URL' -Value $SignalUrl
}

Write-Host ''
Write-Host 'GitHub deploy environment configured.'
Write-Host "Repository: $repo"
Write-Host "Environment: $EnvironmentName"
Write-Host ''
Write-Host 'Next step: rerun the deploy workflow from GitHub Actions.'