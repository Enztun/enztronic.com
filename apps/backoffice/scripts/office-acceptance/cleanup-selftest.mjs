// Real-resource self-test of the shared acceptance cleanup: a NEW loopback PostgreSQL cluster whose
// database creation fails after the server started, a real listening child, and a real orphaned
// grandchild that keeps an owned fixture port open. Everything goes through createOwnership() and
// finalizeRun(), exactly as run.mjs uses them. Only processes this script started are ever stopped.
import { spawnSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { appRoot, assertTestPort, createOwnership, minimalEnv, realSystem, stamp, waitFor } from './lib.mjs';

const options = Object.fromEntries(process.argv.slice(2).map(argument => argument.replace(/^--/, '').split('=')));
const PG_BIN = options['pg-bin'] ?? 'C:\\Program Files\\PostgreSQL\\17\\bin';
const PG_PORT = Number(options['pg-port'] ?? 55469);
const LISTEN_PORT = Number(options['listen-port'] ?? 55479);
const RUN = stamp();
const evidence = path.resolve(options.evidence ?? path.join(appRoot, 'tmp', `claude-cleanup-selftest-${RUN}`));
const report = { run: RUN, startedAt: new Date().toISOString(), ports: { postgres: PG_PORT, listener: LISTEN_PORT }, cases: [] };
const listenScript = port => `require('net').createServer().listen(${port},'127.0.0.1');setInterval(()=>{},1000)`;
function record(name, passed, details) { report.cases.push({ name, passed: !!passed, ...details }); console.log(`${passed ? 'PASS' : 'FAIL'} ${name}`); }

await mkdir(evidence, { recursive: true });
for (const port of [PG_PORT, LISTEN_PORT]) await assertTestPort(port);

// 1. createdb fails after PostgreSQL started ("postgres" already exists): the creator stops its cluster.
{
  const owned = createOwnership(realSystem);
  const root = path.join(evidence, 'partial-cluster');
  const pgLog = [];
  const failure = await owned.createCluster({ root, port: PG_PORT, pgBin: PG_BIN, log: message => pgLog.push(message), database: 'postgres' }).then(() => null, error => error);
  const status = spawnSync(path.join(PG_BIN, 'pg_ctl.exe'), ['-D', path.join(root, 'pgdata'), 'status'], { windowsHide: true, encoding: 'utf8', env: minimalEnv() }).status;
  const portOpen = await realSystem.portOpen(PG_PORT);
  const final = { checks: [] };
  const result = await owned.finalizeRun({ report: final, failure });
  record('partial cluster initialization failure: the started cluster is stopped and reported', failure && failure.cleanup?.outcome === 'stopped' && status === 3 && !portOpen && result.exitCode === 1 && final.cleanup.passed && final.failure.message.includes('createdb.exe failed'), { pgCtlStatusAfter: status, portOpenAfter: portOpen, cleanup: failure?.cleanup ?? null, failure: final.failure, finalizer: final.cleanup, pgLog });
}

// 2. A real listening child: taskkill, its exit awaited, its port confirmed closed, run passes.
{
  const owned = createOwnership(realSystem);
  const handle = owned.startProcess('owned-listener', process.execPath, ['-e', listenScript(LISTEN_PORT)], { env: minimalEnv(), logFile: path.join(evidence, 'owned-listener.log'), ports: [LISTEN_PORT] });
  await waitFor(() => realSystem.portOpen(LISTEN_PORT), { timeoutMs: 20000, intervalMs: 100, label: 'owned listener' });
  const final = { checks: [{ name: 'synthetic functional check', passed: true }] };
  const result = await owned.finalizeRun({ report: final });
  record('clean run: a real owned child is terminated, its exit and port closure confirmed', result.exitCode === 0 && final.cleanup.actions[0]?.outcome === 'terminated' && !(await realSystem.portOpen(LISTEN_PORT)), { pid: handle.pid, finalizer: final.cleanup });
}

// 3. The owned child exits but leaves an orphaned grandchild holding its fixture port.
{
  const owned = createOwnership(realSystem);
  const pidFile = path.join(evidence, 'orphan.pid');
  const parentScript = `const c=require('child_process').spawn(process.execPath,['-e',${JSON.stringify(listenScript(LISTEN_PORT))}],{detached:true,stdio:'ignore',windowsHide:true});require('fs').writeFileSync(${JSON.stringify(pidFile)},String(c.pid));c.unref();setTimeout(()=>process.exit(0),500)`;
  const handle = owned.startProcess('owned-parent', process.execPath, ['-e', parentScript], { env: minimalEnv(), logFile: path.join(evidence, 'owned-parent.log'), ports: [LISTEN_PORT] });
  await handle.exited;
  await waitFor(() => realSystem.portOpen(LISTEN_PORT), { timeoutMs: 20000, intervalMs: 100, label: 'orphan listener' });
  const orphanPid = Number(await readFile(pidFile, 'utf8'));
  const final = { checks: [{ name: 'synthetic functional check', passed: true }] };
  const result = await owned.finalizeRun({ report: final });
  const action = final.cleanup.actions[0];
  const reported = action?.listeners?.[0]?.listenerPids ?? [];
  record('remaining owned listener: the run fails and names the listener without stopping it', result.exitCode === 1 && action?.outcome === 'listener_remaining' && reported.includes(orphanPid) && await realSystem.portOpen(LISTEN_PORT), { parentPid: handle.pid, orphanPid, finalizer: final.cleanup });
  // This script created the orphan itself. Only when the listener is confirmed to be exactly that PID
  // is it stopped here; otherwise it is left running and reported.
  if (reported.includes(orphanPid)) {
    spawnSync('taskkill', ['/PID', String(orphanPid), '/F'], { windowsHide: true, env: minimalEnv() });
    await waitFor(async () => !(await realSystem.portOpen(LISTEN_PORT)), { timeoutMs: 20000, intervalMs: 100, label: 'orphan stopped' });
    report.orphanStopped = { pid: orphanPid, portClosed: true };
  } else report.orphanStopped = { pid: orphanPid, stopped: false, reason: 'listener PID not confirmed as the orphan; left running and reported', reported };
}

report.finishedAt = new Date().toISOString();
report.passed = report.cases.length === 3 && report.cases.every(entry => entry.passed);
await writeFile(path.join(evidence, 'cleanup-selftest-report.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify({ passed: report.passed, cases: report.cases.length, evidence: path.relative(appRoot, evidence) }));
process.exitCode = report.passed ? 0 : 1;
