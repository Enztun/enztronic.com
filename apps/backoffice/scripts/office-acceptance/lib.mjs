// Isolated Office acceptance helpers. Everything here creates NEW loopback-only
// fixtures and stops only processes it started itself.
import { spawn, spawnSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { createWriteStream, lstatSync, realpathSync } from 'node:fs';
import { cp, mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import postgres from 'postgres';

export const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const repoRoot = path.resolve(appRoot, '../..');
export const workerRoot = path.join(repoRoot, 'apps', 'office-worker');
// Production web/database, the existing preview, the shared test fixture and
// the system PostgreSQL are never used by this harness.
export const PROTECTED_PORTS = new Set([3100, 3101, 3118, 5432, 8787, 54329, 55439]);
export const FIXTURE_DATABASE = 'enztronic_office_acceptance_test';
export const OWNER_EMAIL = 'owner@example.test';
export const SALES_EMAIL = 'sales@example.test';

const SYSTEM_KEYS = ['SystemRoot', 'WINDIR', 'TEMP', 'TMP', 'ComSpec', 'PATHEXT', 'SystemDrive', 'USERPROFILE', 'LOCALAPPDATA', 'APPDATA', 'ProgramFiles', 'ProgramFiles(x86)', 'ProgramData', 'NUMBER_OF_PROCESSORS', 'PROCESSOR_ARCHITECTURE', 'OS'];

/** Explicit child environment. The parent shell is never inherited wholesale. */
export function minimalEnv(extra = {}) {
  const env = {};
  for (const key of SYSTEM_KEYS) if (process.env[key] !== undefined) env[key] = process.env[key];
  const systemRoot = process.env.SystemRoot ?? 'C:\\Windows';
  env.PATH = [path.dirname(process.execPath), path.join(systemRoot, 'System32'), systemRoot].join(path.delimiter);
  return { ...env, ...extra };
}

export function stamp() { return new Date().toISOString().replace(/[-:]/g, '').replace(/\..+$/, '').replace('T', '-'); }

export async function portFree(port) {
  return new Promise(resolve => {
    const server = net.createServer();
    server.once('error', () => resolve(false));
    server.listen(port, '127.0.0.1', () => server.close(() => resolve(true)));
  });
}

export async function assertTestPort(port, isFree = portFree) {
  if (PROTECTED_PORTS.has(port)) throw new Error(`Port ${port} is reserved for existing services.`);
  if (!(await isFree(port))) throw new Error(`Port ${port} is occupied; existing services will not be changed.`);
}

function checked(spawnSyncImpl, command, args, options = {}) {
  // `detached` children (pg_ctl start -> cmd -> postgres) would inherit and hold any pipe open for the
  // server's lifetime, so they get no standard handles; their output goes to the server log instead.
  const result = spawnSyncImpl(command, args, { windowsHide: true, encoding: 'utf8', env: minimalEnv(options.env), cwd: options.cwd ?? appRoot, timeout: options.timeout ?? 120000, stdio: options.detachedChildren ? 'ignore' : 'pipe' });
  if (options.log) options.log(`${path.basename(command)} ${args.join(' ')} -> ${result.status}`);
  if (result.status !== 0) throw new Error(`${path.basename(command)} failed (${result.status}): ${(result.stderr || result.stdout || '').slice(0, 800)}`);
  return result;
}
export function runChecked(command, args, options = {}) { return checked(spawnSync, command, args, options); }

/** Short, credential-free text for reports: no connection strings, bounded length. */
export function safeMessage(value) {
  const text = value instanceof Error ? value.message : String(value ?? '');
  return text.replace(/postgres(?:ql)?:\/\/\S+/gi, '[database-url]').replace(/\s+/g, ' ').trim().slice(0, 400);
}

// -- owned resources ------------------------------------------------------------

/** Operating-system actions behind resource ownership. Tests substitute these to inject faults. */
export const realSystem = {
  spawnChild: (command, args, options) => spawn(command, args, options),
  spawnSync: (command, args, options) => spawnSync(command, args, options),
  taskkill: pid => spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true, encoding: 'utf8', env: minimalEnv(), timeout: 30000 }),
  portFree,
  /** True while anything accepts loopback connections on the port; an inconclusive probe counts as open. */
  portOpen: port => new Promise(resolve => {
    const socket = net.connect({ port, host: '127.0.0.1' });
    const done = open => { socket.destroy(); resolve(open); };
    socket.setTimeout(2000, () => done(true));
    socket.once('connect', () => done(true));
    socket.once('error', error => done(error.code !== 'ECONNREFUSED'));
  }),
  /** Diagnostic only: PIDs listening on a loopback port. Nothing is ever stopped because of this. */
  listenerPids: port => {
    const result = spawnSync('netstat', ['-ano', '-p', 'TCP'], { windowsHide: true, encoding: 'utf8', env: minimalEnv(), timeout: 15000 });
    const pids = new Set();
    for (const line of (result.stdout ?? '').split(/\r?\n/)) {
      const [, local, , state, pid] = line.trim().split(/\s+/);
      if (state === 'LISTENING' && /^(127\.0\.0\.1|0\.0\.0\.0|\[::1?\]):\d+$/.test(local ?? '') && local.endsWith(`:${port}`)) pids.add(Number(pid));
    }
    return [...pids];
  },
  sleep: ms => new Promise(resolve => setTimeout(resolve, ms)),
};

