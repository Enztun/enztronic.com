import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const workerRoot = fileURLToPath(new URL('../', import.meta.url));
const installer = path.join(workerRoot, 'install-office-worker-task.ps1');
const powershell = process.env.OFFICE_TEST_PWSH ?? 'pwsh.exe';
const windows = process.platform === 'win32';
const fixturePassword = 'installer_fixture_password_only';
const workerSid = 'S-1-5-21-100-200-300-1007';

function launch(args, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn(powershell, ['-NoProfile', '-NonInteractive', ...args], { cwd, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = '';
    child.stdout.on('data', value => { stdout += value; });
    child.stderr.on('data', value => { stderr += value; });
    const timer = setTimeout(() => { child.kill(); reject(new Error('Mocked installer test timed out.')); }, 30000);
    child.once('error', error => { clearTimeout(timer); reject(error); });
    child.once('exit', code => { clearTimeout(timer); resolve({ code, stdout, stderr }); });
  });
}

const mockRegistration = String.raw`
param([string]$Installer,[string]$Node,[string]$Root,[string]$Case)
$ErrorActionPreference = 'Stop'
$configPath = Join-Path $Root 'office.json'
$logs = Join-Path $Root 'logs'
# Load definitions through the no-side-effect default plan, then mock every OS boundary.
$null = . $Installer -NodeExecutable $Node -ConfigurationFile $configPath -LogDirectory $logs -PowerShellExecutable (Join-Path $PSHOME 'pwsh.exe')
$script:workerSid = 'S-1-5-21-100-200-300-1007'
$script:registrationCalls = 0
$script:schedulerCalls = 0
$script:runCalls = 0
$script:registered = $null
function Get-ScheduledTask { throw 'CIM task access is forbidden in disabled preparation.' }
function Register-ScheduledTask { throw 'CIM task registration is forbidden in disabled preparation.' }
function Start-ScheduledTask { throw 'Task start is forbidden.' }
function Start-Service { throw 'Service start is forbidden.' }
function Get-OfficeWorkerCurrentSid { 'S-1-5-21-100-200-300-1000' }
function Resolve-OfficeWorkerAccountSid([string]$Account) {
  if ($Account -eq $script:workerSid -or $Account -eq 'fixture-worker') { return $script:workerSid }
  if ($Account -eq 'fixture-other' -or $Account -eq 'S-1-5-21-100-200-300-1000') { return 'S-1-5-21-100-200-300-1000' }
  throw 'Unknown mock account.'
}
$script:trigger = [pscustomobject]@{ Enabled=$null; Delay=$null }
$script:action = [pscustomobject]@{ Path=$null; Arguments=$null; WorkingDirectory=$null }
$triggers = [pscustomobject]@{}
$triggers | Add-Member ScriptMethod Create { param($Kind) if ($Kind -ne 8) { throw 'Expected a boot trigger.' }; return $script:trigger }
$actions = [pscustomobject]@{}
$actions | Add-Member ScriptMethod Create { param($Kind) if ($Kind -ne 0) { throw 'Expected an executable action.' }; return $script:action }
$script:definition = [pscustomobject]@{
  RegistrationInfo=[pscustomobject]@{ Description=$null }
  Principal=[pscustomobject]@{ UserId=$null; LogonType=$null; RunLevel=$null }
  Settings=[pscustomobject]@{ Enabled=$null; Hidden=$null; AllowDemandStart=$null; StartWhenAvailable=$null; MultipleInstances=$null; RestartCount=$null; RestartInterval=$null; ExecutionTimeLimit=$null; DisallowStartIfOnBatteries=$null; StopIfGoingOnBatteries=$null }
  Triggers=$triggers
  Actions=$actions
}
$script:folder = [pscustomobject]@{}
$script:folder | Add-Member ScriptMethod GetTask {
  param($Name)
  if ($Name -ne 'EnztronicOfficeWorker') { throw 'Unexpected task name.' }
  if ($Case -eq 'collision') { return [pscustomobject]@{ Enabled=$false } }
  if ($Case -eq 'inspection-failure') { throw [Runtime.InteropServices.COMException]::new('Mock access denied.', -2147024891) }
  throw [Runtime.InteropServices.COMException]::new('Mock task missing.', -2147024894)
}
$script:folder | Add-Member ScriptMethod RegisterTaskDefinition {
  param($Name,$Definition,$Flags,$UserId,$Password,$Logon,$Sddl)
  $script:registrationCalls++
  $script:registered = @{
    taskName=$Name; flags=$Flags; userSid=$UserId; logonType=$Logon; runLevel=$Definition.Principal.RunLevel
    principalSid=$Definition.Principal.UserId; principalLogonType=$Definition.Principal.LogonType
    enabledAtRegistration=$Definition.Settings.Enabled; triggerEnabledAtRegistration=$script:trigger.Enabled
    allowDemandStart=$Definition.Settings.AllowDemandStart; delay=$script:trigger.Delay; startWhenAvailable=$Definition.Settings.StartWhenAvailable
    passwordMatched=($Password -ceq 'installer_fixture_password_only'); passwordAbsent=($null -eq $Password)
    hiddenArguments=$script:action.Arguments.Contains('-WindowStyle Hidden'); executable=$script:action.Path
  }
  if ($Definition.Settings.Enabled -ne $false -or $script:trigger.Enabled -ne $false) { throw 'Task must already be disabled at registration.' }
  if ($Case -eq 'registration-race') { throw [Runtime.InteropServices.COMException]::new('installer_fixture_password_only must not escape.', -2147024713) }
  $task = [pscustomobject]@{ Enabled=$false }
  $task | Add-Member ScriptMethod Run { $script:runCalls++; throw 'Task start forbidden.' }
  return $task
}
$script:scheduler = [pscustomobject]@{}
$script:scheduler | Add-Member ScriptMethod Connect { }
$script:scheduler | Add-Member ScriptMethod GetFolder { param($Name) if ($Name -ne [string][char]92) { throw 'Unexpected task folder.' }; return $script:folder }
$script:scheduler | Add-Member ScriptMethod NewTask { param($Flags) return $script:definition }
function Get-OfficeWorkerTaskScheduler { $script:schedulerCalls++; return $script:scheduler }
$secure = ConvertTo-SecureString 'installer_fixture_password_only' -AsPlainText -Force
$credentialName = if ($Case -eq 'credential-mismatch') { 'fixture-other' } else { 'fixture-worker' }
$credential = [PSCredential]::new($credentialName,$secure)
$sid = if ($Case -eq 'owner-sid') { 'S-1-5-21-100-200-300-1000' } elseif ($Case -eq 'missing-sid') { '' } elseif ($Case -eq 'builtin-sid') { 'S-1-5-18' } else { $script:workerSid }
$logon = if ($Case -eq 's4u') { 'S4U' } else { 'Password' }
if ($Case -in @('s4u','missing-credential')) { $credential = $null }
$errorSummary = $null
$result = $null
try { $result = Register-OfficeWorkerDisabledTask -AccountSid $sid -LogonType $logon -Credential $credential | ConvertFrom-Json }
catch { $errorSummary = $_.Exception.Message }
@{ result=$result; error=$errorSummary; registrationCalls=$script:registrationCalls; schedulerCalls=$script:schedulerCalls; runCalls=$script:runCalls; recorded=$script:registered } | ConvertTo-Json -Depth 6 -Compress
`;

