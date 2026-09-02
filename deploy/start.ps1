# Starts the app servers: uvicorn on 8001, Caddy on 8080 in front of it, and
# the Daybook server on 3000. Stop them with deploy\stop.ps1.
#
#   .\deploy\start.ps1 -Build       rebuild web\dist first
#   .\deploy\start.ps1 -NoDaybook   paw-pages only
#
# The Cloudflare tunnel is not started here -- it runs as a Windows service so
# it survives a reboot without a login. See deploy\install-tunnel-service.ps1.

param(
    [switch]$Build,
    [switch]$NoDaybook
)

$ErrorActionPreference = "Stop"

# winget appends to PATH but running shells do not see it until restarted,
# so read the persisted value rather than the one this session started with.
$env:Path = [Environment]::GetEnvironmentVariable("Path", "Machine") + ";" +
            [Environment]::GetEnvironmentVariable("Path", "User")
$root = Split-Path -Parent $PSScriptRoot
$logs = Join-Path $PSScriptRoot "logs"
if (-not (Test-Path $logs)) { New-Item -ItemType Directory -Path $logs | Out-Null }
Set-Location $root

if ($Build) {
    Push-Location (Join-Path $root "web")
    npm run build
    Pop-Location
}

# These override backend\.env, which stays configured for local development.
$env:COOKIE_SECURE = "true"
$env:WEB_URL = "https://pawpages.kazetakumi.in"
$env:DOCS_ENABLED = "false"

$procs = @()
$procs += Start-Process -FilePath "uv" `
    -ArgumentList "run","uvicorn","app.main:app","--host","127.0.0.1","--port","8001" `
    -WorkingDirectory (Join-Path $root "backend") -PassThru -WindowStyle Hidden `
    -RedirectStandardOutput "$logs\uvicorn.log" -RedirectStandardError "$logs\uvicorn.err"

$procs += Start-Process -FilePath "caddy" `
    -ArgumentList "run","--config","deploy\Caddyfile" `
    -WorkingDirectory $root -PassThru -WindowStyle Hidden `
    -RedirectStandardOutput "$logs\caddy.log" -RedirectStandardError "$logs\caddy.err"

# Sibling repo, served on daybook.kazetakumi.in by the same tunnel. It serves
# its own dist/ and /api/* off one port, so it needs nothing in front of it.
$daybook = Join-Path (Split-Path -Parent $root) "daybook"
if (-not $NoDaybook -and (Test-Path $daybook)) {
    $procs += Start-Process -FilePath "npm.cmd" -ArgumentList "start" `
        -WorkingDirectory $daybook -PassThru -WindowStyle Hidden `
        -RedirectStandardOutput "$logs\daybook.log" -RedirectStandardError "$logs\daybook.err"
}

$procs | ForEach-Object { $_.Id } | Set-Content (Join-Path $PSScriptRoot "running.pids") -Encoding utf8
"started pids: " + (($procs | ForEach-Object { $_.Id }) -join ", ")
"logs in deploy\logs"
