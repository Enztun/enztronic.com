param([Parameter(Mandatory)][string]$ActivationRoot,[switch]$Rollback)
$ErrorActionPreference='Stop'
Set-StrictMode -Version Latest
$app='D:\Enztronic\apps\backoffice'
$root=[IO.Path]::TrimEndingDirectorySeparator([IO.Path]::GetFullPath($ActivationRoot))
if([IO.Path]::GetDirectoryName($root) -ine 'C:\Users\hoyec\Enztronic-Recovery' -or [IO.Path]::GetFileName($root) -notmatch '^production-prep-20261108-[a-f0-9]{10}$'){throw 'Refused activation root.'}
$context=Get-Content -LiteralPath (Join-Path $root 'activation-context.json') -Raw|ConvertFrom-Json
$release=[IO.Path]::GetFullPath($context.releaseRoot)
$expected=Join-Path $app ('.runtime\releases\office-activation-20261108-'+[IO.Path]::GetFileName($root).Substring(25))
if(!$context.ownerAuthorizedStep3And4 -or $release -ine $expected){throw 'Scoped activation authority required.'}
$current=Join-Path $app '.next';$staged=Join-Path $release 'candidate-build';$previous=Join-Path $release 'working-build-before-office'
foreach($target in @($current,$staged,$previous)){
  $absolute=[IO.Path]::GetFullPath($target)
  if(!$absolute.StartsWith($app+'\',[StringComparison]::OrdinalIgnoreCase)){throw 'Build target escaped application.'}
  if((Test-Path -LiteralPath $absolute) -and ((Get-Item -LiteralPath $absolute).Attributes -band [IO.FileAttributes]::ReparsePoint)){throw 'Build links are forbidden.'}
}
$pg='C:\Program Files\PostgreSQL\17\bin';$data=Join-Path $app '.runtime\postgres-data'
$environment=Join-Path $app '.env.local';$savedEnvironment=Join-Path $root 'protected-before\backoffice.env.local'
$service=New-Object -ComObject 'Schedule.Service';$service.Connect();$task=$service.GetFolder('\').GetTask('Enztronic Backoffice')
if($task.Definition.Actions.Count -ne 1 -or !$task.Definition.Actions.Item(1).Arguments.Contains('start-backoffice.ps1')){throw 'Unexpected backoffice startup action.'}
function OfficeListener([int]$Port){$null -ne (Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue|Select-Object -First 1)}
function StopBackoffice {
  $listener=Get-NetTCPConnection -LocalPort 3100 -State Listen -ErrorAction SilentlyContinue|Select-Object -First 1
  $ownedPid=$null;$ownedStart=$null
  if($listener){
    $process=Get-CimInstance Win32_Process -Filter ('ProcessId='+$listener.OwningProcess)
    $owner=Invoke-CimMethod -InputObject $process -MethodName GetOwnerSid
    if([IO.Path]::GetFileName($process.ExecutablePath) -ine 'node.exe' -or $owner.Sid -ne [Security.Principal.WindowsIdentity]::GetCurrent().User.Value){throw 'Unexpected owner/executable on backoffice port; no process stopped.'}
    $ownedPid=[int]$listener.OwningProcess;$ownedStart=(Get-Process -Id $ownedPid).StartTime.ToFileTimeUtc()
  }
  # Fence scheduler retries during the complete build/environment swap.
  $task.Enabled=$false
  # Stop this dedicated cluster cleanly before the task job can terminate its
  # PostgreSQL child. This prevents an abrupt postmaster stop/recovery race.
  & (Join-Path $pg 'pg_ctl.exe') status -D $data *> $null
  if($LASTEXITCODE -eq 0){
    & (Join-Path $pg 'pg_ctl.exe') stop -D $data -m fast -w -t 30 *> $null
    if($LASTEXITCODE -ne 0){throw 'Dedicated PostgreSQL clean stop failed.'}
  }
  if($task.State -in @(2,4) -or $task.GetInstances(0).Count -gt 0){$task.Stop(0)}
  # The existing conhost/npm task can leave its Next child behind while stopping
  # PostgreSQL. Only the captured owner-owned node listener is eligible here.
  Start-Sleep -Seconds 2
  $remaining=Get-NetTCPConnection -LocalPort 3100 -State Listen -ErrorAction SilentlyContinue|Select-Object -First 1
  if($remaining){
    if(!$ownedPid -or $remaining.OwningProcess -ne $ownedPid -or (Get-Process -Id $ownedPid).StartTime.ToFileTimeUtc() -ne $ownedStart){throw 'Backoffice listener identity changed; no process stopped.'}
    Stop-Process -Id $ownedPid -ErrorAction Stop
  }
  $deadline=[DateTime]::UtcNow.AddSeconds(45)
  while(((OfficeListener 3100) -or $task.State -in @(2,4)) -and [DateTime]::UtcNow -lt $deadline){Start-Sleep -Milliseconds 250}
  if((OfficeListener 3100) -or $task.State -in @(2,4)){throw 'Backoffice did not stop; no build replaced.'}
  # Task shutdown can include its PostgreSQL child. Give that shutdown time to
  # finish before the unchanged startup script attempts pg_ctl/start again.
  $deadline=[DateTime]::UtcNow.AddSeconds(35)
  while((OfficeListener 54329) -and [DateTime]::UtcNow -lt $deadline){Start-Sleep -Milliseconds 500}
  if(OfficeListener 54329){
    & (Join-Path $pg 'pg_ctl.exe') status -D $data *> $null
    if($LASTEXITCODE -ne 0){throw 'Unexpected PostgreSQL listener after task stop.'}
    & (Join-Path $pg 'pg_isready.exe') -h 127.0.0.1 -p 54329 -t 3 *> $null
    if($LASTEXITCODE -ne 0){throw 'Existing intended PostgreSQL is still shutting down.'}
  }
}
function WriteOfficeEnvironment([string]$Value){
  $temporary=$environment+'.office-activation-'+[IO.Path]::GetFileName($root).Substring(25)
  if(Test-Path -LiteralPath $temporary){throw 'Environment staging destination already exists.'}
  [IO.File]::WriteAllText($temporary,$Value,[Text.UTF8Encoding]::new($false))
  Set-Acl -LiteralPath $temporary -AclObject (Get-Acl -LiteralPath $environment)
  # Use the explicit overwrite overload; PowerShell can coerce the nullable
  # backup argument of File.Replace to an invalid empty pathname.
  [IO.File]::Move($temporary,$environment,$true)
}
function StartBackoffice {
  $task.Enabled=$true
  $null=$task.Run($null)
  $deadline=[DateTime]::UtcNow.AddSeconds(60);$ready=$false
  while([DateTime]::UtcNow -lt $deadline){
    try{$response=Invoke-WebRequest -Uri 'http://127.0.0.1:3100/robots.txt' -TimeoutSec 2;$ready=$response.StatusCode -eq 200}catch{}
    if($ready){break};Start-Sleep -Milliseconds 500
  }
  if(!$ready){throw 'Backoffice did not become ready.'}
}
if($Rollback){
  if(!(Test-Path -LiteralPath $previous)){throw 'Known-working rollback build is missing.'}
  if((Get-Content -LiteralPath (Join-Path $previous 'BUILD_ID') -Raw).Trim() -cne $context.previousBuildId){throw 'Wrong rollback build.'}
  StopBackoffice
  if(Test-Path -LiteralPath $current){$failed=Join-Path $release ('disabled-office-build-'+[guid]::NewGuid().ToString('N'));Move-Item -LiteralPath $current -Destination $failed}
  Move-Item -LiteralPath $previous -Destination $current
  WriteOfficeEnvironment ([IO.File]::ReadAllText($savedEnvironment))
  StartBackoffice
  @{rolledBack=$true;buildId=$context.previousBuildId;officeEnabled=$false;databaseRestored=$false}|ConvertTo-Json|Set-Content -LiteralPath (Join-Path $root 'application-rollback.json') -Encoding utf8
  return
}
$role=Get-Content -LiteralPath (Join-Path $root 'role-result.json') -Raw|ConvertFrom-Json
if(!$role.passed -or !(Test-Path -LiteralPath $staged) -or (Test-Path -LiteralPath $previous)){throw 'Promotion prerequisites failed.'}
if((Get-Content (Join-Path $current 'BUILD_ID') -Raw).Trim() -cne $context.previousBuildId -or (Get-Content (Join-Path $staged 'BUILD_ID') -Raw).Trim() -cne $context.acceptedBuildId){throw 'Unexpected current/candidate build.'}
$manifest=Get-Content -LiteralPath (Join-Path $release 'validated-build-files.json') -Raw|ConvertFrom-Json
foreach($file in $manifest){if((Get-FileHash -LiteralPath (Join-Path $staged $file.path) -Algorithm SHA256).Hash -ine $file.sha256){throw 'Staged build changed.'}}
$old=[IO.File]::ReadAllText($environment)
if((Get-FileHash -LiteralPath $environment -Algorithm SHA256).Hash -ine (Get-FileHash -LiteralPath $savedEnvironment -Algorithm SHA256).Hash){throw 'Production environment changed since backup.'}
$keys=[regex]::Matches($old,'(?m)^[ \t]*OFFICE_ENABLED[ \t]*=')
if($keys.Count -gt 1){throw 'Duplicate Office flag requires review.'}
if($keys.Count -eq 1){$updated=[regex]::Replace($old,'(?m)^[ \t]*OFFICE_ENABLED[ \t]*=[^\r\n]*','OFFICE_ENABLED=true')}
else{$newline=if($old.Contains("`r`n")){"`r`n"}else{"`n"};$updated=$old+$(if($old.EndsWith("`n")){''}else{$newline})+'OFFICE_ENABLED=true'+$newline}
$moved=$false;$stopped=$false
try{
  $stopped=$true;StopBackoffice
  Move-Item -LiteralPath $current -Destination $previous;$moved=$true
  Move-Item -LiteralPath $staged -Destination $current
  WriteOfficeEnvironment $updated
  foreach($file in $manifest){if((Get-FileHash -LiteralPath (Join-Path $current $file.path) -Algorithm SHA256).Hash -ine $file.sha256){throw 'Promoted build mismatch.'}}
  StartBackoffice
  @{passed=$true;clientDate='2026-11-08';buildId=$context.acceptedBuildId;verifiedFiles=$manifest.Count;rollbackBuild=$previous;officeEnabled=$true;developmentBypass=$false;startupArrangementUnchanged=$true}|ConvertTo-Json|Set-Content -LiteralPath (Join-Path $root 'promotion-result.json') -Encoding utf8
  @{passed=$true;buildId=$context.acceptedBuildId;verifiedFiles=$manifest.Count;officeEnabled=$true}|ConvertTo-Json -Compress
}catch{
  $failure=$_.Exception.GetType().Name
  $_.Exception.Message|Set-Content -LiteralPath (Join-Path $root 'promotion-error.private.txt') -Encoding utf8
  $pendingEnvironment=$environment+'.office-activation-'+[IO.Path]::GetFileName($root).Substring(25)
  if(Test-Path -LiteralPath $pendingEnvironment){Remove-Item -LiteralPath $pendingEnvironment}
  if($moved){
    if(OfficeListener 3100){$task.Stop(0);Start-Sleep -Seconds 2}
    if(Test-Path -LiteralPath $current){$failed=Join-Path $release ('failed-candidate-'+[guid]::NewGuid().ToString('N'));Move-Item -LiteralPath $current -Destination $failed}
    if(Test-Path -LiteralPath $previous){Move-Item -LiteralPath $previous -Destination $current}
    WriteOfficeEnvironment ([IO.File]::ReadAllText($savedEnvironment))
  }
  $task.Enabled=$true
  if($stopped -and !(OfficeListener 3100)){try{StartBackoffice}catch{}}
  @{passed=$false;failureType=$failure;applicationRollbackAttempted=$moved;databaseRollback=$false}|ConvertTo-Json|Set-Content -LiteralPath (Join-Path $root 'promotion-failure.json') -Encoding utf8
  throw 'Promotion failed; inspect protected evidence and existing startup logs.'
}
