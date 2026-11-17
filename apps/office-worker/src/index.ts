import postgres from 'postgres';
import { randomUUID } from 'node:crypto';
import { appendFile, mkdir, rename, stat, unlink } from 'node:fs/promises';
import path from 'node:path';
import { createOfficeRuntime, OfficeError, type LiveExecution } from '../../backoffice/src/lib/office-runtime/index';
import { createOpenAIProvider, type LiveProvider } from '../../backoffice/src/lib/office-runtime/openai';
import { OPENAI_MODEL_PRICES } from '../../backoffice/src/lib/office-runtime/live-pricing';

// This process never reads website/backoffice .env files or borrows their provider credentials.
const databaseUrl = process.env.OFFICE_WORKER_DATABASE_URL;
const concurrency = process.env.OFFICE_WORKER_CONCURRENCY ?? '1';
const logDirectory = process.env.OFFICE_WORKER_LOG_DIRECTORY;
const once = process.argv.includes('--once');
let validDatabaseUrl = false;
try {
  const parsed = new URL(databaseUrl ?? '');
  validDatabaseUrl = ['postgres:', 'postgresql:'].includes(parsed.protocol) && Boolean(parsed.hostname) && parsed.pathname.length > 1;
} catch { /* Never include connection strings in configuration errors. */ }
if (!validDatabaseUrl || process.env.OFFICE_ENABLED !== 'true' || process.env.OFFICE_DEMO_WORKER !== 'true'
  || !/^[1-4]$/.test(concurrency) || (logDirectory && !path.isAbsolute(logDirectory))
  || process.argv.slice(2).some(argument => argument !== '--once')) {
  process.stderr.write('configuration_required: use an Office database URL, explicit demo activation, concurrency 1-4, an absolute log directory and the optional --once argument only.\n');
  process.exit(1);
}
// Live execution is optional. Its Office-only key arrives through the protected worker configuration,
// is validated before any database access, never logged, and removed from this process environment.
let live: LiveExecution | undefined;
if (process.env.OFFICE_LIVE_WORKER !== undefined || Object.keys(process.env).some(key => key.startsWith('OFFICE_OPENAI_'))) {
  const settings = {
    draftModel: process.env.OFFICE_OPENAI_DRAFT_MODEL ?? 'gpt-6-luna',
    packageModel: process.env.OFFICE_OPENAI_PACKAGE_MODEL ?? 'gpt-6.1-sol',
    reasoningEffort: process.env.OFFICE_OPENAI_REASONING_EFFORT ?? 'low',
  };
  const priced = [settings.draftModel, settings.packageModel].every(model => OPENAI_MODEL_PRICES[model]?.efforts.includes(settings.reasoningEffort));
  let provider: LiveProvider | undefined;
  try {
    if (process.env.OFFICE_LIVE_WORKER === 'true' && priced) provider = createOpenAIProvider({ apiKey: process.env.OFFICE_OPENAI_API_KEY ?? '' });
  } catch { /* The key is never echoed; the fixed message below is enough. */ }
  if (!provider) {
    process.stderr.write('configuration_required: live execution needs OFFICE_LIVE_WORKER=true, an Office-only OpenAI API key, priced models and a reasoning effort both models accept.\n');
    process.exit(1);
  }
  live = { provider, settings };
}
delete process.env.OFFICE_OPENAI_API_KEY;
const workerId = `office-${randomUUID()}`;
const sql = postgres(databaseUrl!, { max: 3, connect_timeout: 10, idle_timeout: 20, connection: { application_name: 'enztronic_office_worker', statement_timeout: 10000, lock_timeout: 5000 }, onnotice: () => undefined });
const runtime = createOfficeRuntime(sql, { concurrency: Number(concurrency), live });
const unsafeDatabaseRole = new Error('unsafe_database_role');
let databaseRoleVerified = false;
async function verifyDatabaseRole() {
  // Read catalog capabilities only. Even an accidentally supplied app-owner URL must fail
  // before any worker record, lease, schedule or draft can be written.
  const [capabilities] = await sql`
    SELECT EXISTS (
      SELECT 1 FROM pg_catalog.pg_roles r
      WHERE r.rolname IN (current_user,session_user)
        AND (r.rolsuper OR r.rolcreatedb OR r.rolcreaterole OR r.rolreplication OR r.rolbypassrls)
    ) OR current_user<>session_user AS elevated,
    EXISTS (
      SELECT 1 FROM pg_catalog.pg_database d JOIN pg_catalog.pg_roles r ON r.oid=d.datdba
      WHERE d.datname=current_database() AND r.rolname IN (current_user,session_user)
    ) AS database_owner,
    EXISTS (
      SELECT 1 FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname='backoffice' AND c.relkind IN ('r','p','v','m','f')
        AND left(c.relname,7)<>'office_'
        AND (has_table_privilege(current_user,c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE')
          OR has_any_column_privilege(current_user,c.oid,'SELECT,INSERT,UPDATE'))
    ) AS business_access,
    has_table_privilege(current_user,'backoffice.office_acceptance_evidence','INSERT,UPDATE,DELETE,TRUNCATE')
      OR has_any_column_privilege(current_user,'backoffice.office_acceptance_evidence','INSERT,UPDATE') AS acceptance_write,
    EXISTS (
      SELECT 1 FROM unnest(ARRAY['deciding_owner_id','decided_at','consumed_at','acceptance_evidence_id']) AS owner_column(name)
      WHERE has_column_privilege(current_user,'backoffice.office_approvals',owner_column.name,'INSERT,UPDATE')
    ) AS owner_decision_write,
    has_column_privilege(current_user,'backoffice.office_tasks','acceptance_evidence_id','INSERT,UPDATE')
      OR has_column_privilege(current_user,'backoffice.office_tasks','initiating_owner_id','UPDATE') AS owner_task_write,
    EXISTS (
      SELECT 1 FROM unnest(ARRAY['live_enabled','limit_microunits','monthly_limit_microunits','family_limit_microunits','request_limit_microunits','currency']) AS budget_column(name)
      WHERE has_column_privilege(current_user,'backoffice.office_budget',budget_column.name,'INSERT,UPDATE')
    ) AS budget_limit_write`;
  if (!capabilities || Object.values(capabilities).some(value => value !== false)) throw unsafeDatabaseRole;
  databaseRoleVerified = true;
}
let stdoutAvailable = true;
async function log(event: string, fields: Record<string, string | number | boolean> = {}) {
  const line = `${JSON.stringify({ at: new Date().toISOString(), workerId, event, ...fields })}\n`;
  if (stdoutAvailable) process.stdout.write(line);
  if (!logDirectory) return;
  await mkdir(logDirectory, { recursive: true });
  const file = path.join(logDirectory, 'office-worker.jsonl');
  // Bounded disk use: current file and one 2 MiB previous log. Never log source data, URLs or credentials.
  if (((await stat(file).catch(error => { if (error.code !== 'ENOENT') throw error; return null; }))?.size ?? 0) + Buffer.byteLength(line) > 2 * 1024 * 1024) {
    await unlink(`${file}.previous`).catch(error => { if (error.code !== 'ENOENT') throw error; });
    await rename(file, `${file}.previous`);
  }
  await appendFile(file, line, 'utf8');
}
let stopping = false;
let stopReason = once ? 'single_pass' : 'normal_exit';
let wakeIdle: (() => void) | undefined;
function requestStop(reason: string) { if (!stopping) { stopping = true; stopReason = reason; } wakeIdle?.(); }
// A closed supervisor output pipe must not interrupt the stopping heartbeat or file log flush.
process.stdout.on('error', () => { stdoutAvailable = false; requestStop('output_closed'); });
process.on('SIGINT', () => requestStop('signal'));
process.on('SIGTERM', () => requestStop('signal'));
// A private supervisor pipe also works on Windows, where killing a Node process is not SIGTERM.
// EOF means the owning supervisor has exited; never leave an orphan claiming more work.
if (process.env.OFFICE_WORKER_SUPERVISED === 'true') {
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', () => requestStop('supervisor_shutdown'));
  process.stdin.on('end', () => requestStop('supervisor_disconnected'));
  process.stdin.on('error', () => requestStop('supervisor_disconnected'));
  process.stdin.resume();
}
function waitForWork() {
  return new Promise<void>(resolve => {
    const timer = setTimeout(() => { wakeIdle = undefined; resolve(); }, 1000);
    wakeIdle = () => { clearTimeout(timer); wakeIdle = undefined; resolve(); };
  });
}
try {
  await verifyDatabaseRole();
  // `simulated` stays true for a demo-only worker, as earlier log readers expect.
  await log('started', { adapter: live ? 'openai_responses' : 'deterministic_demo', simulated: !live, liveProvider: live ? 'openai' : 'none', commandExecution: false, mode: once ? 'once' : 'continuous', pid: process.pid });
  while (!stopping) {
    await runtime.recoverExpired();
    if (stopping) break;
    await runtime.dispatchDueSchedules();
    await runtime.workerHeartbeat(workerId);
    if (stopping) break;
    const lease = await runtime.claim(workerId);
    if (!lease) {
      if (once) break;
      if (!stopping) await waitForWork();
      continue;
    }
    let heartbeatFailure = false;
    let pendingHeartbeat: Promise<void> | undefined;
    const heartbeat = setInterval(() => {
      if (!pendingHeartbeat) pendingHeartbeat = runtime.heartbeat(lease).then(() => undefined).catch(() => { heartbeatFailure = true; }).finally(() => { pendingHeartbeat = undefined; });
    }, 8000);
    try {
      const result = await runtime.execute(lease);
      // IDs, model and token/charge counts only; never prompts, briefs or model output.
      const metered: Record<string, string | number> = result.model ? { model: result.model, chargedMicrounits: result.chargedMicrounits ?? 0, inputTokens: result.inputTokens ?? 0, outputTokens: result.outputTokens ?? 0 } : {};
      const fields = { taskId: lease.taskId, runId: lease.runId, step: lease.step, ...metered };
      if (result.outcome === 'failed') await log('step_failed', { ...fields, code: result.code ?? 'adapter_error' });
      else await log(result.outcome === 'stopped' ? 'step_stopped' : 'step_committed', fields);
    } catch (error) {
      const code = error instanceof OfficeError ? error.code : 'adapter_error';
      if (code !== 'LEASE_LOST' && !heartbeatFailure) await runtime.fail(lease, 'adapter_error').catch(() => undefined);
      await log('step_failed', { taskId: lease.taskId, runId: lease.runId, code });
    } finally { clearInterval(heartbeat); await pendingHeartbeat; }
    if (once) break;
  }
} catch (error) {
  process.exitCode = 1;
  stopReason = error === unsafeDatabaseRole ? 'unsafe_database_role' : 'storage_or_runtime_error';
  if (error === unsafeDatabaseRole) process.stderr.write('configuration_required: a reviewed least-privilege Office worker database role is required.\n');
  await log('worker_unavailable', { code: stopReason }).catch(() => { process.stderr.write('worker_unavailable: runtime or structured log storage unavailable.\n'); });
} finally {
  process.stdin.destroy();
  if (databaseRoleVerified) await runtime.workerHeartbeat(workerId, true).catch(() => undefined);
  await sql.end({ timeout: 5 });
  await log('stopped', { reason: stopReason }).catch(() => { process.exitCode = 1; process.stderr.write('worker_unavailable: structured log storage unavailable.\n'); });
}
