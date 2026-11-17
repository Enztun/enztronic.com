// Fault injection for the shared acceptance cleanup. Every case drives the same createOwnership()
// and finalizeRun() that run.mjs uses; only the operating-system actions are substituted. No
// PostgreSQL is started here, and the real-process cases start only their own tiny Node children.
import { EventEmitter } from 'node:events';
import { mkdtempSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { PassThrough } from 'node:stream';
import { afterAll, describe, expect, it } from 'vitest';
import { createOwnership, minimalEnv, realSystem, waitFor } from './lib.mjs';

const logRoot = mkdtempSync(path.join(os.tmpdir(), 'claude-cleanup-faults-'));
const logFile = name => path.join(logRoot, `${name}.log`);
afterAll(() => rm(logRoot, { recursive: true, force: true }));
const quick = { stopTimeoutMs: 50, portTimeoutMs: 20 };
const FIXTURE_PORT = 55998;
const passedReport = () => ({ checks: [{ name: 'every functional check', passed: true }] });

/** Fake operating system. `pg` maps initdb.exe/createdb.exe or a pg_ctl verb (start, stop, status) to an exit status. */
function fakeSystem({ taskkillStatus = 0, listening = [], pg = {} } = {}) {
  const children = new Map();
  const stubborn = new Set();
  const calls = { taskkill: [], tools: [] };
  let nextPid = 41000;
  return {
    calls, children, stubborn,
    spawnChild: () => {
      const child = new EventEmitter();
      Object.assign(child, { pid: nextPid++, stdout: new PassThrough(), stderr: new PassThrough() });
      child.finish = code => { child.stdout.end(); child.stderr.end(); child.emit('exit', code, null); };
      children.set(child.pid, child);
      return child;
    },
    taskkill: pid => {
      calls.taskkill.push(pid);
      if (!stubborn.has(pid)) children.get(pid)?.finish(1);
      return { status: taskkillStatus, stdout: '', stderr: taskkillStatus ? 'ERROR: Access is denied.' : '' };
    },
    spawnSync: (command, args) => {
      const tool = path.basename(command);
      const verb = tool === 'pg_ctl.exe' ? args.at(-1) : tool;
      calls.tools.push(verb);
      const status = pg[verb] ?? 0;
      return { status, stdout: '', stderr: status ? `${verb} failed (injected)` : '' };
    },
    portFree: async () => true,
    portOpen: async port => listening.includes(port),
    listenerPids: port => (listening.includes(port) ? [9999] : []),
    sleep: () => new Promise(resolve => setTimeout(resolve, 1)),
  };
}
const start = (owned, name, ports = []) => owned.startProcess(name, 'node', [], { logFile: logFile(name), ports });
const cluster = owned => owned.createCluster({ root: logRoot, port: FIXTURE_PORT, pgBin: 'pg' });

describe('acceptance cleanup decides the result', () => {
  it('passes a clean run only after every owned exit, shutdown and port closure is confirmed', async () => {
    const system = fakeSystem();
    const owned = createOwnership(system, quick);
    const app = start(owned, 'next-dev', [3128]);
    await cluster(owned);
    const report = passedReport();
    expect(await owned.finalizeRun({ report, closers: [['browser', async () => undefined]] })).toEqual({ passed: true, exitCode: 0 });
    expect(report.cleanup.actions.map(action => action.outcome)).toEqual(['closed', 'terminated', 'stopped']);
    expect(report.cleanup).toMatchObject({ passed: true, failures: [], unresolved: [] });
    expect(await app.exited).toMatchObject({ code: 1 });
    expect(system.calls.taskkill).toEqual([app.pid]);
  });

  it('fails when PostgreSQL does not stop, even though every functional check passed', async () => {
    const system = fakeSystem({ pg: { stop: 1, status: 0 } });
    const owned = createOwnership(system, quick);
    await cluster(owned);
    const report = passedReport();
    expect(await owned.finalizeRun({ report })).toEqual({ passed: false, exitCode: 1 });
    expect(report.functionalPassed).toBe(true);
    expect(report.cleanup.failures).toEqual([expect.objectContaining({ kind: 'postgres', port: FIXTURE_PORT, outcome: 'stop_failed' })]);
    expect(report.cleanup.unresolved).toEqual([expect.objectContaining({ kind: 'postgres', reason: 'stop_failed' })]);
  });

  it('distinguishes a cluster that had already stopped from a failed stop', async () => {
    const owned = createOwnership(fakeSystem({ pg: { stop: 1, status: 3 } }), quick);
    await cluster(owned);
    const report = passedReport();
    expect(await owned.finalizeRun({ report })).toEqual({ passed: true, exitCode: 0 });
    expect(report.cleanup.actions).toEqual([expect.objectContaining({ kind: 'postgres', outcome: 'already_stopped' })]);
  });

  it('fails when a child does not exit: issuing taskkill, even successfully, is not proof of exit', async () => {
    for (const taskkillStatus of [1, 0]) {
      const system = fakeSystem({ taskkillStatus });
      const owned = createOwnership(system, quick);
      const app = start(owned, 'worker');
      system.stubborn.add(app.pid);
      const report = passedReport();
      expect(await owned.finalizeRun({ report })).toEqual({ passed: false, exitCode: 1 });
      expect(report.cleanup.failures).toEqual([expect.objectContaining({ kind: 'process', pid: app.pid, outcome: 'termination_failed', taskkillStatus })]);
      expect(report.cleanup.unresolved).toEqual([expect.objectContaining({ kind: 'process', pid: app.pid, reason: 'exit_not_confirmed' })]);
      expect(report.remainingProcesses).toHaveLength(1);
      if (taskkillStatus) expect(report.cleanup.failures[0].message).toContain('Access is denied');
    }
  });

  it('reports a child that already exited as such, not as a termination failure', async () => {
    const system = fakeSystem();
    const owned = createOwnership(system, quick);
    const app = start(owned, 'worker-once');
    system.children.get(app.pid).finish(0);
    await app.exited;
    const report = passedReport();
    expect(await owned.finalizeRun({ report })).toEqual({ passed: true, exitCode: 0 });
    expect(report.cleanup.actions).toEqual([expect.objectContaining({ pid: app.pid, outcome: 'already_exited', exit: { code: 0, signal: null } })]);
    expect(system.calls.taskkill).toEqual([]);
    // A taskkill that fails because the child was already ending is the same outcome once its exit arrives.
    const racing = fakeSystem({ taskkillStatus: 128 });
    const raced = createOwnership(racing, quick);
    const ending = start(raced, 'ending');
    expect(await raced.stopProcess(ending)).toMatchObject({ outcome: 'already_exited', taskkillStatus: 128 });
  });

  it('fails while an owned fixture port still listens after exit, and never stops that listener', async () => {
    const system = fakeSystem({ listening: [3128] });
    const owned = createOwnership(system, quick);
    const app = start(owned, 'next-dev', [3128]);
    const report = passedReport();
    expect(await owned.finalizeRun({ report })).toEqual({ passed: false, exitCode: 1 });
    expect(report.cleanup.failures).toEqual([expect.objectContaining({ pid: app.pid, outcome: 'listener_remaining', listeners: [{ port: 3128, listenerPids: [9999] }] })]);
    expect(report.cleanup.unresolved).toEqual([expect.objectContaining({ pid: app.pid, reason: 'owned_port_still_listening' })]);
    // The unrelated listener is reported with a safe identifier; only the owned child was ever signalled.
    expect(system.calls.taskkill).toEqual([app.pid]);
  });

  it('stops a cluster whose initialization failed after PostgreSQL started', async () => {
    const system = fakeSystem({ pg: { 'createdb.exe': 1 } });
    const owned = createOwnership(system, quick);
    const failure = await cluster(owned).then(() => null, error => error);
    expect(failure).toMatchObject({ message: expect.stringContaining('Cleanup: stopped.'), cleanup: { kind: 'postgres', outcome: 'stopped', resolved: true } });
    expect(system.calls.tools).toEqual(['initdb.exe', 'start', 'createdb.exe', 'stop']);
    const report = { checks: [] };
    expect(await owned.finalizeRun({ report, failure })).toEqual({ passed: false, exitCode: 1 });
    expect(report.functionalPassed).toBe(false);
    expect(report.failure.message).toContain('createdb.exe failed');
    expect(report.cleanup).toMatchObject({ passed: true, failures: [], unresolved: [] });
  });

  it('keeps owning a partially initialized cluster whose own cleanup also failed', async () => {
    const system = fakeSystem({ pg: { 'createdb.exe': 1, stop: 1, status: 0 } });
    const owned = createOwnership(system, quick);
    const failure = await cluster(owned).then(() => null, error => error);
    expect(failure.message).toContain('Cleanup: stop_failed.');
    const report = { checks: [] };
    expect(await owned.finalizeRun({ report, failure })).toEqual({ passed: false, exitCode: 1 });
    // The finalizer tried again, and both the original failure and the cleanup failure are reported.
    expect(system.calls.tools.filter(verb => verb === 'stop')).toHaveLength(2);
    expect(report.failure).toMatchObject({ message: expect.stringContaining('createdb.exe failed'), initializationCleanup: { outcome: 'stop_failed' } });
    expect(report.cleanup.unresolved).toEqual([expect.objectContaining({ kind: 'postgres', port: FIXTURE_PORT, reason: 'stop_failed' })]);
  });

  it('attempts every cleanup after an earlier one fails and keeps the functional failure', async () => {
    const system = fakeSystem({ pg: { stop: 1, status: 0 } });
    const owned = createOwnership(system, quick);
    const stuck = start(owned, 'stuck');
    system.stubborn.add(stuck.pid);
    const later = start(owned, 'later', [3129]);
    await cluster(owned);
    const report = passedReport();
    const failure = new Error('Acceptance check failed: injected functional failure');
    const closers = [['browser', async () => { throw new Error('injected browser close failure'); }], ['database client', async () => undefined]];
    expect(await owned.finalizeRun({ report, failure, closers })).toEqual({ passed: false, exitCode: 1 });
    expect(report.cleanup.actions.map(action => [action.resource ?? action.name ?? action.kind, action.outcome])).toEqual([
      ['browser', 'close_failed'], ['database client', 'closed'], ['stuck', 'termination_failed'], ['later', 'terminated'], ['postgres', 'stop_failed'],
    ]);
    expect(report.failure.message).toBe('Acceptance check failed: injected functional failure');
    expect(report.cleanup.unresolved.map(entry => entry.kind)).toEqual(['process', 'postgres']);
    expect(system.calls.taskkill).toEqual([stuck.pid, later.pid]);
  });

  it('turns the reviewed false pass into a failure: checks passed, PostgreSQL stop failed, one child remained', async () => {
    const system = fakeSystem({ pg: { stop: 1, status: 0 } });
    const owned = createOwnership(system, quick);
    await cluster(owned);
    system.stubborn.add(start(owned, 'synthetic-owned-child').pid);
    const report = passedReport();
    expect(await owned.finalizeRun({ report })).toEqual({ passed: false, exitCode: 1 });
    expect(report).toMatchObject({ functionalPassed: true, passed: false, remainingProcesses: [expect.objectContaining({ name: 'synthetic-owned-child' })] });
  });

  it('never acts on a process it did not start', async () => {
    const system = fakeSystem();
    const owned = createOwnership(system, quick);
    expect(await owned.stopProcess({ pid: 4242, name: 'unrelated' })).toMatchObject({ outcome: 'not_owned' });
    expect(system.calls.taskkill).toEqual([]);
  });
});

async function freeLoopbackPort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => { const { port } = server.address(); server.close(() => resolve(port)); });
  });
}

