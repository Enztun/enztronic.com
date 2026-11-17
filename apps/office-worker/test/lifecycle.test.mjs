import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, readFile, copyFile, readdir, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';
import postgres from 'postgres';

const workerRoot = fileURLToPath(new URL('../', import.meta.url));
const loader = pathToFileURL(path.join(workerRoot, 'node_modules/tsx/dist/loader.mjs')).href;
const supervisor = path.join(workerRoot, 'start-office-worker.ps1');
const installer = path.join(workerRoot, 'install-office-worker-task.ps1');
const powershell = process.env.OFFICE_TEST_PWSH ?? 'pwsh.exe';
const windows = process.platform === 'win32';
const configuration = { OFFICE_ENABLED: 'true', OFFICE_DEMO_WORKER: 'true', OFFICE_WORKER_DATABASE_URL: 'postgresql://fixture_only@127.0.0.1:1/unused_test', OFFICE_WORKER_CONCURRENCY: '1' };

async function temporary(run) {
  const directory = await mkdtemp(path.join(tmpdir(), 'office-worker-lifecycle-'));
  try { return await run(directory); }
  finally {
    const resolved = path.resolve(directory);
    assert.equal(path.dirname(resolved), path.resolve(tmpdir()));
    assert.ok(path.basename(resolved).startsWith('office-worker-lifecycle-'));
    await rm(resolved, { recursive: true, force: true, maxRetries: 4, retryDelay: 100 });
  }
}
function launch(command, args, options = {}) {
  const child = spawn(command, args, { cwd: workerRoot, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'], ...options });
  let stdout = '', stderr = '';
  child.stdout.on('data', data => { stdout = (stdout + data).slice(-200000); });
  child.stderr.on('data', data => { stderr = (stderr + data).slice(-200000); });
  const done = new Promise((resolve, reject) => {
    const timer = setTimeout(() => { child.kill(); reject(new Error('Owned lifecycle fixture timed out.')); }, 30000);
    child.once('error', error => { clearTimeout(timer); reject(error); });
    child.once('exit', (code, signal) => { clearTimeout(timer); resolve({ code, signal, stdout, stderr }); });
  });
  return { child, done };
}
async function until(check, milliseconds = 10000) {
  const end = Date.now() + milliseconds;
  while (Date.now() < end) {
    const value = await check();
    if (value) return value;
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  throw new Error('Owned lifecycle fixture did not reach its expected state.');
}
async function jsonLines(file) { return (await readFile(file, 'utf8')).trim().split('\n').filter(Boolean).map(line => JSON.parse(line)); }
async function fakeWorker(directory, source) {
  await mkdir(path.join(directory, 'node_modules/tsx/dist'), { recursive: true });
  await mkdir(path.join(directory, 'src'));
  await writeFile(path.join(directory, 'package.json'), '{"type":"module"}');
  await writeFile(path.join(directory, 'node_modules/tsx/dist/loader.mjs'), 'export {};');
  await writeFile(path.join(directory, 'src/index.ts'), source);
  await copyFile(supervisor, path.join(directory, 'start-office-worker.ps1'));
  await writeFile(path.join(directory, 'office.json'), JSON.stringify(configuration));
  return ['-NoProfile', '-NonInteractive', '-File', path.join(directory, 'start-office-worker.ps1'), '-NodeExecutable', process.execPath, '-ConfigurationFile', path.join(directory, 'office.json'), '-LogDirectory', path.join(directory, 'logs')];
}

test('installer plans by default, resolves paths and invokes no task or service commands', { skip: !windows }, async () => temporary(async directory => {
  const wrapper = path.join(directory, 'plan.ps1');
  await writeFile(wrapper, `param([string]$Installer,[string]$Node)\nfunction Get-ScheduledTask { throw 'Task side effects forbidden.' }\nfunction Register-ScheduledTask { throw 'Task side effects forbidden.' }\nfunction Start-ScheduledTask { throw 'Task side effects forbidden.' }\nfunction New-ScheduledTaskAction { throw 'Task side effects forbidden.' }\nfunction Start-Service { throw 'Service side effects forbidden.' }\n& $Installer -NodeExecutable $Node -ConfigurationFile 'office.json' -LogDirectory 'logs'\n`);
  const result = await launch(powershell, ['-NoProfile', '-NonInteractive', '-File', wrapper, '-Installer', installer, '-Node', process.execPath], { cwd: directory }).done;
  assert.equal(result.code, 0, result.stderr);
  const plan = JSON.parse(result.stdout);
  assert.equal(plan.mode, 'plan_only'); assert.equal(plan.startsNow, false); assert.equal(plan.runLevel, 'Limited');
  assert.ok(plan.arguments.includes(path.join(directory, 'office.json')));
  assert.ok(plan.arguments.includes(path.join(directory, 'logs')));
  assert.deepEqual(await readdir(directory), ['plan.ps1']);
}));

test('invalid startup settings fail before connecting and never disclose the connection string', async () => {
  const secretUrl = 'postgresql://hidden_user:sentinel_password@127.0.0.1:1/unused_test';
  for (const value of ['NaN', 'Infinity', '0', '5', '1.5', '-1', ' 1']) {
    const result = await launch(process.execPath, ['--import', loader, path.join(workerRoot, 'src/index.ts'), '--once'], { env: { ...process.env, ...configuration, OFFICE_WORKER_DATABASE_URL: secretUrl, OFFICE_WORKER_CONCURRENCY: value } }).done;
    assert.equal(result.code, 1); assert.match(result.stderr, /configuration_required/);
    assert.equal(result.stdout, ''); assert.ok(!result.stderr.includes('sentinel_password'));
  }
  for (const invalid of [{ OFFICE_WORKER_DATABASE_URL: 'https://example.test/db' }, { OFFICE_WORKER_LOG_DIRECTORY: 'relative' }]) {
    const result = await launch(process.execPath, ['--import', loader, path.join(workerRoot, 'src/index.ts'), '--once'], { env: { ...process.env, ...configuration, ...invalid } }).done;
    assert.equal(result.code, 1); assert.match(result.stderr, /configuration_required/); assert.equal(result.stdout, '');
  }
});

test('invalid live settings fail before connecting and never disclose the API key', async () => {
  const key = `sk-proj-sentinel${'k'.repeat(30)}`;
  for (const invalid of [
    { OFFICE_LIVE_WORKER: 'true' },
    { OFFICE_LIVE_WORKER: 'yes', OFFICE_OPENAI_API_KEY: key },
    { OFFICE_LIVE_WORKER: 'true', OFFICE_OPENAI_API_KEY: 'sentinel-not-a-key' },
    { OFFICE_OPENAI_API_KEY: key },
    { OFFICE_LIVE_WORKER: 'true', OFFICE_OPENAI_API_KEY: key, OFFICE_OPENAI_PACKAGE_MODEL: 'unpriced-model' },
    { OFFICE_LIVE_WORKER: 'true', OFFICE_OPENAI_API_KEY: key, OFFICE_OPENAI_REASONING_EFFORT: 'none' },
  ]) {
    const result = await launch(process.execPath, ['--import', loader, path.join(workerRoot, 'src/index.ts'), '--once'], { env: { ...process.env, ...configuration, ...invalid } }).done;
    assert.equal(result.code, 1); assert.match(result.stderr, /configuration_required: live execution/);
    assert.equal(result.stdout, ''); assert.ok(!result.stderr.includes('sentinel'));
  }
});

test('owner key helper plans without the key, removes live settings atomically and keeps access rules', { skip: !windows }, async () => temporary(async directory => {
  const config = path.join(directory, 'office.json');
  const helper = path.join(workerRoot, 'set-office-openai-key.ps1');
  const live = { ...configuration, OFFICE_LIVE_WORKER: 'true', OFFICE_OPENAI_API_KEY: `sk-proj-sentinel${'k'.repeat(30)}`, OFFICE_OPENAI_DRAFT_MODEL: 'gpt-6-luna' };
  await writeFile(config, JSON.stringify(live));
  const sddl = async () => (await launch(powershell, ['-NoProfile', '-NonInteractive', '-Command', `(Get-Acl -LiteralPath '${config}').Sddl`]).done).stdout.trim();
  const before = await sddl();
  const plan = await launch(powershell, ['-NoProfile', '-NonInteractive', '-File', helper, '-ConfigurationFile', config]).done;
  assert.equal(plan.code, 0, plan.stderr); assert.ok(!plan.stdout.includes('sentinel'));
  assert.equal(JSON.parse(plan.stdout).applied, false); assert.deepEqual(JSON.parse(await readFile(config, 'utf8')), live);
  const removed = await launch(powershell, ['-NoProfile', '-NonInteractive', '-File', helper, '-ConfigurationFile', config, '-Apply', '-Remove']).done;
  assert.equal(removed.code, 0, removed.stderr); assert.ok(!removed.stdout.includes('sentinel'));
  assert.deepEqual(JSON.parse(await readFile(config, 'utf8')), configuration);
  assert.deepEqual(await readdir(directory), ['office.json']);
  assert.equal(await sddl(), before);
  await writeFile(config, JSON.stringify({ SOME_OTHER_APP: 'x' }));
  const refused = await launch(powershell, ['-NoProfile', '-NonInteractive', '-File', helper, '-ConfigurationFile', config, '-Apply', '-Remove']).done;
  assert.notEqual(refused.code, 0); assert.deepEqual(JSON.parse(await readFile(config, 'utf8')), { SOME_OTHER_APP: 'x' });
}));

test('key insertion and removal keep temporary secrets private even under a broader parent ACL', { skip: !windows }, async () => temporary(async directory => {
  const helper = path.join(workerRoot, 'set-office-openai-key.ps1');
  const wrapper = path.join(directory, 'private-key-helper.ps1');
  // Observe the actual file immediately before its first secret write. The broader parent is
  // deliberate: checking only the replaced file's final ACL misses this disclosure window.
  await writeFile(wrapper, String.raw`param([string]$Helper,[string]$ConfigurationFile,[switch]$FailReplacement)
$ErrorActionPreference = 'Stop'
$parent = Split-Path $ConfigurationFile
$parentAcl = Get-Acl -LiteralPath $parent
$everyone = [Security.Principal.SecurityIdentifier]::new('S-1-1-0')
$parentAcl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new($everyone,'ReadAndExecute','ContainerInherit,ObjectInherit','None','Allow'))
Set-Acl -LiteralPath $parent -AclObject $parentAcl
$privateAcl = Get-Acl -LiteralPath $ConfigurationFile
$privateAcl.SetAccessRuleProtection($true,$false)
$privateAcl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new([Security.Principal.WindowsIdentity]::GetCurrent().User,'FullControl','Allow'))
Set-Acl -LiteralPath $ConfigurationFile -AclObject $privateAcl
$originalSddl = (Get-Acl -LiteralPath $ConfigurationFile).Sddl
$originalHash = (Get-FileHash -LiteralPath $ConfigurationFile -Algorithm SHA256).Hash
$global:officeKeyHelperProbe = @{ configurationFile=$ConfigurationFile; observed=$false; private=$false; emptyBeforeWrite=$false; lock=$null }
function Read-Host { param([switch]$AsSecureString,[string]$Prompt); ConvertTo-SecureString ('sk-proj-sentinel'+('k'*30)) -AsPlainText -Force }
$lines = @(Get-Content -LiteralPath $Helper)
$writeLine = 1 + [Array]::FindIndex($lines,[Predicate[string]]{ param($line) $line.Contains('$officeTemporaryStream.Write(') })
$replaceLine = 1 + [Array]::FindIndex($lines,[Predicate[string]]{ param($line) $line.Contains('[IO.File]::Replace(') })
if ($writeLine -lt 1 -or $replaceLine -lt 1) { throw 'Missing key-helper observation point.' }
$writeBreakpoint = Set-PSBreakpoint -Script $Helper -Line $writeLine -Action {
  $temporary = Get-ChildItem -LiteralPath (Split-Path $global:officeKeyHelperProbe.configurationFile) -Filter 'office.json.*.tmp' | Select-Object -First 1
  $acl = Get-Acl -LiteralPath $temporary.FullName
  $global:officeKeyHelperProbe.observed = $true
  $global:officeKeyHelperProbe.private = $acl.AreAccessRulesProtected -and $acl.Sddl -notmatch '\(A;[^)]*;;;WD\)'
  $global:officeKeyHelperProbe.emptyBeforeWrite = $temporary.Length -eq 0
}
$replaceBreakpoint = $null
if ($FailReplacement) {
  $replaceBreakpoint = Set-PSBreakpoint -Script $Helper -Line $replaceLine -Action {
    $global:officeKeyHelperProbe.lock = [IO.File]::Open($global:officeKeyHelperProbe.configurationFile,[IO.FileMode]::Open,[IO.FileAccess]::Read,[IO.FileShare]::Read)
  }
}
$failed = $false
try { & $Helper -ConfigurationFile $ConfigurationFile -Apply | Out-Null } catch { $failed = $true }
finally {
  if ($global:officeKeyHelperProbe.lock) { $global:officeKeyHelperProbe.lock.Dispose() }
  Remove-PSBreakpoint -Breakpoint $writeBreakpoint
  if ($replaceBreakpoint) { Remove-PSBreakpoint -Breakpoint $replaceBreakpoint }
}
$stored = Get-Content -Raw -LiteralPath $ConfigurationFile | ConvertFrom-Json -AsHashtable
$result = @{ observed=$global:officeKeyHelperProbe.observed; temporaryPrivate=$global:officeKeyHelperProbe.private; emptyBeforeWrite=$global:officeKeyHelperProbe.emptyBeforeWrite; failed=$failed; finalAclPreserved=((Get-Acl -LiteralPath $ConfigurationFile).Sddl -ceq $originalSddl); noTemporaryFiles=(@(Get-ChildItem -LiteralPath $parent -Filter '*.tmp').Count -eq 0); originalUnchanged=((Get-FileHash -LiteralPath $ConfigurationFile -Algorithm SHA256).Hash -ceq $originalHash); keyPresent=$stored.ContainsKey('OFFICE_OPENAI_API_KEY') }
if (!$failed) {
  $global:officeKeyHelperProbe.observed = $false
  $global:officeKeyHelperProbe.private = $false
  $removalBreakpoint = Set-PSBreakpoint -Script $Helper -Line $writeLine -Action $writeBreakpoint.Action
  try { & $Helper -ConfigurationFile $ConfigurationFile -Apply -Remove | Out-Null } finally { Remove-PSBreakpoint -Breakpoint $removalBreakpoint }
  $afterRemoval = Get-Content -Raw -LiteralPath $ConfigurationFile | ConvertFrom-Json -AsHashtable
  $result.removalWorked = !$afterRemoval.ContainsKey('OFFICE_OPENAI_API_KEY') -and !$afterRemoval.ContainsKey('OFFICE_LIVE_WORKER')
  $result.removalAclPreserved = (Get-Acl -LiteralPath $ConfigurationFile).Sddl -ceq $originalSddl
  $result.removalTemporaryPrivate = $global:officeKeyHelperProbe.observed -and $global:officeKeyHelperProbe.private
  $result.removalNoTemporaryFiles = @(Get-ChildItem -LiteralPath $parent -Filter '*.tmp').Count -eq 0
}
$result | ConvertTo-Json -Compress
`);
  for (const failReplacement of [false, true]) {
    const caseDirectory = path.join(directory, failReplacement ? 'failed-replacement' : 'successful-replacement');
    await mkdir(caseDirectory);
    const config = path.join(caseDirectory, 'office.json');
    await writeFile(config, JSON.stringify(configuration));
    const args = ['-NoProfile', '-NonInteractive', '-File', wrapper, '-Helper', helper, '-ConfigurationFile', config];
    if (failReplacement) args.push('-FailReplacement');
    const probe = await launch(powershell, args).done;
    assert.equal(probe.code, 0, probe.stderr); assert.ok(!probe.stdout.includes('sentinel')); assert.ok(!probe.stderr.includes('sentinel'));
    const result = JSON.parse(probe.stdout);
    assert.equal(result.observed, true); assert.equal(result.temporaryPrivate, true); assert.equal(result.emptyBeforeWrite, true);
    assert.equal(result.finalAclPreserved, true); assert.equal(result.noTemporaryFiles, true); assert.equal(result.failed, failReplacement);
    if (failReplacement) { assert.equal(result.originalUnchanged, true); assert.equal(result.keyPresent, false); }
    else { assert.equal(result.keyPresent, true); assert.equal(result.removalWorked, true); assert.equal(result.removalAclPreserved, true); assert.equal(result.removalTemporaryPrivate, true); assert.equal(result.removalNoTemporaryFiles, true); }
  }
}));

test('supervisor rejects unreviewed keys/types/concurrency before launching or creating logs', { skip: !windows }, async () => temporary(async directory => {
  const args = await fakeWorker(directory, `throw new Error('Must not launch');`);
  const key = `sk-proj-${'k'.repeat(40)}`;
  for (const invalid of [{ PROVIDER_KEY: 'forbidden' }, { OFFICE_DEMO_WORKER: true }, { OFFICE_WORKER_CONCURRENCY: 'NaN' }, { OFFICE_WORKER_DATABASE_URL: 'https://example.test/db' }, { OFFICE_LIVE_WORKER: 'true' }, { OFFICE_OPENAI_API_KEY: key }, { OFFICE_LIVE_WORKER: 'false', OFFICE_OPENAI_API_KEY: key }, { OFFICE_LIVE_WORKER: 'true', OFFICE_OPENAI_API_KEY: key, OPENAI_API_KEY: key }]) {
    await writeFile(path.join(directory, 'office.json'), JSON.stringify({ ...configuration, ...invalid }));
    const result = await launch(powershell, args).done;
    assert.notEqual(result.code, 0); assert.ok(!(await readdir(directory)).includes('logs'));
  }
}));

test('supervisor scrubs inherited secrets, drains crash output, rotates fixed logs and restarts only its child', { skip: !windows }, async () => temporary(async directory => {
  const args = await fakeWorker(directory, `import fs from 'node:fs'; import path from 'node:path';
const root=process.env.OFFICE_WORKER_LOG_DIRECTORY; const file=path.join(root,'probes.jsonl');
const first=!fs.existsSync(file); fs.appendFileSync(file,JSON.stringify({pid:process.pid,keys:Object.keys(process.env),execPath:process.execPath,temp:process.env.TEMP,tmp:process.env.TMP,once:process.argv.includes('--once')})+'\\n');
if(first){process.stderr.write('sentinel_secret_should_never_be_logged'+'.'.repeat(150000));process.exitCode=7;}`);
  const logDirectory = path.join(directory, 'logs'); await mkdir(logDirectory);
  await writeFile(path.join(logDirectory, 'office-supervisor.jsonl'), 'x'.repeat(2 * 1024 * 1024));
  await writeFile(path.join(logDirectory, 'office-supervisor.jsonl.previous'), 'stale');
  const result = await launch(powershell, args, { env: { ...process.env, WEBSITE_API_KEY: 'sentinel_secret', NODE_OPTIONS: '--no-warnings', DATABASE_URL: 'must_not_inherit' } }).done;
  assert.equal(result.code, 0, result.stderr);
  const probes = await jsonLines(path.join(logDirectory, 'probes.jsonl'));
  assert.equal(probes.length, 2); assert.notEqual(probes[0].pid, probes[1].pid);
  assert.equal(probes[0].execPath.toLowerCase(), process.execPath.toLowerCase());
  for (const probe of probes) {
    assert.ok(probe.keys.includes('OFFICE_WORKER_SUPERVISED'));
    assert.ok(!probe.keys.includes('WEBSITE_API_KEY')); assert.ok(!probe.keys.includes('NODE_OPTIONS')); assert.ok(!probe.keys.includes('DATABASE_URL'));
    assert.equal(probe.temp, path.join(logDirectory, 'temp'));
    assert.equal(probe.tmp, path.join(logDirectory, 'temp'));
    assert.ok(probe.keys.every(key => ['SystemRoot','WINDIR','TEMP','TMP',...Object.keys(configuration),'OFFICE_WORKER_LOG_DIRECTORY','OFFICE_WORKER_SUPERVISED'].includes(key)));
  }
  const events = await jsonLines(path.join(logDirectory, 'office-supervisor.jsonl'));
  assert.equal(events.filter(event => event.event === 'child_started').length, 2);
  assert.deepEqual(events.find(event => event.event === 'restart_scheduled').delaySeconds, 5);
  assert.ok(!(await readFile(path.join(logDirectory, 'office-supervisor.jsonl'), 'utf8')).includes('sentinel_secret'));
  assert.equal((await stat(path.join(logDirectory, 'office-supervisor.jsonl.previous'))).size, 2 * 1024 * 1024);
}));

test('supervisor --Once passes a single-claim flag and never retries failure', { skip: !windows }, async () => temporary(async directory => {
  const args = await fakeWorker(directory, `import fs from 'node:fs'; import path from 'node:path'; fs.writeFileSync(path.join(process.env.OFFICE_WORKER_LOG_DIRECTORY,'once.json'),JSON.stringify({once:process.argv.includes('--once')}));process.exitCode=7;`);
  const result = await launch(powershell, [...args, '-Once']).done;
  assert.notEqual(result.code, 0);
  assert.deepEqual(JSON.parse(await readFile(path.join(directory, 'logs/once.json'), 'utf8')), { once: true });
  const events = await jsonLines(path.join(directory, 'logs/office-supervisor.jsonl'));
  assert.equal(events.filter(event => event.event === 'child_started').length, 1);
  assert.ok(!events.some(event => event.event === 'restart_scheduled'));
}));

test('a killed supervisor closes its private pipe so its owned child exits', { skip: !windows }, async () => temporary(async directory => {
  const args = await fakeWorker(directory, `import fs from 'node:fs'; import path from 'node:path';
const root=process.env.OFFICE_WORKER_LOG_DIRECTORY;fs.writeFileSync(path.join(root,'ready.json'),JSON.stringify({pid:process.pid}));
process.stdin.resume();process.stdin.on('end',()=>{fs.writeFileSync(path.join(root,'stopped.json'),'{}');process.stdin.destroy();});`);
  const processFixture = launch(powershell, args);
  try {
    await until(async () => readFile(path.join(directory, 'logs/ready.json'), 'utf8').catch(() => false));
    processFixture.child.kill(); await processFixture.done;
    await until(async () => readFile(path.join(directory, 'logs/stopped.json'), 'utf8').catch(() => false));
  } finally { processFixture.child.kill(); }
}));

test('supervisor startup failure requests graceful child cleanup before exiting', { skip: !windows }, async () => temporary(async directory => {
  const args = await fakeWorker(directory, `import fs from 'node:fs'; import path from 'node:path';
process.stdin.resume();process.stdin.on('data',()=>{fs.writeFileSync(path.join(process.env.OFFICE_WORKER_LOG_DIRECTORY,'graceful.json'),JSON.stringify({pid:process.pid}));process.stdin.destroy();});`);
  await mkdir(path.join(directory, 'logs/office-supervisor.jsonl'), { recursive: true });
  const result = await launch(powershell, args).done;
  assert.notEqual(result.code, 0);
  const stopped = JSON.parse(await readFile(path.join(directory, 'logs/graceful.json'), 'utf8'));
  assert.throws(() => process.kill(stopped.pid, 0), { code: 'ESRCH' });
}));

test('real worker records --once/stopping health, rotates logs and exits when its supervisor disappears', { skip: !windows || !process.env.OFFICE_LIFECYCLE_ADMIN_URL, timeout: 60000 }, async () => temporary(async directory => {
  // Create a NEW fixture database. No shared preview/test schema is reset or dropped.
  const adminUrl = new URL(process.env.OFFICE_LIFECYCLE_ADMIN_URL);
  assert.ok(['127.0.0.1', 'localhost'].includes(adminUrl.hostname));
  assert.ok(!['5432', '54329', ''].includes(adminUrl.port));
  assert.equal(adminUrl.pathname, '/postgres');
  const databaseName = `office_worker_${randomUUID().replaceAll('-', '')}_test`;
  const roleName = `office_worker_role_${randomUUID().replaceAll('-', '')}`;
  const admin = postgres(adminUrl.toString(), { max: 1, onnotice: () => undefined });
  let sql;
  let processFixture;
  let ownedWorkerPid;
  try {
    await admin.unsafe(`CREATE DATABASE "${databaseName}"`);
    const databaseUrl = new URL(adminUrl); databaseUrl.pathname = `/${databaseName}`;
    sql = postgres(databaseUrl.toString(), { max: 2, onnotice: () => undefined });
    for (const migration of ['001_init.sql', '002_users_and_ownership.sql', '003_office.sql', '004_office_live_provider.sql']) await sql.unsafe(await readFile(path.join(workerRoot, '../backoffice/database/migrations', migration), 'utf8'));
    await sql.unsafe(`CREATE ROLE ${roleName} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS`);
    const grantExample = await readFile(path.join(workerRoot, 'office-role.example.sql'), 'utf8');
    await sql.unsafe(grantExample.replaceAll('enztronic_office_runtime', roleName));
    const workerUrl = new URL(databaseUrl); workerUrl.username = roleName; workerUrl.password = '';
    const { createOfficeRuntime } = await import('../../backoffice/src/lib/office-runtime/index.ts');
    const runtime = createOfficeRuntime(sql);
    const deniedLogDirectory = path.join(directory, 'denied-logs');
    async function rejectsStartup(url) {
      const result = await launch(process.execPath, ['--import', loader, path.join(workerRoot, 'src/index.ts'), '--once'], { env: { ...process.env, ...configuration, OFFICE_WORKER_DATABASE_URL: url, OFFICE_WORKER_LOG_DIRECTORY: deniedLogDirectory } }).done;
      assert.equal(result.code, 1); assert.match(result.stderr, /least-privilege Office worker database role/);
      assert.ok(!result.stdout.includes('"event":"started"')); assert.match(result.stdout, /unsafe_database_role/);
      const [count] = await sql`SELECT count(*)::int AS n FROM backoffice.office_workers`; assert.equal(count.n, 0);
    }
    await rejectsStartup(databaseUrl.toString());
    await sql.unsafe(`GRANT SELECT ON backoffice.users TO ${roleName}`);
    await rejectsStartup(workerUrl.toString());
    await sql.unsafe(`REVOKE SELECT ON backoffice.users FROM ${roleName}`);
    await sql.unsafe(`GRANT UPDATE(deciding_owner_id) ON backoffice.office_approvals TO ${roleName}`);
    await rejectsStartup(workerUrl.toString());
    await sql.unsafe(`REVOKE UPDATE(deciding_owner_id) ON backoffice.office_approvals FROM ${roleName}`);
    // Only the owner may switch live execution on or move a spending limit.
    for (const column of ['live_enabled', 'family_limit_microunits']) {
      await sql.unsafe(`GRANT UPDATE(${column}) ON backoffice.office_budget TO ${roleName}`);
      await rejectsStartup(workerUrl.toString());
      await sql.unsafe(`REVOKE UPDATE(${column}) ON backoffice.office_budget FROM ${roleName}`);
    }
    const logDirectory = path.join(directory, 'logs'); await mkdir(logDirectory);
    await writeFile(path.join(logDirectory, 'office-worker.jsonl'), 'x'.repeat(2 * 1024 * 1024));
    await writeFile(path.join(logDirectory, 'office-worker.jsonl.previous'), 'stale');
    const env = { ...process.env, ...configuration, OFFICE_WORKER_DATABASE_URL: workerUrl.toString(), OFFICE_WORKER_LOG_DIRECTORY: logDirectory };
    const once = await launch(process.execPath, ['--import', loader, path.join(workerRoot, 'src/index.ts'), '--once'], { env }).done;
    assert.equal(once.code, 0, once.stderr);
    const events = await jsonLines(path.join(logDirectory, 'office-worker.jsonl'));
    assert.deepEqual(events.map(event => event.event), ['started', 'stopped']);
    assert.equal(events[0].mode, 'once'); assert.equal(events[0].simulated, true); assert.equal(events[0].commandExecution, false); assert.equal(events[1].reason, 'single_pass');
    assert.equal((await stat(path.join(logDirectory, 'office-worker.jsonl.previous'))).size, 2 * 1024 * 1024);
    assert.equal((await runtime.health()).workerOnline, false);
    assert.equal((await runtime.health()).status, 'worker_offline');
    const [onceWorker] = await sql`SELECT stopping FROM backoffice.office_workers`;
    assert.equal(onceWorker.stopping, true);
    const configFile = path.join(directory, 'office.json'); await writeFile(configFile, JSON.stringify({ ...configuration, OFFICE_WORKER_DATABASE_URL: workerUrl.toString() }));
    processFixture = launch(powershell, ['-NoProfile', '-NonInteractive', '-File', supervisor, '-NodeExecutable', process.execPath, '-ConfigurationFile', configFile, '-LogDirectory', logDirectory]);
    await until(async () => (await runtime.health()).workerOnline);
    ownedWorkerPid = (await jsonLines(path.join(logDirectory, 'office-worker.jsonl'))).findLast(event => event.event === 'started').pid;
    const health = await runtime.health(); assert.equal(health.status, 'worker_online'); assert.match(health.disclosure, /Deterministic demonstration/); assert.equal(health.providerConfigured, false); assert.equal(health.commandExecutionEnabled, false);
    processFixture.child.kill(); await processFixture.done;
    await until(async () => !(await runtime.health()).workerOnline);
    const stopped = await until(async () => { const last = (await jsonLines(path.join(logDirectory, 'office-worker.jsonl'))).at(-1); return last.event === 'stopped' && last; });
    assert.equal(stopped.event, 'stopped'); assert.equal(stopped.reason, 'supervisor_disconnected');
    await until(() => { try { process.kill(ownedWorkerPid, 0); return false; } catch (error) { return error.code === 'ESRCH'; } });
    await sql`UPDATE backoffice.office_workers SET stopping=false,heartbeat_at=now()-interval '61 seconds'`;
    assert.equal((await runtime.health()).workerOnline, false);
  } finally {
    if (processFixture) { processFixture.child.kill(); await processFixture.done.catch(() => undefined); }
    if (ownedWorkerPid) { try { process.kill(ownedWorkerPid); } catch (error) { if (error.code !== 'ESRCH') throw error; } }
    if (sql) {
      await until(async () => { const [row] = await sql`SELECT count(*)::int AS n FROM backoffice.office_workers WHERE stopping=false AND heartbeat_at>now()-interval '60 seconds'`; return row.n === 0; }).catch(() => undefined);
      assert.match(roleName, /^office_worker_role_[a-f0-9]{32}$/);
      await sql.unsafe(`DROP OWNED BY ${roleName}`).catch(() => undefined);
      await sql.end({ timeout: 2 });
    }
    // The generated, validated identifier is the sole cleanup target.
    assert.match(databaseName, /^office_worker_[a-f0-9]{32}_test$/);
    await admin.unsafe(`DROP DATABASE IF EXISTS "${databaseName}" WITH (FORCE)`);
    await admin.unsafe(`DROP ROLE IF EXISTS ${roleName}`);
    await admin.end({ timeout: 2 });
  }
}));
