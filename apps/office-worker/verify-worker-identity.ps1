[CmdletBinding()]
param(
    [string]$InstallationRoot = 'C:\ProgramData\EnztronicOffice',
    [Parameter(Mandatory)][string]$ExpectedSid,
    [Parameter(Mandatory)][string]$ResultPath
)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Get-OfficeFullPath([string]$Value) {
    if ($Value -notmatch '^[CDE]:\\' -or $Value.Substring(2).Contains(':')) { throw 'Only reviewed local absolute paths are allowed.' }
    [IO.Path]::TrimEndingDirectorySeparator([IO.Path]::GetFullPath($Value))
}
function Assert-OfficeNoLink([string]$Value) {
    $officeCurrent = $Value
    while ($officeCurrent) {
        if (([IO.File]::GetAttributes($officeCurrent) -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw 'Installation links are forbidden.' }
        $officeCurrent = [IO.Path]::GetDirectoryName($officeCurrent)
    }
}
function Test-OfficeAccessDenied([Exception]$ErrorValue) {
    $officeException = $ErrorValue
    while ($officeException.InnerException) { $officeException = $officeException.InnerException }
    ($officeException.HResult -band 0xffff) -eq 5
}
function Test-OfficeFileAccess([string]$Value, [IO.FileAccess]$Access) {
    try {
        $officeStream = [IO.FileStream]::new($Value, [IO.FileMode]::Open, $Access,
            ([IO.FileShare]::ReadWrite -bor [IO.FileShare]::Delete))
        $officeStream.Dispose() # No bytes read, written, truncated or returned.
        @{ allowed=$true; denied=$false; conclusive=$true }
    } catch {
        $officeDenied = Test-OfficeAccessDenied $_.Exception
        @{ allowed=$false; denied=$officeDenied; conclusive=$officeDenied }
    }
}
function Test-OfficeDirectoryRead([string]$Value) {
    try {
        $officeEnumerator = [IO.Directory]::EnumerateFileSystemEntries($Value).GetEnumerator()
        try { $null = $officeEnumerator.MoveNext() } finally { $officeEnumerator.Dispose() }
        @{ allowed=$true; denied=$false; conclusive=$true }
    } catch {
        $officeDenied = Test-OfficeAccessDenied $_.Exception
        @{ allowed=$false; denied=$officeDenied; conclusive=$officeDenied }
    }
}
function Test-OfficeDirectoryWrite([string]$Value) {
    $officeSentinel = Join-Path $Value ('.office-identity-probe-' + [Guid]::NewGuid().ToString('N') + '.tmp')
    try {
        $officeStream = [IO.FileStream]::new($officeSentinel, [IO.FileMode]::CreateNew,
            [IO.FileAccess]::ReadWrite, [IO.FileShare]::None, 4096, [IO.FileOptions]::DeleteOnClose)
        try {
            $officeStream.WriteByte(80); $officeStream.Position = 0
            if ($officeStream.ReadByte() -ne 80) { throw 'Probe sentinel comparison failed.' }
        } finally { $officeStream.Dispose() }
        @{ allowed=$true; denied=$false; conclusive=$true }
    } catch {
        $officeDenied = Test-OfficeAccessDenied $_.Exception
        @{ allowed=$false; denied=$officeDenied; conclusive=$officeDenied }
    }
}
function Get-OfficeLogSnapshot([string]$Directory) {
    $officeFiles = [Collections.Generic.List[string]]::new()
    $officeQueue = [Collections.Generic.Queue[string]]::new(); $officeQueue.Enqueue($Directory)
    while ($officeQueue.Count) {
        foreach ($officeItem in [IO.DirectoryInfo]::new($officeQueue.Dequeue()).EnumerateFileSystemInfos()) {
            if (($officeItem.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw 'Log directory links are forbidden.' }
            if ($officeItem -is [IO.DirectoryInfo]) { $officeQueue.Enqueue($officeItem.FullName) }
            else {
                $officeHash = [Convert]::ToHexString([Security.Cryptography.SHA256]::HashData([IO.File]::ReadAllBytes($officeItem.FullName)))
                $officeFiles.Add([IO.Path]::GetRelativePath($Directory,$officeItem.FullName) + ':' + $officeHash)
            }
            if ($officeFiles.Count -gt 2000) { throw 'Unexpected probe log inventory size.' }
        }
    }
    @($officeFiles | Sort-Object -CaseSensitive)
}
function Invoke-OfficeProbeChild([string]$Executable, [string[]]$Arguments, [string]$WorkingDirectory,
    [string]$TemporaryDirectory, [Collections.IDictionary]$AdditionalEnvironment) {
    $officeStart = [Diagnostics.ProcessStartInfo]::new()
    $officeStart.FileName=$Executable; $officeStart.WorkingDirectory=$WorkingDirectory
    $officeStart.UseShellExecute=$false; $officeStart.CreateNoWindow=$true
    $officeStart.RedirectStandardInput=$true; $officeStart.RedirectStandardOutput=$true; $officeStart.RedirectStandardError=$true
    foreach ($officeArgument in $Arguments) { $officeStart.ArgumentList.Add($officeArgument) }
    $officeStart.Environment.Clear()
    foreach ($officeKey in @('SystemRoot','WINDIR')) {
        $officeValue=[Environment]::GetEnvironmentVariable($officeKey)
        if ($officeValue) { $officeStart.Environment[$officeKey]=$officeValue }
    }
    $officeStart.Environment['TEMP']=$TemporaryDirectory; $officeStart.Environment['TMP']=$TemporaryDirectory
    foreach ($officeKey in $AdditionalEnvironment.Keys) { $officeStart.Environment[$officeKey]=[string]$AdditionalEnvironment[$officeKey] }
    $officeChild=$null
    try {
        $officeChild=[Diagnostics.Process]::Start($officeStart)
        $officeChild.StandardInput.Close()
        $officeOut=$officeChild.StandardOutput.ReadToEndAsync(); $officeErr=$officeChild.StandardError.ReadToEndAsync()
        $officeTimedOut=!$officeChild.WaitForExit(15000)
        if ($officeTimedOut) { $officeChild.Kill($true); $null=$officeChild.WaitForExit(5000) }
        if (!$officeChild.HasExited) { throw 'Owned probe child did not exit.' }
        @{ timedOut=$officeTimedOut; exitCode=$officeChild.ExitCode;
           stdout=$officeOut.GetAwaiter().GetResult(); stderr=$officeErr.GetAwaiter().GetResult() }
    } finally {
        if ($officeChild) {
            if (!$officeChild.HasExited) { $officeChild.Kill($true); $null=$officeChild.WaitForExit(5000) }
            $officeChild.Dispose()
        }
    }
}

$officeResult = [ordered]@{ identityMatches=$false; administratorAbsent=$false; manifestValid=$false;
    filesystemPassed=$false; runtimeSmokePassed=$false; supervisorRejectedBeforeLaunch=$false;
    logsUnchanged=$false; passed=$false; targets=[ordered]@{} }
$officeCanWriteResult=$false
try {
    if ($PSVersionTable.PSVersion.Major -lt 7) { throw 'PowerShell 7 is required.' }
    $officeRoot=Get-OfficeFullPath $InstallationRoot
    if ($officeRoot -ine 'C:\ProgramData\EnztronicOffice') { throw 'Unexpected installation root.' }
    $officeLogs=Join-Path $officeRoot 'logs'; $officeTemp=Join-Path $officeLogs 'temp'
    $officeResultFile=Get-OfficeFullPath $ResultPath
    if ([IO.Path]::GetDirectoryName($officeResultFile) -ine $officeLogs -or
        [IO.Path]::GetFileName($officeResultFile) -notmatch '^identity-probe-[a-fA-F0-9-]{32,36}\.json$') { throw 'Unexpected probe result path.' }
    Assert-OfficeNoLink $officeRoot; Assert-OfficeNoLink $officeLogs; Assert-OfficeNoLink $officeTemp
    $officeCanWriteResult=$true
    $officeIdentity=[Security.Principal.WindowsIdentity]::GetCurrent()
    $officeResult.identityMatches=$officeIdentity.User.Value -ceq $ExpectedSid
    $officeResult.administratorAbsent=!([Security.Principal.WindowsPrincipal]::new($officeIdentity).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator))
    if (!$officeResult.identityMatches -or !$officeResult.administratorAbsent) { throw 'Probe must run as the dedicated nonadministrator identity.' }
    $officeManifestPath=Join-Path $officeRoot 'verification-targets.json'; Assert-OfficeNoLink $officeManifestPath
    $officeManifest=[IO.File]::ReadAllText($officeManifestPath) | ConvertFrom-Json -AsHashtable
    if ($officeManifest.version -ne 1 -or $officeManifest.expectedSid -cne $ExpectedSid -or
        $officeManifest.targets -isnot [array] -or !$officeManifest.targets.Count) { throw 'Unexpected verification manifest.' }
    $officeExpectedPaths=@{
        nodePath=(Join-Path $officeRoot 'tools\node.exe'); powerShellPath=(Join-Path $officeRoot 'tools\powershell\pwsh.exe');
        loaderPath=(Join-Path $officeRoot 'runtime\apps\office-worker\node_modules\tsx\dist\loader.mjs');
        entryPath=(Join-Path $officeRoot 'runtime\apps\office-worker\src\index.ts');
        workingDirectory=(Join-Path $officeRoot 'runtime');
        supervisorPath=(Join-Path $officeRoot 'runtime\apps\office-worker\start-office-worker.ps1');
        pendingConfigPath=(Join-Path $officeRoot 'configuration\pending.json')
    }
    foreach ($officeKey in $officeExpectedPaths.Keys) {
        if ((Get-OfficeFullPath ([string]$officeManifest.runtime[$officeKey])) -ine $officeExpectedPaths[$officeKey]) { throw 'Unexpected runtime probe path.' }
        Assert-OfficeNoLink $officeExpectedPaths[$officeKey]
    }
    $officeLabels=[Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
    foreach ($officeTarget in $officeManifest.targets) {
        if ($officeTarget.label -notmatch '^[a-zA-Z][a-zA-Z0-9_-]{0,63}$' -or !$officeLabels.Add($officeTarget.label) -or
            $officeTarget.kind -notin @('file','directory') -or $officeTarget.expectedRead -isnot [bool] -or
            $officeTarget.expectedWrite -isnot [bool]) { throw 'Unexpected access target.' }
        $officeTargetPath=Get-OfficeFullPath ([string]$officeTarget.path)
        if ($officeTarget.kind -eq 'file') {
            $officeRead=Test-OfficeFileAccess $officeTargetPath ([IO.FileAccess]::Read)
            $officeWrite=Test-OfficeFileAccess $officeTargetPath ([IO.FileAccess]::Write)
        } else {
            $officeRead=Test-OfficeDirectoryRead $officeTargetPath; $officeWrite=Test-OfficeDirectoryWrite $officeTargetPath
        }
        $officeTargetPassed=$officeRead.conclusive -and $officeWrite.conclusive -and
            ($officeRead.allowed -eq $officeTarget.expectedRead) -and ($officeWrite.allowed -eq $officeTarget.expectedWrite)
        $officeResult.targets[$officeTarget.label]=[ordered]@{ readAllowed=[bool]$officeRead.allowed; readDenied=[bool]$officeRead.denied;
            readConclusive=[bool]$officeRead.conclusive; writeAllowed=[bool]$officeWrite.allowed; writeDenied=[bool]$officeWrite.denied;
            writeConclusive=[bool]$officeWrite.conclusive; passed=[bool]$officeTargetPassed }
    }
    $officeResult.manifestValid=$true
    $officeResult.filesystemPassed=@($officeResult.targets.Values | Where-Object { !$_.passed }).Count -eq 0
    if (!$officeResult.filesystemPassed) { throw 'Worker filesystem boundary failed.' }

    $officePending=[IO.File]::ReadAllText($officeExpectedPaths.pendingConfigPath) | ConvertFrom-Json -AsHashtable
    if ($officePending.OFFICE_ENABLED -cne 'false' -or $officePending.OFFICE_DEMO_WORKER -cne 'false' -or
        ![string]::IsNullOrEmpty($officePending.OFFICE_WORKER_DATABASE_URL)) { throw 'Pending configuration must remain disabled with no database URL.' }
    $officeBefore=Get-OfficeLogSnapshot $officeLogs
    $officeGuardPath=Join-Path $officeTemp ('identity-network-guard-' + [Guid]::NewGuid().ToString('N') + '.mjs')
    $officeReadyPath=$officeGuardPath+'.ready'
    try {
        $officeGuard=@'
import fs from 'node:fs';
import net from 'node:net';
import tls from 'node:tls';
import dgram from 'node:dgram';
import { syncBuiltinESMExports } from 'node:module';
const forbidden=()=>{throw new Error('office_probe_network_forbidden');};
net.connect=forbidden; net.createConnection=forbidden; net.Socket.prototype.connect=forbidden;
tls.connect=forbidden; dgram.createSocket=forbidden; globalThis.fetch=forbidden;
syncBuiltinESMExports();
fs.writeFileSync(process.env.OFFICE_PROBE_GUARD_READY,'ready',{flag:'wx'});
'@
        $officeGuardStream=[IO.FileStream]::new($officeGuardPath,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::None)
        try { $officeGuardBytes=[Text.UTF8Encoding]::new($false).GetBytes($officeGuard); $officeGuardStream.Write($officeGuardBytes,0,$officeGuardBytes.Length) } finally { $officeGuardStream.Dispose() }
        $officeSmoke=Invoke-OfficeProbeChild $officeExpectedPaths.nodePath @('--import',([Uri]$officeGuardPath).AbsoluteUri,
            '--import',([Uri]$officeExpectedPaths.loaderPath).AbsoluteUri,$officeExpectedPaths.entryPath,'--once') $officeExpectedPaths.workingDirectory $officeTemp @{
                OFFICE_ENABLED='false'; OFFICE_DEMO_WORKER='false'; OFFICE_WORKER_DATABASE_URL=''; OFFICE_WORKER_CONCURRENCY='1';
                OFFICE_WORKER_LOG_DIRECTORY=$officeLogs; OFFICE_PROBE_GUARD_READY=$officeReadyPath; TSX_DISABLE_CACHE='1'; NODE_DISABLE_COMPILE_CACHE='1'
            }
        $officeResult.runtimeSmokePassed=!$officeSmoke.timedOut -and $officeSmoke.exitCode -eq 1 -and
            [string]::IsNullOrEmpty($officeSmoke.stdout) -and $officeSmoke.stderr.StartsWith('configuration_required:') -and
            !$officeSmoke.stderr.Contains('office_probe_network_forbidden') -and [IO.File]::Exists($officeReadyPath)
    } finally {
        # Delete only the two exact files created by this probe, never directories.
        foreach ($officeOwnedFile in @($officeReadyPath,$officeGuardPath)) { if ([IO.File]::Exists($officeOwnedFile)) { [IO.File]::Delete($officeOwnedFile) } }
    }
    $officeSupervisorBefore=Get-OfficeLogSnapshot $officeLogs
    # The child catches only the exact disabled-configuration rejection, avoiding
    # console formatting/line-wrap ambiguity without exposing raw exception text.
    $officeSupervisorCommand = '$ErrorActionPreference=''Stop''; try { & ''' + $officeExpectedPaths.supervisorPath +
        ''' -NodeExecutable ''' + $officeExpectedPaths.nodePath + ''' -ConfigurationFile ''' + $officeExpectedPaths.pendingConfigPath +
        ''' -LogDirectory ''' + $officeLogs + ''' -Once; exit 0 } catch { if ($_.Exception.Message -ceq ''Demo worker requires deliberate activation and an Office-only database role.'') { [Console]::Error.WriteLine(''office_probe_pending_rejected''); exit 17 }; [Console]::Error.WriteLine(''office_probe_supervisor_unexpected''); exit 18 }'
    $officeSupervisor=Invoke-OfficeProbeChild $officeExpectedPaths.powerShellPath @('-NoLogo','-NoProfile','-NonInteractive','-Command',
        $officeSupervisorCommand) $officeExpectedPaths.workingDirectory $officeTemp @{}
    $officeAfter=Get-OfficeLogSnapshot $officeLogs
    $officeSupervisorUnchanged=($officeSupervisorBefore -join "`n") -ceq ($officeAfter -join "`n")
    $officeResult.supervisorRejectedBeforeLaunch=!$officeSupervisor.timedOut -and $officeSupervisor.exitCode -eq 17 -and
        [string]::IsNullOrEmpty($officeSupervisor.stdout) -and
        $officeSupervisor.stderr.Trim() -ceq 'office_probe_pending_rejected' -and $officeSupervisorUnchanged
    $officeResult.logsUnchanged=($officeBefore -join "`n") -ceq ($officeAfter -join "`n")
    $officeResult.passed=$officeResult.identityMatches -and $officeResult.administratorAbsent -and $officeResult.manifestValid -and
        $officeResult.filesystemPassed -and $officeResult.runtimeSmokePassed -and $officeResult.supervisorRejectedBeforeLaunch -and $officeResult.logsUnchanged
} catch {
    # Raw exceptions, paths, child output and configuration values are never emitted.
    $officeResult.passed=$false
}
if ($officeCanWriteResult) {
    try {
        $officeResultStream=[IO.FileStream]::new($officeResultFile,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::None)
        try { $officeResultBytes=[Text.UTF8Encoding]::new($false).GetBytes(($officeResult | ConvertTo-Json -Depth 8)); $officeResultStream.Write($officeResultBytes,0,$officeResultBytes.Length) }
        finally { $officeResultStream.Dispose() }
    } catch { $officeResult.passed=$false }
}
if ($officeResult.passed) { exit 0 } else { exit 1 }