describe.runIf(process.platform === 'win32')('real child processes: taskkill, exit and loopback port', () => {
  it('terminates a real listening child, awaits its exit and confirms its port closed', async () => {
    const owned = createOwnership(realSystem);
    const port = await freeLoopbackPort();
    const handle = owned.startProcess('real-listener', process.execPath, ['-e', `require('net').createServer().listen(${port},'127.0.0.1');setInterval(()=>{},1000)`], { env: minimalEnv(), logFile: logFile('real-listener'), ports: [port] });
    await waitFor(() => realSystem.portOpen(port), { timeoutMs: 15000, intervalMs: 100, label: 'real child listening' });
    expect(await owned.stopProcess(handle)).toMatchObject({ outcome: 'terminated', taskkillStatus: 0, exit: expect.any(Object) });
    expect(await realSystem.portOpen(port)).toBe(false);
    const report = passedReport();
    expect(await owned.finalizeRun({ report })).toEqual({ passed: true, exitCode: 0 });
  }, 60000);

  it('reports a real child that exited on its own as already exited', async () => {
    const owned = createOwnership(realSystem);
    const handle = owned.startProcess('real-short', process.execPath, ['-e', 'process.exit(0)'], { env: minimalEnv(), logFile: logFile('real-short') });
    await handle.exited;
    expect(await owned.stopProcess(handle)).toMatchObject({ outcome: 'already_exited', exit: { code: 0 } });
  }, 60000);
});
