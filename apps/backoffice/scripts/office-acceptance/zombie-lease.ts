// Acceptance helper: a worker that claims a lease and then disappears, and later the same
// stale lease trying to commit. Runs only with the limited worker login against a disposable
// loopback *_test database. No model, provider or external effect is involved.
import { readFile, writeFile } from 'node:fs/promises';
import postgres from 'postgres';
import { createOfficeRuntime, OfficeError, type OfficeLease } from '../../src/lib/office-runtime/index';

async function main() {
  const [mode, url, file] = process.argv.slice(2);
  const target = new URL(url ?? '');
  if (!['127.0.0.1', 'localhost'].includes(target.hostname) || !target.pathname.endsWith('_test') || ['5432', '54329', '55439'].includes(target.port) || !file) {
    throw new Error('Usage: claim|stale-commit <disposable loopback *_test URL> <lease file>');
  }
  const sql = postgres(url, { max: 2, onnotice: () => undefined });
  const runtime = createOfficeRuntime(sql);
  try {
    if (mode === 'claim') {
      // Claim then exit without executing or heartbeating: the lease is left for durable recovery.
      const lease = await runtime.claim('zombie-acceptance-worker');
      await writeFile(file, JSON.stringify({ claimedAt: new Date().toISOString(), lease }, null, 2));
    } else if (mode === 'stale-commit') {
      const { lease } = JSON.parse(await readFile(file, 'utf8')) as { lease: OfficeLease };
      let outcome: string;
      try { await runtime.execute(lease); outcome = 'committed'; } catch (error) { outcome = error instanceof OfficeError ? error.code : 'unexpected_error'; }
      await writeFile(file.replace(/\.json$/, '-stale-commit.json'), JSON.stringify({ attemptedAt: new Date().toISOString(), runId: lease.runId, outcome }, null, 2));
    } else {
      throw new Error('Mode must be claim or stale-commit.');
    }
  } finally {
    await sql.end({ timeout: 2 });
  }
}

// Loaded by tsx as CommonJS in this package, so no top-level await.
main().catch(error => { process.stderr.write(`${error instanceof Error ? error.message : 'zombie helper failed'}\n`); process.exitCode = 1; });
