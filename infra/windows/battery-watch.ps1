<#
.SYNOPSIS
  Warns on Discord when this machine's battery is low and unplugged.

.DESCRIPTION
  This laptop is the household's DNS server. If it dies, every device in the
  house loses name resolution — not just Home Guardian's filtering, but the
  internet as far as anyone else can tell. A low battery is therefore an
  imminent house-wide outage, and the one failure the app itself cannot report:
  the API runs in a container with no view of host power, and by the time the
  machine is off there is nothing left to send the alert.

  So this runs on the host, on a schedule, and posts to the same Discord webhook
  the app uses.

.PARAMETER MockPercent
  Pretend the battery is at this level. For testing the alert path without
  waiting for a real flat battery.

.PARAMETER MockOnBattery
  Pretend the machine is unplugged. Combine with -MockPercent.

.PARAMETER WhatIfOnly
  Work out what would be sent and print it, without posting to Discord.
#>
[CmdletBinding()]
param(
  [int]    $MockPercent = -1,
  [switch] $MockOnBattery,
  [switch] $WhatIfOnly,
  # Set when fired by the power-source-change event rather than the timer, so
  # the first message can say "unplugged" instead of only a percentage.
  [switch] $PowerSourceChanged
)

$ErrorActionPreference = 'Stop'

# Warn at each of these, worst last.
#
# 10% alone was too late. On 2026-08-17 this machine fell from 13.4% to the
# 5% hibernate at 0.7%/min — under seven minutes from crossing 10%, or barely
# one tick of a five-minute timer, and that assumes somebody is looking at
# their phone the moment it lands. 25% buys about twenty minutes, which is
# enough to walk to the laptop.
$Thresholds = @(25, 10)
# Re-send at most this often when the level is not still falling.
$RepeatMinutes = 30

# State lives outside the repo: it is machine-local, changes constantly, and
# has no business in version control.
$StateDir  = Join-Path $env:LOCALAPPDATA 'HomeGuardian'
$StateFile = Join-Path $StateDir 'battery-state.json'

function Get-Webhook {
  # Read from the app's own .env so there is exactly one copy of this secret on
  # the machine. Never printed, never logged.
  $envPath = Join-Path (Split-Path (Split-Path $PSScriptRoot -Parent) -Parent) '.env'
  if (-not (Test-Path $envPath)) { return $null }
  $line = Select-String -Path $envPath -Pattern '^ALERT_WEBHOOK_URL=(.+)$' | Select-Object -First 1
  if (-not $line) { return $null }
  return $line.Matches[0].Groups[1].Value.Trim()
}

function Get-BatteryState {
  if ($MockPercent -ge 0) {
    return @{ Percent = $MockPercent; OnBattery = [bool]$MockOnBattery; Present = $true }
  }
  $b = Get-CimInstance -ClassName Win32_Battery -ErrorAction SilentlyContinue | Select-Object -First 1
  if (-not $b) { return @{ Present = $false } }

  # Win32_Battery.BatteryStatus: 1 = discharging, 4 = low, 5 = critical are all
  # "running on the battery". 2 (AC), 3 (fully charged), 6-9 (charging) and 11
  # (partially charged) all mean mains power is attached. Anything unexpected is
  # treated as plugged in — a false silence beats crying wolf every five minutes.
  $onBattery = @(1, 4, 5) -contains [int]$b.BatteryStatus
  # Firmware estimate; wildly optimistic on some hardware and absent on others,
  # so it is only ever shown as a hint, never used for a decision.
  $mins = [int]$b.EstimatedRunTime
  return @{
    Percent   = [int]$b.EstimatedChargeRemaining
    OnBattery = $onBattery
    Minutes   = if ($mins -gt 0 -and $mins -lt 1440) { $mins } else { 0 }
    Present   = $true
  }
}

function Read-State {
  $fresh = @{ alerted = $false; percent = 101; at = $null; tier = 0 }
  if (-not (Test-Path $StateFile)) { return $fresh }
  try { return (Get-Content $StateFile -Raw | ConvertFrom-Json) }
  catch { return $fresh }
}

