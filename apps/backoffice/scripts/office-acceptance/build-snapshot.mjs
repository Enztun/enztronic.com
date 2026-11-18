// Isolated production build check of the CURRENT working tree. The copy has its own `.next`,
// contains no `.env*` files, shares installed packages through a junction, and is built with
// explicit non-secret variables only. The running app's `.next*` directories are never touched.
// Usage: node build-snapshot.mjs [snapshot parent, default D:\tmp] [evidence directory]
import { spawn } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { appRoot, assertSafeSnapshotDestination, minimalEnv, snapshotWorkingTree, stamp } from './lib.mjs';

const RUN = stamp();
const root = path.join(process.argv[2] ?? 'D:\\tmp', `claude-office-build-${RUN}`);
const app = path.join(root, 'app');
// Refused before the snapshot root, or anything in it, is created or copied.
assertSafeSnapshotDestination({ source: appRoot, destination: app });
const evidence = path.resolve(process.argv[3] ?? path.join(appRoot, 'tmp', 'claude-workflow-20261105'));
await mkdir(evidence, { recursive: true });
const logFile = path.join(evidence, `build-${RUN}.log`);
const { files, manifest } = await snapshotWorkingTree(app);
const env = minimalEnv({ NODE_ENV: 'production', NEXT_TELEMETRY_DISABLED: '1', OFFICE_ENABLED: 'false' });
const log = createWriteStream(logFile);
const started = Date.now();
const child = spawn('cmd.exe', ['/d', '/c', 'pnpm', 'run', 'build', '--webpack'], { cwd: app, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
child.stdout.pipe(log, { end: false });
child.stderr.pipe(log, { end: false });
const code = await new Promise(resolve => child.once('exit', resolve));
log.end();
const buildId = await readFile(path.join(app, '.next', 'BUILD_ID'), 'utf8').catch(() => null);
const result = { command: 'pnpm run build --webpack', cwd: app, snapshotFiles: files, snapshotManifest: manifest, exitCode: code, seconds: Math.round((Date.now() - started) / 1000), buildId, log: path.relative(appRoot, logFile) };
await writeFile(path.join(evidence, `build-${RUN}.json`), JSON.stringify(result, null, 2));
console.log(JSON.stringify(result));
process.exitCode = code === 0 ? 0 : 1;