async function fixture(run, configuration = { OFFICE_ENABLED: 'false', OFFICE_DEMO_WORKER: 'false' }) {
  const directory = await mkdtemp(path.join(tmpdir(), 'office-worker-installer-'));
  try {
    await mkdir(path.join(directory, 'logs'));
    await writeFile(path.join(directory, 'office.json'), JSON.stringify(configuration));
    const wrapper = path.join(directory, 'mock-register.ps1');
    await writeFile(wrapper, mockRegistration);
    return await run(directory, wrapper);
  } finally {
    assert.equal(path.dirname(path.resolve(directory)), path.resolve(tmpdir()));
    assert.ok(path.basename(directory).startsWith('office-worker-installer-'));
    await rm(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  }
}
async function mockedCase(directory, wrapper, scenario) {
  const result = await launch(['-File', wrapper, '-Installer', installer, '-Node', process.execPath, '-Root', directory, '-Case', scenario], directory);
  assert.equal(result.code, 0, result.stderr);
  assert.ok(!result.stdout.includes(fixturePassword));
  assert.ok(!result.stderr.includes(fixturePassword));
  return JSON.parse(result.stdout);
}

test('disabled Password preparation registers an explicit dedicated SID, disabled from its first definition and never starts', { skip: !windows }, async () => fixture(async (directory, wrapper) => {
  const actual = await mockedCase(directory, wrapper, 'password');
  assert.equal(actual.error, null);
  assert.equal(actual.registrationCalls, 1);
  assert.equal(actual.schedulerCalls, 1);
  assert.equal(actual.runCalls, 0);
  const { executable, ...recorded } = actual.recorded;
  assert.equal(path.basename(executable).toLowerCase(), 'pwsh.exe');
  assert.deepEqual(recorded, {
    taskName: 'EnztronicOfficeWorker', flags: 2, userSid: workerSid, logonType: 1, runLevel: 0,
    principalSid: workerSid, principalLogonType: 1, enabledAtRegistration: false, triggerEnabledAtRegistration: false,
    allowDemandStart: false, delay: 'PT1M', startWhenAvailable: true, passwordMatched: true, passwordAbsent: false,
    hiddenArguments: true,
  });
  assert.equal(actual.result.mode, 'registered_disabled');
  assert.equal(actual.result.enabled, false);
  assert.equal(actual.result.triggerEnabled, false);
  assert.equal(actual.result.startsNow, false);
  assert.equal(actual.result.accountSid, workerSid);
  assert.match(actual.result.availability, /owner logon/);
}));

test('optional S4U preparation remains disabled and supplies no password or owner identity', { skip: !windows }, async () => fixture(async (directory, wrapper) => {
  const actual = await mockedCase(directory, wrapper, 's4u');
  assert.equal(actual.error, null);
  assert.equal(actual.recorded.logonType, 2);
  assert.equal(actual.recorded.passwordAbsent, true);
  assert.equal(actual.recorded.userSid, workerSid);
  assert.equal(actual.recorded.enabledAtRegistration, false);
  assert.equal(actual.runCalls, 0);
  assert.match(actual.result.s4uLimit, /no network or EFS/);
}));

test('preparation refuses missing, builtin, owner or mismatched identities before reaching the scheduler', { skip: !windows }, async () => fixture(async (directory, wrapper) => {
  for (const scenario of ['missing-sid', 'builtin-sid', 'owner-sid', 'credential-mismatch', 'missing-credential']) {
    const actual = await mockedCase(directory, wrapper, scenario);
    assert.ok(actual.error, scenario);
    assert.equal(actual.registrationCalls, 0, scenario);
    assert.equal(actual.schedulerCalls, 0, scenario);
    assert.equal(actual.runCalls, 0, scenario);
  }
}));

test('enabled or boolean preparation flags fail before scheduler access', { skip: !windows }, async () => {
  for (const flags of [{ OFFICE_ENABLED: 'true', OFFICE_DEMO_WORKER: 'false' }, { OFFICE_ENABLED: 'false', OFFICE_DEMO_WORKER: 'true' }, { OFFICE_ENABLED: false, OFFICE_DEMO_WORKER: false }]) {
    await fixture(async (directory, wrapper) => {
      const actual = await mockedCase(directory, wrapper, 'password');
      assert.match(actual.error, /exact OFFICE_ENABLED=false and OFFICE_DEMO_WORKER=false/);
      assert.equal(actual.schedulerCalls, 0);
      assert.equal(actual.registrationCalls, 0);
    }, flags);
  }
});

test('existing task, uncertain inspection and create-only registration races cannot overwrite or start a task', { skip: !windows }, async () => fixture(async (directory, wrapper) => {
  for (const scenario of ['collision', 'inspection-failure', 'registration-race']) {
    const actual = await mockedCase(directory, wrapper, scenario);
    assert.ok(actual.error, scenario);
    assert.equal(actual.registrationCalls, scenario === 'registration-race' ? 1 : 0, scenario);
    assert.equal(actual.runCalls, 0, scenario);
    if (actual.recorded) assert.equal(actual.recorded.flags, 2);
  }
}));

test('disabled preparation and legacy activation are mutually exclusive before any account or task work', { skip: !windows }, async () => fixture(async directory => {
  const actual = await launch(['-File', installer, '-NodeExecutable', process.execPath, '-ConfigurationFile', path.join(directory, 'office.json'), '-LogDirectory', path.join(directory, 'logs'), '-Activate', '-RegisterDisabled'], directory);
  assert.notEqual(actual.code, 0);
  assert.match(actual.stderr, /Choose either legacy interactive activation or disabled dedicated-account preparation/);
}));

test('legacy Activate retains interactive limited registration without starting a task', { skip: !windows }, async () => fixture(async directory => {
  const wrapper = path.join(directory, 'legacy.ps1');
  await writeFile(wrapper, String.raw`
param([string]$Installer,[string]$Node,[string]$Root)
$ErrorActionPreference = 'Stop'
$global:officeInstallerLegacyMock = @{ registrations=0; recorded=$null }
function Get-ScheduledTask { param($TaskName,$ErrorAction) return $null }
function New-ScheduledTaskAction { param($Execute,$Argument,$WorkingDirectory) return @{ Execute=$Execute; Arguments=$Argument; WorkingDirectory=$WorkingDirectory } }
function New-ScheduledTaskTrigger { param([switch]$AtLogOn,$User) return @{ AtLogOn=[bool]$AtLogOn; HasExplicitUser=[bool]$User } }
function New-ScheduledTaskPrincipal { param($UserId,$LogonType,$RunLevel) return @{ HasExplicitUser=[bool]$UserId; LogonType=$LogonType; RunLevel=$RunLevel } }
function New-ScheduledTaskSettingsSet { param($MultipleInstances,$RestartCount,$RestartInterval,$ExecutionTimeLimit) return @{ MultipleInstances=$MultipleInstances; RestartCount=$RestartCount } }
function Register-ScheduledTask { param($TaskName,$Action,$Trigger,$Principal,$Settings) $global:officeInstallerLegacyMock.registrations++; $global:officeInstallerLegacyMock.recorded=@{ TaskName=$TaskName; Trigger=$Trigger; Principal=$Principal; Settings=$Settings } }
function Start-ScheduledTask { throw 'Task start forbidden.' }
function Start-Service { throw 'Service start forbidden.' }
$message = & $Installer -NodeExecutable $Node -ConfigurationFile (Join-Path $Root 'office.json') -LogDirectory (Join-Path $Root 'logs') -PowerShellExecutable (Join-Path $PSHOME 'pwsh.exe') -Activate
@{ registrations=$global:officeInstallerLegacyMock.registrations; recorded=$global:officeInstallerLegacyMock.recorded; saysNotStarted=([string]$message).Contains('Not started.') } | ConvertTo-Json -Depth 6 -Compress
`);
  const result = await launch(['-File', wrapper, '-Installer', installer, '-Node', process.execPath, '-Root', directory], directory);
  assert.equal(result.code, 0, result.stderr);
  const actual = JSON.parse(result.stdout);
  assert.equal(actual.registrations, 1);
  assert.equal(actual.recorded.TaskName, 'EnztronicOfficeWorker');
  assert.deepEqual(actual.recorded.Trigger, { AtLogOn: true, HasExplicitUser: true });
  assert.deepEqual(actual.recorded.Principal, { HasExplicitUser: true, LogonType: 'Interactive', RunLevel: 'Limited' });
  assert.equal(actual.saysNotStarted, true);
}));