function Write-State($state) {
  # A dry run must not leave state behind claiming a warning was already sent.
  if ($WhatIfOnly) { return }
  if (-not (Test-Path $StateDir)) { New-Item -ItemType Directory -Path $StateDir -Force | Out-Null }
  $state | ConvertTo-Json | Set-Content -Path $StateFile -Encoding utf8
}

function Send-Discord($content) {
  if ($WhatIfOnly) { Write-Host "WOULD SEND: $content"; return $true }
  $hook = Get-Webhook
  if (-not $hook) { Write-Host 'No ALERT_WEBHOOK_URL in .env - nothing sent.'; return $false }
  try {
    Invoke-RestMethod -Uri $hook -Method Post -ContentType 'application/json' `
      -Body (@{ content = $content } | ConvertTo-Json -Compress) | Out-Null
    Write-Host "SENT: $content"
    return $true
  } catch {
    # A failed post must not leave a stale state file claiming we warned.
    Write-Host "Discord post failed: $($_.Exception.Message)"
    return $false
  }
}

# ---- main ----------------------------------------------------------------

$battery = Get-BatteryState
if (-not $battery.Present) {
  Write-Output 'No battery detected (desktop or VM) — nothing to watch.'
  exit 0
}

$state = Read-State
$percent = $battery.Percent
$onBattery = $battery.OnBattery

if (-not $onBattery) {
  # Back on mains. Say so once, but only if we actually warned about it —
  # otherwise every unplug-and-replug becomes two messages.
  if ($state.alerted) {
    Send-Discord ":white_check_mark: Home Guardian server is back on power ($percent%). DNS is safe." | Out-Null
    Write-State @{ alerted = $false; percent = $percent; at = $null }
  } else {
    Write-Output "On AC at $percent% — nothing to do."
  }
  exit 0
}

# The worst threshold this level has reached; 0 when still healthy.
$tier = 0
foreach ($t in ($Thresholds | Sort-Object -Descending)) { if ($percent -le $t) { $tier = $t } }

if ($tier -eq 0) {
  # Discharging but healthy. Say so once if we are only now unplugged, then
  # clear any previous warning so the next dip alerts without a cooldown.
  if ($PowerSourceChanged) {
    $hint = if ($battery.Minutes) { " (about $($battery.Minutes) min at this rate)" } else { '' }
    Send-Discord ":electric_plug: Home Guardian server is now on **battery** at $percent%$hint. DNS stays up until it runs out." | Out-Null
  }
  if ($state.alerted) { Write-State @{ alerted = $false; percent = $percent; at = $null; tier = 0 } }
  Write-Output "On battery at $percent% — above the highest threshold ($($Thresholds[0])%)."
  exit 0
}

# Below a threshold and unplugged. Alert when this is new, when it has crossed
# into a WORSE tier, when it has fallen further, or when the cooldown elapsed.
$lastAt = if ($state.at) { [datetime]$state.at } else { [datetime]::MinValue }
$lastTier = if ($null -ne $state.tier) { [int]$state.tier } else { 0 }
$dueAgain = ((Get-Date) - $lastAt).TotalMinutes -ge $RepeatMinutes
$fellFurther = $percent -lt [int]$state.percent
$worseTier = $lastTier -eq 0 -or $tier -lt $lastTier

if (-not $state.alerted -or $worseTier -or $fellFurther -or $dueAgain) {
  $hint = if ($battery.Minutes) { " — about **$($battery.Minutes) min** left at this rate" } else { '' }
  $icon = if ($tier -le 10) { ':rotating_light:' } else { ':warning:' }
  $urgency = if ($tier -le 10) {
    "Windows hibernates it at 5%, which takes the whole house offline."
  } else {
    'Plug it in before it gets urgent.'
  }
  $msg = "$icon **Home Guardian server battery at $percent% and unplugged**$hint. $urgency"
  if (Send-Discord $msg) {
    Write-State @{ alerted = $true; percent = $percent; at = (Get-Date).ToString('o'); tier = $tier }
  }
} else {
  Write-Output "Already warned at $($state.percent)% (tier $lastTier) — holding until it drops or $RepeatMinutes min pass."
}
