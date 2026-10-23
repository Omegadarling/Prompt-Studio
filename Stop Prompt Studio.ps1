$ErrorActionPreference = 'Stop'
$pidFile = Join-Path $PSScriptRoot '.runtime\server.pid'
if (-not (Test-Path -LiteralPath $pidFile)) { Write-Output 'No app process was recorded.'; exit }
$appPid = [int](Get-Content -LiteralPath $pidFile)
$appProcess = Get-CimInstance Win32_Process -Filter "ProcessId=$appPid" -ErrorAction SilentlyContinue
$expectedFile = Join-Path $PSScriptRoot 'server.mjs'
if ($appProcess -and $appProcess.Name -eq 'node.exe' -and $appProcess.CommandLine.Contains('"' + $expectedFile + '"')) {
    Stop-Process -Id $appPid
    Remove-Item -LiteralPath $pidFile
    Write-Output 'Prompt Studio stopped.'
} else { Write-Output 'The recorded app process is no longer running. No other process was stopped.' }
