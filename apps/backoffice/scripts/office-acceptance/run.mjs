// Isolated Office acceptance: one synthetic brief from a browser save to owner acceptance, plus
// failure, crash-recovery, fencing, restart, deep-link, denial and invariant checks.
// Creates NEW loopback fixtures only, never reads .env files or production configuration,
// stops only processes it started, and retains every log, screenshot and database for review.
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright';
import {
  appRoot, workerRoot, OWNER_EMAIL, SALES_EMAIL, applyMigrations, assertSafeSnapshotDestination, assertTestPort, businessDigest, connect, createCluster,
  createWorkerRole, finalizeRun, minimalEnv, seedSyntheticBusiness, snapshotWorkingTree, stamp, startProcess, stopProcess, waitFor, waitForHttp,
} from './lib.mjs';

const options = Object.fromEntries(process.argv.slice(2).map(argument => argument.replace(/^--/, '').split('=')));
const PG_BIN = options['pg-bin'] ?? 'C:\\Program Files\\PostgreSQL\\17\\bin';
const PG_PORT = Number(options['pg-port'] ?? 55449);
const APP_PORT = Number(options['app-port'] ?? 3128);
const SALES_PORT = Number(options['sales-port'] ?? 3129);
const RUN = stamp();
const evidence = path.join(appRoot, 'tmp', `claude-acceptance-${RUN}`);
// Outside the app so the copy is never type-checked, linted or collected as tests.
const snapshotRoot = path.join(options['snapshot-root'] ?? 'D:\\tmp', `claude-office-acceptance-${RUN}`);
const snapshotApp = path.join(snapshotRoot, 'app');
const shots = path.join(evidence, 'screenshots');
const DEMO = '00000000-0000-4000-8000-000000000001';
const LIVE = '00000000-0000-4000-8000-000000000002';
const MARKER = `ACCEPTANCE-${RUN}`;
const report = { run: RUN, startedAt: new Date().toISOString(), isolation: {}, checks: [], timeline: [], screenshots: [], processes: [], evidence: {} };

function note(event, details = {}) { const entry = { at: new Date().toISOString(), event, ...details }; report.timeline.push(entry); console.log(JSON.stringify(entry)); }
function check(name, passed, details = {}) {
  report.checks.push({ name, passed: !!passed, ...details });
  note(passed ? 'check_passed' : 'check_failed', { name, ...details });
  if (!passed) throw new Error(`Acceptance check failed: ${name}`);
}
async function shot(page, name, locator) {
  const file = path.join(shots, `${name}.png`);
  if (locator) { await locator.scrollIntoViewIfNeeded(); await locator.screenshot({ path: file }); } else await page.screenshot({ path: file });
  report.screenshots.push(path.relative(appRoot, file));
}
const tick = ms => new Promise(resolve => setTimeout(resolve, ms));
// Locators are bound to one page; each browser context gets fresh ones.
const dashboardPanel = page => page.locator('section[aria-labelledby="dashboard-office-title"]');
const statusSection = page => page.locator('section[aria-labelledby="office-status-title"]');
// Emulates a hidden or visible tab for the page's own visibility handling; Office stops polling while hidden.
const setTabHidden = (page, hidden) => page.evaluate(value => {
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => value });
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => (value ? 'hidden' : 'visible') });
  document.dispatchEvent(new Event('visibilitychange'));
}, hidden);
const leasedRunIn = (body, agentId, runId) => body?.roles?.find(entry => entry.agentId === agentId && entry.mode === 'demo')?.leasedRuns?.find(run => run.id === runId) ?? null;

function appEnv(email, port, cluster, distDir) {
  // Explicit synthetic values only. The development bypass is a fixture of `next dev`; production rejects it.
  return minimalEnv({ NODE_ENV: 'development', NEXT_TELEMETRY_DISABLED: '1', OFFICE_ENABLED: 'true', DATABASE_URL: cluster.url, CLOUDFLARE_ACCESS_DEV_BYPASS: 'true', CLOUDFLARE_ACCESS_DEV_EMAIL: email, BACKOFFICE_HOST: '127.0.0.1', BACKOFFICE_PORT: String(port), ...(distDir ? { OFFICE_BUILD_DIR: distDir } : {}) });
}
function startNext(name, port, email, cluster, distDir) {
  // The fixture port is owned with the process: cleanup is confirmed only once it has closed.
  const handle = startProcess(name, process.execPath, [path.join(snapshotApp, 'node_modules', 'next', 'dist', 'bin', 'next'), 'dev', '--webpack', '--hostname', '127.0.0.1', '--port', String(port)], { cwd: snapshotApp, env: appEnv(email, port, cluster, distDir), logFile: path.join(evidence, `${name}.log`), ports: [port] });
  report.processes.push({ name, pid: handle.pid, port });
  return handle;
}
async function stopOwned(handle) {
  const result = await stopProcess(handle);
  note('process_stopped', result);
  return result;
}
function startWorker(name, role, extraArgs = []) {
  const logDirectory = path.join(evidence, `worker-${name}`);
  const loader = pathToFileURL(path.join(workerRoot, 'node_modules', 'tsx', 'dist', 'loader.mjs')).href;
  const handle = startProcess(`worker-${name}`, process.execPath, ['--import', loader, path.join(workerRoot, 'src', 'index.ts'), ...extraArgs], {
    cwd: workerRoot, stdin: 'pipe', logFile: path.join(evidence, `worker-${name}.stdout.log`),
    env: minimalEnv({ OFFICE_ENABLED: 'true', OFFICE_DEMO_WORKER: 'true', OFFICE_WORKER_DATABASE_URL: role.url, OFFICE_WORKER_CONCURRENCY: '1', OFFICE_WORKER_LOG_DIRECTORY: logDirectory, OFFICE_WORKER_SUPERVISED: 'true' }),
  });
  report.processes.push({ name: `worker-${name}`, pid: handle.pid, args: extraArgs });
  return handle;
}
async function stopWorkerGracefully(handle) {
  // The supervised worker treats any stdin data as a shutdown request and records a stopping heartbeat.
  handle.child.stdin.write('stop\n');
  const exit = await Promise.race([handle.exited, tick(45000).then(() => null)]);
  if (!exit) await stopOwned(handle);
  return exit;
}
async function zombie(mode, role, file) {
  const loader = pathToFileURL(path.join(appRoot, 'node_modules', 'tsx', 'dist', 'loader.mjs')).href;
  const handle = startProcess(`zombie-${mode}`, process.execPath, ['--import', loader, path.join(appRoot, 'scripts', 'office-acceptance', 'zombie-lease.ts'), mode, role.url, file], { cwd: appRoot, env: minimalEnv(), logFile: path.join(evidence, `zombie-${mode}.log`) });
  const exit = await handle.exited;
  if (exit.code !== 0) throw new Error(`zombie ${mode} exited ${exit.code}`);
  return JSON.parse(await readFile(mode === 'claim' ? file : file.replace(/\.json$/, '-stale-commit.json'), 'utf8'));
}

