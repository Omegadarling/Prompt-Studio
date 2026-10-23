$ErrorActionPreference = 'Stop'
$appPort = if ($env:H3_PORT) { [int]$env:H3_PORT } else { 17943 }
$appUrl = "http://127.0.0.1:$appPort"
function Get-AppHealth {
    try { Invoke-RestMethod -Uri "$appUrl/api/health" -TimeoutSec 2 } catch { $null }
}
$launchLock = New-Object System.Threading.Mutex($false, "Local\H3PromptStudio-$appPort")
$lockHeld = $false
try {
    try { $lockHeld = $launchLock.WaitOne(15000) } catch [System.Threading.AbandonedMutexException] { $lockHeld = $true }
    if (-not $lockHeld) { throw 'Another app launch is still in progress. Try opening the app again shortly.' }
    $health = Get-AppHealth
    if ($health -and $health.app -ne 'minimax-h3-prompt-studio') { throw "Port $appPort belongs to another app. Set H3_PORT to another port." }
    if (-not $health) {
    $nodeExe = (Get-Command node.exe -ErrorAction Stop).Source
    $runtimePath = Join-Path $PSScriptRoot '.runtime'
    New-Item -ItemType Directory -Path $runtimePath -Force | Out-Null
    $serverFile = Join-Path $PSScriptRoot 'server.mjs'
    $appProcess = Start-Process -FilePath $nodeExe -ArgumentList ('"' + $serverFile + '"') -WorkingDirectory $PSScriptRoot -WindowStyle Hidden -RedirectStandardOutput (Join-Path $runtimePath 'server.log') -RedirectStandardError (Join-Path $runtimePath 'server-error.log') -PassThru
    for ($attempt = 0; $attempt -lt 30; $attempt++) {
        Start-Sleep -Milliseconds 250
        $health = Get-AppHealth
        if ($health) { break }
        if ($appProcess.HasExited) { break }
    }
    if (-not $health -or $health.app -ne 'minimax-h3-prompt-studio') { throw 'Prompt Studio could not start. Check .runtime/server-error.log in the app folder.' }
    $appProcess.Refresh()
    if (-not $appProcess.HasExited) { $appProcess.Id | Set-Content -LiteralPath (Join-Path $runtimePath 'server.pid') }
    }
} finally {
    if ($lockHeld) { $launchLock.ReleaseMutex() }
    $launchLock.Dispose()
}
Start-Process $appUrl