const CLEANUP_FAILURES = new Set(['termination_failed', 'listener_remaining', 'stop_failed', 'cleanup_error', 'close_failed']);

/**
 * Resources one run created: child process trees and PostgreSQL clusters. Each is owned from the
 * moment it exists and counts as released only once its exit or shutdown, and the closing of its
 * fixture ports, has been confirmed. Nothing is adopted, and a different process that happens to
 * occupy a fixture port is reported, never stopped.
 */
export function createOwnership(system = realSystem, { stopTimeoutMs = 20000, portTimeoutMs = 10000 } = {}) {
  const processes = new Map();
  const clusters = new Map();
  const run = (command, args, options) => checked(system.spawnSync, command, args, options);
  const processResource = entry => ({ kind: 'process', name: entry.name, pid: entry.pid ?? null, ports: entry.ports });
  const clusterResource = entry => ({ kind: 'postgres', port: entry.port, data: path.relative(appRoot, entry.data) || entry.data });

  async function openPorts(ports) {
    let open = [];
    for (let waited = 0; ; waited += 250) {
      open = [];
      for (const port of ports) if (await system.portOpen(port)) open.push(port);
      if (!open.length || waited >= portTimeoutMs) return open;
      await system.sleep(250);
    }
  }
  const listeners = ports => ports.map(port => ({ port, listenerPids: system.listenerPids(port) }));

  /** Start a hidden child whose output goes only to its own log file. It is owned from this moment. */
  function startProcess(name, command, args, { cwd, env, logFile, stdin = 'ignore', ports = [] }) {
    const log = createWriteStream(logFile, { flags: 'a' });
    const child = system.spawnChild(command, args, { cwd, env, windowsHide: true, stdio: [stdin, 'pipe', 'pipe'] });
    child.stdout?.pipe(log, { end: false });
    child.stderr?.pipe(log, { end: false });
    const entry = { name, pid: child.pid, child, ports, exit: null, stop: null };
    entry.exited = new Promise(resolve => {
      const finish = exit => { if (entry.exit) return; entry.exit = exit; log.end(); resolve(exit); };
      child.once('exit', (code, signal) => finish({ code, signal }));
      child.once('error', error => finish({ code: null, signal: null, error: safeMessage(error) }));
    });
    processes.set(entry.pid ?? `unstarted:${name}:${processes.size}`, entry);
    return { name, child, pid: child.pid, exited: entry.exited };
  }

  /**
   * Stop one owned process tree and confirm it. Issuing taskkill is not proof of exit: the child's own
   * exit event is awaited, then its fixture ports must close. A child that already exited is reported
   * as such rather than as a termination failure.
   */
  async function stopProcess(handle) {
    const entry = [...processes.values()].find(candidate => candidate === handle || (!!handle?.child && candidate.child === handle.child));
    if (!entry) return { kind: 'process', name: handle?.name ?? null, pid: handle?.pid ?? null, outcome: 'not_owned' };
    let result;
    if (entry.stop) result = entry.stop;
    else if (entry.exit) result = { ...processResource(entry), outcome: 'already_exited', exit: entry.exit };
    else {
      const killed = system.taskkill(entry.pid);
      const exit = await Promise.race([entry.exited, system.sleep(stopTimeoutMs).then(() => null)]);
      if (!exit) result = { ...processResource(entry), outcome: 'termination_failed', taskkillStatus: killed.status ?? null, message: safeMessage(killed.stderr || killed.stdout || killed.error) };
      // A failed taskkill whose child still exits means the process was already ending on its own.
      else result = { ...processResource(entry), outcome: killed.status === 0 ? 'terminated' : 'already_exited', taskkillStatus: killed.status ?? null, exit };
    }
    if (entry.exit && result.outcome !== 'listener_remaining') {
      const open = await openPorts(entry.ports);
      if (open.length) result = { ...result, outcome: 'listener_remaining', listeners: listeners(open) };
    }
    entry.stop = result;
    return result;
  }

  /** A NEW disposable cluster. It is owned before it starts, so a failure after startup is still stopped. */
  async function createCluster({ root, port, pgBin, log, database = FIXTURE_DATABASE }) {
    await assertTestPort(port, system.portFree);
    const data = path.join(root, 'pgdata');
    run(path.join(pgBin, 'initdb.exe'), ['-D', data, '-U', 'office_test', '--auth=trust', '--encoding=UTF8', '--no-locale'], { log });
    const entry = { data, port, pgBin, log, stop: null };
    clusters.set(data, entry);
    try {
      run(path.join(pgBin, 'pg_ctl.exe'), ['-D', data, '-l', path.join(root, 'postgres.log'), '-o', `-h 127.0.0.1 -p ${port}`, '-w', 'start'], { log, detachedChildren: true });
      run(path.join(pgBin, 'createdb.exe'), ['-h', '127.0.0.1', '-p', String(port), '-U', 'office_test', database], { log });
    } catch (error) {
      // The creator cleans up what it started; if that fails as well, the run's finalizer still owns it.
      const cleanup = await stopOwnedCluster(entry);
      throw Object.assign(new Error(`PostgreSQL fixture initialization failed: ${safeMessage(error)} Cleanup: ${cleanup.outcome}.`), { cause: error, cleanup });
    }
    return { data, port, url: `postgresql://office_test@127.0.0.1:${port}/${database}` };
  }

  async function stopOwnedCluster(entry) {
    if (entry.stop?.resolved) return entry.stop;
    const pgCtl = path.join(entry.pgBin, 'pg_ctl.exe');
    const stopped = system.spawnSync(pgCtl, ['-D', entry.data, '-m', 'fast', '-w', 'stop'], { windowsHide: true, encoding: 'utf8', env: minimalEnv(), cwd: appRoot, timeout: 120000 });
    entry.log?.(`pg_ctl.exe -D ${entry.data} -m fast -w stop -> ${stopped.status}`);
    let outcome = 'stopped';
    if (stopped.status !== 0) {
      // pg_ctl status: 0 running, 3 not running, 4 no usable data directory (never started).
      const status = system.spawnSync(pgCtl, ['-D', entry.data, 'status'], { windowsHide: true, encoding: 'utf8', env: minimalEnv(), cwd: appRoot, timeout: 30000 });
      outcome = status.status === 3 || status.status === 4 ? 'already_stopped' : 'stop_failed';
    }
    let result = { ...clusterResource(entry), outcome, pgCtlStatus: stopped.status ?? null, ...(outcome === 'stop_failed' ? { message: safeMessage(stopped.stderr || stopped.stdout || stopped.error) } : {}) };
    if (outcome !== 'stop_failed') {
      const open = await openPorts([entry.port]);
      if (open.length) result = { ...result, outcome: 'listener_remaining', listeners: listeners(open) };
    }
    entry.stop = { ...result, resolved: result.outcome === 'stopped' || result.outcome === 'already_stopped' };
    return entry.stop;
  }

  /** Synchronous stop kept for callers that run their own finalizer; it throws when pg_ctl fails. */
  function stopCluster({ data, pgBin, log }) {
    run(path.join(pgBin, 'pg_ctl.exe'), ['-D', data, '-m', 'fast', '-w', 'stop'], { log });
    const entry = clusters.get(data);
    if (entry) entry.stop = { ...clusterResource(entry), outcome: 'stopped', pgCtlStatus: 0, resolved: true };
  }

  /** Everything this run still owns that is not confirmed released, with safe identifiers. */
  async function unresolved() {
    const remaining = [];
    for (const entry of processes.values()) {
      if (!entry.exit) remaining.push({ ...processResource(entry), reason: 'exit_not_confirmed' });
      const open = await openPorts(entry.ports);
      if (open.length) remaining.push({ ...processResource(entry), reason: 'owned_port_still_listening', listeners: listeners(open) });
    }
    for (const entry of clusters.values()) {
      if (!entry.stop?.resolved) remaining.push({ ...clusterResource(entry), reason: entry.stop?.outcome ?? 'not_stopped' });
      else if ((await openPorts([entry.port])).length) remaining.push({ ...clusterResource(entry), reason: 'owned_port_still_listening', listeners: listeners([entry.port]) });
    }
    return remaining;
  }

  /**
   * The shared acceptance finalizer. Every cleanup action is attempted even after an earlier one
   * fails; a cleanup failure or any unresolved owned resource makes the run fail even when every
   * functional check passed, and the original functional failure is kept alongside them.
   */
  async function finalizeRun({ report, failure = null, closers = [] }) {
    const actions = [];
    for (const [resource, close] of closers) {
      try { await close(); actions.push({ kind: 'client', resource, outcome: 'closed' }); }
      catch (error) { actions.push({ kind: 'client', resource, outcome: 'close_failed', message: safeMessage(error) }); }
    }
    for (const entry of [...processes.values()]) {
      try { actions.push(await stopProcess(entry)); }
      catch (error) { actions.push({ ...processResource(entry), outcome: 'cleanup_error', message: safeMessage(error) }); }
    }
    for (const entry of [...clusters.values()]) {
      try { actions.push(await stopOwnedCluster(entry)); }
      catch (error) { actions.push({ ...clusterResource(entry), outcome: 'cleanup_error', message: safeMessage(error) }); }
    }
    let remaining;
    try { remaining = await unresolved(); }
    catch (error) { remaining = [{ kind: 'verification', reason: 'verification_failed', message: safeMessage(error) }]; }
    const failures = actions.filter(action => CLEANUP_FAILURES.has(action.outcome));
    report.functionalPassed = !failure && report.checks.length > 0 && report.checks.every(entry => entry.passed);
    if (failure) report.failure = { message: safeMessage(failure), ...(failure?.cleanup ? { initializationCleanup: failure.cleanup } : {}) };
    report.cleanup = { passed: !failures.length && !remaining.length, actions, failures, unresolved: remaining };
    report.remainingProcesses = remaining.filter(entry => entry.kind === 'process');
    report.passed = report.functionalPassed && report.cleanup.passed;
    return { passed: report.passed, exitCode: report.passed ? 0 : 1 };
  }

  const liveProcesses = () => [...processes.values()].filter(entry => !entry.exit).map(processResource);
  return { startProcess, stopProcess, createCluster, stopCluster, stopOwnedCluster, unresolved, finalizeRun, liveProcesses };
}

