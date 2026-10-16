[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][string]$Root,
    [string]$PythonPath,
    [switch]$ActivateSchedule
)

# Plan only by default. This script never copies configuration or reads secrets.
# InteractiveToken needs this user signed in (a locked session is sufficient).
# WakeToRun depends on Windows/firmware wake timers; it cannot power on a shut-down
# PC. A delayed logon trigger catches up after startup/sign-in. No boot/SYSTEM task,
# password, elevation or automatic retry of a vulnerability finding is requested.
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$TaskName = 'Enztronic Website Audit'
$TaskPath = '\'
$ManagedSource = 'Enztronic.website-audit.windows.v1'

function ConvertTo-WindowsArgument([string]$Value) {
    # CommandLineToArgvW/CPython rules, including quotes and trailing backslashes.
    $builder = New-Object System.Text.StringBuilder
    [void]$builder.Append('"')
    $slashes = 0
    foreach ($character in $Value.ToCharArray()) {
        if ($character -eq '\') { $slashes++; continue }
        if ($character -eq '"') {
            [void]$builder.Append(('\' * (2 * $slashes + 1)))
        } else {
            [void]$builder.Append(('\' * $slashes))
        }
        [void]$builder.Append($character)
        $slashes = 0
    }
    [void]$builder.Append(('\' * (2 * $slashes)))
    [void]$builder.Append('"')
    return $builder.ToString()
}

function ConvertTo-XmlText([string]$Value) {
    return [System.Security.SecurityElement]::Escape($Value)
}

function Read-TaskXml([string]$Text) {
    $settings = New-Object System.Xml.XmlReaderSettings
    $settings.DtdProcessing = [System.Xml.DtdProcessing]::Prohibit
    $settings.XmlResolver = $null
    $settings.MaxCharactersInDocument = 1048576
    $reader = [System.Xml.XmlReader]::Create((New-Object System.IO.StringReader($Text)), $settings)
    try {
        $document = New-Object System.Xml.XmlDocument
        $document.XmlResolver = $null
        $document.Load($reader)
        return ,$document
    } finally { $reader.Dispose() }
}

function Get-TaskNodeText($Document, [string]$Path) {
    $namespace = New-Object System.Xml.XmlNamespaceManager($Document.NameTable)
    $namespace.AddNamespace('t', 'http://schemas.microsoft.com/windows/2004/02/mit/task')
    $nodes = $Document.SelectNodes($Path, $namespace)
    # Windows omits schema-default values when it exports a registered task.
    # Only these documented defaults may stand in for an absent element:
    # https://learn.microsoft.com/windows/win32/taskschd/task-scheduler-schema
    $defaults = @{
        '/t:Task/t:Triggers/t:CalendarTrigger/t:Enabled' = 'true'
        '/t:Task/t:Triggers/t:LogonTrigger/t:Enabled' = 'true'
        '/t:Task/t:Principals/t:Principal/t:RunLevel' = 'LeastPrivilege'
        '/t:Task/t:Settings/t:RunOnlyIfNetworkAvailable' = 'false'
        '/t:Task/t:Settings/t:AllowStartOnDemand' = 'true'
        '/t:Task/t:Settings/t:Enabled' = 'true'
        '/t:Task/t:Settings/t:Hidden' = 'false'
        '/t:Task/t:Settings/t:RunOnlyIfIdle' = 'false'
        '/t:Task/t:Settings/t:Priority' = '7'
    }
    if ($nodes.Count -eq 0 -and $defaults.ContainsKey($Path)) { return $defaults[$Path] }
    if ($nodes.Count -ne 1) { throw 'Task definition has a missing or duplicate required field.' }
    $value = $nodes[0].InnerText
    if ($Path.EndsWith('/t:UserId') -and $value -notmatch '^S-1-') {
        # The scheduler may export the logon identity as DOMAIN\name.
        $value = (New-Object Security.Principal.NTAccount($value)).Translate([Security.Principal.SecurityIdentifier]).Value
    }
    return $value
}

function Assert-TaskOwnership($Document, [string]$Sid) {
    if ((Get-TaskNodeText $Document '/t:Task/t:RegistrationInfo/t:Source') -cne $ManagedSource -or
        (Get-TaskNodeText $Document '/t:Task/t:RegistrationInfo/t:Author') -cne $Sid -or
        (Get-TaskNodeText $Document '/t:Task/t:Principals/t:Principal/t:UserId') -cne $Sid) {
        throw 'Refusing to overwrite an unrelated existing Enztronic Website Audit task.'
    }
}

function Assert-RegisteredDefinition($Document, $Expected, [string]$Sid) {
    Assert-TaskOwnership $Document $Sid
    foreach ($path in $Expected.Keys) {
        if ((Get-TaskNodeText $Document $path) -cne $Expected[$path]) {
            throw 'Registered task definition does not match the reviewed plan.'
        }
    }
    $namespace = New-Object System.Xml.XmlNamespaceManager($Document.NameTable)
    $namespace.AddNamespace('t', 'http://schemas.microsoft.com/windows/2004/02/mit/task')
    foreach ($rule in @(@('/t:Task/t:Actions/*', 1), @('/t:Task/t:Principals/*', 1),
                        @('/t:Task/t:Triggers/*', 2), @('/t:Task/t:Settings/t:RestartOnFailure', 0))) {
        if ($Document.SelectNodes($rule[0], $namespace).Count -ne $rule[1]) {
            throw 'Registered task contains unexpected actions, principals, triggers or retry settings.'
        }
    }
}

if ($Root -notmatch '^[A-Za-z]:[\\/]') { throw 'Root must be an absolute local Windows directory.' }
$Root = [System.IO.Path]::GetFullPath($Root).TrimEnd('\')
if ($Root -match '^[A-Za-z]:$' -or -not (Test-Path -LiteralPath $Root -PathType Container)) {
    throw 'Provision the private runtime directory before planning a task.'
}
$runner = Join-Path $Root 'scheduled_run.py'
if (-not (Test-Path -LiteralPath $runner -PathType Leaf)) {
    throw 'Provision the reviewed scheduled_run.py snapshot in Root first.'
}
if (-not $PythonPath) { $PythonPath = (Get-Command python.exe -ErrorAction Stop).Source }
if ($PythonPath -notmatch '^[A-Za-z]:[\\/]') { throw 'PythonPath must be absolute.' }
$PythonPath = [System.IO.Path]::GetFullPath($PythonPath)
if (-not (Test-Path -LiteralPath $PythonPath -PathType Leaf)) { throw 'PythonPath does not exist.' }
$pythonw = Join-Path ([System.IO.Path]::GetDirectoryName($PythonPath)) 'pythonw.exe'
if (-not (Test-Path -LiteralPath $pythonw -PathType Leaf)) { throw 'A sibling pythonw.exe is required for windowless execution.' }
if ((Get-TimeZone).Id -ne 'SE Asia Standard Time') {
    throw 'This plan requires the current Jakarta-compatible SE Asia Standard Time timezone; no system timezone is changed.'
}
$sid = [System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value
$arguments = (@($runner, '--root', $Root, '--mode', 'due') | ForEach-Object { ConvertTo-WindowsArgument $_ }) -join ' '
$next = (Get-Date).Date.AddHours(2).AddMinutes(30)
if ($next -le (Get-Date)) { $next = $next.AddDays(1) }
$boundary = $next.ToString("yyyy-MM-dd'T'HH:mm:ss", [Globalization.CultureInfo]::InvariantCulture) + '+07:00'
$xml = @"
<?xml version="1.0" encoding="UTF-16"?>
<Task version="1.4" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
  <RegistrationInfo><Author>$(ConvertTo-XmlText $sid)</Author><Source>$ManagedSource</Source><Description>Enztronic-only read-only audit; managed by the reviewed Windows installer.</Description></RegistrationInfo>
  <Triggers>
    <CalendarTrigger><StartBoundary>$boundary</StartBoundary><Enabled>true</Enabled><ScheduleByDay><DaysInterval>1</DaysInterval></ScheduleByDay></CalendarTrigger>
    <LogonTrigger><Enabled>true</Enabled><Delay>PT2M</Delay><UserId>$(ConvertTo-XmlText $sid)</UserId></LogonTrigger>
  </Triggers>
  <Principals><Principal id="Author"><UserId>$(ConvertTo-XmlText $sid)</UserId><LogonType>InteractiveToken</LogonType><RunLevel>LeastPrivilege</RunLevel></Principal></Principals>
  <Settings>
    <MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy><DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries><StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>
    <StartWhenAvailable>true</StartWhenAvailable><RunOnlyIfNetworkAvailable>false</RunOnlyIfNetworkAvailable><AllowStartOnDemand>true</AllowStartOnDemand><Enabled>true</Enabled><Hidden>false</Hidden><RunOnlyIfIdle>false</RunOnlyIfIdle><WakeToRun>true</WakeToRun><ExecutionTimeLimit>PT2H</ExecutionTimeLimit><Priority>7</Priority>
  </Settings>
  <Actions Context="Author"><Exec><Command>$(ConvertTo-XmlText $pythonw)</Command><Arguments>$(ConvertTo-XmlText $arguments)</Arguments><WorkingDirectory>$(ConvertTo-XmlText $Root)</WorkingDirectory></Exec></Actions>
</Task>
"@

$activated = $false
if ($ActivateSchedule) {
    $existingXml = $null
    try {
        # Query the exact task rather than enumerate the root folder. Some
        # Windows11 builds return not-found for CIM enumeration of owned tasks.
        $existingXml = Export-ScheduledTask -TaskName $TaskName -TaskPath $TaskPath -ErrorAction Stop
    } catch {
        # An empty root task folder returns the same documented not-found error
        # as an absent task. Permission/provider errors must still stop setup.
        if ($_.CategoryInfo.Category -ne [System.Management.Automation.ErrorCategory]::ObjectNotFound -or
            $_.FullyQualifiedErrorId -notmatch '0x80070002') { throw }
        $existingXml = $null
    }
    if ($existingXml) {
        Assert-TaskOwnership (Read-TaskXml $existingXml) $sid
    }
    $registration = @{TaskName = $TaskName; TaskPath = $TaskPath; Xml = $xml; ErrorAction = 'Stop'}
    if ($existingXml) { $registration.Force = $true }
    Register-ScheduledTask @registration | Out-Null
    $planned = Read-TaskXml $xml
    $namespace = New-Object System.Xml.XmlNamespaceManager($planned.NameTable)
    $namespace.AddNamespace('t', 'http://schemas.microsoft.com/windows/2004/02/mit/task')
    $expected = @{}
    foreach ($node in $planned.SelectNodes('/t:Task/t:Triggers//t:*[not(*)] | /t:Task/t:Settings/* | /t:Task/t:Actions/t:Exec/* | /t:Task/t:Principals/t:Principal/*', $namespace)) {
        $parts = @()
        $current = $node
        while ($current -is [System.Xml.XmlElement]) { $parts = @('t:' + $current.LocalName) + $parts; $current = $current.ParentNode }
        $expected['/' + ($parts -join '/')] = $node.InnerText
    }
    Assert-RegisteredDefinition (Read-TaskXml (Export-ScheduledTask -TaskName $TaskName -TaskPath $TaskPath -ErrorAction Stop)) $expected $sid
    $activated = $true
}
[ordered]@{
    task_name = $TaskName; task_path = $TaskPath; activated = $activated
    pythonw = $pythonw; arguments = $arguments; root = $Root
    schedule = 'Daily 02:30 WIB, plus current-user logon delayed 2 minutes; engine decides 14 UTC-date full cadence.'
    configuration = 'Uses the pre-provisioned runtime. No secret/configuration file is copied, read or changed; provision its private Windows ACL separately.'
    limits = 'Requires this user signed in. Sleep wake depends on wake timers. Powered-off/signed-out runs wait for startup/sign-in; catching up is not an always-on guarantee. No password, elevation, generic finding retries or visible helper console.'
    xml = $xml
} | ConvertTo-Json -Depth 4
