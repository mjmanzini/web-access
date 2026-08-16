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
| Discharging, above 10% | silent |
| Discharging, at or below 10% | alert |
| Same level, already warned | held for 30 minutes |
| Fell further since the warning | alerts again immediately |
| Plugged back in after a warning | one "back on power" message |

**Testing** — mock any state without waiting for a flat battery:

```powershell
# Print what would be sent; sends nothing, writes no state.
.\battery-watch.ps1 -MockPercent 8 -MockOnBattery -WhatIfOnly

# Actually post to Discord.
.\battery-watch.ps1 -MockPercent 8 -MockOnBattery
```

**Scheduled task** — registered in user context, no admin required:

```powershell
schtasks /Create /TN 'HomeGuardian-BatteryWatch' /SC MINUTE /MO 5 /F /TR `
  'powershell.exe -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File "C:\Users\Jastice\Documents\web-access\infra\windows\battery-watch.ps1"'

schtasks /Query /TN 'HomeGuardian-BatteryWatch' /V /FO LIST   # verify
schtasks /Run   /TN 'HomeGuardian-BatteryWatch'               # run now
schtasks /Delete /TN 'HomeGuardian-BatteryWatch' /F           # remove
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
