# Stops whatever deploy\start.ps1 last started.

$pidFile = Join-Path $PSScriptRoot "running.pids"
if (-not (Test-Path $pidFile)) { "nothing to stop"; exit }

foreach ($id in Get-Content $pidFile) {
    try {
        Stop-Process -Id $id -Force -ErrorAction Stop
        "stopped $id"
    } catch {
        "already gone: $id"
    }
}
Remove-Item $pidFile
