param(
  [Parameter(Mandatory)][string]$NodeExecutable,
  [Parameter(Mandatory)][string]$ConfigurationFile,
  [Parameter(Mandatory)][string]$LogDirectory,
  [switch]$Activate,
  [switch]$RegisterDisabled,
  [string]$AccountSid,
  [ValidateSet('S4U','Password')][string]$LogonType = 'S4U',
  [PSCredential]$Credential,
  [string]$PowerShellExecutable
)
$ErrorActionPreference = 'Stop'
if ($Activate -and $RegisterDisabled) { throw 'Choose either legacy interactive activation or disabled dedicated-account preparation.' }
if (!$RegisterDisabled -and ($AccountSid -or $Credential -or $PSBoundParameters.ContainsKey('LogonType'))) { throw 'Dedicated-account settings require -RegisterDisabled; they never fall back to the current owner.' }
$officeTaskName = 'EnztronicOfficeWorker'
$officeSupervisor = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot 'start-office-worker.ps1'))
$officeNode = [IO.Path]::GetFullPath($NodeExecutable)
$officeConfig = [IO.Path]::GetFullPath($ConfigurationFile)
$officeLogs = [IO.Path]::TrimEndingDirectorySeparator([IO.Path]::GetFullPath($LogDirectory))
$officePwsh = if ($PowerShellExecutable) { [IO.Path]::GetFullPath($PowerShellExecutable) } else { Join-Path $PSHOME 'pwsh.exe' }
if (!$PowerShellExecutable -and !(Test-Path -LiteralPath $officePwsh -PathType Leaf)) { $officePwsh = (Get-Command pwsh.exe -ErrorAction Stop).Source }
foreach ($officeArgument in @($officeSupervisor,$officeNode,$officeConfig,$officeLogs,$officePwsh)) {
  if ($officeArgument.Contains('"') -or $officeArgument.Contains("`r") -or $officeArgument.Contains("`n")) { throw 'Invalid quoted startup argument.' }
}
$officeArgs = '-NoProfile -NonInteractive -WindowStyle Hidden -File "{0}" -NodeExecutable "{1}" -ConfigurationFile "{2}" -LogDirectory "{3}"' -f $officeSupervisor,$officeNode,$officeConfig,$officeLogs

