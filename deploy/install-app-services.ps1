# Registers the two app servers and Caddy as Windows services, so the whole
# stack is back after a reboot without anyone signing in. The tunnel is a
# service already -- see deploy\install-tunnel-service.ps1.
#
#   pawpages-api   uvicorn on 127.0.0.1:8001
#   pawpages-web   Caddy on 127.0.0.1:8080, in front of the api
#   daybook        Hono on 127.0.0.1:3000
#
# Must run elevated. Re-running it updates the existing services in place.
#
# Remove them with (elevated):
#   nssm remove pawpages-api confirm   (and pawpages-web, daybook)
#
# The services run as LocalSystem, which does not have the user PATH, so every
# binary is named by absolute path: the venv's python and node directly rather
# than the uv and npm launchers that would have to be resolved first.

$log = Join-Path $PSScriptRoot "logs\service-install-apps.log"
Start-Transcript -Path $log -Force | Out-Null

$root    = Split-Path -Parent $PSScriptRoot
$logs    = Join-Path $PSScriptRoot "logs"
$daybook = Join-Path (Split-Path -Parent $root) "daybook"

$nssm   = (Get-Command nssm -ErrorAction SilentlyContinue).Source
if (-not $nssm) { throw "nssm not on PATH; winget install NSSM.NSSM" }
$python = Join-Path $root "backend\.venv\Scripts\python.exe"
$caddy  = "C:\Users\akhil\AppData\Local\Microsoft\WinGet\Packages\CaddyServer.Caddy_Microsoft.Winget.Source_8wekyb3d8bbwe\caddy.exe"
$node   = "D:\APPS\node\node.exe"

foreach ($p in @($python, $caddy, $node)) {
    if (-not (Test-Path $p)) { throw "missing binary: $p" }
}

function Add-AppService($name, $exe, $argline, $dir, $envExtra) {
    if (Get-Service $name -ErrorAction SilentlyContinue) {
        & $nssm stop $name confirm | Out-Null
        Start-Sleep -Seconds 2
        & $nssm remove $name confirm | Out-Null
        Start-Sleep -Seconds 2
    }
    & $nssm install $name $exe $argline | Out-Null
    & $nssm set $name AppDirectory $dir | Out-Null
    & $nssm set $name AppStdout (Join-Path $logs "$name.log") | Out-Null
    & $nssm set $name AppStderr (Join-Path $logs "$name.err") | Out-Null
    # Without this the logs grow forever on a box that never gets restarted.
    & $nssm set $name AppRotateFiles 1 | Out-Null
    & $nssm set $name AppRotateBytes 10485760 | Out-Null
    & $nssm set $name Start SERVICE_AUTO_START | Out-Null
    & $nssm set $name AppExit Default Restart | Out-Null
    & $nssm set $name AppRestartDelay 5000 | Out-Null
    if ($envExtra) { & $nssm set $name AppEnvironmentExtra $envExtra | Out-Null }
    "registered $name"
}

# These override backend\.env, which stays configured for local development.
Add-AppService "pawpages-api" $python `
    "-m uvicorn app.main:app --host 127.0.0.1 --port 8001" `
    (Join-Path $root "backend") `
    @("COOKIE_SECURE=true", "WEB_URL=https://pawpages.kazetakumi.in", "DOCS_ENABLED=false")

Add-AppService "pawpages-web" $caddy "run --config deploy\Caddyfile" $root $null

Add-AppService "daybook" $node "node_modules\tsx\dist\cli.mjs src/server/index.ts" $daybook $null

foreach ($n in @("pawpages-api", "pawpages-web", "daybook")) {
    Start-Service $n
    Start-Sleep -Seconds 3
}
Start-Sleep -Seconds 4
Get-Service pawpages-api, pawpages-web, daybook, cloudflared |
    Format-Table Name, Status, StartType -AutoSize

Stop-Transcript | Out-Null
