// Secret-free pre-edit baseline only. Final builds use a separately created snapshot.
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { appRoot, assertSafeSnapshotDestination, snapshotWorkingTree } from './lib.mjs';

const runRoot = path.join(process.env.LOCALAPPDATA, 'Temp', 'enztronic-office-uiux-20261108', randomUUID());
const baseline = path.join(runRoot, 'baseline-app');
assertSafeSnapshotDestination({ source: appRoot, destination: baseline });
const result = await snapshotWorkingTree(baseline);
const evidence = path.join(appRoot, 'docs', 'office', 'ui-ux-evidence-20261108');
await mkdir(evidence, { recursive: true });
const record = { kind: 'pre-edit-source-baseline', capturedAt: new Date().toISOString(), runRoot, baseline, ...result, environmentFiles: 0, productionBuildTouched: false, productionDatabaseUsed: false };
await writeFile(path.join(evidence, 'baseline.json'), JSON.stringify(record, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify(record));