/** The ownership registry of this process's acceptance or build run. */
export const owned = createOwnership();
export const { startProcess, stopProcess, createCluster, stopCluster, finalizeRun } = owned;
export function startedProcesses() { return owned.liveProcesses(); }

export async function waitFor(check, { timeoutMs = 120000, intervalMs = 1000, label = 'condition' } = {}) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try { const value = await check(); if (value) return value; } catch { /* retry until the deadline */ }
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${label}.`);
    await new Promise(resolve => setTimeout(resolve, intervalMs));
  }
}

export async function waitForHttp(url, timeoutMs = 240000) {
  return waitFor(async () => { const response = await fetch(url, { redirect: 'manual' }); return response.status > 0 && response.status < 500; }, { timeoutMs, intervalMs: 1500, label: url });
}

// -- disposable PostgreSQL --------------------------------------------------
// Clusters are created and stopped through the ownership registry above.

export function connect(url) {
  const target = new URL(url);
  if (!['127.0.0.1', 'localhost'].includes(target.hostname) || PROTECTED_PORTS.has(Number(target.port)) || !target.pathname.endsWith('_test')) throw new Error('Only a disposable loopback *_test database may be used.');
  return postgres(url, { max: 4, onnotice: () => undefined });
}

export async function applyMigrations(sql, names = ['001_init.sql', '002_users_and_ownership.sql', '003_office.sql', '004_office_live_provider.sql']) {
  for (const name of names) await sql.unsafe(await readFile(path.join(appRoot, 'database', 'migrations', name), 'utf8'));
}

export async function seedSyntheticBusiness(sql) {
  const [owner] = await sql`INSERT INTO backoffice.users(email,name,role,commission_rate_bps) VALUES(${OWNER_EMAIL},'Owner fixture','admin',0) RETURNING id`;
  const [sales] = await sql`INSERT INTO backoffice.users(email,name,role,commission_rate_bps) VALUES(${SALES_EMAIL},'Sales fixture','sales',500) RETURNING id`;
  await sql`INSERT INTO backoffice.clients(name,email,owner_user_id) VALUES('Synthetic client fixture','client@example.test',${sales.id})`;
  return { ownerId: owner.id, salesId: sales.id };
}

/** A fresh least-privilege login provisioned from the reviewed grant example. */
export async function createWorkerRole(sql, port) {
  const role = `office_worker_acceptance_${randomBytes(6).toString('hex')}`;
  await sql.unsafe(`CREATE ROLE ${role} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS`);
  const grants = await readFile(path.join(workerRoot, 'office-role.example.sql'), 'utf8');
  await sql.unsafe(grants.replaceAll('enztronic_office_runtime', role));
  return { role, url: `postgresql://${role}@127.0.0.1:${port}/${FIXTURE_DATABASE}` };
}

