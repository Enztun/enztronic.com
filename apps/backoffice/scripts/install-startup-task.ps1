[CmdletBinding()]
param(
    [string]$TaskName = "Enztronic Backoffice",
    [switch]$Force
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

if (
    [string]::IsNullOrWhiteSpace($TaskName) -or
    $TaskName.Length -gt 100 -or
    $TaskName.IndexOfAny([char[]]"/\:*?`"<>|") -ge 0
) {
    throw "TaskName contains invalid characters."
}

foreach ($commandName in @(
    "Get-ScheduledTask",
    "New-ScheduledTaskAction",
    "New-ScheduledTaskTrigger",
    "New-ScheduledTaskPrincipal",
    "New-ScheduledTaskSettingsSet",
    "New-ScheduledTask",
    "Register-ScheduledTask"
)) {
    if (-not (Get-Command $commandName -ErrorAction SilentlyContinue)) {
        throw "Windows Scheduled Tasks cmdlet $commandName is unavailable."
    }
}

$startScript = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot "start-backoffice.ps1")).Path
$appRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot "..")).Path
$currentUser = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name

$existing = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
if ($existing -and -not $Force) {
    throw "Scheduled task '$TaskName' already exists. Re-run with -Force to replace it."
}

$arguments = "-NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File `"$startScript`""
$action = New-ScheduledTaskAction `
    -Execute "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe" `
    -Argument $arguments `
    -WorkingDirectory $appRoot
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $currentUser
$principal = New-ScheduledTaskPrincipal `
    -UserId $currentUser `
    -LogonType Interactive `
    -RunLevel Limited
$settings = New-ScheduledTaskSettingsSet `
    -StartWhenAvailable `
    -RestartCount 3 `
    -RestartInterval (New-TimeSpan -Minutes 1) `
    -MultipleInstances IgnoreNew `
    -ExecutionTimeLimit ([TimeSpan]::Zero) `
    -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries
$task = New-ScheduledTask `
    -Action $action `
    -Trigger $trigger `
    -Principal $principal `
    -Settings $settings `
    -Description "Starts the loopback-only Enztronic backoffice and its dedicated PostgreSQL cluster."

Register-ScheduledTask -TaskName $TaskName -InputObject $task -Force | Out-Null
Write-Output "Installed '$TaskName' for $currentUser. Build the app before the next logon."
