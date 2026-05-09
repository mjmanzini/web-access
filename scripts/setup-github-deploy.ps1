param(
  [string]$RepoOwner,
  [string]$RepoName,
  [string]$EnvironmentName = 'production',
  [string]$DeployPath,
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

$DeployPath = Read-RequiredValue 'Deploy path on VPS (DEPLOY_PATH)' $DeployPath

if (-not $WebUrl) {
  $WebUrl = Read-Host 'Public web URL for smoke tests (WEB_URL, optional)'
}

if (-not $SignalUrl) {
  $SignalUrl = Read-Host 'Public signaling URL for smoke tests (SIGNAL_URL, optional)'
}

Write-Host "Creating or updating GitHub environment '$EnvironmentName' in $repo..."
gh api --method PUT -H 'Accept: application/vnd.github+json' "/repos/$repo/environments/$EnvironmentName" | Out-Null

Write-Host 'Setting required deploy secret...'
Set-GhSecret -Repo $repo -Environment $EnvironmentName -Name 'DEPLOY_PATH' -Value $DeployPath

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