/** Count and content digest of every non-Office backoffice table. */
export async function businessDigest(sql) {
  const tables = await sql`SELECT table_name FROM information_schema.tables WHERE table_schema='backoffice' AND table_type='BASE TABLE' AND left(table_name,7)<>'office_' ORDER BY table_name`;
  const digest = {};
  for (const { table_name: table } of tables) {
    const [row] = await sql.unsafe(`SELECT count(*)::int AS n, md5(coalesce(string_agg(t::text, '|' ORDER BY t::text), '')) AS digest FROM backoffice."${table.replaceAll('"', '')}" t`);
    digest[table] = row;
  }
  return digest;
}

// -- working-tree snapshot ----------------------------------------------------

const EXCLUDED_DIRECTORIES = new Set(['node_modules', '.next', '.next-office-check', '.next-office-dev', '.runtime', '.venv', 'tmp', 'output', 'coverage']);
function excluded(relative, isDirectory) {
  const [top] = relative.split(path.sep);
  if (top.startsWith('.verify-')) return true;
  if (isDirectory && EXCLUDED_DIRECTORIES.has(path.basename(relative)) && !relative.includes(path.sep)) return true;
  const name = path.basename(relative);
  return !isDirectory && (name.startsWith('.env') || name.endsWith('.tsbuildinfo') || name.endsWith('.log'));
}

