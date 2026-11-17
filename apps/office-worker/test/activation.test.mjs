import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const workerRoot = fileURLToPath(new URL('../', import.meta.url));
const script = path.join(workerRoot, 'activate-prepared-worker.ps1');
const powershell = process.env.OFFICE_TEST_PWSH ?? 'pwsh.exe';
const windows = process.platform === 'win32';
const password = 'activation_fixture_password_only';
const databasePassword = 'activation_db_password_only';

async function launch(args, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn(powershell, ['-NoProfile', '-NonInteractive', ...args], { cwd, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = '';
    child.stdout.on('data', value => { stdout += value; });
    child.stderr.on('data', value => { stderr += value; });
    const timer = setTimeout(() => { child.kill(); reject(new Error('Mocked activation test timed out.')); }, 30000);
    child.once('error', error => { clearTimeout(timer); reject(error); });
    child.once('exit', code => { clearTimeout(timer); resolve({ code, stdout, stderr }); });
  });
}
async function fixture(run) {
  const directory = await mkdtemp(path.join(tmpdir(), 'office-worker-activation-'));
  try { return await run(directory); }
  finally {
    assert.equal(path.dirname(path.resolve(directory)), path.resolve(tmpdir()));
    assert.ok(path.basename(directory).startsWith('office-worker-activation-'));
    await rm(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  }
}

const mockOperation = String.raw`
param([string]$Script,[string]$Scenario)
$ErrorActionPreference='Stop'
$null = . $Script
$global:officeActivationMock=@{accountEnabled=$false;accountChanges=@();registrations=@();runCalls=0;stopCalls=0;contextReads=0;forActivation=$null;security='O:SYG:SYD:(A;;FA;;;SY)(A;;GR;;;S-1-5-21-100-200-300-1000)'}
$global:officeActivationMock.originalSecurity=$global:officeActivationMock.security
$paths=Get-OfficeActivationPaths
$trigger=[pscustomobject]@{Type=8;Delay='PT1M';Enabled=$false}
$action=[pscustomobject]@{Type=0;Path=$paths.powershell;Arguments=(Get-OfficeActivationTaskArguments $paths);WorkingDirectory=$paths.worker}
$triggers=[pscustomobject]@{Count=1;Value=$trigger};$triggers|Add-Member ScriptMethod Item {param($Index) if($Index -ne 1){throw 'Unexpected trigger index.'};$this.Value}
$actions=[pscustomobject]@{Count=1;Value=$action};$actions|Add-Member ScriptMethod Item {param($Index) if($Index -ne 1){throw 'Unexpected action index.'};$this.Value}
$definition=[pscustomobject]@{
 Principal=[pscustomobject]@{UserId='S-1-5-21-100-200-300-1007';LogonType=1;RunLevel=0}
 Settings=[pscustomobject]@{Enabled=$false;AllowDemandStart=$false;StartWhenAvailable=$true;MultipleInstances=2;RestartCount=3;RestartInterval='PT1M';ExecutionTimeLimit='PT0S'}
 Triggers=$triggers;Actions=$actions
}
$task=[pscustomobject]@{Enabled=$false;State=1;Definition=$definition}
$task|Add-Member ScriptMethod GetSecurityDescriptor {param($Sections) if($Sections -ne 7){throw 'Unexpected security sections.'};$global:officeActivationMock.security}
$task|Add-Member ScriptMethod Run {
 param($Parameters)
 $global:officeActivationMock.runCalls++
 if($Scenario -eq 'run-fails'){throw 'activation_fixture_password_only must not escape.'}
 if(!$this.Enabled -or !$this.Definition.Triggers.Item(1).Enabled){throw 'Run before deliberate task enable.'}
 $this.State=4
}
$task|Add-Member ScriptMethod Stop {
 param($Flags)
 if($this.Enabled -or $this.Definition.Triggers.Item(1).Enabled){throw 'Future scheduling must be disabled before stop.'}
 $global:officeActivationMock.stopCalls++;$this.State=1
}
$global:officeActivationMock.task=$task
$folder=[pscustomobject]@{}
$folder|Add-Member ScriptMethod GetTask {param($Name) if($Name -ne 'EnztronicOfficeWorker'){throw 'Unexpected task name.'};$global:officeActivationMock.task}
$folder|Add-Member ScriptMethod RegisterTaskDefinition {
 param($Name,$Definition,$Flags,$UserId,$Password,$Logon,$Sddl)
 if($Password -cne 'activation_fixture_password_only'){throw 'Unexpected fixture credential.'}
 $global:officeActivationMock.registrations+=@{flags=$Flags;sid=$UserId;logon=$Logon;sddlPreserved=($Sddl -ceq $global:officeActivationMock.security);enabled=$Definition.Settings.Enabled;triggerEnabled=$Definition.Triggers.Item(1).Enabled}
 $global:officeActivationMock.task.Definition=$Definition
 $global:officeActivationMock.task.Enabled=$Definition.Settings.Enabled
 $global:officeActivationMock.security=if($Scenario -eq 'security-drift-on-enable' -and $Definition.Settings.Enabled){$Sddl+'(A;;GA;;;S-1-5-21-100-200-300-1000)'}else{$Sddl}
 if($global:officeActivationMock.task.State -notin @(2,4)){$global:officeActivationMock.task.State=if($Definition.Settings.Enabled){3}else{1}}
 $global:officeActivationMock.task
}
$credential=[PSCredential]::new('fixture-worker',(ConvertTo-SecureString 'activation_fixture_password_only' -AsPlainText -Force))
$global:officeActivationMock.context=@{paths=$paths;workerSid='S-1-5-21-100-200-300-1007';ownerSid='S-1-5-21-100-200-300-1000';credential=$credential;folder=$folder;task=$task;userEnabled=$false;runtime=@{hash=('a'*64);files=1296}}
function Test-OfficeActivationAdministrator {$Scenario -ne 'not-admin'}
function Get-OfficeActivationContext([bool]$ForActivation){$global:officeActivationMock.contextReads++;$global:officeActivationMock.forActivation=$ForActivation;$global:officeActivationMock.context}
function Set-OfficeActivationAccount($Context,[bool]$Enabled){$global:officeActivationMock.accountChanges+=,$Enabled;$global:officeActivationMock.accountEnabled=$Enabled}
function Get-OfficeActivationOwnedProcesses($Context){if($Scenario -eq 'stop-process-remains'){[pscustomobject]@{id=9001;kind='worker'}}}
function Enable-LocalUser {throw 'Actual identity commands forbidden.'}
function Disable-LocalUser {throw 'Actual identity commands forbidden.'}
function Register-ScheduledTask {throw 'Actual task commands forbidden.'}
function Start-ScheduledTask {throw 'Actual task commands forbidden.'}
function Stop-Process {throw 'Foreign process termination forbidden.'}
function Get-CimInstance {throw 'Actual process inventory forbidden in mocked operation.'}
if($Scenario -in @('stop','stop-process-remains')){$task.Enabled=$true;$task.State=4;$definition.Settings.Enabled=$true;$definition.Settings.AllowDemandStart=$true;$trigger.Enabled=$true;$global:officeActivationMock.accountEnabled=$true;$global:officeActivationMock.context.userEnabled=$true}
if($Scenario -eq 'wrong-task'){$definition.Principal.UserId='S-1-5-18'}
if($Scenario -eq 'already-enabled'){$task.Enabled=$true}
$result=$null;$failure=$null;$rollback=$null
try{$result=Invoke-OfficePreparedWorkerOperation -Mode $(if($Scenario -in @('stop','stop-process-remains')){'StopWorker'}else{'Activate'}) -TimeoutSeconds 0}
catch{$failure=$_.Exception.Message;if($_.Exception.Data.Contains('rollbackConfirmed')){$rollback=[bool]$_.Exception.Data['rollbackConfirmed']}}
@{result=$result;failure=$failure;rollback=$rollback;accountEnabled=$global:officeActivationMock.accountEnabled;accountChanges=@($global:officeActivationMock.accountChanges);registrations=@($global:officeActivationMock.registrations);runCalls=$global:officeActivationMock.runCalls;stopCalls=$global:officeActivationMock.stopCalls;contextReads=$global:officeActivationMock.contextReads;forActivation=$global:officeActivationMock.forActivation;originalSecurityRestored=($global:officeActivationMock.security -ceq $global:officeActivationMock.originalSecurity)}|ConvertTo-Json -Depth 7 -Compress
`;

async function operation(directory, scenario) {
  const wrapper = path.join(directory, 'mock-operation.ps1');
  await writeFile(wrapper, mockOperation);
  const actual = await launch(['-File', wrapper, '-Script', script, '-Scenario', scenario], directory);
  assert.equal(actual.code, 0, actual.stderr);
  assert.ok(!actual.stdout.includes(password));
  assert.ok(!actual.stderr.includes(password));
  return JSON.parse(actual.stdout);
}

test('activation is plan-only without an explicit operation', { skip: !windows }, async () => fixture(async directory => {
  const actual = await launch(['-File', script], directory);
  assert.equal(actual.code, 0, actual.stderr);
  assert.equal(JSON.parse(actual.stdout).mode, 'plan_only');
}));

test('activation accepts only explicit demo flags and the dedicated loopback database role without disclosing its URL', { skip: !windows }, async () => fixture(async directory => {
  const valid = { OFFICE_ENABLED: 'true', OFFICE_DEMO_WORKER: 'true', OFFICE_WORKER_CONCURRENCY: '1', OFFICE_WORKER_DATABASE_URL: `postgresql://enztronic_office_worker:${databasePassword}@127.0.0.1:54329/enztronic_backoffice` };
  const cases = [
    { name: 'valid', input: valid, accepted: true },
    ...[
      { OFFICE_ENABLED: 'false' }, { OFFICE_DEMO_WORKER: true }, { OFFICE_WORKER_CONCURRENCY: 'NaN' }, { WEBSITE_KEY: 'forbidden' },
      ...[
        `postgresql://enztronic_app:${databasePassword}@127.0.0.1:54329/enztronic_backoffice`,
        `postgresql://enztronic_office_worker:${databasePassword}@example.test:54329/enztronic_backoffice`,
        `postgresql://enztronic_office_worker:${databasePassword}@127.0.0.1:5432/enztronic_backoffice`,
        `postgresql://enztronic_office_worker:${databasePassword}@127.0.0.1:54329/postgres`,
        `postgresql://enztronic_office_worker:${databasePassword}@127.0.0.1:54329/enztronic_backoffice?host=elsewhere`,
        'postgresql://enztronic_office_worker:@127.0.0.1:54329/enztronic_backoffice',
      ].map(OFFICE_WORKER_DATABASE_URL => ({ OFFICE_WORKER_DATABASE_URL })),
    ].map((changes, index) => ({ name: `invalid-${index}`, input: { ...valid, ...changes }, accepted: false })),
  ];
  await writeFile(path.join(directory, 'cases.json'), JSON.stringify(cases));
  const wrapper = path.join(directory, 'configuration.ps1');
  await writeFile(wrapper, String.raw`
param([string]$Script,[string]$Cases)
$ErrorActionPreference='Stop';$null = . $Script
$results=@();foreach($case in (Get-Content -LiteralPath $Cases -Raw|ConvertFrom-Json -AsHashtable)){
 $accepted=$true;$errorCode=$null
 try{Assert-OfficeActivationConfiguration $case.input}catch{$accepted=$false;$errorCode=$_.Exception.Message}
 $results+=@{name=$case.name;accepted=$accepted;errorCode=$errorCode}
};ConvertTo-Json -InputObject $results -Depth 4 -Compress
`);
  const actual = await launch(['-File', wrapper, '-Script', script, '-Cases', path.join(directory, 'cases.json')], directory);
  assert.equal(actual.code, 0, actual.stderr);
  assert.ok(!actual.stdout.includes(databasePassword));
  assert.ok(!actual.stderr.includes(databasePassword));
  assert.deepEqual(JSON.parse(actual.stdout).map(entry => entry.accepted), cases.map(entry => entry.accepted));
}));

test('owned activation updates rather than creates, preserves the task ACL, and reports Windows start separately from health', { skip: !windows }, async () => fixture(async directory => {
  const actual = await operation(directory, 'activate');
  assert.equal(actual.failure, null);
  assert.equal(actual.runCalls, 1);
  assert.equal(actual.stopCalls, 0);
  assert.deepEqual(actual.accountChanges, [true]);
  assert.deepEqual(actual.registrations, [{ flags: 20, sid: 'S-1-5-21-100-200-300-1007', logon: 1, sddlPreserved: true, enabled: true, triggerEnabled: true }]);
  assert.equal(actual.result.state, 'windows_start_requested_health_unverified');
  assert.equal(actual.result.workerHealthVerified, false);
  assert.equal(actual.result.databaseCallsPerformed, false);
}));

test('wrong task, nonadministrator or already-enabled worker cannot be activated', { skip: !windows }, async () => fixture(async directory => {
  for (const scenario of ['wrong-task', 'not-admin', 'already-enabled']) {
    const actual = await operation(directory, scenario);
    assert.ok(actual.failure, scenario);
    assert.equal(actual.runCalls, 0, scenario);
    assert.equal(actual.registrations.length, 0, scenario);
    assert.deepEqual(actual.accountChanges, [], scenario);
  }
}));

test('a failed Windows run request rolls back only its owned task and account, retaining no credential output', { skip: !windows }, async () => fixture(async directory => {
  const actual = await operation(directory, 'run-fails');
  assert.equal(actual.failure, 'worker_activation_failed');
  assert.equal(actual.rollback, true);
  assert.equal(actual.accountEnabled, false);
  assert.deepEqual(actual.accountChanges, [true, false]);
  assert.deepEqual(actual.registrations.map(entry => entry.enabled), [true, false]);
  assert.ok(actual.registrations.every(entry => entry.flags === 20 && entry.sddlPreserved));
}));

test('unexpected task ACL changes fail activation and rollback restores the original owner-read descriptor', { skip: !windows }, async () => fixture(async directory => {
  const actual = await operation(directory, 'security-drift-on-enable');
  assert.equal(actual.failure, 'worker_activation_failed');
  assert.equal(actual.rollback, true);
  assert.equal(actual.runCalls, 0);
  assert.equal(actual.originalSecurityRestored, true);
  assert.equal(actual.accountEnabled, false);
}));

test('stop disables future starts before the task, waits owned process exit and leaves leases for separate reconciliation', { skip: !windows }, async () => fixture(async directory => {
  const actual = await operation(directory, 'stop');
  assert.equal(actual.failure, null);
  assert.equal(actual.forActivation, false);
  assert.equal(actual.runCalls, 0);
  assert.equal(actual.stopCalls, 1);
  assert.deepEqual(actual.registrations.map(entry => entry.enabled), [false]);
  assert.deepEqual(actual.accountChanges, [false]);
  assert.equal(actual.result.ownedProcessesExited, true);
  assert.equal(actual.result.gracefulShutdownConfirmed, false);
  assert.equal(actual.result.databaseLeaseReconciliation, 'required_separately');
}));

test('an unresolved owned child fails stop without terminating a foreign process or leaving its account enabled', { skip: !windows }, async () => fixture(async directory => {
  const actual = await operation(directory, 'stop-process-remains');
  assert.equal(actual.failure, 'owned_worker_processes_remain');
  assert.equal(actual.accountEnabled, false);
  assert.equal(actual.stopCalls, 1);
  assert.equal(actual.runCalls, 0);
}));

test('runtime verification checks actual bytes, the complete inventory and contained unique manifest paths', { skip: !windows }, async () => fixture(async directory => {
  const wrapper = path.join(directory, 'runtime.ps1');
  await writeFile(wrapper, String.raw`
param([string]$Script,[string]$Runtime,[string]$Hash)
$ErrorActionPreference='Stop';$null = . $Script
$result=$null;$failure=$null
try{$result=Assert-OfficeActivationRuntime @{runtime=$Runtime} $Hash}catch{$failure=$_.Exception.Message}
@{result=$result;failure=$failure}|ConvertTo-Json -Depth 4 -Compress
`);
  const hash = value => createHash('sha256').update(value).digest('hex');
  for (const scenario of ['valid', 'changed-bytes', 'extra-file', 'path-escape', 'duplicate']) {
    const runtime = path.join(directory, scenario);
    await mkdir(path.join(runtime, 'worker'), { recursive: true });
    const content = Buffer.from('export const fixture = true;\n');
    await writeFile(path.join(runtime, 'worker/index.js'), scenario === 'changed-bytes' ? Buffer.from('changed') : content);
    const file = { path: scenario === 'path-escape' ? '../outside.js' : 'worker/index.js', bytes: content.length, sha256: hash(content) };
    const manifest = Buffer.from(JSON.stringify({ files: scenario === 'duplicate' ? [file, file] : [file] }));
    await writeFile(path.join(runtime, 'runtime-manifest.json'), manifest);
    await writeFile(path.join(runtime, 'runtime-manifest.sha256'), hash(manifest));
    if (scenario === 'extra-file') await writeFile(path.join(runtime, 'unreviewed.js'), 'unreviewed');
    const actual = await launch(['-File', wrapper, '-Script', script, '-Runtime', runtime, '-Hash', hash(manifest)], directory);
    assert.equal(actual.code, 0, actual.stderr);
    const result = JSON.parse(actual.stdout);
    if (scenario === 'valid') {
      assert.equal(result.failure, null);
      assert.equal(result.result.files, 1);
      assert.equal(result.result.hash, hash(manifest));
    } else assert.match(result.failure, /runtime_file_mismatch|unmanifested_runtime_file|runtime_manifest_path_invalid/, scenario);
  }
}));

test('process scope requires the exact installed executable and worker SID, refusing an unrecognized same-account command', { skip: !windows }, async () => fixture(async directory => {
  const wrapper = path.join(directory, 'process-scope.ps1');
  await writeFile(wrapper, String.raw`
param([string]$Script)
$ErrorActionPreference='Stop';$null = . $Script
$paths=Get-OfficeActivationPaths;$global:officeActivationProcessRows=@(
 [pscustomobject]@{ExecutablePath=$paths.node;ProcessId=11;CommandLine=($paths.node+' --import loader '+$paths.entry);OwnerSid='S-1-5-21-100-200-300-1007'},
 [pscustomobject]@{ExecutablePath=$paths.node;ProcessId=12;CommandLine=($paths.node+' '+$paths.entry);OwnerSid='S-1-5-21-100-200-300-1000'},
 [pscustomobject]@{ExecutablePath='C:\unrelated\node.exe';ProcessId=13;CommandLine=$paths.entry;OwnerSid='S-1-5-21-100-200-300-1007'},
 [pscustomobject]@{ExecutablePath=$paths.powershell;ProcessId=14;CommandLine=($paths.powershell+' -File "'+$paths.supervisor+'"');OwnerSid='S-1-5-21-100-200-300-1007'}
)
function Get-CimInstance {param($ClassName,$Filter) $global:officeActivationProcessRows}
function Invoke-CimMethod {param($InputObject,$MethodName) if($MethodName -ne 'GetOwnerSid'){throw 'Unexpected method.'};@{ReturnValue=0;Sid=$InputObject.OwnerSid}}
function Stop-Process {throw 'No process termination allowed.'}
$context=@{paths=$paths;workerSid='S-1-5-21-100-200-300-1007'}
$owned=@(Get-OfficeActivationOwnedProcesses $context)
$global:officeActivationProcessRows=@([pscustomobject]@{ExecutablePath=$paths.node;ProcessId=15;CommandLine='unrecognized';OwnerSid=$context.workerSid})
$failure=$null;try{$null=Get-OfficeActivationOwnedProcesses $context}catch{$failure=$_.Exception.Message}
@{ids=@($owned.id);unknownFailure=$failure}|ConvertTo-Json -Compress
`);
  const actual = await launch(['-File', wrapper, '-Script', script], directory);
  assert.equal(actual.code, 0, actual.stderr);
  assert.deepEqual(JSON.parse(actual.stdout), { ids: [11, 14], unknownFailure: 'scoped_process_command_unconfirmed' });
}));
