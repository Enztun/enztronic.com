#requires -Version 7.0
[CmdletBinding()]
param(
  [Parameter(Mandatory)][string]$PreparationRoot,
  [switch]$Promote,
  [switch]$Rollback
)

# UI-only release controller. No database writes, environment edits, worker
# controls, task registration, model/provider activation or public-site action.
$ErrorActionPreference='Stop'
Set-StrictMode -Version Latest
if($Promote -and $Rollback){throw 'Choose promotion or rollback.'}
$uiApp='D:\Enztronic\apps\backoffice'
$uiRecoveryBase='C:\Users\hoyec\Enztronic-Recovery'
$uiRoot=[IO.Path]::TrimEndingDirectorySeparator([IO.Path]::GetFullPath($PreparationRoot))
$uiName=[IO.Path]::GetFileName($uiRoot)
if([IO.Path]::GetDirectoryName($uiRoot) -ine $uiRecoveryBase -or $uiName -notmatch '^ui-ux-release-20261108-[a-f0-9]{10}$'){throw 'Refused UI preparation root.'}
$uiSuffix=$uiName.Substring($uiName.Length-10)
$uiRelease=Join-Path $uiApp ('.runtime\releases\ui-ux-20261108-'+$uiSuffix)
$uiCurrent=Join-Path $uiApp '.next'
$uiCandidate=Join-Path $uiRelease 'candidate-build'
$uiPrevious=Join-Path $uiRelease 'working-build-before-ui'
$uiEnvironment=Join-Path $uiApp '.env.local'
$uiWorkerConfiguration='C:\ProgramData\EnztronicOffice\configuration\pending.json'
$uiData=Join-Path $uiApp '.runtime\postgres-data'
$uiPg='C:\Program Files\PostgreSQL\17\bin'
$uiOwnerSid=[Security.Principal.WindowsIdentity]::GetCurrent().User.Value
$uiAppTaskName='Enztronic Backoffice'
$uiWorkerTaskName='EnztronicOfficeWorker'