export class SnapshotDestinationError extends Error {
  constructor(code, message) { super(message); this.name = 'SnapshotDestinationError'; this.code = code; }
}

const exists = target => !!lstatSync(target, { throwIfNoEntry: false });
// Windows paths compare case-insensitively with one separator style and no trailing separator.
const comparablePath = target => { const normal = path.resolve(target).replace(/[\\/]+$/, ''); return process.platform === 'win32' ? normal.toLowerCase() : normal; };
const isWithin = (child, parent) => comparablePath(child).startsWith(`${comparablePath(parent)}${path.sep}`);

/** Absolute path whose existing part is resolved through junctions and symbolic links to its real location. */
export function canonicalPath(target, cwd = process.cwd()) {
  const missing = [];
  let existing = path.resolve(cwd, target);
  while (!exists(existing)) {
    const parent = path.dirname(existing);
    if (parent === existing) break;
    missing.unshift(path.basename(existing));
    existing = parent;
  }
  return path.join(realpathSync.native(existing), ...missing);
}

/**
 * Refuse a snapshot destination that is the source, lies inside it (directly or through a junction
 * or symbolic link), contains it, or already exists. Nothing is created before this passes, and an
 * old snapshot is never merged into.
 */
export function assertSafeSnapshotDestination({ source = appRoot, destination, cwd = process.cwd() }) {
  if (typeof destination !== 'string' || !destination.trim()) throw new SnapshotDestinationError('missing', 'A snapshot destination is required.');
  let from;
  let to;
  try { from = canonicalPath(source, cwd); to = canonicalPath(destination, cwd); }
  catch (error) { throw new SnapshotDestinationError('unresolvable', `Snapshot paths could not be resolved (${error.code ?? safeMessage(error)}).`); }
  if (comparablePath(to) === comparablePath(from)) throw new SnapshotDestinationError('same_as_source', `The snapshot destination ${to} is the source tree itself.`);
  if (isWithin(to, from)) throw new SnapshotDestinationError('inside_source', `The snapshot destination ${to} lies inside the source tree ${from}.`);
  if (isWithin(from, to)) throw new SnapshotDestinationError('contains_source', `The snapshot destination ${to} contains the source tree ${from}.`);
  const manifest = path.join(path.dirname(to), `${path.basename(to)}-manifest.json`);
  if (exists(path.resolve(cwd, destination)) || exists(to) || exists(manifest)) throw new SnapshotDestinationError('exists', `The snapshot destination ${to} or its manifest already exists; snapshots are never merged into earlier output.`);
  return { source: from, destination: to, manifest };
}

