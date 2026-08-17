# Host-side watchers (Windows)

The API runs in a container and cannot see the host it depends on. These
scripts cover the failures only the host can observe.

## battery-watch.ps1

This laptop is the household's DNS server. A flat battery is not a laptop
problem — it is every device in the house losing name resolution, and it is the
one outage the app can never report, because by the time the machine is off
there is nothing left to send the alert.

Posts to the same Discord webhook the app uses (read from the repo's `.env`, so
there is exactly one copy of that secret on the machine).

**Behaviour**

| Condition | Result |
|---|---|
| On AC | silent |
| Just unplugged (event-triggered) | one "now on battery" message |
| Discharging, above 25% | silent |
| Discharging, at or below 25% | warning |
| Discharging, at or below 10% | urgent alert |
| Crossed into a worse tier | alerts again immediately |
| Same level, already warned | held for 30 minutes |
| Fell further since the warning | alerts again immediately |
| Plugged back in after a warning | one "back on power" message |

**Why two thresholds.** On 2026-08-17 this machine fell from 13.4% to the 5%
hibernate in about eleven minutes — roughly 0.7%/min. A single 10% threshold
gives under seven minutes, or one tick of a five-minute timer, and assumes
somebody happens to be looking at their phone. 25% buys about twenty minutes.

**Testing** — mock any state without waiting for a flat battery:

```powershell
# Print what would be sent; sends nothing, writes no state.
.\battery-watch.ps1 -MockPercent 8 -MockOnBattery -WhatIfOnly

# Actually post to Discord.
.\battery-watch.ps1 -MockPercent 8 -MockOnBattery
```

### Registering the tasks — read this before using `schtasks`

> **`schtasks /Create` registers a task that will not run on battery.** Its
> defaults are `DisallowStartIfOnBatteries = True` and
> `StopIfGoingOnBatteries = True`. For an ordinary task that is a sensible
> power saving. For a battery watchdog it is fatal: the one condition it exists
> to report is the exact condition under which Windows refuses to start it, and
> it fails **silently** — the task shows `Ready`, `LastTaskResult 0`, and simply
> never fires.
>
> This is not hypothetical. It is why the alert never arrived on 2026-08-17
> during a two-hour discharge from 08:25 to a 10:25 hibernate: 24 consecutive
> ticks suppressed, no error anywhere.

Use `Register-ScheduledTask` with explicit power flags. No admin required —
both run in the user's context.

```powershell
$script = 'C:\Users\Jastice\Documents\web-access\infra\windows\battery-watch.ps1'
$set = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
  -ExecutionTimeLimit (New-TimeSpan -Minutes 5) -MultipleInstances IgnoreNew
$pri = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive -RunLevel Limited

# 1. Every five minutes.
$trg = New-ScheduledTaskTrigger -Once -At (Get-Date) `
  -RepetitionInterval (New-TimeSpan -Minutes 5) -RepetitionDuration ([TimeSpan]::MaxValue)
Register-ScheduledTask -TaskName 'HomeGuardian-BatteryWatch' -Trigger $trg -Settings $set -Principal $pri `
  -Action (New-ScheduledTaskAction -Execute 'powershell.exe' `
    -Argument "-NoProfile -NonInteractive -ExecutionPolicy Bypass -File `"$script`"")

# 2. The instant mains power is lost, rather than up to five minutes later.
#    Kernel-Power event 105 is "power source change"; the 15s delay lets
#    Win32_Battery catch up before we read it.
$cls = Get-CimClass MSFT_TaskEventTrigger -Namespace Root/Microsoft/Windows/TaskScheduler
$evt = New-CimInstance -CimClass $cls -ClientOnly
$evt.Enabled = $true
$evt.Delay = 'PT15S'
$evt.Subscription = "<QueryList><Query Id='0' Path='System'><Select Path='System'>*[System[Provider[@Name='Microsoft-Windows-Kernel-Power'] and (EventID=105)]]</Select></Query></QueryList>"
Register-ScheduledTask -TaskName 'HomeGuardian-PowerSourceChanged' -Trigger $evt -Settings $set -Principal $pri `
  -Action (New-ScheduledTaskAction -Execute 'powershell.exe' `
    -Argument "-NoProfile -NonInteractive -ExecutionPolicy Bypass -File `"$script`" -PowerSourceChanged")
```

**Always verify the power flags after registering — this is the check that was
missing:**

```powershell
Get-ScheduledTask -TaskName 'HomeGuardian-*' | ForEach-Object {
  "{0} onBattery={1}" -f $_.TaskName, (-not $_.Settings.DisallowStartIfOnBatteries)
}   # both must say onBattery=True
```

### Power policy for a laptop acting as a server

The watchdog only buys time; these settings decide what happens when it runs
out. Applied to the active scheme:

```powershell
$g = (powercfg /getactivescheme) -replace '.*GUID: ([a-f0-9\-]+).*','$1'
powercfg /change standby-timeout-ac 0      # never sleep on mains
powercfg /change hibernate-timeout-ac 0
# Lid closed on mains must do nothing - closing the lid is the likeliest
# accidental way to take the household's DNS down.
powercfg /setacvalueindex $g 4f971e89-eebd-4455-a8de-9e59040e7347 `
  5ca83367-6e45-459f-a27b-476b1d01c936 0
# On battery the lid still hibernates: a clean stop with Postgres flushed.
powercfg /setdcvalueindex $g 4f971e89-eebd-4455-a8de-9e59040e7347 `
  5ca83367-6e45-459f-a27b-476b1d01c936 2
powercfg /setactive $g
```

Critical-battery action should stay **Hibernate** (not Sleep, not Shutdown).
Hibernate flushes RAM to disk and stops cleanly, so Postgres closes properly;
sleep keeps draining until the battery is genuinely flat, which then *is* a
hard power cut. On 2026-08-17 this is what saved the database — the machine
hibernated at 5% rather than dying, containers stayed up across the resume, and
no data was lost.

Other task verbs:

```powershell
Start-ScheduledTask      -TaskName 'HomeGuardian-BatteryWatch'   # run now
Get-ScheduledTaskInfo    -TaskName 'HomeGuardian-BatteryWatch'   # last result
Unregister-ScheduledTask -TaskName 'HomeGuardian-BatteryWatch' -Confirm:$false
```

State (last warned level and time) lives in
`%LOCALAPPDATA%\HomeGuardian\battery-state.json` — machine-local, deliberately
outside the repo.

**Note on encoding:** the script is saved as UTF-8 **with a BOM**. Windows
PowerShell 5.1 reads `.ps1` files as ANSI without one, which mangles every
non-ASCII character and makes the file fail to parse. Keep the BOM.

**After the mini-PC migration** this task moves with the DNS role. A machine on
mains with no battery reports "No battery detected" and exits cleanly, so it is
harmless to leave registered either way.
