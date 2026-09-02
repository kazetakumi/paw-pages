# Installs cloudflared as a Windows service, so the tunnel comes up at boot
# without waiting for anyone to sign in.
#
# Two things this has to do that `cloudflared service install` does not:
#
#   1. The service runs as LocalSystem, whose home is
#      C:\Windows\System32\config\systemprofile -- so the config and the tunnel
#      credentials are copied there.
#   2. `service install` registers the service with no arguments, so it starts,
#      finds no subcommand and exits (Start-Service then reports a failure).
#      The ImagePath is rewritten here to name the config and `tunnel run`.
#
# Must run elevated. deploy\install-autostart.ps1 does not start the tunnel.
#
# Remove it with (elevated):  cloudflared service uninstall
#
# Note: no stderr redirect and no ErrorActionPreference. cloudflared logs INF
# lines to stderr and PowerShell 5.1 turns those into terminating errors.
# Stop-Service is avoided too: a cloudflared started without arguments never
# answers the stop control and wedges in StopPending forever.

$log = Join-Path $PSScriptRoot "logs\service-install.log"
Start-Transcript -Path $log -Force | Out-Null

$tunnelId = "1d4eb356-948e-48e5-9ff5-b184994ce7f9"
$exe      = "C:\Program Files (x86)\cloudflared\cloudflared.exe"
$userDir  = Join-Path $env:USERPROFILE ".cloudflared"
$sysDir   = "C:\Windows\System32\config\systemprofile\.cloudflared"

if (-not (Test-Path $sysDir)) { New-Item -ItemType Directory -Path $sysDir -Force | Out-Null }
Copy-Item (Join-Path $userDir "$tunnelId.json") $sysDir -Force

@"
tunnel: $tunnelId
credentials-file: $sysDir\$tunnelId.json

ingress:
  - hostname: pawpages.kazetakumi.in
    service: http://127.0.0.1:8080

  - hostname: daybook.kazetakumi.in
    service: http://127.0.0.1:3000

  - service: http_status:404
"@ | Set-Content (Join-Path $sysDir "config.yml") -Encoding utf8
"seeded $sysDir"

if (-not (Get-Service cloudflared -ErrorAction SilentlyContinue)) {
    cloudflared service install
    Start-Sleep -Seconds 3
}

sc.exe stop Cloudflared | Out-Null
Start-Sleep -Seconds 2

$imagePath = "`"$exe`" --config `"$sysDir\config.yml`" tunnel run"
Set-ItemProperty "HKLM:\SYSTEM\CurrentControlSet\Services\Cloudflared" -Name ImagePath -Value $imagePath
"ImagePath: $imagePath"

Start-Service cloudflared
Start-Sleep -Seconds 8
Get-Service cloudflared | Format-Table Name, Status, StartType -AutoSize

Stop-Transcript | Out-Null