async function familyEvidence(sql, parentId) {
  const tasks = await sql`SELECT id, parent_task_id, agent_id, state, version::int, current_artifact_id, acceptance_evidence_id, blocked_reason, created_at, updated_at FROM backoffice.office_tasks WHERE id=${parentId} OR parent_task_id=${parentId} ORDER BY parent_task_id NULLS FIRST, agent_id`;
  const ids = tasks.map(task => task.id);
  return {
    tasks,
    runs: await sql`SELECT id, task_id, agent_id, step, state, attempt, predecessor_run_id, error_code, started_at, finished_at FROM backoffice.office_runs WHERE task_id IN ${sql(ids)} ORDER BY started_at, id`,
    artifacts: await sql`SELECT a.id, a.task_id, a.author_agent_id, a.producer_run_id, a.revision, a.artifact_hash, a.size_bytes, encode(sha256(convert_to(a.content,'UTF8')),'hex')=a.artifact_hash AS digest_matches FROM backoffice.office_artifacts a WHERE a.task_id IN ${sql(ids)} ORDER BY a.created_at`,
    reviews: await sql`SELECT r.id, r.task_id, r.artifact_id, r.reviewer_id, a.author_agent_id, r.state, r.artifact_hash, r.decided_at FROM backoffice.office_reviews r JOIN backoffice.office_artifacts a ON a.id=r.artifact_id WHERE r.task_id IN ${sql(ids)} ORDER BY r.created_at`,
    approvals: await sql`SELECT id, task_id, artifact_id, artifact_hash, state, version::int, decided_at, acceptance_evidence_id FROM backoffice.office_approvals WHERE task_id IN ${sql(ids)} ORDER BY created_at`,
    acceptance: await sql`SELECT e.id, e.approval_id, e.artifact_id, e.artifact_hash, jsonb_array_length(e.component_manifest) AS manifest_entries, jsonb_array_length(e.review_references) AS review_references, e.decided_at FROM backoffice.office_acceptance_evidence e JOIN backoffice.office_approvals a ON a.id=e.approval_id WHERE a.task_id=${parentId}`,
    handoffs: (await sql`SELECT count(*)::int AS n, count(*) FILTER (WHERE state='accepted')::int AS accepted FROM backoffice.office_handoffs WHERE task_id IN ${sql(ids)}`)[0],
    events: await sql`SELECT event_type, actor_type, count(*)::int AS n FROM backoffice.office_events WHERE task_id IN ${sql(ids)} GROUP BY 1,2 ORDER BY 1,2`,
  };
}

