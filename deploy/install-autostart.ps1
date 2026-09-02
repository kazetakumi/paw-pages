# Registers a scheduled task so the two app servers come back after a reboot.
# Runs at logon rather than at boot because uv and node resolve from the user
# PATH. The tunnel itself is a service and starts earlier, without a login --
# it just answers 502 until this task brings the origins up.
#
#   .\deploy\install-autostart.ps1     register (or update) the task
#
# Remove it with:
#   Unregister-ScheduledTask -TaskName "PawPages" -Confirm:$false

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot

$action = New-ScheduledTaskAction -Execute "powershell.exe" `
    -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$PSScriptRoot\start.ps1`"" `
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
