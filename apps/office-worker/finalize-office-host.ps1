param([Parameter(Mandatory)][string]$PreparationRoot)
$ErrorActionPreference='Stop'
Set-StrictMode -Version Latest
$officeCanWriteReceipt=$false
trap {
  if($officeCanWriteReceipt){
    @{passed=$false;failureType=$_.Exception.GetType().Name;failureStage=$_.InvocationInfo.ScriptLineNumber}|ConvertTo-Json|Set-Content -LiteralPath (Join-Path $PreparationRoot 'scheduler-finalization.json') -Encoding utf8
    $_.Exception.Message|Set-Content -LiteralPath (Join-Path $PreparationRoot 'scheduler-finalization-error.private.txt') -Encoding utf8
  }
  exit 1
}
$officeStage=[IO.Path]::TrimEndingDirectorySeparator([IO.Path]::GetFullPath($PreparationRoot))
if([IO.Path]::GetDirectoryName($officeStage) -ine 'C:\Users\hoyec\Enztronic-Worker-Preparation' -or [IO.Path]::GetFileName($officeStage) -notmatch '^step2-20261108-[a-f0-9]{10}$'){throw 'Refused preparation destination.'}
$officeRoot='C:\ProgramData\EnztronicOffice'
$identity=[Security.Principal.WindowsIdentity]::GetCurrent()
if(!([Security.Principal.WindowsPrincipal]::new($identity)).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)){throw 'Administrator elevation required for scheduler security inspection.'}
$marker=Get-Content -LiteralPath (Join-Path $officeRoot 'administration\installation-owner.json') -Raw|ConvertFrom-Json
if(!$marker.completed -or $marker.preparation -ine $officeStage -or $marker.ownerSid -ne $identity.User.Value){throw 'Refused foreign or incomplete installation.'}
$officeCanWriteReceipt=$true
$user=Get-LocalUser -Name 'EnztronicOfficeSvc'
if($user.SID.Value -ne $marker.sid -or $user.Enabled){throw 'Worker identity must match and remain disabled.'}
$svc=New-Object -ComObject 'Schedule.Service';$svc.Connect();$folder=$svc.GetFolder('\');$task=$folder.GetTask('EnztronicOfficeWorker')
if($task.Enabled -or $task.State -in @(2,4) -or $task.Definition.Principal.LogonType -ne 1 -or $task.Definition.Principal.RunLevel -ne 0 -or $task.Definition.Settings.AllowDemandStart){throw 'Worker task must remain disabled, limited and unstarted.'}
$sid=$task.Definition.Principal.UserId
if($sid -notmatch '^S-1-'){$sid=([Security.Principal.NTAccount]$sid).Translate([Security.Principal.SecurityIdentifier]).Value}
if($sid -ne $marker.sid -or $task.Definition.Actions.Count -ne 1 -or $task.Definition.Actions.Item(1).Path -ine (Join-Path $officeRoot 'tools\powershell\pwsh.exe')){throw 'Refused foreign worker principal or action.'}
$beforeXml=$task.Xml
$beforeSecurity=$task.GetSecurityDescriptor(7)
$beforeSecurity|Set-Content -LiteralPath (Join-Path $officeRoot 'administration\task-security-before-owner-read.txt') -Encoding utf8
$descriptor=[Security.AccessControl.RawSecurityDescriptor]::new($beforeSecurity)
$readExecute=[BitConverter]::ToInt32([BitConverter]::GetBytes([uint32]2147483648),0) # GENERIC_READ only
$ownerAce=[Security.AccessControl.CommonAce]::new([Security.AccessControl.AceFlags]::None,[Security.AccessControl.AceQualifier]::AccessAllowed,$readExecute,$identity.User,$false,$null)
# Task Scheduler's existing ACL can be noncanonical. Preserve its ACEs/order;
# insert only the new explicit owner rule before inherited entries.
$insert=0
while($insert -lt $descriptor.DiscretionaryAcl.Count -and !($descriptor.DiscretionaryAcl[$insert].AceFlags -band [Security.AccessControl.AceFlags]::Inherited)){$insert++}
$descriptor.DiscretionaryAcl.InsertAce($insert,$ownerAce)
$task.SetSecurityDescriptor($descriptor.GetSddlForm([Security.AccessControl.AccessControlSections]::Access),0)
[xml]$beforeDefinition=$beforeXml;[xml]$afterDefinition=$task.Xml
foreach($document in @($beforeDefinition,$afterDefinition)){
  foreach($node in @($document.SelectNodes('//*[local-name()="RegistrationInfo"]/*[local-name()="SecurityDescriptor"]'))){$null=$node.ParentNode.RemoveChild($node)}
}
if($afterDefinition.OuterXml -cne $beforeDefinition.OuterXml -or $task.Enabled -or (Get-LocalUser -SID $user.SID).Enabled){throw 'Scheduler metadata visibility must not change the definition or activation state.'}
$task.Xml|Set-Content -LiteralPath (Join-Path $officeStage 'office-worker-task.xml') -Encoding utf8
$result=@{
 passed=$true;clientDate='2026-11-08';machineUtc=[DateTime]::UtcNow.ToString('o');ownerMetadataReadGranted=$true;
 workerAccountEnabled=$false;workerTaskEnabled=$task.Enabled;workerTaskState=$task.State;
 workerTaskLastResult=$task.LastTaskResult;workerLogonType=$task.Definition.Principal.LogonType;workerRunLevel=$task.Definition.Principal.RunLevel;
 workerDefinitionUnchanged=$true;probeTasksRemaining=@($folder.GetTasks(1)|Where-Object {$_.Name -like 'EnztronicOfficeSetupProbe-*'}).Count;
 productionDatabaseChanges=$false;workerStarted=$false
}
$result|ConvertTo-Json -Depth 4|Set-Content -LiteralPath (Join-Path $officeStage 'scheduler-finalization.json') -Encoding utf8
@{passed=$true;ownerMetadataReadGranted=$true;workerDefinitionUnchanged=$true;workerAccountEnabled=$false;workerTaskEnabled=$false}|ConvertTo-Json -Compress