function Assert-UINoLink([string]$Target){
  $cursor=[IO.Path]::GetFullPath($Target)
  while($cursor){
    if(Test-Path -LiteralPath $cursor){
      if(([IO.File]::GetAttributes($cursor) -band [IO.FileAttributes]::ReparsePoint) -ne 0){throw 'UI release links are forbidden.'}
    }
    $cursor=[IO.Path]::GetDirectoryName($cursor)
  }
}
function Assert-UITreePath([string]$Target){
  $absolute=[IO.Path]::GetFullPath($Target)
  if($absolute -ine $uiCurrent -and [IO.Path]::GetDirectoryName($absolute) -ine $uiRelease){throw 'Build path escaped the exact UI release.'}
  Assert-UINoLink $absolute
}
function Get-UIHash([string]$File){(Get-FileHash -LiteralPath $File -Algorithm SHA256).Hash.ToLowerInvariant()}
function Read-UIJson([string]$File){Get-Content -LiteralPath $File -Raw|ConvertFrom-Json}
function Assert-UITrue($Value,[string]$Reason){if($Value -isnot [bool] -or !$Value){throw $Reason}}
function Get-UIBuildFiles([string]$Tree){
  Assert-UITreePath $Tree
  if(!(Test-Path -LiteralPath $Tree -PathType Container)){throw 'Complete build tree is missing.'}
  $pending=[Collections.Generic.Stack[string]]::new();$pending.Push($Tree)
  while($pending.Count){
    foreach($entry in [IO.DirectoryInfo]::new($pending.Pop()).EnumerateFileSystemInfos()){
      if(($entry.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0){throw 'Build tree contains a link.'}
      if(($entry.Attributes -band [IO.FileAttributes]::Directory) -ne 0){$pending.Push($entry.FullName)}
      else{[pscustomobject]@{path=[IO.Path]::GetRelativePath($Tree,$entry.FullName).Replace('\','/');bytes=$entry.Length;sha256=(Get-UIHash $entry.FullName)}}
    }
  }
}
function Assert-UIBuild([string]$Tree,$Manifest,[string]$BuildId){
  Assert-UITreePath $Tree
  if((Get-Content -LiteralPath (Join-Path $Tree 'BUILD_ID') -Raw).Trim() -cne $BuildId){throw 'Unexpected build identifier.'}
  $files=@(Get-UIBuildFiles $Tree)
  if(!$Manifest.Count -or $Manifest.Count -ne $files.Count){throw 'Build manifest file count differs.'}
  $index=[Collections.Generic.Dictionary[string,object]]::new([StringComparer]::OrdinalIgnoreCase)
  foreach($file in $files){$index.Add($file.path,$file)}
  $seen=[Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
  foreach($expected in $Manifest){
    $relative=[string]$expected.path
    if(!$relative -or [IO.Path]::IsPathRooted($relative) -or $relative.Contains(':') -or $relative.Contains('\') -or @($relative.Split('/')|Where-Object{$_ -in @('','.', '..')}).Count -or !$seen.Add($relative)){throw 'Invalid or duplicate relative build path.'}
    if([string]$expected.sha256 -notmatch '^[a-f0-9]{64}$' -or !$index.ContainsKey($relative)){throw 'Incomplete build manifest.'}
    $actual=$index[$relative]
    if($expected.bytes -isnot [long] -and $expected.bytes -isnot [int]){throw 'Build manifest needs exact file lengths.'}
    if([long]$expected.bytes -ne $actual.bytes -or $expected.sha256 -cne $actual.sha256){throw 'Build bytes differ from the validated manifest.'}
  }
}
function Move-UIBuild([string]$Source,[string]$Destination){
  Assert-UITreePath $Source;Assert-UITreePath $Destination
  if(!(Test-Path -LiteralPath $Source -PathType Container) -or (Test-Path -LiteralPath $Destination)){throw 'Atomic build move requires an existing source and a new destination.'}
  # Every move stays on D: inside the app's exact current/release directories.
  [IO.Directory]::Move($Source,$Destination)
}
function Read-UIManifest([string]$Name,[string]$Hash,[int]$Count){
  $file=Join-Path $uiRelease $Name
  Assert-UINoLink $file
  if($Hash -notmatch '^[a-f0-9]{64}$' -or (Get-UIHash $file) -cne $Hash){throw 'Manifest changed since preparation.'}
  $manifest=@(Read-UIJson $file)
  if($Count -lt 1 -or $manifest.Count -ne $Count){throw 'Prepared manifest count differs.'}
  return ,$manifest
}
function Get-UITask([string]$Name){$uiFolder.GetTask($Name)}
function Resolve-UISid([string]$Account){
  if($Account -match '^S-1-'){return [Security.Principal.SecurityIdentifier]::new($Account).Value}
  return [Security.Principal.NTAccount]::new($Account).Translate([Security.Principal.SecurityIdentifier]).Value
}
function Assert-UIProtectedState([switch]$DuringFence){
  if((Get-UIHash $uiEnvironment) -cne $uiContext.environmentSha256 -or (Get-UIHash $uiSavedEnvironment) -cne $uiContext.environmentSha256){throw 'Application environment changed since the protected backup.'}
  if((Get-UIHash $uiWorkerConfiguration) -cne (Get-UIHash $uiSavedWorker)){throw 'Worker configuration changed; no configuration is overwritten.'}
  $appTask=Get-UITask $uiAppTaskName
  $expectedAppXml=[IO.File]::ReadAllText($uiSavedAppTask)
  # Task Scheduler canonicalizes defaults/formatting when XmlText is loaded.
  # Normalize both sides in memory rather than comparing one normalized side
  # with a raw saved string. This never registers either definition.
  $definition=$uiScheduler.NewTask(0);$definition.XmlText=$appTask.Xml
  $expectedDefinition=$uiScheduler.NewTask(0);$expectedDefinition.XmlText=$expectedAppXml
  if($DuringFence){
    # Compare an in-memory task definition while the only intended difference is
    # its temporary Enabled=false fence. Nothing is re-registered or persisted.
    $definition.Settings.Enabled=$true;$expectedDefinition.Settings.Enabled=$true
    if($definition.XmlText -cne $expectedDefinition.XmlText){throw 'Backoffice startup definition changed.'}
  }elseif($definition.XmlText -cne $expectedDefinition.XmlText -or !$appTask.Enabled){throw 'Backoffice startup definition or enabled state changed.'}
  $workerTask=Get-UITask $uiWorkerTaskName
  if($workerTask.Xml -cne [IO.File]::ReadAllText($uiSavedWorkerTask) -or !$workerTask.Enabled){throw 'Office worker task changed; the UI release does not control it.'}
}
function Get-UIListener([int]$Port){
  $listeners=@(Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue)
  if($listeners.Count -gt 1 -or @($listeners|Where-Object{$_.LocalAddress -ne '127.0.0.1'}).Count){throw 'Unexpected listener binding; no process stopped.'}
  if($listeners.Count){return $listeners[0]}
  return $null
}
function Get-UINodeIdentity {
  $listener=Get-UIListener 3100
  if(!$listener){return $null}
  $process=Get-CimInstance Win32_Process -Filter ('ProcessId='+$listener.OwningProcess)
  $owner=Invoke-CimMethod -InputObject $process -MethodName GetOwnerSid
  if([IO.Path]::GetFileName($process.ExecutablePath) -ine 'node.exe' -or $owner.Sid -ne $uiOwnerSid){throw 'Unexpected owner or executable on 3100; no process stopped.'}
  [pscustomobject]@{id=[int]$listener.OwningProcess;started=(Get-Process -Id $listener.OwningProcess -ErrorAction Stop).StartTime.ToFileTimeUtc()}
}
function Assert-UIQuiescent {
  $evidenceFile=Join-Path $uiRoot 'quiescence-verification.json';Assert-UINoLink $evidenceFile
  $evidence=Read-UIJson $evidenceFile
  Assert-UITrue $evidence.quiescent 'Owner work is not quiescent.'
  if($evidence.open_tasks -ne 0 -or $evidence.leased_steps -ne 0 -or $evidence.open_runs -ne 0){throw 'Open Office work prevents a UI promotion.'}
  # PowerShell 7.5+ converts ISO JSON timestamps to DateTime automatically.
  # Casting preserves its UTC Kind; Parse would stringify it and lose the zone.
  $age=([DateTimeOffset]::UtcNow-[DateTimeOffset]$evidence.checkedAtUtc).TotalSeconds
  if($age -lt 0 -or $age -gt 120){throw 'Fresh read-only production quiescence evidence is required.'}
  # Re-run the reviewed, target-pinned READ ONLY helper at the final boundary.
  # Its stderr remains private; neither DATABASE_URL nor a credential is emitted.
  $helper='D:\Enztronic\apps\office-worker\read-worker-quiescence.mjs'
  Assert-UINoLink $helper
  if($uiContext.quiescenceHelperSha256 -notmatch '^[a-f0-9]{64}$' -or (Get-UIHash $helper) -cne $uiContext.quiescenceHelperSha256){throw 'Reviewed quiescence helper changed.'}
  $node='C:\ProgramData\EnztronicOffice\tools\node.exe';Assert-UINoLink $node
  $output=& $node $helper 2>(Join-Path $uiRoot ('ui-quiescence-'+$uiAttempt+'.private.log'))
  if($LASTEXITCODE -ne 0){throw 'Live read-only quiescence check refused promotion.'}
  try{$live=($output -join [Environment]::NewLine)|ConvertFrom-Json}catch{throw 'Invalid live quiescence response.'}
  Assert-UITrue $live.quiescent 'Owner work became active before promotion.'
  if($live.open_tasks -ne 0 -or $live.leased_steps -ne 0 -or $live.open_runs -ne 0){throw 'Open Office work prevents a UI promotion.'}
}
function Stop-UIBackoffice {
  $owned=Get-UINodeIdentity
  $appTask=Get-UITask $uiAppTaskName
  $appTask.Enabled=$false
  # The original task owns this dedicated PostgreSQL child. Stop its exact data
  # directory cleanly before stopping the conhost/npm task, as rehearsed earlier.
  & (Join-Path $uiPg 'pg_ctl.exe') status -D $uiData *> $null
  if($LASTEXITCODE -eq 0){
    & (Join-Path $uiPg 'pg_ctl.exe') stop -D $uiData -m fast -w -t 30 *> $null
    if($LASTEXITCODE -ne 0){throw 'Dedicated PostgreSQL did not stop cleanly.'}
  }elseif(Get-UIListener 54329){throw 'Unexpected database listener; no foreign process stopped.'}
  if($appTask.State -in @(2,4) -or $appTask.GetInstances(0).Count -gt 0){$appTask.Stop(0)}
  Start-Sleep -Seconds 2
  $remaining=Get-UIListener 3100
  if($remaining){
    $currentIdentity=Get-UINodeIdentity
    if(!$owned -or $currentIdentity.id -ne $owned.id -or $currentIdentity.started -ne $owned.started){throw 'Backoffice listener identity changed; no process stopped.'}
    Stop-Process -Id $owned.id -ErrorAction Stop
  }
  $deadline=[DateTime]::UtcNow.AddSeconds(45)
  while([DateTime]::UtcNow -lt $deadline){
    $appTask=Get-UITask $uiAppTaskName
    if(!(Get-UIListener 3100) -and !(Get-UIListener 54329) -and $appTask.State -notin @(2,4)){break}
    Start-Sleep -Milliseconds 250
  }
  if((Get-UIListener 3100) -or (Get-UIListener 54329) -or (Get-UITask $uiAppTaskName).State -in @(2,4)){throw 'Backoffice shutdown is incomplete; no build replaced.'}
  Assert-UIProtectedState -DuringFence
}
function Start-UIBackoffice([string]$ExpectedBuild){
  if((Get-Content -LiteralPath (Join-Path $uiCurrent 'BUILD_ID') -Raw).Trim() -cne $ExpectedBuild){throw 'Wrong build before startup.'}
  Assert-UIProtectedState -DuringFence
  $appTask=Get-UITask $uiAppTaskName;$appTask.Enabled=$true
  Assert-UIProtectedState
  $null=$appTask.Run($null)
  $deadline=[DateTime]::UtcNow.AddSeconds(60);$ready=$false
  while([DateTime]::UtcNow -lt $deadline){
    try{$response=Invoke-WebRequest -Uri 'http://127.0.0.1:3100/robots.txt' -TimeoutSec 2;$ready=$response.StatusCode -eq 200}catch{}
    if($ready){break};Start-Sleep -Milliseconds 500
  }
  if(!$ready){throw 'Backoffice did not become ready.'}
  $identity=Get-UINodeIdentity
  if(!$identity){throw 'Expected owner-owned local listener is missing.'}
  & (Join-Path $uiPg 'pg_isready.exe') -h 127.0.0.1 -p 54329 -t 3 *> $null
  if($LASTEXITCODE -ne 0){throw 'Intended local database is not ready.'}
  Assert-UIProtectedState
}
function Save-UIReceipt([string]$Name,$Value){
  $target=Join-Path $uiRoot $Name;Assert-UINoLink $target
  if(Test-Path -LiteralPath $target){throw 'Receipt destination already exists.'}
  [IO.File]::WriteAllText($target,($Value|ConvertTo-Json -Depth 8)+[Environment]::NewLine,[Text.UTF8Encoding]::new($false))
}

Assert-UINoLink $uiRoot;Assert-UINoLink $uiRelease;Assert-UINoLink $uiData
$uiContextFile=Join-Path $uiRoot 'ui-release-context.json';Assert-UINoLink $uiContextFile
$uiContext=Read-UIJson $uiContextFile
foreach($key in @('ownerAuthorizedUiFix','browserVerificationPassed','webpackBuildPassed','baselineBusinessVerificationPassed')){Assert-UITrue $uiContext.$key ('Missing reviewed UI gate: '+$key)}
if([IO.Path]::GetFullPath($uiContext.releaseRoot) -ine $uiRelease -or $uiContext.previousBuildId -notmatch '^[A-Za-z0-9_-]{1,100}$' -or $uiContext.acceptedBuildId -notmatch '^[A-Za-z0-9_-]{1,100}$' -or $uiContext.acceptedBuildId -ceq $uiContext.previousBuildId -or $uiContext.environmentSha256 -notmatch '^[a-f0-9]{64}$'){throw 'Invalid scoped UI release context.'}
$uiBefore=Join-Path $uiRoot 'protected-before'
$uiSavedEnvironment=Join-Path $uiBefore 'backoffice.env.local'
$uiSavedWorker=Join-Path $uiBefore 'office-worker.json'
$uiSavedAppTask=Join-Path $uiBefore 'backoffice-task.xml'
$uiSavedWorkerTask=Join-Path $uiBefore 'office-worker-task.xml'
foreach($file in @($uiEnvironment,$uiWorkerConfiguration,$uiSavedEnvironment,$uiSavedWorker,$uiSavedAppTask,$uiSavedWorkerTask)){Assert-UINoLink $file;if(!(Test-Path -LiteralPath $file -PathType Leaf)){throw 'Protected configuration or task backup is missing.'}}
$uiManifest=Read-UIManifest 'validated-build-files.json' $uiContext.manifestSha256 $uiContext.buildFileCount
$uiPreviousManifest=Read-UIManifest 'previous-build-files.json' $uiContext.previousManifestSha256 $uiContext.previousBuildFileCount
$uiScheduler=New-Object -ComObject 'Schedule.Service';$uiScheduler.Connect();$uiFolder=$uiScheduler.GetFolder('\')
$uiTask=Get-UITask $uiAppTaskName
if((Resolve-UISid $uiTask.Definition.Principal.UserId) -ne $uiOwnerSid -or $uiTask.Definition.Principal.LogonType -ne 3 -or $uiTask.Definition.Actions.Count -ne 1 -or !$uiTask.Definition.Actions.Item(1).Arguments.Contains('start-backoffice.ps1')){throw 'Only the existing owner-interactive backoffice startup task is permitted.'}
Assert-UIProtectedState
if($Rollback){
  # A served build may acquire Next's runtime cache files. Its known identifier
  # and link-free tree suffice here because rollback retains it whole, while the
  # frozen known-working previous build must still match its exact full manifest.
  if((Get-Content -LiteralPath (Join-Path $uiCurrent 'BUILD_ID') -Raw).Trim() -cne $uiContext.acceptedBuildId){throw 'Unexpected current UI build for rollback.'}
  $null=@(Get-UIBuildFiles $uiCurrent)
  Assert-UIBuild $uiPrevious $uiPreviousManifest $uiContext.previousBuildId
}else{
  if(Test-Path -LiteralPath $uiPrevious){throw 'Previous-build destination already exists; no overwrite permitted.'}
  Assert-UIBuild $uiCurrent $uiPreviousManifest $uiContext.previousBuildId
  Assert-UIBuild $uiCandidate $uiManifest $uiContext.acceptedBuildId
}
if(!$Promote -and !$Rollback){
  @{mode='plan_only';preparationRoot=$uiRoot;acceptedBuildId=$uiContext.acceptedBuildId;previousBuildId=$uiContext.previousBuildId;verifiedFiles=$uiManifest.Count;configurationChanges=0;databaseWrites=0;workerTaskChanges=0;requiresFreshQuiescenceEvidence=$true}|ConvertTo-Json -Compress
  return
}

$uiAttempt=[guid]::NewGuid().ToString('N')
$uiLock=$null;$uiStopped=$false;$uiMoved=$false;$uiNewCurrent=$false;$uiRestored=$false;$uiRecoveryReady=$false
$uiFrom=if($Rollback){$uiPrevious}else{$uiCandidate}
$uiFromBuild=if($Rollback){$uiContext.previousBuildId}else{$uiContext.acceptedBuildId}
$uiFromManifest=if($Rollback){$uiPreviousManifest}else{$uiManifest}
$uiOldBuild=if($Rollback){$uiContext.acceptedBuildId}else{$uiContext.previousBuildId}
$uiOldManifest=if($Rollback){$uiManifest}else{$uiPreviousManifest}
$uiBackup=if($Rollback){Join-Path $uiRelease ('retained-ui-candidate-'+$uiAttempt)}else{$uiPrevious}
$uiFailed=Join-Path $uiRelease ('failed-ui-build-'+$uiAttempt)
try{
  $uiLockFile=Join-Path $uiRoot 'publish.lock';Assert-UINoLink $uiLockFile
  $uiLock=[IO.File]::Open($uiLockFile,[IO.FileMode]::OpenOrCreate,[IO.FileAccess]::ReadWrite,[IO.FileShare]::None)
  Assert-UIProtectedState;Assert-UIQuiescent
  $uiStopped=$true;Stop-UIBackoffice
  if($Rollback){$uiOldManifest=@(Get-UIBuildFiles $uiCurrent)}
  Move-UIBuild $uiCurrent $uiBackup;$uiMoved=$true
  Move-UIBuild $uiFrom $uiCurrent;$uiNewCurrent=$true
  Assert-UIBuild $uiCurrent $uiFromManifest $uiFromBuild
  Start-UIBackoffice $uiFromBuild
  $receipt=@{passed=$true;operation=$(if($Rollback){'rollback'}else{'promote'});clientDate='2026-11-08';machineUtc=[DateTime]::UtcNow.ToString('o');buildId=$uiFromBuild;verifiedFiles=$uiFromManifest.Count;retainedPreviousBuild=$uiBackup;environmentUnchanged=$true;workerConfigurationUnchanged=$true;startupDefinitionUnchanged=$true;workerTaskUnchanged=$true;databaseWrites=0;databaseRestore=$false;developmentBypassChanged=$false;ownerBrowserAcceptance='separate-after-promotion'}
  Save-UIReceipt ('ui-'+$receipt.operation+'-'+$uiAttempt+'.json') $receipt
  $receipt|ConvertTo-Json -Depth 8 -Compress
}catch{
  $uiFailure=$_.Exception.GetType().Name
  # Keep detailed diagnostics private and never emit configuration or credentials.
  try{Save-UIReceipt ('ui-error-'+$uiAttempt+'.private.json') @{failureType=$uiFailure;message=$_.Exception.Message;machineUtc=[DateTime]::UtcNow.ToString('o')}}catch{}
  $uiRecoveryFailure=$null
  try{
    if($uiMoved){
      Stop-UIBackoffice
      if(Test-Path -LiteralPath $uiCurrent){Move-UIBuild $uiCurrent $uiFailed}
      Move-UIBuild $uiBackup $uiCurrent;$uiRestored=$true
      Assert-UIBuild $uiCurrent $uiOldManifest $uiOldBuild
      Start-UIBackoffice $uiOldBuild;$uiRecoveryReady=$true
    }elseif($uiStopped){
      # A shutdown failure before the first rename still needs the old task's
      # Enabled flag restored. Never delete, reseed or restore database contents.
      $uiTask=Get-UITask $uiAppTaskName;$uiTask.Enabled=$true
      if(!(Get-UIListener 3100)){Start-UIBackoffice $uiOldBuild}
      Assert-UIProtectedState;$uiRecoveryReady=$true
    }
  }catch{$uiRecoveryFailure=$_.Exception.GetType().Name}
  $failure=@{passed=$false;operation=$(if($Rollback){'rollback'}else{'promote'});failureType=$uiFailure;buildMoveStarted=$uiMoved;previousBuildRestored=$uiRestored;previousServiceReady=$uiRecoveryReady;recoveryFailureType=$uiRecoveryFailure;databaseRestore=$false;environmentEdited=$false;workerTaskEdited=$false;failedBuild=$(if(Test-Path -LiteralPath $uiFailed){$uiFailed}else{$null})}
  Save-UIReceipt ('ui-failure-'+$uiAttempt+'.json') $failure
  $failure|ConvertTo-Json -Compress
  throw 'UI release failed; inspect protected receipt and startup logs. No database or environment rollback was performed.'
}finally{
  if($uiLock){$uiLock.Dispose()}
  # Restore only this exact task's original enabled state; never register it.
  if($uiStopped){$uiTask=Get-UITask $uiAppTaskName;$uiTask.Enabled=$true}
}
