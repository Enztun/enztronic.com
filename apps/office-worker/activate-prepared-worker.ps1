[CmdletBinding()]
param(
  [switch]$Activate,
  [switch]$StopWorker,
  [string]$InstallationRoot = 'C:\ProgramData\EnztronicOffice',
  [ValidateRange(5,180)][int]$StopTimeoutSeconds = 60
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
if ($Activate -and $StopWorker) { throw 'Choose activation or the owned-worker stop operation.' }
$officeActivationRoot = [IO.Path]::TrimEndingDirectorySeparator([IO.Path]::GetFullPath($InstallationRoot))
if ($officeActivationRoot -ine 'C:\ProgramData\EnztronicOffice') { throw 'Only the reviewed Office installation is supported.' }
$officeActivationTaskName = 'EnztronicOfficeWorker'
$script:officeActivationStage = 'plan'

function Get-OfficeActivationPaths {
  $worker = Join-Path $officeActivationRoot 'runtime\apps\office-worker'
  @{
    root=$officeActivationRoot; worker=$worker; runtime=(Join-Path $officeActivationRoot 'runtime')
    administration=(Join-Path $officeActivationRoot 'administration')
    marker=(Join-Path $officeActivationRoot 'administration\installation-owner.json')
    credential=(Join-Path $officeActivationRoot 'administration\worker-account.credential.clixml')
    configuration=(Join-Path $officeActivationRoot 'configuration\pending.json')
    logs=(Join-Path $officeActivationRoot 'logs'); node=(Join-Path $officeActivationRoot 'tools\node.exe')
    powershell=(Join-Path $officeActivationRoot 'tools\powershell\pwsh.exe')
    supervisor=(Join-Path $worker 'start-office-worker.ps1'); entry=(Join-Path $worker 'src\index.ts')
  }
}
function Assert-OfficeActivationNoLink([string]$Path) {
  $current = [IO.Path]::GetFullPath($Path)
  while ($current) {
    if (([IO.File]::GetAttributes($current) -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw 'installation_link_refused' }
    $current = [IO.Path]::GetDirectoryName($current)
  }
}
function Get-OfficeActivationCurrentSid { [Security.Principal.WindowsIdentity]::GetCurrent().User.Value }
function Test-OfficeActivationAdministrator {
  ([Security.Principal.WindowsPrincipal]::new([Security.Principal.WindowsIdentity]::GetCurrent())).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}
function Resolve-OfficeActivationSid([string]$Account) {
  if ($Account -match '^S-1-') { return ([Security.Principal.SecurityIdentifier]::new($Account)).Value }
  ([Security.Principal.NTAccount]::new($Account)).Translate([Security.Principal.SecurityIdentifier]).Value
}
function Assert-OfficeActivationConfiguration([Collections.IDictionary]$Configuration) {
  $allowed = @('OFFICE_ENABLED','OFFICE_DEMO_WORKER','OFFICE_WORKER_DATABASE_URL','OFFICE_WORKER_CONCURRENCY')
  foreach ($key in $Configuration.Keys) {
    if ($key -cnotin $allowed -or $Configuration[$key] -isnot [string]) { throw 'office_only_configuration_required' }
  }
  if ($Configuration.OFFICE_ENABLED -cne 'true' -or $Configuration.OFFICE_DEMO_WORKER -cne 'true' -or
      ($Configuration.Contains('OFFICE_WORKER_CONCURRENCY') -and $Configuration.OFFICE_WORKER_CONCURRENCY -cnotmatch '^[1-4]$')) { throw 'explicit_demo_activation_required' }
  $database = $null
  if (![Uri]::TryCreate($Configuration.OFFICE_WORKER_DATABASE_URL,[UriKind]::Absolute,[ref]$database) -or
      $database.Scheme -notin @('postgres','postgresql') -or $database.Host -cnotin @('127.0.0.1','localhost') -or
      $database.Port -ne 54329 -or $database.AbsolutePath -cne '/enztronic_backoffice' -or $database.Query -or $database.Fragment) { throw 'dedicated_office_database_required' }
  $parts = $database.UserInfo.Split(':',2)
  if ($parts.Count -ne 2 -or [Uri]::UnescapeDataString($parts[0]) -cne 'enztronic_office_worker' -or
      [string]::IsNullOrWhiteSpace([Uri]::UnescapeDataString($parts[1]))) { throw 'dedicated_office_database_role_required' }
  # No connection is opened. The caller separately verifies schema, grants and leases.
}
function Assert-OfficeActivationRuntime($Paths,[string]$ExpectedHash) {
  $manifestPath = Join-Path $Paths.runtime 'runtime-manifest.json'
  $hashPath = Join-Path $Paths.runtime 'runtime-manifest.sha256'
  Assert-OfficeActivationNoLink $manifestPath; Assert-OfficeActivationNoLink $hashPath
  $hash = (Get-Content -LiteralPath $hashPath -Raw).Trim()
  if ($ExpectedHash -cnotmatch '^[a-f0-9]{64}$' -or $hash -cne $ExpectedHash -or
      (Get-FileHash -LiteralPath $manifestPath -Algorithm SHA256).Hash -ine $hash) { throw 'runtime_manifest_mismatch' }
  $manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
  if (!$manifest.files -or @($manifest.files).Count -gt 50000) { throw 'runtime_manifest_invalid' }
  $expected = [Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
  $null = $expected.Add('runtime-manifest.json'); $null = $expected.Add('runtime-manifest.sha256')
  foreach ($file in $manifest.files) {
    if ($file.path -isnot [string] -or $file.path.Contains('\') -or $file.path.Contains(':') -or
        $file.path.StartsWith('/') -or @($file.path.Split('/') | Where-Object { !$_ -or $_ -in @('.','..') }).Count -or
        !$expected.Add($file.path) -or $file.sha256 -cnotmatch '^[a-f0-9]{64}$') { throw 'runtime_manifest_path_invalid' }
    $candidate = [IO.Path]::GetFullPath((Join-Path $Paths.runtime $file.path))
    if (!$candidate.StartsWith($Paths.runtime + '\',[StringComparison]::OrdinalIgnoreCase)) { throw 'runtime_manifest_path_invalid' }
    Assert-OfficeActivationNoLink $candidate
    $details = Get-Item -LiteralPath $candidate
    if ($details.PSIsContainer -or $details.Length -ne $file.bytes -or
        (Get-FileHash -LiteralPath $candidate -Algorithm SHA256).Hash -ine $file.sha256) { throw 'runtime_file_mismatch' }
  }
  $pending = [Collections.Generic.Stack[string]]::new(); $pending.Push($Paths.runtime)
  $actualFiles = 0
  while ($pending.Count) {
    foreach ($item in Get-ChildItem -LiteralPath $pending.Pop() -Force) {
      if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw 'runtime_link_refused' }
      if ($item.PSIsContainer) { $pending.Push($item.FullName) }
      else {
        $relative = [IO.Path]::GetRelativePath($Paths.runtime,$item.FullName).Replace('\','/')
        if (!$expected.Contains($relative)) { throw 'unmanifested_runtime_file' }; $actualFiles++
      }
    }
  }
  if ($actualFiles -ne $expected.Count) { throw 'runtime_inventory_mismatch' }
  @{ hash=$hash; files=@($manifest.files).Count }
}
function Get-OfficeActivationTaskArguments($Paths) {
  '-NoProfile -NonInteractive -WindowStyle Hidden -File "{0}" -NodeExecutable "{1}" -ConfigurationFile "{2}" -LogDirectory "{3}"' -f $Paths.supervisor,$Paths.node,$Paths.configuration,$Paths.logs
}
function Assert-OfficeActivationOwnedTask($Task,$Context) {
  $definition = $Task.Definition
  if ((Resolve-OfficeActivationSid $definition.Principal.UserId) -cne $Context.workerSid -or
      $definition.Principal.LogonType -ne 1 -or $definition.Principal.RunLevel -ne 0 -or
      $definition.Actions.Count -ne 1 -or $definition.Triggers.Count -ne 1 -or
      $definition.Settings.MultipleInstances -ne 2 -or $definition.Settings.RestartCount -ne 3 -or
      $definition.Settings.RestartInterval -ne 'PT1M' -or $definition.Settings.ExecutionTimeLimit -ne 'PT0S') { throw 'worker_task_identity_or_settings_mismatch' }
  $action = $definition.Actions.Item(1); $trigger = $definition.Triggers.Item(1)
  if ($action.Type -ne 0 -or $action.Path -ine $Context.paths.powershell -or
      $action.Arguments -cne (Get-OfficeActivationTaskArguments $Context.paths) -or
      $action.WorkingDirectory -ine $Context.paths.worker -or $trigger.Type -ne 8 -or $trigger.Delay -ne 'PT1M') { throw 'worker_task_action_or_trigger_mismatch' }
}
function Get-OfficeActivationSecurity($Task) {
  # SECURITY_INFORMATION: owner, group and DACL only; preserve the owner's existing read ACE.
  $Task.GetSecurityDescriptor(7)
}
function Get-OfficeActivationCanonicalSecurity([string]$Sddl) {
  $descriptor = [Security.AccessControl.RawSecurityDescriptor]::new($Sddl)
  $descriptor.GetSddlForm([Security.AccessControl.AccessControlSections]::Access -bor
    [Security.AccessControl.AccessControlSections]::Owner -bor [Security.AccessControl.AccessControlSections]::Group)
}
function Get-OfficeActivationContext([bool]$ForActivation) {
  $script:officeActivationStage = 'installation_identity'
  $paths = Get-OfficeActivationPaths
  foreach ($path in @($paths.root,$paths.administration,$paths.marker,$paths.credential)) { Assert-OfficeActivationNoLink $path }
  $marker = Get-Content -LiteralPath $paths.marker -Raw | ConvertFrom-Json
  if (!$marker.completed -or $marker.ownerSid -cne (Get-OfficeActivationCurrentSid) -or
      $marker.sid -cnotmatch '^S-1-5-21-\d+-\d+-\d+-\d+$' -or $marker.sid -ceq $marker.ownerSid) { throw 'completed_owned_installation_required' }
  $user = Get-LocalUser -Name 'EnztronicOfficeSvc'
  if ($user.SID.Value -cne $marker.sid -or
      @(Get-LocalGroupMember -SID 'S-1-5-32-544' | Where-Object { $_.SID.Value -ceq $marker.sid }).Count) { throw 'worker_account_identity_mismatch' }
  $runtime = $null
  if ($ForActivation) {
    foreach ($path in @($paths.configuration,$paths.node,$paths.powershell,$paths.supervisor)) { Assert-OfficeActivationNoLink $path }
    $script:officeActivationStage = 'runtime_integrity'
    $runtime = Assert-OfficeActivationRuntime $paths $marker.runtimeManifestSha256
    $script:officeActivationStage = 'configuration_validation'
    $configuration = Get-Content -LiteralPath $paths.configuration -Raw | ConvertFrom-Json -AsHashtable
    if ($configuration -isnot [Collections.IDictionary]) { throw 'office_only_configuration_required' }
    Assert-OfficeActivationConfiguration $configuration
  }
  $script:officeActivationStage = 'registration_credential'
  $credential = Import-Clixml -LiteralPath $paths.credential
  if ($credential -isnot [PSCredential] -or (Resolve-OfficeActivationSid $credential.UserName) -cne $marker.sid) { throw 'worker_registration_credential_mismatch' }
  $service = New-Object -ComObject Schedule.Service; $service.Connect(); $folder = $service.GetFolder('\')
  $task = $folder.GetTask($officeActivationTaskName)
  $context = @{ paths=$paths; workerSid=$marker.sid; ownerSid=$marker.ownerSid; credential=$credential; folder=$folder; task=$task; userEnabled=[bool]$user.Enabled; runtime=$runtime }
  $script:officeActivationStage = 'owned_task_validation'
  Assert-OfficeActivationOwnedTask $task $context
  $context
}
function Get-OfficeActivationOwnedProcesses($Context) {
  $owned = @()
  foreach ($process in Get-CimInstance Win32_Process -Filter "Name='node.exe' OR Name='pwsh.exe'") {
    $kind = if ($process.ExecutablePath -ieq $Context.paths.node) { 'worker' } elseif ($process.ExecutablePath -ieq $Context.paths.powershell) { 'supervisor' } else { $null }
    if (!$kind) { continue }
    $owner = Invoke-CimMethod -InputObject $process -MethodName GetOwnerSid
    if ($owner.ReturnValue -ne 0) { throw 'process_identity_unavailable' }
    if ($owner.Sid -cne $Context.workerSid) { continue }
    $command = ([string]$process.CommandLine).Replace('/','\')
    $expected = if ($kind -eq 'worker') { $Context.paths.entry } else { $Context.paths.supervisor }
    if (!$command -or $command -notmatch ('(?i)(?:^|\s|\")' + [regex]::Escape($expected) + '(?:\s|\"|$)')) { throw 'scoped_process_command_unconfirmed' }
    $owned += [pscustomobject]@{ id=[int]$process.ProcessId; kind=$kind }
  }
  $owned
}
function Set-OfficeActivationAccount($Context,[bool]$Enabled) {
  if ((Get-LocalUser -Name 'EnztronicOfficeSvc').SID.Value -cne $Context.workerSid) { throw 'worker_account_identity_changed' }
  if ($Enabled) { $null = Enable-LocalUser -SID $Context.workerSid } else { $null = Disable-LocalUser -SID $Context.workerSid }
  if ([bool](Get-LocalUser -SID $Context.workerSid).Enabled -ne $Enabled) { throw 'worker_account_state_unconfirmed' }
}
function Update-OfficeActivationTask($Context,[bool]$Enabled) {
  $task = $Context.folder.GetTask($officeActivationTaskName)
  Assert-OfficeActivationOwnedTask $task $Context
  # Keep the pre-operation descriptor across automatic rollback as well as success.
  $security = if ($Context.ContainsKey('taskSecurity')) { $Context.taskSecurity } else { Get-OfficeActivationSecurity $task }
  $definition = $task.Definition
  $definition.Settings.Enabled = $Enabled; $definition.Settings.AllowDemandStart = $Enabled
  $definition.Settings.StartWhenAvailable = $true; $definition.Triggers.Item(1).Enabled = $Enabled
  $password = $null
  try {
    $password = $Context.credential.GetNetworkCredential().Password
    # TASK_UPDATE | TASK_DONT_ADD_PRINCIPAL_ACE; never create/replace another task or widen its ACL.
    $null = $Context.folder.RegisterTaskDefinition($officeActivationTaskName,$definition,20,$Context.workerSid,$password,1,$security)
  } catch { throw 'owned_task_update_failed' }
  finally { $password = $null }
  $updated = $Context.folder.GetTask($officeActivationTaskName)
  Assert-OfficeActivationOwnedTask $updated $Context
  if ([bool]$updated.Enabled -ne $Enabled -or [bool]$updated.Definition.Settings.Enabled -ne $Enabled -or
      [bool]$updated.Definition.Settings.AllowDemandStart -ne $Enabled -or [bool]$updated.Definition.Triggers.Item(1).Enabled -ne $Enabled -or
      (Get-OfficeActivationCanonicalSecurity (Get-OfficeActivationSecurity $updated)) -cne (Get-OfficeActivationCanonicalSecurity $security)) { throw 'owned_task_state_or_security_unconfirmed' }
  $updated
}
function Stop-OfficeActivationWorker($Context,[int]$TimeoutSeconds) {
  $script:officeActivationStage = 'owned_worker_stop'
  $task = $Context.folder.GetTask($officeActivationTaskName)
  Assert-OfficeActivationOwnedTask $task $Context
  $stopped = $false
  try {
    if ($task.Enabled -or $task.Definition.Settings.Enabled -or $task.Definition.Settings.AllowDemandStart -or $task.Definition.Triggers.Item(1).Enabled) { $task = Update-OfficeActivationTask $Context $false }
    if ($task.State -in @(2,4)) { $null = $task.Stop(0) }
    $deadline = [DateTime]::UtcNow.AddSeconds($TimeoutSeconds)
    do {
      $task = $Context.folder.GetTask($officeActivationTaskName)
      Assert-OfficeActivationOwnedTask $task $Context
      $processes = @(Get-OfficeActivationOwnedProcesses $Context)
      $stopped = $task.State -notin @(2,4) -and !$processes.Count
      if (!$stopped) { Start-Sleep -Milliseconds 200 }
    } while (!$stopped -and [DateTime]::UtcNow -lt $deadline)
  } finally { Set-OfficeActivationAccount $Context $false }
  if (!$stopped) { throw 'owned_worker_processes_remain' }
  if ($task.Enabled -or $task.Definition.Settings.Enabled -or $task.Definition.Settings.AllowDemandStart -or $task.Definition.Triggers.Item(1).Enabled) { throw 'owned_worker_stop_state_unconfirmed' }
  @{ passed=$true; state='owned_worker_stopped_disabled'; windowsTaskStopped=$true; ownedProcessesExited=$true; accountEnabled=$false; taskEnabled=$false; triggerEnabled=$false; gracefulShutdownConfirmed=$false; databaseLeaseReconciliation='required_separately'; databaseCallsPerformed=$false }
}
function Invoke-OfficePreparedWorkerOperation([ValidateSet('Activate','StopWorker')][string]$Mode,[int]$TimeoutSeconds=60) {
  if (!(Test-OfficeActivationAdministrator)) { throw 'elevated_original_owner_required' }
  $context = Get-OfficeActivationContext ($Mode -eq 'Activate')
  Assert-OfficeActivationOwnedTask $context.task $context
  $context.taskSecurity = Get-OfficeActivationSecurity $context.task
  if ($Mode -eq 'StopWorker') { return Stop-OfficeActivationWorker $context $TimeoutSeconds }
  $task = $context.task
  if ($context.userEnabled -or $task.Enabled -or $task.State -in @(2,4) -or
      $task.Definition.Settings.Enabled -or $task.Definition.Settings.AllowDemandStart -or $task.Definition.Triggers.Item(1).Enabled -or
      @(Get-OfficeActivationOwnedProcesses $context).Count) { throw 'disabled_idle_prepared_worker_required' }
  $changed = $false
  try {
    $script:officeActivationStage = 'account_enable'; $changed=$true
    Set-OfficeActivationAccount $context $true
    $script:officeActivationStage = 'task_enable'
    $task = Update-OfficeActivationTask $context $true
    $script:officeActivationStage = 'windows_run_request'
    $null = $task.Run($null)
    @{ passed=$true; state='windows_start_requested_health_unverified'; windowsRunRequested=$true; accountEnabled=$true; taskEnabled=$true; triggerEnabled=$true; workerHealthVerified=$false; databaseSchemaVerified=$false; databaseCallsPerformed=$false; runtimeManifestSha256=$context.runtime.hash; runtimeFiles=$context.runtime.files; availability='Depends on the dedicated database and an awake host; pre-owner-logon processing is not established.' }
  } catch {
    $originalStage=$script:officeActivationStage
    $rolledBack=$false
    if ($changed) {
      try { $null=Stop-OfficeActivationWorker $context $TimeoutSeconds; $rolledBack=$true }
      catch { try { Set-OfficeActivationAccount $context $false } catch { } }
    }
    $script:officeActivationStage=$originalStage
    $failure=[InvalidOperationException]::new('worker_activation_failed')
    $failure.Data['rollbackConfirmed']=$rolledBack
    throw $failure
  }
}
function Write-OfficeActivationReceipt($Receipt,[string]$Mode) {
  $paths=Get-OfficeActivationPaths
  Assert-OfficeActivationNoLink $paths.administration
  $name='worker-'+$Mode.ToLowerInvariant()+'-'+[DateTime]::UtcNow.ToString('yyyyMMddTHHmmss')+'-'+[guid]::NewGuid().ToString('N')+'.json'
  $file=Join-Path $paths.administration $name
  $Receipt.clientDate='2026-11-08'; $Receipt.machineUtc=[DateTime]::UtcNow.ToString('o'); $Receipt.taskName=$officeActivationTaskName
  $stream=[IO.FileStream]::new($file,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::None)
  try { $bytes=[Text.UTF8Encoding]::new($false).GetBytes(($Receipt | ConvertTo-Json -Depth 5)); $stream.Write($bytes,0,$bytes.Length) }
  finally { $stream.Dispose() }
}

if (!$Activate -and !$StopWorker) {
  @{ mode='plan_only'; taskName=$officeActivationTaskName; originalOwnerElevationRequired=$true; activation='Explicit -Activate validates the prepared runtime, dedicated credentials and enabled demo configuration, updates only the owned Windows task and requests a start.'; stop='Explicit -StopWorker disables future task starts, stops only the owned task, verifies scoped process exit and disables its account.'; databaseCallsPerformed=$false; healthAndLeases='Verified separately by the owner.' } | ConvertTo-Json -Compress
  return
}
$mode=if($Activate){'Activate'}else{'StopWorker'}
try {
  $receipt=Invoke-OfficePreparedWorkerOperation -Mode $mode -TimeoutSeconds $StopTimeoutSeconds
} catch {
  $receipt=@{passed=$false;state='windows_operation_failed';stage=$script:officeActivationStage;databaseCallsPerformed=$false}
  if ($_.Exception.Data.Contains('rollbackConfirmed')) { $receipt.rollbackConfirmed=[bool]$_.Exception.Data['rollbackConfirmed'] }
  try { Write-OfficeActivationReceipt $receipt $mode } catch { }
  $receipt | ConvertTo-Json -Depth 5 -Compress
  throw 'Office worker Windows operation failed. Inspect its protected receipt; database health and leases require separate verification.'
}
Write-OfficeActivationReceipt $receipt $mode
$receipt | ConvertTo-Json -Depth 5 -Compress