/** Copy the CURRENT working tree (tracked and untracked) without secrets, data or build output. */
export async function snapshotWorkingTree(target, { source = appRoot, cwd = process.cwd() } = {}) {
  // Validated before the target or any parent is created and before a single file is read.
  const { source: from, destination, manifest: manifestFile } = assertSafeSnapshotDestination({ source, destination: target, cwd });
  await mkdir(destination, { recursive: true });
  const manifest = [];
  async function walk(relative) {
    const absolute = path.join(from, relative);
    for (const entry of await readdir(absolute, { withFileTypes: true })) {
      const child = path.join(relative, entry.name);
      // Junctions and symbolic links are never followed, so nothing outside the source is copied.
      if (entry.isSymbolicLink() || excluded(child, entry.isDirectory())) continue;
      if (entry.isDirectory()) { await walk(child); continue; }
      await mkdir(path.dirname(path.join(destination, child)), { recursive: true });
      await cp(path.join(from, child), path.join(destination, child));
      const bytes = await readFile(path.join(destination, child));
      manifest.push({ path: child.split(path.sep).join('/'), bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') });
    }
  }
  await walk('');
  // Share installed packages through a junction; nothing is installed or modified. It must resolve to
  // exactly the source's packages, and nothing ever traverses or deletes through it.
  const modules = path.join(from, 'node_modules');
  const junction = path.join(destination, 'node_modules');
  runChecked('cmd.exe', ['/d', '/c', 'mklink', '/J', junction, modules]);
  if (!lstatSync(junction).isSymbolicLink() || comparablePath(realpathSync.native(junction)) !== comparablePath(realpathSync.native(modules))) throw new Error('The dependency junction does not resolve to the source node_modules.');
  const sorted = manifest.sort((a, b) => a.path.localeCompare(b.path));
  await writeFile(manifestFile, JSON.stringify({ source: from, destination, files: sorted.length, entries: sorted }, null, 2));
  if (sorted.some(entry => /(^|\/)\.env/.test(entry.path))) throw new Error('Snapshot unexpectedly contains an environment file.');
  return { files: sorted.length, destination, manifest: manifestFile };
}

export async function fileExists(file) { return stat(file).then(() => true, () => false); }