function Get-OfficeWorkerCurrentSid { [Security.Principal.WindowsIdentity]::GetCurrent().User.Value }
function Resolve-OfficeWorkerAccountSid([string]$Account) {
  if ($Account -match '^S-') {
    $sid = [Security.Principal.SecurityIdentifier]::new($Account)
    $null = $sid.Translate([Security.Principal.NTAccount])
    return $sid.Value
  }
  return ([Security.Principal.NTAccount]::new($Account)).Translate([Security.Principal.SecurityIdentifier]).Value
}
function Get-OfficeWorkerTaskScheduler { New-Object -ComObject Schedule.Service }
function Test-OfficeWorkerTaskMissing($Failure) {
  $exception = $Failure.Exception
  while ($exception) {
    if ($exception.HResult -eq -2147024894) { return $true } # HRESULT_FROM_WIN32(ERROR_FILE_NOT_FOUND)
    $exception = $exception.InnerException
  }
  return $false
}
function Register-OfficeWorkerDisabledTask {
  param([string]$AccountSid, [ValidateSet('S4U','Password')][string]$LogonType = 'S4U', [PSCredential]$Credential)
  if ($AccountSid -cnotmatch '^S-1-5-21-\d+-\d+-\d+-\d+$' -or $AccountSid -match '-(?:500|501|502)$') { throw 'Supply the explicit SID of a dedicated nonadministrator worker account.' }
  try { $resolvedSid = Resolve-OfficeWorkerAccountSid $AccountSid } catch { throw 'The supplied dedicated worker SID could not be resolved.' }
  if ($resolvedSid -cne $AccountSid -or $resolvedSid -ceq (Get-OfficeWorkerCurrentSid)) { throw 'The worker must use the supplied dedicated account, never the installing owner account.' }
  if ($LogonType -eq 'Password' -and !$Credential) { throw 'Password registration requires an in-memory PSCredential for the dedicated worker account.' }
  if ($Credential) {
    try { $credentialSid = Resolve-OfficeWorkerAccountSid $Credential.UserName } catch { throw 'The dedicated registration credential could not be resolved.' }
    if ($credentialSid -cne $AccountSid) { throw 'The registration credential must match the explicit worker account SID.' }
  }
  if (!(Test-Path -LiteralPath $officeNode -PathType Leaf) -or !(Test-Path -LiteralPath $officePwsh -PathType Leaf) -or !(Test-Path -LiteralPath $officeConfig -PathType Leaf) -or !(Test-Path -LiteralPath $officeLogs -PathType Container)) { throw 'Review the installed executables and existing private configuration/log paths before preparation.' }
  try { $configuration = Get-Content -LiteralPath $officeConfig -Raw | ConvertFrom-Json -AsHashtable } catch { throw 'The private worker preparation configuration is invalid.' }
  if ($configuration -isnot [Collections.IDictionary] -or $configuration.OFFICE_ENABLED -cne 'false' -or $configuration.OFFICE_DEMO_WORKER -cne 'false') { throw 'Disabled preparation requires exact OFFICE_ENABLED=false and OFFICE_DEMO_WORKER=false configuration strings.' }

  # COM avoids the broken ScheduledTasks CIM provider on the reviewed host. TASK_CREATE
  # is deliberate: a racing name collision must fail rather than overwrite any task.
  $scheduler = Get-OfficeWorkerTaskScheduler
  $scheduler.Connect()
  $folder = $scheduler.GetFolder('\')
  try {
    $existing = $folder.GetTask($officeTaskName)
  } catch {
    if (!(Test-OfficeWorkerTaskMissing $_)) { throw 'Unable to inspect the dedicated Office task name; no task was changed.' }
    $existing = $null
  }
  if ($existing) { throw 'Office task already exists. Review it explicitly; this script will not overwrite it.' }
  $definition = $scheduler.NewTask(0)
  $definition.RegistrationInfo.Description = 'Prepared Office worker only. Disabled until separate schema, least-privilege role and activation approval.'
  $definition.Principal.UserId = $AccountSid
  $definition.Principal.LogonType = if ($LogonType -eq 'Password') { 1 } else { 2 }
  $definition.Principal.RunLevel = 0 # TASK_RUNLEVEL_LUA / least privilege
  $definition.Settings.Enabled = $false
  $definition.Settings.Hidden = $true
  $definition.Settings.AllowDemandStart = $false
  $definition.Settings.StartWhenAvailable = $true
  $definition.Settings.MultipleInstances = 2 # TASK_INSTANCES_IGNORE_NEW
  $definition.Settings.RestartCount = 3
  $definition.Settings.RestartInterval = 'PT1M'
  $definition.Settings.ExecutionTimeLimit = 'PT0S'
  $definition.Settings.DisallowStartIfOnBatteries = $false
  $definition.Settings.StopIfGoingOnBatteries = $false
  $trigger = $definition.Triggers.Create(8) # TASK_TRIGGER_BOOT, prepared but disabled
  $trigger.Enabled = $false
  $trigger.Delay = 'PT1M'
  $action = $definition.Actions.Create(0) # TASK_ACTION_EXEC
  $action.Path = $officePwsh
  $action.Arguments = $officeArgs
  $action.WorkingDirectory = $PSScriptRoot
  $password = $null
  try {
    if ($Credential) { $password = $Credential.GetNetworkCredential().Password }
    $registered = $folder.RegisterTaskDefinition($officeTaskName, $definition, 2, $AccountSid, $password, $definition.Principal.LogonType, $null)
  } catch { throw 'Dedicated Office task registration failed. No worker was started; inspect the secure host preparation.' }
  finally { $password = $null }
  if ($registered.Enabled -ne $false) { throw 'Prepared task did not report disabled. Stop and inspect its definition before any activation.' }
  # No Run, Enable, service start, migration, SQL grant or identity provisioning occurs here.
  @{ mode = 'registered_disabled'; taskName = $officeTaskName; accountSid = $AccountSid; logonType = $LogonType; enabled = $false; triggerEnabled = $false; trigger = 'boot_delayed_60_seconds'; startsNow = $false; runLevel = 'Limited'; availability = 'Not activated. Dedicated PostgreSQL currently depends on owner logon; PC must remain awake. Pre-logon processing is unverified.'; s4uLimit = 'S4U has no network or EFS access; verify required local database access before a separately approved activation.' } | ConvertTo-Json -Compress
}

if ($RegisterDisabled) {
  Register-OfficeWorkerDisabledTask -AccountSid $AccountSid -LogonType $LogonType -Credential $Credential
  return
}
if (!$Activate) {
  @{ mode = 'plan_only'; taskName = $officeTaskName; execute = $officePwsh; arguments = $officeArgs; startsNow = $false; runLevel = 'Limited'; availability = 'current-user interactive logon; PC awake'; required = 'Owner-authorized activation window, reviewed config ACLs and Office database role.' } | ConvertTo-Json -Compress
  return
}
if (!(Test-Path -LiteralPath $officeNode -PathType Leaf) -or !(Test-Path -LiteralPath $officePwsh -PathType Leaf) -or !(Test-Path -LiteralPath $officeConfig -PathType Leaf)) { throw 'Review the installed executables and Office-only configuration before activation.' }
if (Get-ScheduledTask -TaskName $officeTaskName -ErrorAction SilentlyContinue) { throw 'Office task already exists. Review it explicitly; this script will not overwrite it.' }
$officeUser = [Security.Principal.WindowsIdentity]::GetCurrent().Name
$officeAction = New-ScheduledTaskAction -Execute $officePwsh -Argument $officeArgs -WorkingDirectory $PSScriptRoot
$officeTrigger = New-ScheduledTaskTrigger -AtLogOn -User $officeUser
$officePrincipal = New-ScheduledTaskPrincipal -UserId $officeUser -LogonType Interactive -RunLevel Limited
$officeSettings = New-ScheduledTaskSettingsSet -MultipleInstances IgnoreNew -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit ([TimeSpan]::Zero)
Register-ScheduledTask -TaskName $officeTaskName -Action $officeAction -Trigger $officeTrigger -Principal $officePrincipal -Settings $officeSettings | Out-Null
Write-Output 'Dedicated Office logon task registered. Not started. This does not provide PC-off or pre-logon availability.'
