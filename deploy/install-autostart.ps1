# Registers a scheduled task so a reboot does not take the sites down. Runs at
# logon rather than at boot because uv, node and cloudflared all resolve from
# the user PATH and the tunnel credentials live under the user profile.
#
#   .\deploy\install-autostart.ps1     register (or update) the task
#
# Remove it with:
#   Unregister-ScheduledTask -TaskName "PawPages" -Confirm:$false

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot

$action = New-ScheduledTaskAction -Execute "powershell.exe" `
    -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$PSScriptRoot\start.ps1`" -Tunnel pawpages" `
    -WorkingDirectory $root

# Give the network a moment; cloudflared would retry anyway, but this keeps the
# logs clean on a cold boot.
$trigger = New-ScheduledTaskTrigger -AtLogOn -User "$env:USERDOMAIN\$env:USERNAME"
$trigger.Delay = "PT30S"

$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries -ExecutionTimeLimit ([TimeSpan]::Zero)

Register-ScheduledTask -TaskName "PawPages" -Action $action -Trigger $trigger `
    -Settings $settings -Force | Out-Null

"registered scheduled task 'PawPages' (at logon, 30s delay)"
