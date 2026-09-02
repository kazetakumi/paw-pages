# Stops whatever deploy\start.ps1 last started.

$pidFile = Join-Path $PSScriptRoot "running.pids"
if (-not (Test-Path $pidFile)) { "nothing to stop"; exit }

# /T kills the children too: uv and npm.cmd are launchers, and killing them
# alone leaves the actual uvicorn and node processes holding their ports.
foreach ($id in Get-Content $pidFile) {
    $out = taskkill /PID $id /T /F 2>&1
    if ($LASTEXITCODE -eq 0) { "stopped $id" } else { "already gone: $id" }
}
Remove-Item $pidFile
