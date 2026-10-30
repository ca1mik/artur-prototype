param(
  [int]$IntervalMinutes = 5,
  [string]$ExtraArgs = "--unseen --write-doc --draft-replies --use-ollama"
)

$backendDir = Resolve-Path (Join-Path $PSScriptRoot "..")
$rootDir = Resolve-Path (Join-Path $backendDir "..")
$logDir = Join-Path $rootDir "sales\logs\watcher"

New-Item -ItemType Directory -Path $logDir -Force | Out-Null

$timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
$stdoutPath = Join-Path $logDir "inbox-watch-$timestamp.out.log"
$stderrPath = Join-Path $logDir "inbox-watch-$timestamp.err.log"

$command = @"
Set-Location '$backendDir'
`$env:INBOX_MONITOR_INTERVAL_MINUTES = '$IntervalMinutes'
npm run inbox:watch -- $ExtraArgs
"@

$process = Start-Process `
  -FilePath "powershell.exe" `
  -ArgumentList @("-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", $command) `
  -WindowStyle Hidden `
  -RedirectStandardOutput $stdoutPath `
  -RedirectStandardError $stderrPath `
  -PassThru

Write-Output "Started inbox monitor watcher."
Write-Output "PID: $($process.Id)"
Write-Output "STDOUT: $stdoutPath"
Write-Output "STDERR: $stderrPath"
