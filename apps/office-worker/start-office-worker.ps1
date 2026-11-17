param(
  [Parameter(Mandatory)][string]$NodeExecutable,
  [Parameter(Mandatory)][string]$ConfigurationFile,
  [Parameter(Mandatory)][string]$LogDirectory,
  [switch]$Once
)
$ErrorActionPreference = 'Stop'
$officeWorkerRoot = [IO.Path]::GetFullPath($PSScriptRoot)
$officeNodePath = [IO.Path]::GetFullPath($NodeExecutable)
$officeConfigPath = [IO.Path]::GetFullPath($ConfigurationFile)
if (!(Test-Path -LiteralPath $officeNodePath -PathType Leaf)) { throw 'Review and supply the installed Node executable.' }
if (!(Test-Path -LiteralPath $officeConfigPath -PathType Leaf)) { throw 'Office-only configuration is required.' }
$officeConfig = Get-Content -Raw -LiteralPath $officeConfigPath | ConvertFrom-Json -AsHashtable
if ($officeConfig -isnot [System.Collections.IDictionary]) { throw 'Worker configuration must be a JSON object.' }
$officeAllowed = @('OFFICE_WORKER_DATABASE_URL','OFFICE_ENABLED','OFFICE_DEMO_WORKER','OFFICE_WORKER_CONCURRENCY','OFFICE_LIVE_WORKER','OFFICE_OPENAI_API_KEY','OFFICE_OPENAI_DRAFT_MODEL','OFFICE_OPENAI_PACKAGE_MODEL','OFFICE_OPENAI_REASONING_EFFORT')
foreach ($officeKey in $officeConfig.Keys) {
  if ($officeKey -cnotin $officeAllowed -or $officeConfig[$officeKey] -isnot [string]) { throw 'Use exact Office-only configuration keys with string values; website and owner secrets are forbidden.' }
}
if ($officeConfig.OFFICE_ENABLED -cne 'true' -or $officeConfig.OFFICE_DEMO_WORKER -cne 'true' -or !$officeConfig.OFFICE_WORKER_DATABASE_URL) { throw 'Demo worker requires deliberate activation and an Office-only database role.' }
if ($officeConfig.ContainsKey('OFFICE_WORKER_CONCURRENCY') -and $officeConfig.OFFICE_WORKER_CONCURRENCY -cnotmatch '^[1-4]$') { throw 'Office worker concurrency must be an integer from 1 to 4.' }
# Live execution is opt-in: its own switch plus an Office-only OpenAI key. The key is never printed.
$officeOpenAIKeys = @($officeConfig.Keys | Where-Object { $_ -clike 'OFFICE_OPENAI_*' })
if ($officeConfig.ContainsKey('OFFICE_LIVE_WORKER') -and ($officeConfig.OFFICE_LIVE_WORKER -cne 'true' -or $officeConfig.OFFICE_OPENAI_API_KEY -cnotmatch '^sk-[A-Za-z0-9_-]{20,400}$')) { throw 'Live worker requires OFFICE_LIVE_WORKER=true and an Office-only OpenAI API key.' }
if (!$officeConfig.ContainsKey('OFFICE_LIVE_WORKER') -and $officeOpenAIKeys.Count) { throw 'OpenAI settings are only accepted together with OFFICE_LIVE_WORKER=true.' }
$officeDatabaseUri = $null
if (![Uri]::TryCreate($officeConfig.OFFICE_WORKER_DATABASE_URL, [UriKind]::Absolute, [ref]$officeDatabaseUri) -or $officeDatabaseUri.Scheme -notin @('postgres','postgresql') -or !$officeDatabaseUri.Host -or $officeDatabaseUri.AbsolutePath.Length -lt 2) { throw 'A valid Office-only PostgreSQL database URL is required.' }
$officeLoader = Join-Path $officeWorkerRoot 'node_modules\tsx\dist\loader.mjs'
$officeEntry = Join-Path $officeWorkerRoot 'src\index.ts'
if (!(Test-Path -LiteralPath $officeLoader -PathType Leaf) -or !(Test-Path -LiteralPath $officeEntry -PathType Leaf)) { throw 'Install the reviewed Office worker dependencies before startup.' }
$officeLogs = [IO.Path]::TrimEndingDirectorySeparator([IO.Path]::GetFullPath($LogDirectory))
New-Item -ItemType Directory -Path $officeLogs -Force | Out-Null
# The child must not inherit an owner's temporary directory. This directory is
# inside the worker's explicitly writable log branch, never its immutable code.
$officeTemporaryDirectory = Join-Path $officeLogs 'temp'
New-Item -ItemType Directory -Path $officeTemporaryDirectory -Force | Out-Null
function Write-OfficeSupervisorEvent([string]$EventName, [int]$ExitCode = 0, [int]$DelaySeconds = 0) {
  # Fixed summaries only. Raw child stderr may contain URLs or credentials and is never persisted.
  $officeLine = (@{ at = [DateTime]::UtcNow.ToString('o'); event = $EventName; exitCode = $ExitCode; delaySeconds = $DelaySeconds } | ConvertTo-Json -Compress) + "`n"
  $officeFile = Join-Path $officeLogs 'office-supervisor.jsonl'
  if ((Test-Path -LiteralPath $officeFile) -and (Get-Item -LiteralPath $officeFile).Length + [Text.Encoding]::UTF8.GetByteCount($officeLine) -gt 2MB) {
    if (Test-Path -LiteralPath "$officeFile.previous") { Remove-Item -LiteralPath "$officeFile.previous" -Force }
    Move-Item -LiteralPath $officeFile -Destination "$officeFile.previous"
  }
  [IO.File]::AppendAllText($officeFile, $officeLine, [Text.UTF8Encoding]::new($false))
}
$officeBackoffs = @(5,15,60)
$officeAttempt = 0
for (;;) {
  $officeStart = [Diagnostics.ProcessStartInfo]::new()
  $officeStart.FileName = $officeNodePath
  $officeStart.WorkingDirectory = $officeWorkerRoot
  $officeStart.UseShellExecute = $false
  $officeStart.CreateNoWindow = $true
  # Direct import avoids a tsx CLI wrapper and leaves one explicitly owned Node process.
  $officeStart.ArgumentList.Add('--import')
  $officeStart.ArgumentList.Add(([Uri]$officeLoader).AbsoluteUri)
  $officeStart.ArgumentList.Add($officeEntry)
  if ($Once) { $officeStart.ArgumentList.Add('--once') }
  $officeStart.RedirectStandardInput = $true
  $officeStart.RedirectStandardOutput = $true
  $officeStart.RedirectStandardError = $true
  $officeStart.Environment.Clear()
  foreach ($officeSystemKey in @('SystemRoot','WINDIR')) {
    $officeSystemValue = [Environment]::GetEnvironmentVariable($officeSystemKey)
    if ($officeSystemValue) { $officeStart.Environment[$officeSystemKey] = $officeSystemValue }
  }
  $officeStart.Environment['TEMP'] = $officeTemporaryDirectory
  $officeStart.Environment['TMP'] = $officeTemporaryDirectory
  foreach ($officeKey in $officeAllowed) { if ($officeConfig.ContainsKey($officeKey)) { $officeStart.Environment[$officeKey] = [string]$officeConfig[$officeKey] } }
  $officeStart.Environment['OFFICE_WORKER_LOG_DIRECTORY'] = $officeLogs
  $officeStart.Environment['OFFICE_WORKER_SUPERVISED'] = 'true'
  $officeProcess = $null
  try {
    $officeProcess = [Diagnostics.Process]::Start($officeStart)
    # Drain pipes without retaining unbounded strings, exposing secrets or blocking the child.
    $officeOutput = $officeProcess.StandardOutput.BaseStream.CopyToAsync([IO.Stream]::Null)
    $officeError = $officeProcess.StandardError.BaseStream.CopyToAsync([IO.Stream]::Null)
    Write-OfficeSupervisorEvent 'child_started'
    while (!$officeProcess.WaitForExit(250)) { }
    $officeOutput.GetAwaiter().GetResult()
    $officeError.GetAwaiter().GetResult()
    $officeExitCode = $officeProcess.ExitCode
    Write-OfficeSupervisorEvent 'child_exited' $officeExitCode
  } finally {
    # Only this child receives a shutdown request. EOF also tells it that the supervisor died.
    if ($officeProcess -and !$officeProcess.HasExited) {
      try { $officeProcess.StandardInput.WriteLine('shutdown'); $officeProcess.StandardInput.Close() } catch { }
      if (!$officeProcess.WaitForExit(30000)) { $officeProcess.Kill($true); $officeProcess.WaitForExit(5000) | Out-Null }
    }
    if ($officeProcess) { $officeProcess.Dispose() }
  }
  if ($officeExitCode -eq 0) { break }
  # Single-pass verification never silently restarts a failed claim.
  if ($Once) { throw 'Office worker single pass failed. Inspect its fixed-code Office logs.' }
  $officeDelay = $officeBackoffs[[Math]::Min($officeAttempt,2)]
  Write-OfficeSupervisorEvent 'restart_scheduled' $officeExitCode $officeDelay
  Start-Sleep -Seconds $officeDelay
  $officeAttempt++
}