let cluster = null;
let sql = null;
let browser = null;
let failure = null;
try {
  await mkdir(shots, { recursive: true });
  // The snapshot destination is checked before it, or anything in it, is created or copied.
  assertSafeSnapshotDestination({ source: appRoot, destination: snapshotApp });
  for (const port of [PG_PORT, APP_PORT, SALES_PORT]) await assertTestPort(port);
  report.isolation = { pgPort: PG_PORT, appPort: APP_PORT, salesPort: SALES_PORT, database: 'enztronic_office_acceptance_test', evidence: path.relative(appRoot, evidence), snapshot: snapshotApp, envFilesInSnapshot: 0, production: 'ports 3100/54329 and .runtime are never used' };
  note('snapshot_start');
  report.isolation.snapshotFiles = (await snapshotWorkingTree(snapshotApp)).files;
  note('snapshot_done', { files: report.isolation.snapshotFiles });

  cluster = await createCluster({ root: path.join(evidence, 'pg'), port: PG_PORT, pgBin: PG_BIN, log: message => note('pg', { message }) });
  sql = connect(cluster.url);
  await applyMigrations(sql);
  const { ownerId } = await seedSyntheticBusiness(sql);
  const role = await createWorkerRole(sql, PG_PORT);
  report.isolation.workerRole = role.role;
  const digestBefore = await businessDigest(sql);
  note('fixture_ready', { ownerId });

  const owner = startNext('next-dev-owner', APP_PORT, OWNER_EMAIL, cluster);
  const base = `http://127.0.0.1:${APP_PORT}`;
  await waitForHttp(`${base}/dashboard`, 600000);
  note('owner_server_ready');

  browser = await chromium.launch({ headless: true, env: minimalEnv() });
  // ---- Phase 1: save one brief with no worker, reload, failure classes, then close the browser.
  let context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  let page = await context.newPage();
  page.setDefaultTimeout(180000);
  await page.goto(`${base}/dashboard`);
  const panel = dashboardPanel(page);
  await panel.getByText('No worker connected').waitFor();
  check('dashboard: Office panel truthful before any work', await panel.getByText('Demonstration records').isVisible());
  await shot(page, '01-dashboard-before-work', panel);

  await page.goto(`${base}/team`);
  await page.getByRole('heading', { name: 'Office', level: 1 }).waitFor();
  await page.getByRole('button', { name: 'New internal brief' }).click();
  const form = page.locator('section[aria-labelledby="office-new-brief-title"]');
  await form.getByText('Saving creates a durable demonstration task').waitFor();
  check('brief: persistence and execution explained before writing', await form.getByText(/nothing executes until a worker runs/).isVisible());
  const goal = `Synthetic website proposal ${MARKER}`;
  const briefText = `Synthetic owner request ${MARKER}: five informational pages, a contact form proposal and an accessibility review. Prices, dates, provider and sources remain unknown.`;
  await form.getByLabel('Goal').fill(goal);
  await form.getByLabel('Brief and permitted source references').fill(briefText);
  check('brief: draft labelled as tab-memory only', await form.getByText('Unsaved draft · kept only in this tab').isVisible());
  await shot(page, '02-brief-persistence-banner', form);
  await form.getByRole('button', { name: 'Save simulated brief' }).click();
  const savedNotice = page.getByText(/Saved as task [0-9a-f-]{36}/);
  await savedNotice.waitFor();
  const parentId = (await savedNotice.textContent()).match(/[0-9a-f-]{36}/)[0];
  check('save: confirmed task id shown and selected in the URL', page.url().includes(`task=${parentId}`), { parentId, url: page.url() });
  check('save: notice says nothing is executing without a worker', /nothing is executing/.test(await savedNotice.textContent()));
  const detail = page.locator('#office-task-detail');
  await detail.getByText(`Task · ${parentId}`).waitFor();
  await detail.getByText(/Delegated · 0 of 7 specialist tasks reviewed/).waitFor();
  check('save: parent shown as delegated, not executing', !(await detail.getByText(/Executing now/).count()));
  await shot(page, '03-saved-task-queued-not-executing');
  await page.reload();
  await detail.getByText(`Task · ${parentId}`).waitFor();
  check('reload: same task id and source text restored', await detail.getByText(MARKER, { exact: false }).first().isVisible());
  await shot(page, '04-reload-preserves-task-and-brief');

  // Uncertain outcome: the server saves, the browser never sees the response.
  await page.getByRole('combobox', { name: /^Records/ }).selectOption('live');
  await page.getByRole('button', { name: 'New internal brief' }).click();
  const liveGoal = `Live uncertain save ${MARKER}`;
  await form.getByLabel('Goal').fill(liveGoal);
  await form.getByLabel('Brief and permitted source references').fill(`Synthetic live request ${MARKER}; execution is not configured.`);
  let intercepted = 0;
  const dropResponse = async route => {
    if (route.request().method() !== 'POST' || intercepted) return route.continue();
    intercepted += 1;
    const response = await route.fetch();
    note('uncertain_save_server_status', { status: response.status() });
    await route.abort('failed');
  };
  await page.route('**/api/office', dropResponse);
  await form.getByRole('button', { name: 'Save internal brief' }).click();
  await form.getByText('Reconcile the earlier submission before anything else').waitFor();
  await page.unroute('**/api/office', dropResponse);
  check('uncertain: brief locked for an identical retry', await form.getByLabel('Goal').isDisabled());
  const liveCount = async text => (await sql`SELECT count(*)::int AS n FROM backoffice.office_tasks WHERE goal=${text} AND parent_task_id IS NULL`)[0].n;
  check('uncertain: the server did save exactly one task', await liveCount(liveGoal) === 1);
  await shot(page, '05-uncertain-save-locked', form);
  await form.getByRole('button', { name: 'Refresh and inspect saved tasks' }).click();
  await form.getByRole('button', { name: 'Retry the same brief safely' }).and(page.locator(':enabled')).waitFor();
  await form.getByRole('button', { name: 'Retry the same brief safely' }).click();
  const duplicateNotice = page.getByText(/Your earlier attempt was already saved as task/);
  await duplicateNotice.waitFor();
  check('uncertain: retry reconciled to the same task; no duplicate parent', await liveCount(liveGoal) === 1);
  await shot(page, '06-uncertain-reconciled-no-duplicate');

  // Definitive rejection, storage uncertainty, session loss and offline: text is always retained.
  const fulfill = (status, body) => async route => (route.request().method() === 'POST' ? route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) }) : route.continue());
  await page.getByRole('button', { name: 'New internal brief' }).click();
  const rejectGoal = `Rejected save ${MARKER}`;
  await form.getByLabel('Goal').fill(rejectGoal);
  await form.getByLabel('Brief and permitted source references').fill(`Synthetic conflict case ${MARKER}.`);
  let handler = fulfill(409, { error: 'Idempotency key was already used for different input.', code: 'CONFLICT' });
  await page.route('**/api/office', handler);
  await form.getByRole('button', { name: 'Save internal brief' }).click();
  await form.getByText(/Not saved: Idempotency key was already used/).waitFor();
  await page.unroute('**/api/office', handler);
  check('409: text kept and editable; nothing stored', (await form.getByLabel('Goal').inputValue()) === rejectGoal && await form.getByLabel('Goal').isEnabled() && await liveCount(rejectGoal) === 0);
  await shot(page, '07-conflict-rejected-text-kept', form);

  handler = fulfill(503, { error: 'Office storage is unavailable. Check migration and worker configuration.', code: 'storage_unavailable' });
  await page.route('**/api/office', handler);
  await form.getByRole('button', { name: 'Save internal brief' }).click();
  await form.getByText('Reconcile the earlier submission before anything else').waitFor();
  await page.unroute('**/api/office', handler);
  check('503 storage: outcome treated as unknown and locked', await form.getByLabel('Goal').isDisabled());
  await form.getByRole('button', { name: 'Refresh and inspect saved tasks' }).click();
  await form.getByRole('button', { name: 'Retry the same brief safely' }).and(page.locator(':enabled')).waitFor();
  await form.getByRole('button', { name: 'Retry the same brief safely' }).click();
  await page.getByText(/Saved as task [0-9a-f-]{36}/).waitFor();
  check('503 storage: the same-key retry saved exactly one task', await liveCount(rejectGoal) === 1);

  await page.getByRole('button', { name: 'New internal brief' }).click();
  const deniedGoal = `Denied save ${MARKER}`;
  await form.getByLabel('Goal').fill(deniedGoal);
  await form.getByLabel('Brief and permitted source references').fill(`Synthetic expired-session case ${MARKER}.`);
  handler = fulfill(401, { error: 'Authentication required', code: 'invalid_token' });
  await page.route('**/api/office', handler);
  await form.getByRole('button', { name: 'Save internal brief' }).click();
  await form.getByText('Saving is blocked: the owner session is unavailable').waitFor();
  await page.unroute('**/api/office', handler);
  check('401: text kept and nothing stored', (await form.getByLabel('Goal').inputValue()) === deniedGoal && await liveCount(deniedGoal) === 0);
  await shot(page, '08-session-denied-text-kept', form);
  await page.getByRole('button', { name: 'Refresh office records' }).click();
  await form.getByText('Saving is available; live execution is not configured').waitFor();
  await context.setOffline(true);
  await form.getByText('Saving is paused: this browser is offline').waitFor();
  check('offline: text kept while saving is paused', (await form.getByLabel('Goal').inputValue()) === deniedGoal);
  await shot(page, '09-offline-text-kept', form);
  await context.setOffline(false);
  await form.getByText('Saving is available; live execution is not configured').waitFor({ timeout: 60000 });
  report.evidence.browserClosedAt = new Date().toISOString();
  await context.close();
  note('browser_closed');

  // ---- Phase 2: crash after claim, stopped worker, restarts and recovery while no browser is open.
  const leaseFile = path.join(evidence, 'zombie-lease.json');
  const claimed = await zombie('claim', role, leaseFile);
  check('crash: a worker claimed a lease and exited without executing', !!claimed.lease?.runId, { runId: claimed.lease?.runId, step: claimed.lease?.step });

  const first = startWorker('stopped', role);
  await waitFor(async () => (await sql`SELECT count(*)::int AS n FROM backoffice.office_workers WHERE id<>'zombie-acceptance-worker'`)[0].n > 0, { timeoutMs: 60000, label: 'first worker heartbeat' });
  await tick(4000);
  const firstExit = await stopWorkerGracefully(first);
  const [stoppedRow] = await sql`SELECT id, stopping, heartbeat_at FROM backoffice.office_workers WHERE id<>'zombie-acceptance-worker' ORDER BY heartbeat_at DESC LIMIT 1`;
  check('stop: graceful stop recorded a stopping heartbeat', stoppedRow?.stopping === true && firstExit?.code === 0, { workerId: stoppedRow?.id });
  const [committedWhileHeld] = await sql`SELECT count(*)::int AS n FROM backoffice.office_runs WHERE state='succeeded' AND step IN ('draft','review','package','package_review')`;
  check('capacity: no step ran while the abandoned lease was live', committedWhileHeld.n === 0);

  // ---- Phase 2b: the actual Office view ages that live lease itself. The page clock is controlled;
  // the lease, its server-relative remaining time and the worker heartbeat are real database evidence.
  {
    const agent = claimed.lease.agentId;
    const expected = ['review', 'package_review'].includes(claimed.lease.step) ? 'reviewing' : 'executing';
    const statusReads = [];
    let officeRequests = 0;
    context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    page = await context.newPage();
    page.setDefaultTimeout(180000);
    await page.clock.install();
    page.on('request', request => { if (new URL(request.url()).pathname.startsWith('/api/office')) officeRequests += 1; });
    page.on('response', response => { if (new URL(response.url()).pathname === '/api/office/status' && response.ok()) response.json().then(body => statusReads.push(body), () => undefined); });
    await page.goto(`${base}/team?view=status`);
    const card = statusSection(page).locator(`li[data-agent-id="${agent}"]`);
    await statusSection(page).locator(`li[data-agent-id="${agent}"][data-indicator="${expected}"]`).waitFor();
    await waitFor(() => leasedRunIn(statusReads.at(-1), agent, claimed.lease.runId), { timeoutMs: 15000, intervalMs: 100, label: 'status read with the claimed lease' });
    const read = leasedRunIn(statusReads.at(-1), agent, claimed.lease.runId);
    check('lease view: a live lease shows as execution, with remaining time measured by the database', read.leaseLive && read.leaseRemainingMs > 0 && read.leaseRemainingMs <= 30000, { agent, step: claimed.lease.step, leaseRemainingMs: read.leaseRemainingMs });
    check('lease view: the worker heartbeat is shown separately (still online)', await statusSection(page).getByText('Worker online', { exact: true }).first().isVisible());
    // Hidden tab: polling stops. The page clock is frozen, so nothing advances unless this test runs it.
    await setTabHidden(page, true);
    await page.clock.pauseAt(new Date((await page.evaluate(() => Date.now())) + 50));
    const requestsBefore = officeRequests;
    check('lease view: still shown as execution just before its remaining time runs out', await card.getAttribute('data-indicator') === expected);
    await page.clock.runFor(read.leaseRemainingMs + 1000);
    await statusSection(page).locator(`li[data-agent-id="${agent}"][data-indicator="stalled"]`).waitFor({ timeout: 15000 });
    const expiredLabel = (await card.locator('[data-state="stalled"]').first().textContent())?.trim();
    check('lease view: at local expiry the role stops claiming execution, with no new fetch', officeRequests === requestsBefore && expiredLabel === 'Lease expired' && !/Executing|Reviewing|Running|lease held/.test(await card.textContent()), { requestsDuringExpiry: officeRequests - requestsBefore, label: expiredLabel });
    await shot(page, '20-lease-expired-locally-without-fetch', card);
    // Visible again: the page re-ages at once and reconciles; the fresh database read replaces the estimate.
    const readsBefore = statusReads.length;
    await setTabHidden(page, false);
    await waitFor(() => statusReads.length > readsBefore, { timeoutMs: 20000, intervalMs: 100, label: 'reconciling status read after the tab became visible' });
    const fresh = leasedRunIn(statusReads.at(-1), agent, claimed.lease.runId);
    const reconciled = fresh?.leaseLive && fresh.leaseRemainingMs > 0 ? expected : 'stalled';
    await statusSection(page).locator(`li[data-agent-id="${agent}"][data-indicator="${reconciled}"]`).waitFor({ timeout: 15000 });
    check('lease view: becoming visible reconciles with fresh database evidence', officeRequests > requestsBefore, { freshLeaseRemainingMs: fresh?.leaseRemainingMs ?? null, indicator: reconciled });
    // Fault injection: hold one status response while page time passes, and shorten the remaining time it
    // reports to less than that delay. Evidence already expired on arrival must never read as execution.
    if (reconciled === expected) {
      await setTabHidden(page, true);
      let release;
      const released = new Promise(resolve => { release = resolve; });
      let intercepted;
      const interceptedRead = new Promise(resolve => { intercepted = resolve; });
      await page.route('**/api/office/status**', async route => {
        const response = await route.fetch();
        const body = await response.json();
        for (const run of [...body.roles.flatMap(entry => [entry.activeRun, ...entry.leasedRuns]), ...body.tasks.flatMap(entry => [entry.activeRun, ...entry.leasedRuns])]) if (run?.id === claimed.lease.runId) run.leaseRemainingMs = Math.min(run.leaseRemainingMs, 3000);
        for (const entry of body.roles) if (entry.reviewInProgress?.runId === claimed.lease.runId) entry.reviewInProgress.leaseRemainingMs = Math.min(entry.reviewInProgress.leaseRemainingMs, 3000);
        intercepted(body);
        await released;
        await route.fulfill({ response, json: body });
      }, { times: 1 });
      await page.getByRole('button', { name: 'Refresh office records' }).click();
      await interceptedRead;
      await page.clock.runFor(5000);
      check('lease view: the earlier fresh read is still current while the next response is delayed', await card.getAttribute('data-indicator') === expected);
      const delivered = statusReads.length;
      release();
      await waitFor(() => statusReads.length > delivered, { timeoutMs: 15000, intervalMs: 100, label: 'delayed status response' });
      await statusSection(page).locator(`li[data-agent-id="${agent}"][data-indicator="stalled"]`).waitFor({ timeout: 15000 });
      check('lease view (fault injection): a response whose lease expired in transit is never shown as execution', (await card.locator('[data-state="stalled"]').first().textContent())?.trim() === 'Lease expired' && !/Executing|Reviewing|Running|lease held/.test(await card.textContent()));
      await shot(page, '21-delayed-response-expired-on-arrival', card);
      await page.unrouteAll({ behavior: 'wait' });
    } else note('lease_view_delayed_case_skipped', { reason: 'the real lease had already expired at the reconciling read' });
    await context.close();
  }

  await waitFor(async () => (await sql`SELECT lease_until<now() AS expired FROM backoffice.office_dispatch WHERE id=${claimed.lease.dispatchId}`)[0].expired, { timeoutMs: 90000, label: 'abandoned lease expiry' });
  // The abandoned claim also heartbeated; by the runtime's 60 s rule it counts as online until that ages out.
  await waitFor(async () => !(await sql`SELECT 1 FROM backoffice.office_workers WHERE NOT stopping AND heartbeat_at>now()-interval '61 seconds'`).length, { timeoutMs: 120000, label: 'abandoned heartbeat ageing out' });

  context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  page = await context.newPage();
  page.setDefaultTimeout(180000);
  await page.goto(`${base}/team?view=status`);
  const stoppedPanel = statusSection(page);
  await stoppedPanel.getByText('Worker stopped', { exact: true }).first().waitFor();
  check('status: stalled lease and stopped worker shown truthfully', await stoppedPanel.locator('[data-indicator="stalled"]').count() === 1);
  await shot(page, '10-worker-stopped-stalled-lease', stoppedPanel);
  await context.close();

  for (const pass of ['once-1', 'once-2']) {
    const handle = startWorker(pass, role, ['--once']);
    const exit = await handle.exited;
    check(`restart: single-pass worker ${pass} exited cleanly`, exit.code === 0);
  }
  const [interrupted] = await sql`SELECT state, error_code FROM backoffice.office_runs WHERE id=${claimed.lease.runId}`;
  check('recovery: the abandoned run was interrupted on lease expiry', interrupted.state === 'interrupted' && interrupted.error_code === 'lease_expired');
  const continuous = startWorker('continuous', role);
  await waitFor(async () => (await sql`SELECT state FROM backoffice.office_tasks WHERE id=${parentId}`)[0].state === 'waiting_for_owner_approval', { timeoutMs: 180000, label: 'reviewed package awaiting owner' });
  const [successor] = await sql`SELECT id, attempt, predecessor_run_id, state FROM backoffice.office_runs WHERE predecessor_run_id=${claimed.lease.runId}`;
  check('recovery: a new linked run completed the interrupted step', successor?.state === 'succeeded' && successor.attempt === 2, { successorRunId: successor?.id });
  const fenced = await zombie('stale-commit', role, leaseFile);
  check('fencing: the stale lease could not commit', fenced.outcome === 'LEASE_LOST');

  // ---- Phase 3: reopen the browser, follow the dashboard decision link, inspect evidence, accept.
  context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  page = await context.newPage();
  page.setDefaultTimeout(180000);
  await page.goto(`${base}/dashboard`);
  const decisionPanel = dashboardPanel(page);
  await decisionPanel.getByText('Worker online').first().waitFor();
  await shot(page, '11-dashboard-awaiting-owner', decisionPanel);
  await decisionPanel.getByRole('link', { name: new RegExp(`Review decision: ${goal}`) }).click();
  await page.waitForURL(url => url.pathname === '/team' && url.search === `?mode=demo&workspace=${DEMO}&task=${parentId}&view=inbox`);
  const inboxCard = page.locator('article[aria-current="true"]');
  await inboxCard.getByRole('button', { name: 'Accept this internal package' }).waitFor();
  check('deep link: exact mode, workspace, task and inbox opened', await page.locator('#office-task-detail').getByText(`Task · ${parentId}`).isVisible());
  await shot(page, '12-deep-link-exact-decision');
  await page.getByRole('button', { name: 'Status', exact: true }).click();
  const rolePanel = statusSection(page);
  await rolePanel.locator('li[data-agent-id]').first().waitFor();
  const indicators = await rolePanel.locator('li[data-agent-id]').evaluateAll(items => items.map(item => ({ agent: item.getAttribute('data-agent-id'), indicator: item.getAttribute('data-indicator') })));
  check('roles: all seven show persisted states and none is idle', indicators.length === 7 && indicators.every(item => item.indicator !== 'idle' && item.indicator !== 'unknown'), { indicators });
  await shot(page, '13-role-status-evidence', rolePanel);
  await page.getByRole('button', { name: 'Inbox' }).click();
  await page.locator('#office-task-detail').getByText('Execution evidence').scrollIntoViewIfNeeded();
  await shot(page, '14-package-execution-and-evidence', page.locator('#office-task-detail'));
  await page.locator('article[aria-current="true"]').getByRole('button', { name: 'Accept this internal package' }).click();
  await page.getByText(/Accepted\. Acceptance evidence [0-9a-f-]{36}/).waitFor();
  await shot(page, '15-owner-accepted');
  const family = await familyEvidence(sql, parentId);
  const evidenceIds = new Set(family.tasks.map(task => task.acceptance_evidence_id));
  check('acceptance: parent and seven children completed with one shared evidence record', family.tasks.length === 8 && family.tasks.every(task => task.state === 'completed') && evidenceIds.size === 1 && !evidenceIds.has(null));
  check('evidence: seven authored drafts plus package, all digests match', family.artifacts.length === 8 && family.artifacts.every(artifact => artifact.digest_matches && artifact.producer_run_id));
  check('evidence: every passed review is independent of its author', family.reviews.filter(review => review.state === 'passed').length === 8 && family.reviews.every(review => review.reviewer_id !== review.author_agent_id));
  report.evidence.family = family;
  report.evidence.zombie = { claimed, fenced, successorRunId: successor.id };

  // Invalid, cross-workspace, wrong-mode and unknown links open nothing and reveal nothing.
  for (const [name, url, expected] of [
    ['invalid', '/team?mode=demo&workspace=not-a-uuid', 'This Office link is malformed or ambiguous'],
    ['cross-workspace', `/team?mode=live&workspace=${LIVE}&task=${parentId}`, 'No internal record matches this link'],
    ['wrong-mode', `/team?mode=live&workspace=${DEMO}&task=${parentId}`, 'No internal record matches this link'],
    ['unknown-task', `/team?mode=demo&workspace=${DEMO}&task=${randomUUID()}`, 'No demonstration record matches this link'],
  ]) {
    await page.goto(`${base}${url}`);
    await page.getByText(expected).waitFor();
    const leaked = await page.locator('#office-task-detail').count();
    check(`deep link ${name}: useful state, nothing opened`, leaked === 0);
    if (name === 'cross-workspace') await shot(page, '16-deep-link-cross-workspace-denied');
  }
  await page.goto(`${base}/dashboard`);
  const acceptedPanel = dashboardPanel(page);
  await acceptedPanel.getByText('Owner accepted').first().waitFor();
  await shot(page, '17-dashboard-after-acceptance', acceptedPanel);
  await context.close();

  // ---- Phase 3b: exact revision links in the actual Office view, on a second synthetic family whose
  // child has a run-produced R1 and an owner-prepared R2 (both written through the real Office API).
  {
    context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    page = await context.newPage();
    page.setDefaultTimeout(180000);
    const api = async (operation, input) => {
      const response = await page.request.post(`${base}/api/office`, { headers: { origin: base, 'content-type': 'application/json' }, data: { operation, input } });
      if (!response.ok()) throw new Error(`Office ${operation} failed (${response.status()})`);
      return response.json();
    };
    const revisionGoal = `Revision link check ${MARKER}`;
    const { taskId: revisionParent } = await api('submit', { workspaceId: DEMO, mode: 'demo', goal: revisionGoal, brief: `Synthetic revision-link request ${MARKER}; prices, dates and sources remain unknown.`, idempotencyKey: randomUUID() });
    const [child] = await waitFor(async () => { const rows = await sql`SELECT id, agent_id, goal, version::int, current_artifact_id FROM backoffice.office_tasks WHERE parent_task_id=${revisionParent} AND state='review_passed' ORDER BY updated_at, id LIMIT 1`; return rows.length ? rows : null; }, { timeoutMs: 240000, intervalMs: 1000, label: 'a reviewed specialist draft in the second family' });
    const r1 = child.current_artifact_id;
    await api('task_action', { workspaceId: DEMO, taskId: child.id, version: child.version, action: 'request_changes', reason: 'Synthetic revision-link check: prepare a second revision.' });
    const [changed] = await sql`SELECT version::int FROM backoffice.office_tasks WHERE id=${child.id}`;
    const { artifactId: r2 } = await api('revise_artifact', { workspaceId: DEMO, taskId: child.id, version: changed.version, title: 'Synthetic owner revision R2', content: `Owner-prepared synthetic revision ${MARKER}. No real work was performed.`, authorAgentId: child.agent_id });
    const revisions = await sql`SELECT id, revision, producer_run_id IS NOT NULL AS from_run FROM backoffice.office_artifacts WHERE task_id=${child.id} ORDER BY revision`;
    check('revision: a child holds a run-produced R1 and an owner-prepared R2', revisions.length === 2 && revisions[0].id === r1 && revisions[0].from_run && revisions[1].id === r2 && !revisions[1].from_run, { taskId: child.id, r1, r2 });
    const revisionHref = artifactId => `/team?mode=demo&workspace=${DEMO}&task=${child.id}&artifact=${artifactId}&view=tasks`;
    const detail = page.locator('#office-task-detail');
    const select = detail.getByRole('combobox', { name: 'Artifact revision' });
    const shown = revision => detail.locator(`pre[aria-label$=", revision ${revision}"]`);
    const urlHas = artifactId => new URL(page.url()).searchParams.get('artifact') === artifactId;
    const statusRead = () => page.waitForResponse(response => new URL(response.url()).pathname === '/api/office/status');

    // Initial R1 link, after hydration, URL synchronisation and the first evidence poll.
    let polled = statusRead();
    await page.goto(`${base}${revisionHref(r1)}`);
    await shown(1).waitFor();
    await polled;
    check('revision link: an initial R1 link shows exactly R1 and keeps it in the canonical URL', urlHas(r1) && await select.inputValue() === r1 && await detail.locator('[data-revision="historical"]').isVisible(), { url: new URL(page.url()).search });
    await shot(page, '22-revision-link-r1-kept', detail);
    polled = statusRead();
    await page.reload();
    await shown(1).waitFor();
    await polled;
    check('revision link: reload keeps R1 rather than the current R2', urlHas(r1) && await select.inputValue() === r1);
    polled = statusRead();
    await page.getByRole('button', { name: 'Refresh office records' }).click();
    await polled;
    check('revision link: a record refresh keeps R1', urlHas(r1) && await select.inputValue() === r1 && await shown(1).isVisible());

    // Same-route navigation R1 → R2 with an unsaved brief draft in page memory.
    await page.getByRole('button', { name: 'New internal brief' }).click();
    const form = page.locator('section[aria-labelledby="office-new-brief-title"]');
    const draftGoal = `Unsaved draft across navigation ${MARKER}`;
    await form.getByLabel('Goal').fill(draftGoal);
    await page.evaluate(href => window.next.router.push(href), revisionHref(r2));
    await page.waitForURL(url => url.searchParams.get('artifact') === r2);
    await shown(2).waitFor();
    check('revision link: same-route navigation R1 → R2 applies R2 in the open task detail', urlHas(r2) && await select.inputValue() === r2 && !(await shown(1).count()));
    await page.getByRole('button', { name: 'New internal brief' }).click();
    check('revision link: unsaved draft text stays in page memory across that navigation', (await form.getByLabel('Goal').inputValue()) === draftGoal);
    await form.getByRole('button', { name: 'Keep draft text and close' }).click();
    await shot(page, '23-revision-link-r1-to-r2', detail);

    // Explicit selection, explicit return to the current revision, then close and reopen.
    await select.selectOption(r1);
    await page.waitForURL(url => url.searchParams.get('artifact') === r1);
    await detail.getByRole('button', { name: 'Show the current revision' }).click();
    await page.waitForURL(url => !url.searchParams.has('artifact') && url.searchParams.get('task') === child.id);
    check('revision: choosing R1 records it in the URL and returning to the current revision clears it', await select.inputValue() === r2 && await shown(2).isVisible());
    await select.selectOption(r1);
    await page.waitForURL(url => url.searchParams.get('artifact') === r1);
    await detail.getByRole('button', { name: 'Close task detail' }).click();
    await page.waitForURL(url => !url.searchParams.has('task') && !url.searchParams.has('artifact'));
    await page.getByLabel('Search tasks').fill(revisionGoal);
    // Child goals embed the parent goal, so the parent is matched by its exact heading.
    await page.locator('[aria-label="Office task list"] button').filter({ has: page.getByRole('heading', { name: revisionGoal, exact: true }) }).click();
    await detail.getByText(`Task · ${revisionParent}`).waitFor();
    await detail.locator('button', { hasText: child.goal }).first().click();
    await detail.getByText(`Task · ${child.id}`).waitFor();
    await shown(2).waitFor();
    check('revision: closing then reopening the task shows its current revision; no earlier selection leaks', !new URL(page.url()).searchParams.has('artifact') && await select.inputValue() === r2);
    await page.getByLabel('Search tasks').fill('');

    // A save can commit while its response is delayed. A newer task/revision choice must
    // survive that old completion, including the real view's refresh and URL effects.
    const [savingTask, destinationTask] = await waitFor(async () => {
      const rows = await sql`SELECT t.id, t.agent_id, t.goal, t.version::int, t.current_artifact_id, a.content FROM backoffice.office_tasks t JOIN backoffice.office_artifacts a ON a.id=t.current_artifact_id WHERE t.parent_task_id=${revisionParent} AND t.id<>${child.id} AND t.state='review_passed' AND t.revision_cycles=0 ORDER BY t.agent_id LIMIT 2`;
      return rows.length === 2 ? rows : null;
    }, { timeoutMs: 240000, intervalMs: 1000, label: 'two untouched reviewed siblings for the delayed revision save' });
    const destinationR1 = destinationTask.current_artifact_id;
    await api('task_action', { workspaceId: DEMO, taskId: destinationTask.id, version: destinationTask.version, action: 'request_changes', reason: 'Synthetic delayed-save check: retain a historical destination revision.' });
    const [destinationChanged] = await sql`SELECT version::int FROM backoffice.office_tasks WHERE id=${destinationTask.id}`;
    const { artifactId: destinationR2 } = await api('revise_artifact', { workspaceId: DEMO, taskId: destinationTask.id, version: destinationChanged.version, title: `Simulated destination R2 ${MARKER}`, content: `${destinationTask.content}\n\nSynthetic destination revision ${MARKER}; facts remain unverified.`, authorAgentId: destinationTask.agent_id });
    await waitFor(async () => (await sql`SELECT state FROM backoffice.office_tasks WHERE id=${destinationTask.id} AND current_artifact_id=${destinationR2}`)[0]?.state === 'review_passed', { timeoutMs: 120000, intervalMs: 1000, label: 'the destination R2 independent review' });
    await page.goto(`${base}/team?mode=demo&workspace=${DEMO}&task=${savingTask.id}&artifact=${savingTask.current_artifact_id}&view=tasks`);
    await detail.getByText(`Task · ${savingTask.id}`).waitFor();
    await detail.getByRole('button', { name: 'Request changes', exact: true }).click();
    await detail.getByLabel('Reason / specific changes').fill('Synthetic delayed-save check: prepare an owner revision before selecting another task.');
    await detail.getByRole('button', { name: 'Record requested changes', exact: true }).click();
    await detail.getByRole('button', { name: 'Prepare a new revision', exact: true }).and(page.locator(':enabled')).waitFor();
    await detail.getByRole('button', { name: 'Prepare a new revision', exact: true }).click();
    const delayedTitle = `Simulated delayed save A ${MARKER}`;
    const delayedContent = `Simulated owner revision ${MARKER}. No real work was performed; source facts remain unverified.`;
    await detail.getByLabel('Revision title').fill(delayedTitle);
    await detail.getByLabel('Draft content').fill(delayedContent);
    let heldSave = null;
    let heldError = null;
    let delayedIntercepted = false;
    let releaseSave;
    let finishSaveRoute;
    const saveGate = new Promise(resolve => { releaseSave = resolve; });
    const saveRouteDone = new Promise(resolve => { finishSaveRoute = resolve; });
    const delayRevisionResponse = async route => {
      const request = route.request();
      const body = request.method() === 'POST' ? request.postDataJSON() : null;
      if (delayedIntercepted || body?.operation !== 'revise_artifact' || body.input?.taskId !== savingTask.id) return route.continue();
      delayedIntercepted = true;
      try {
        const response = await route.fetch();
        heldSave = { status: response.status(), body: await response.json() };
        await saveGate;
        await route.fulfill({ response });
      } catch (error) {
        heldError = error;
        await route.abort('failed').catch(() => {});
      } finally { finishSaveRoute(); }
    };
    await page.route('**/api/office', delayRevisionResponse);
    try {
      await detail.getByRole('button', { name: 'Save new revision', exact: true }).click();
      await waitFor(() => heldSave || heldError, { timeoutMs: 15000, intervalMs: 50, label: 'the committed A revision response held before browser delivery' });
      if (heldError) throw heldError;
      if (heldSave.status < 200 || heldSave.status >= 300 || typeof heldSave.body.artifactId !== 'string') throw new Error(`Delayed revision save failed (${heldSave.status}).`);
      const [committedBeforeRelease] = await sql`SELECT id FROM backoffice.office_artifacts WHERE id=${heldSave.body.artifactId} AND task_id=${savingTask.id} AND content=${delayedContent}`;
      if (!committedBeforeRelease) throw new Error('The delayed A response did not follow a committed revision.');
      await detail.getByRole('button', { name: 'Close task detail' }).click();
      await page.getByLabel('Search tasks').fill(destinationTask.goal);
      await page.locator('[aria-label="Office task list"] button').filter({ has: page.getByRole('heading', { name: destinationTask.goal, exact: true }) }).click();
      await detail.getByText(`Task · ${destinationTask.id}`).waitFor();
      await select.selectOption(destinationR1);
      await page.waitForURL(url => url.searchParams.get('task') === destinationTask.id && url.searchParams.get('artifact') === destinationR1);
      await shown(1).waitFor();
      const destinationHref = page.url();
      const destinationContent = await shown(1).textContent();
      const historicalBeforeRelease = await select.inputValue() === destinationR1 && destinationContent === destinationTask.content && await detail.locator('[data-revision="historical"]').isVisible();
      releaseSave();
      await saveRouteDone;
      if (heldError) throw heldError;
      await page.getByText('A new internal artifact revision was saved. Earlier revisions and reviews were retained.', { exact: true }).waitFor();
      await page.getByRole('button', { name: 'Refresh office records' }).and(page.locator(':enabled')).waitFor();
      // Let React commit the completion callback and its canonical-URL effect before asserting.
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      const [persisted] = await sql`SELECT a.id, a.revision, a.producer_run_id, a.content, t.current_artifact_id FROM backoffice.office_artifacts a JOIN backoffice.office_tasks t ON t.id=a.task_id WHERE a.id=${heldSave.body.artifactId} AND a.task_id=${savingTask.id}`;
      check('revision save: a delayed A completion preserves B historical revision, content and URL while A remains saved', historicalBeforeRelease && page.url() === destinationHref && await detail.getByText(`Task · ${destinationTask.id}`).isVisible() && await select.inputValue() === destinationR1 && await shown(1).textContent() === destinationContent && !(await shown(2).count()) && await detail.locator('[data-revision="historical"]').isVisible() && persisted?.id === persisted?.current_artifact_id && persisted?.revision === 2 && persisted?.producer_run_id === null && persisted?.content === delayedContent, { savingTaskId: savingTask.id, savedArtifactId: heldSave.body.artifactId, destinationTaskId: destinationTask.id, destinationR1, destinationR2, urlBefore: new URL(destinationHref).search, urlAfter: new URL(page.url()).search });
      report.evidence.delayedRevisionSave = { savingTaskId: savingTask.id, savedArtifactId: heldSave.body.artifactId, destinationTaskId: destinationTask.id, destinationR1, destinationR2, url: new URL(page.url()).search, responseHeldUntilAfterDestinationSelection: true };
      await shot(page, '25-delayed-save-preserves-other-task-r1', detail);
    } finally {
      releaseSave();
      if (delayedIntercepted) await saveRouteDone;
      await page.unroute('**/api/office', delayRevisionResponse);
    }
    await page.getByLabel('Search tasks').fill('');

    // Rejected revision links: denied, nothing substituted, the request kept so a reload stays denied.
    const otherTaskRevision = family.artifacts.find(artifact => artifact.task_id !== child.id).id;
    for (const [name, artifactId] of [['another task\'s revision', otherTaskRevision], ['unknown revision', randomUUID()]]) {
      for (const pass of ['open', 'reload']) {
        if (pass === 'open') await page.goto(`${base}${revisionHref(artifactId)}`); else await page.reload();
        await detail.locator('[data-revision="unavailable"]').waitFor();
        check(`revision link ${name} (${pass}): not found, no other revision shown, request kept`, urlHas(artifactId) && !(await detail.locator('pre[aria-label^="Artifact "]').count()) && await page.getByText(/linked revision was not found/).first().isVisible());
      }
    }
    await shot(page, '24-revision-link-rejected', detail);
    await page.getByRole('combobox', { name: /^Records/ }).selectOption('live');
    await page.waitForURL(url => url.searchParams.get('mode') === 'live' && !url.searchParams.has('task') && !url.searchParams.has('artifact'));
    check('revision: switching records mode clears the task and revision selection', !(await detail.count()));
    report.evidence.revisionLinks = { parentId: revisionParent, childId: child.id, r1, r2, otherTaskRevision };
    await context.close();
  }
  await stopOwned(owner);
  await stopWorkerGracefully(continuous);

  // ---- Phase 4: a sales session receives no Office data anywhere.
  const salesServer = startNext('next-dev-sales', SALES_PORT, SALES_EMAIL, cluster, '.next-office-dev');
  const salesBase = `http://127.0.0.1:${SALES_PORT}`;
  await waitForHttp(`${salesBase}/dashboard`, 600000);
  context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  page = await context.newPage();
  page.setDefaultTimeout(180000);
  await page.goto(`${salesBase}/dashboard`);
  await page.getByRole('heading', { name: /Your accounts/ }).waitFor();
  const salesHtml = await page.content();
  const salesRsc = await (await page.request.get(`${salesBase}/dashboard`, { headers: { RSC: '1' } })).text();
  check('sales: no Office panel, goals or markers in dashboard HTML or RSC payload', ![salesHtml, salesRsc].some(body => body.includes('dashboard-office-title') || body.includes(MARKER) || body.includes('Worker online')));
  await shot(page, '18-sales-dashboard-no-office');
  check('sales: Office APIs refuse', (await page.request.get(`${salesBase}/api/office`)).status() === 403 && (await page.request.get(`${salesBase}/api/office/status`)).status() === 403);
  await page.goto(`${salesBase}/team?mode=demo&workspace=${DEMO}&task=${parentId}`);
  await page.getByText('Administrator access required').waitFor();
  check('sales: Office link denied without data', !(await page.content()).includes(MARKER));
  await shot(page, '19-sales-office-link-denied');
  await context.close();
  await stopOwned(salesServer);

  const digestAfter = await businessDigest(sql);
  check('invariants: every non-Office business table unchanged', JSON.stringify(digestAfter) === JSON.stringify(digestBefore), { tables: Object.keys(digestBefore).length });
  report.evidence.businessDigest = { before: digestBefore, after: digestAfter };
  report.evidence.workers = await sql`SELECT id, adapter, stopping, started_at, heartbeat_at FROM backoffice.office_workers ORDER BY started_at`;
  report.evidence.liveTasks = await sql`SELECT id, goal, state, blocked_reason, (SELECT count(*)::int FROM backoffice.office_runs r WHERE r.task_id=t.id) AS runs FROM backoffice.office_tasks t WHERE workspace_id=${LIVE} ORDER BY created_at`;
} catch (error) {
  failure = error;
  note('acceptance_failed', { message: error instanceof Error ? error.message : String(error) });
} finally {
  // One shared finalizer stops every owned process and cluster, confirms exits and closed ports,
  // and fails the run on any cleanup failure even when every functional check passed.
  const closers = [...(browser ? [['browser', () => browser.close()]] : []), ...(sql ? [['database client', () => sql.end({ timeout: 5 })]] : [])];
  const { exitCode } = await finalizeRun({ report, failure, closers });
  for (const action of report.cleanup.actions) note('cleanup', action);
  for (const entry of report.cleanup.unresolved) note('cleanup_unresolved', entry);
  report.finishedAt = new Date().toISOString();
  await mkdir(evidence, { recursive: true });
  await writeFile(path.join(evidence, 'acceptance-report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ passed: report.passed, functionalPassed: report.functionalPassed, cleanupPassed: report.cleanup.passed, checks: report.checks.length, evidence: path.relative(appRoot, evidence) }));
  process.exitCode = exitCode;
}
