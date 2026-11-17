param(
  [Parameter(Mandatory)][string]$PreparationRoot,
  [switch]$Install,
  [switch]$Resume
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$officeDestination = 'C:\ProgramData\EnztronicOffice'
$officeProject = 'D:\Enztronic'
$officeAccountName = 'EnztronicOfficeSvc'
$officeTaskName = 'EnztronicOfficeWorker'
$officeStage = [IO.Path]::TrimEndingDirectorySeparator([IO.Path]::GetFullPath($PreparationRoot))
$officeStageBase = 'C:\Users\hoyec\Enztronic-Worker-Preparation'
if ([IO.Path]::GetDirectoryName($officeStage) -ine $officeStageBase -or [IO.Path]::GetFileName($officeStage) -notmatch '^step2-20261108-[a-f0-9]{10}$') { throw 'Refused preparation source.' }
if ((Get-Item -LiteralPath $officeStage).Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Preparation source must not be a link.' }
$officeRuntimeSource = Join-Path $officeStage 'runtime'
$officePowerShellSource = Join-Path $officeStage 'powershell'
$officeOwnerSid = [Security.Principal.WindowsIdentity]::GetCurrent().User
$officePreparedOwner = Get-Content -LiteralPath (Join-Path $officeStage 'preparation-owner.json') -Raw | ConvertFrom-Json
if ($officePreparedOwner.ownerSid -ne $officeOwnerSid.Value) { throw 'Use the original owner account for elevation; recovery credentials must remain owner-decryptable.' }
$officeAdministrator = New-Object Security.Principal.SecurityIdentifier('S-1-5-32-544')
$officeSystem = New-Object Security.Principal.SecurityIdentifier('S-1-5-18')
$officeManifestFile = Join-Path $officeRuntimeSource 'runtime-manifest.json'
$officeManifestHash = (Get-Content -LiteralPath (Join-Path $officeRuntimeSource 'runtime-manifest.sha256') -Raw).Trim()
if ((Get-FileHash -LiteralPath $officeManifestFile -Algorithm SHA256).Hash -ine $officeManifestHash) { throw 'Prepared runtime manifest mismatch.' }
$officeManifest = Get-Content -LiteralPath $officeManifestFile -Raw | ConvertFrom-Json
$officePowerShell = Get-Content -LiteralPath (Join-Path $officeStage 'powershell-verification.json') -Raw | ConvertFrom-Json
if (!$officePowerShell.OfficialChecksumMatched -or !$officePowerShell.SignatureValid -or (Get-AuthenticodeSignature -LiteralPath (Join-Path $officePowerShellSource 'pwsh.exe')).Status -ne 'Valid') { throw 'Reviewed PowerShell verification required.' }
if (!$Install) {
  @{ mode='plan_only'; preparation=$officeStage; destination=$officeDestination; account=$officeAccountName; finalAccountEnabled=$false; workerTaskEnabled=$false; productionDatabaseChanges=$false; migration003=$false; runtimeManifestSha256=$officeManifestHash; elevatedAdministratorRequired=$true; validation='Harmless temporary batch identity probe only; no Office claims or production database connection.' } | ConvertTo-Json -Compress
  return
}
if (!(New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) { throw 'An elevated administrator process is required to install the reviewed worker identity and disabled task.' }

function Set-OfficeDirectoryAccess([string]$Path,[Security.Principal.SecurityIdentifier]$WorkerSid,[Security.AccessControl.FileSystemRights]$WorkerRights=0) {
  $acl=New-Object Security.AccessControl.DirectorySecurity
  $acl.SetAccessRuleProtection($true,$false);$acl.SetOwner($officeOwnerSid)
  foreach($sid in @($officeOwnerSid,$officeSystem,$officeAdministrator)) {
    $acl.AddAccessRule((New-Object Security.AccessControl.FileSystemAccessRule($sid,'FullControl','ContainerInherit,ObjectInherit','None','Allow')))
  }
  if($WorkerSid -and $WorkerRights -ne 0) { $acl.AddAccessRule((New-Object Security.AccessControl.FileSystemAccessRule($WorkerSid,$WorkerRights,'ContainerInherit,ObjectInherit','None','Allow'))) }
  Set-Acl -LiteralPath $Path -AclObject $acl
}
function Add-OfficeDeny([string]$Path,[Security.Principal.SecurityIdentifier]$Sid,[bool]$Directory) {
  $acl=Get-Acl -LiteralPath $Path
  if($Directory) {$rule=New-Object Security.AccessControl.FileSystemAccessRule($Sid,'FullControl','ContainerInherit,ObjectInherit','None','Deny')}
  else {$rule=New-Object Security.AccessControl.FileSystemAccessRule($Sid,'FullControl','Deny')}
  $acl.AddAccessRule($rule);Set-Acl -LiteralPath $Path -AclObject $acl
}
function Copy-OfficeTree([string]$From,[string]$To) {
  if(Test-Path -LiteralPath $To){throw 'Installation copy destination already exists.'}
  if(@(Get-ChildItem -LiteralPath $From -Force -Recurse -Attributes ReparsePoint).Count){throw 'Installation input must contain actual files, not links.'}
  New-Item -ItemType Directory -Path $To | Out-Null
  & robocopy.exe $From $To /E /XJ /NFL /NDL /NJH /NJS /NP | Out-Null
  if($LASTEXITCODE -ge 8){throw 'Installation copy failed.'}
}
function Write-OfficeReceipt([hashtable]$Data) {
  $Data.clientDate='2026-11-08';$Data.machineUtc=[DateTime]::UtcNow.ToString('o')
  $Data | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath (Join-Path $officeStage 'host-installation-result.json') -Encoding utf8
}
function Test-OfficeMissingTask($ErrorRecord) {
  $exception=$ErrorRecord.Exception
  while($exception){if($exception.HResult -eq -2147024894){return $true};$exception=$exception.InnerException}
  return $false
}
function Assert-OfficeDisabledTask($Task,[string]$WorkerSid) {
  $definition=$Task.Definition
  $principal=$definition.Principal.UserId
  if($principal -notmatch '^S-1-'){$principal=([Security.Principal.NTAccount]$principal).Translate([Security.Principal.SecurityIdentifier]).Value}
  $expectedRoot=Join-Path $officeDestination 'runtime\apps\office-worker'
  $expectedNode=Join-Path $officeDestination 'tools\node.exe'
  $expectedConfig=Join-Path $officeDestination 'configuration\pending.json'
  $expectedLogs=Join-Path $officeDestination 'logs'
  $expectedArgs='-NoProfile -NonInteractive -WindowStyle Hidden -File "{0}" -NodeExecutable "{1}" -ConfigurationFile "{2}" -LogDirectory "{3}"' -f (Join-Path $expectedRoot 'start-office-worker.ps1'),$expectedNode,$expectedConfig,$expectedLogs
  if($Task.Enabled -or $Task.State -eq 4 -or $definition.Settings.Enabled -or $definition.Settings.AllowDemandStart -or !$definition.Settings.StartWhenAvailable -or $principal -ne $WorkerSid -or $definition.Principal.LogonType -ne 1 -or $definition.Principal.RunLevel -ne 0 -or $definition.Actions.Count -ne 1 -or $definition.Triggers.Count -ne 1){throw 'Refused mismatched or enabled worker task.'}
  $action=$definition.Actions.Item(1);$trigger=$definition.Triggers.Item(1)
  if($action.Type -ne 0 -or $action.Path -ine (Join-Path $officeDestination 'tools\powershell\pwsh.exe') -or $action.Arguments -cne $expectedArgs -or $action.WorkingDirectory -ine $expectedRoot -or $trigger.Type -ne 8 -or $trigger.Enabled -or $trigger.Delay -ne 'PT1M'){throw 'Refused mismatched worker action or trigger.'}
}

$officeUser=$null;$officeSid=$null;$officeCredential=$null;$officeProbeTask=$null;$officeRegisteredProbe=$false
$officeMarker=Join-Path $officeDestination 'administration\installation-owner.json'
$officeCredentialFile=Join-Path $officeDestination 'administration\worker-account.credential.clixml'
$officeReceipt=@{passed=$false;state='installing';productionDatabaseChanges=$false;workerActivated=$false;officeEnabled=$false;developmentBypass=$false}
try {
  $officeService=New-Object -ComObject 'Schedule.Service';$officeService.Connect();$officeFolder=$officeService.GetFolder('\')
  $officeExistingTask=$null
  try{$officeExistingTask=$officeFolder.GetTask($officeTaskName)}catch{if(!(Test-OfficeMissingTask $_)){throw}}
  if(!$Resume) {
    if((Test-Path -LiteralPath $officeDestination) -or (Get-LocalUser -Name $officeAccountName -ErrorAction SilentlyContinue) -or $officeExistingTask){throw 'Existing installation/account/task found; no existing identity will be replaced.'}
    New-Item -ItemType Directory -Path $officeDestination | Out-Null
    Set-OfficeDirectoryAccess $officeDestination $null
    New-Item -ItemType Directory -Path (Join-Path $officeDestination 'administration')|Out-Null
    Set-OfficeDirectoryAccess (Join-Path $officeDestination 'administration') $null
    $officePassword='Aa1!'+[Convert]::ToBase64String([Security.Cryptography.RandomNumberGenerator]::GetBytes(36))
    $officeSecurePassword=ConvertTo-SecureString $officePassword -AsPlainText -Force
    $officeUser=New-LocalUser -Name $officeAccountName -Password $officeSecurePassword -Disabled -PasswordNeverExpires -UserMayNotChangePassword -Description 'Enztronic Office worker; pending activation'
    $officeSid=$officeUser.SID
    $officeCredential=New-Object Management.Automation.PSCredential(('{0}\{1}' -f $env:COMPUTERNAME,$officeAccountName),$officeSecurePassword)
    $officeCredential | Export-Clixml -LiteralPath $officeCredentialFile
    $officePassword=$null;$officeSecurePassword=$null
    @{preparation=$officeStage;sid=$officeSid.Value;ownerSid=$officeOwnerSid.Value;runtimeManifestSha256=$officeManifestHash;completed=$false}|ConvertTo-Json|Set-Content -LiteralPath $officeMarker -Encoding utf8
  } else {
    if(!(Test-Path -LiteralPath $officeMarker)){throw 'Resume requires the owned installation marker.'}
    $marker=Get-Content -LiteralPath $officeMarker -Raw|ConvertFrom-Json
    if($marker.completed -or $marker.preparation -ine $officeStage -or $marker.ownerSid -ne $officeOwnerSid.Value -or $marker.runtimeManifestSha256 -ine $officeManifestHash){throw 'Refused completed or different installation resume.'}
    $officeUser=Get-LocalUser -Name $officeAccountName;$officeSid=$officeUser.SID
    if($officeSid.Value -ne $marker.sid){throw 'Refused account identity replacement.'}
    $officeCredential=Import-Clixml -LiteralPath $officeCredentialFile
    if($officeExistingTask){Assert-OfficeDisabledTask $officeExistingTask $officeSid.Value}
  }
  $officeReceipt.accountSid=$officeSid.Value
  $usersGroup=Get-LocalGroup -SID 'S-1-5-32-545'
  if(!@(Get-LocalGroupMember -Group $usersGroup |Where-Object {$_.SID.Value -eq $officeSid.Value}).Count){Add-LocalGroupMember -Group $usersGroup -Member $officeUser}
  if(@(Get-LocalGroupMember -SID 'S-1-5-32-544'|Where-Object {$_.SID.Value -eq $officeSid.Value}).Count){throw 'Worker must not be an administrator.'}
  . (Join-Path $PSScriptRoot 'windows-worker-rights.ps1')
  $officeRights=GrantOfficeWorkerRights -Sid $officeSid.Value
  $officeReceipt.rightsVerified=$officeRights.Verified

  if(!(Test-Path -LiteralPath (Join-Path $officeDestination 'runtime'))){Copy-OfficeTree $officeRuntimeSource (Join-Path $officeDestination 'runtime')}
  foreach($file in $officeManifest.files) {
    $candidate=[IO.Path]::GetFullPath((Join-Path $officeDestination ('runtime\'+$file.path)))
    if(!$candidate.StartsWith((Join-Path $officeDestination 'runtime')+'\',[StringComparison]::OrdinalIgnoreCase) -or (Get-FileHash -LiteralPath $candidate -Algorithm SHA256).Hash -ine $file.sha256){throw 'Installed runtime file mismatch.'}
  }
  $officeTools=Join-Path $officeDestination 'tools'
  if(!(Test-Path -LiteralPath $officeTools)){New-Item -ItemType Directory -Path $officeTools|Out-Null}
  if(!(Test-Path -LiteralPath (Join-Path $officeTools 'powershell'))){Copy-OfficeTree $officePowerShellSource (Join-Path $officeTools 'powershell')}
  $officeNode=Join-Path $officeTools 'node.exe'
  if(!(Test-Path -LiteralPath $officeNode)){Copy-Item -LiteralPath (Join-Path $officeStage 'node.exe') -Destination $officeNode}
  if((Get-FileHash -LiteralPath $officeNode -Algorithm SHA256).Hash -ine (Get-FileHash -LiteralPath (Join-Path $officeStage 'node.exe') -Algorithm SHA256).Hash){throw 'Installed Node executable mismatch.'}
  $officePwsh=Join-Path $officeTools 'powershell\pwsh.exe'
  if((Get-AuthenticodeSignature -LiteralPath $officePwsh).Status -ne 'Valid'){throw 'Installed PowerShell signature invalid.'}
  foreach($directory in @('configuration','logs','logs\temp','verification')){if(!(Test-Path -LiteralPath (Join-Path $officeDestination $directory))){New-Item -ItemType Directory -Path (Join-Path $officeDestination $directory)|Out-Null}}
  $officePending=Join-Path $officeDestination 'configuration\pending.json'
  @{OFFICE_ENABLED='false';OFFICE_DEMO_WORKER='false';OFFICE_WORKER_CONCURRENCY='1';OFFICE_WORKER_DATABASE_URL=''}|ConvertTo-Json|Set-Content -LiteralPath $officePending -Encoding utf8
  Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'verify-worker-identity.ps1') -Destination (Join-Path $officeDestination 'verification\verify-worker-identity.ps1') -Force
  Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'office-role.example.sql') -Destination (Join-Path $officeDestination 'administration\database-role-template.sql') -Force
  Set-OfficeDirectoryAccess $officeDestination $officeSid 'ReadAndExecute'
  foreach($branch in @('runtime','tools','configuration','verification')){Set-OfficeDirectoryAccess (Join-Path $officeDestination $branch) $officeSid 'ReadAndExecute'}
  Set-OfficeDirectoryAccess (Join-Path $officeDestination 'administration') $null
  Set-OfficeDirectoryAccess (Join-Path $officeDestination 'logs') $officeSid 'Modify'

  $sddlSections=[Security.AccessControl.AccessControlSections]::Access -bor [Security.AccessControl.AccessControlSections]::Owner -bor [Security.AccessControl.AccessControlSections]::Group
  $ownerProfile='C:\Users\hoyec'
  $beforeAcl=Join-Path $officeDestination 'administration\acl-before.json'
  if(!(Test-Path -LiteralPath $beforeAcl)){@{project=(Get-Acl $officeProject).GetSecurityDescriptorSddlForm($sddlSections);ownerProfile=(Get-Acl $ownerProfile).GetSecurityDescriptorSddlForm($sddlSections);workerSid=$officeSid.Value}|ConvertTo-Json|Set-Content -LiteralPath $beforeAcl -Encoding utf8}
  Add-OfficeDeny $officeProject $officeSid $true
  Add-OfficeDeny $ownerProfile $officeSid $true
  $secretPaths=@(
    'D:\Enztronic\.env.local','D:\Enztronic\apps\backoffice\.env.local','D:\Enztronic\apps\meteora-lp\.env',
    'D:\Enztronic\apps\backoffice\.runtime\postgres-admin-password.txt','D:\Enztronic\apps\backoffice\.runtime\postgres-app-password.txt',
    'C:\Users\hoyec\Enztronic-Recovery\production-prep-20261108-f3d5f15456\production.pgdump',
    'E:\Enztronic-Recovery\production-prep-20261108-f3d5f15456\production-prep-20261108-f3d5f15456.tar.gz'
  )
  foreach($path in $secretPaths){if(!(Test-Path -LiteralPath $path -PathType Leaf)){throw 'Expected sensitive probe target is missing.'};Add-OfficeDeny $path $officeSid $false}
  $officeWorkerRoot=Join-Path $officeDestination 'runtime\apps\office-worker'
  $officeLoader=Join-Path $officeWorkerRoot 'node_modules\tsx\dist\loader.mjs'
  $officeEntry=Join-Path $officeWorkerRoot 'src\index.ts'
  $officeSupervisor=Join-Path $officeWorkerRoot 'start-office-worker.ps1'
  $targets=@();$index=0
  foreach($path in $secretPaths){$index++;$targets+=@{label=('private_'+$index);path=$path;kind='file';expectedRead=$false;expectedWrite=$false}}
  foreach($path in @($officeNode,$officePwsh,$officeLoader,$officeEntry,$officePending)){$index++;$targets+=@{label=('runtime_read_'+$index);path=$path;kind='file';expectedRead=$true;expectedWrite=$false}}
  foreach($branch in @('','runtime','configuration','verification','administration','logs','logs\temp')){
    $targets+=@{label=('directory_'+$branch.Replace('\','_'));path=if($branch){Join-Path $officeDestination $branch}else{$officeDestination};kind='directory';expectedRead=($branch -ne 'administration');expectedWrite=($branch -in @('logs','logs\temp'))}
  }
  @{version=1;expectedSid=$officeSid.Value;targets=$targets;runtime=@{nodePath=$officeNode;powerShellPath=$officePwsh;loaderPath=$officeLoader;entryPath=$officeEntry;workingDirectory=(Join-Path $officeDestination 'runtime');supervisorPath=$officeSupervisor;pendingConfigPath=$officePending}}|ConvertTo-Json -Depth 7|Set-Content -LiteralPath (Join-Path $officeDestination 'verification-targets.json') -Encoding utf8
  Enable-LocalUser -SID $officeSid
  if(!$officeExistingTask){& (Join-Path $officeWorkerRoot 'install-office-worker-task.ps1') -RegisterDisabled -AccountSid $officeSid.Value -LogonType Password -Credential $officeCredential -PowerShellExecutable $officePwsh -NodeExecutable $officeNode -ConfigurationFile $officePending -LogDirectory (Join-Path $officeDestination 'logs')|Out-Null}
  $workerTask=$officeFolder.GetTask($officeTaskName)
  Assert-OfficeDisabledTask $workerTask $officeSid.Value

  # This temporary task only probes files and configuration refusal. It has no
  # trigger and never receives a database URL or enabled Office configuration.
  $probeId=[guid]::NewGuid().ToString('N');$officeProbeTask='EnztronicOfficeSetupProbe-'+$probeId
  $probeResult=Join-Path $officeDestination ('logs\identity-probe-'+$probeId+'.json')
  $definition=$officeService.NewTask(0);$definition.Principal.UserId=$officeSid.Value;$definition.Principal.LogonType=1;$definition.Principal.RunLevel=0
  $definition.Settings.Enabled=$true;$definition.Settings.AllowDemandStart=$true;$definition.Settings.ExecutionTimeLimit='PT2M';$definition.Settings.DisallowStartIfOnBatteries=$false;$definition.Settings.StopIfGoingOnBatteries=$false
  $action=$definition.Actions.Create(0);$action.Path=$officePwsh;$action.WorkingDirectory=$officeDestination
  $action.Arguments='-NoProfile -NonInteractive -WindowStyle Hidden -File "{0}" -InstallationRoot "{1}" -ExpectedSid "{2}" -ResultPath "{3}"' -f (Join-Path $officeDestination 'verification\verify-worker-identity.ps1'),$officeDestination,$officeSid.Value,$probeResult
  $registered=$officeFolder.RegisterTaskDefinition($officeProbeTask,$definition,2,$officeCredential.UserName,$officeCredential.GetNetworkCredential().Password,1,$null);$officeRegisteredProbe=$true
  $null=$registered.Run($null);$deadline=[DateTime]::UtcNow.AddSeconds(100)
  while(!(Test-Path -LiteralPath $probeResult) -and [DateTime]::UtcNow -lt $deadline){Start-Sleep -Milliseconds 500}
  if(!(Test-Path -LiteralPath $probeResult)){throw 'Real worker identity probe did not produce a result.'}
  $probe=Get-Content -LiteralPath $probeResult -Raw|ConvertFrom-Json
  while($registered.State -eq 4 -and [DateTime]::UtcNow -lt $deadline){Start-Sleep -Milliseconds 100}
  if($registered.State -eq 4 -or !$probe.passed){throw 'Real worker identity preparation checks failed.'}
  $officeReceipt.identityProbe=$probe;$officeReceipt.workerTaskDisabled=$true;$officeReceipt.runtimeManifestSha256=$officeManifestHash;$officeReceipt.installation=$officeDestination
  $officeReceipt.passed=$true;$officeReceipt.state='prepared_not_activated'
} catch {
  $officeReceipt.state='failed_closed';$officeReceipt.failureType=$_.Exception.GetType().Name
  $officeReceipt.failureStage=$_.InvocationInfo.ScriptLineNumber
  # Detailed errors remain private to the owner; never emit secrets/URLs.
  $_.Exception.Message|Set-Content -LiteralPath (Join-Path $officeStage 'host-installation-error.private.txt') -Encoding utf8
} finally {
  if($officeRegisteredProbe){
    try{
      $probeTask=$officeFolder.GetTask($officeProbeTask)
      if($probeTask.State -in @(2,4)){$probeTask.Stop(0)}
      $stopDeadline=[DateTime]::UtcNow.AddSeconds(10)
      while($probeTask.State -in @(2,4) -and [DateTime]::UtcNow -lt $stopDeadline){Start-Sleep -Milliseconds 100}
      if($probeTask.State -in @(2,4)){throw 'Owned verification task did not stop.'}
      $officeFolder.DeleteTask($officeProbeTask,0)
      $absent=$false
      try{$null=$officeFolder.GetTask($officeProbeTask)}catch{if(Test-OfficeMissingTask $_){$absent=$true}else{throw}}
      if(!$absent){throw 'Owned verification task was not removed.'}
      $officeReceipt.probeRemoved=$true
    }catch{$officeReceipt.passed=$false;$officeReceipt.probeCleanupFailed=$true}
  }
  if($officeUser -and $officeSid){
    try{
      if((Get-LocalUser -Name $officeAccountName).SID.Value -ne $officeSid.Value){$officeReceipt.passed=$false;$officeReceipt.accountIdentityChanged=$true}
      else{Disable-LocalUser -SID $officeSid;$officeReceipt.accountDisabled=!(Get-LocalUser -SID $officeSid).Enabled;if(!$officeReceipt.accountDisabled){$officeReceipt.passed=$false}}
    }catch{$officeReceipt.passed=$false;$officeReceipt.accountDisableFailed=$true}
  }
  Write-OfficeReceipt $officeReceipt
}
if(!$officeReceipt.passed){throw 'Office host preparation failed closed. Review the protected installation receipt.'}
@{preparation=$officeStage;sid=$officeSid.Value;ownerSid=$officeOwnerSid.Value;runtimeManifestSha256=$officeManifestHash;completed=$true}|ConvertTo-Json|Set-Content -LiteralPath $officeMarker -Encoding utf8
@{passed=$true;state='prepared_not_activated';accountDisabled=$true;workerTaskDisabled=$true;productionDatabaseChanges=$false}|ConvertTo-Json -Compress
