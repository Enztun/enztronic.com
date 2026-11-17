import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';

import { assertNewDestination, verifyRuntimePackage } from '../package-runtime.mjs';

const digest = bytes => crypto.createHash('sha256').update(bytes).digest('hex');

function fixture(run) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'office-runtime-package-test-'));
  const links = [];
  try { return run(directory, links); }
  finally {
    for (const link of links) if (fs.lstatSync(link, { throwIfNoEntry: false })?.isSymbolicLink()) fs.unlinkSync(link);
    assert.equal(path.dirname(directory), fs.realpathSync.native(os.tmpdir()));
    assert.ok(path.basename(directory).startsWith('office-runtime-package-test-'));
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

function inertPackage(directory) {
  const files = ['entry.ts', 'loader.mjs', 'supervisor.ps1'].map(name => {
    const bytes = Buffer.from(`Nonexecuted manifest fixture: ${name}\n`);
    fs.writeFileSync(path.join(directory, name), bytes);
    return { path: name, bytes: bytes.length, sha256: digest(bytes) };
  });
  const manifest = { formatVersion: 1, workerActivated: false, configurationIncluded: false, entry: 'entry.ts', loader: 'loader.mjs', supervisor: 'supervisor.ps1', files };
  const bytes = Buffer.from(JSON.stringify(manifest, null, 2) + '\n');
  fs.writeFileSync(path.join(directory, 'runtime-manifest.json'), bytes);
  fs.writeFileSync(path.join(directory, 'runtime-manifest.sha256'), digest(bytes) + '\n');
  return manifest;
}

test('packaging refuses missing, relative, existing and source-overlapping destinations before writes', () => fixture(directory => {
  const source = path.join(directory, 'source');
  fs.mkdirSync(source);
  fs.writeFileSync(path.join(source, 'owner-only.env'), 'synthetic sentinel');
  const before = fs.readdirSync(source);

  assert.throws(() => assertNewDestination('', source), /absolute/);
  assert.throws(() => assertNewDestination('relative-runtime', source), /absolute/);
  assert.throws(() => assertNewDestination(source, source), /overlaps/);
  assert.throws(() => assertNewDestination(path.join(source, 'runtime'), source), /overlaps/);
  assert.throws(() => assertNewDestination(directory, source), /overlaps/);
  const existing = path.join(directory, 'existing'); fs.mkdirSync(existing);
  assert.throws(() => assertNewDestination(existing, source), /already exists/);
  assert.throws(() => assertNewDestination(path.join(directory, 'absent-parent/runtime'), source), /parent first/);
  assert.deepEqual(fs.readdirSync(source), before);
  assert.equal(fs.existsSync(path.join(source, 'runtime')), false);
}));

test('packaging resolves a junction alias before checking workspace overlap', () => fixture((directory, links) => {
  const source = path.join(directory, 'source'); fs.mkdirSync(source);
  const alias = path.join(directory, 'alias');
  fs.symlinkSync(source, alias, process.platform === 'win32' ? 'junction' : 'dir'); links.push(alias);

  assert.throws(() => assertNewDestination(path.join(alias, 'runtime'), source), /overlaps/);
  assert.equal(fs.existsSync(path.join(source, 'runtime')), false);
}));

test('a protected-parent sibling destination is accepted without creating it', () => fixture(directory => {
  const source = path.join(directory, 'source'); fs.mkdirSync(source);
  const destination = path.join(directory, 'source-other');

  assert.equal(assertNewDestination(destination, source), destination);
  assert.equal(fs.existsSync(destination), false);
}));

test('verification accepts a complete inert inventory and rejects changed runtime bytes', () => fixture(directory => {
  inertPackage(directory);
  assert.equal(verifyRuntimePackage(directory).verified, true);
  fs.appendFileSync(path.join(directory, 'entry.ts'), 'changed');
  assert.throws(() => verifyRuntimePackage(directory), /inventory or digest mismatch/);
}));

test('verification rejects unmanifested configuration rather than silently excluding it', () => fixture(directory => {
  inertPackage(directory);
  fs.writeFileSync(path.join(directory, '.env.local'), 'synthetic sentinel');
  assert.throws(() => verifyRuntimePackage(directory), /inventory or digest mismatch/);
}));

test('verification rejects a changed manifest checksum', () => fixture(directory => {
  inertPackage(directory);
  fs.appendFileSync(path.join(directory, 'runtime-manifest.json'), ' ');
  assert.throws(() => verifyRuntimePackage(directory), /manifest digest mismatch/);
}));

test('verification rejects links instead of resolving them into owner files', () => fixture((directory, links) => {
  const runtime = path.join(directory, 'runtime'); fs.mkdirSync(runtime);
  inertPackage(runtime);
  const outside = path.join(directory, 'outside'); fs.mkdirSync(outside);
  fs.writeFileSync(path.join(outside, 'owner-only.env'), 'synthetic sentinel');
  const alias = path.join(runtime, 'outside');
  fs.symlinkSync(outside, alias, process.platform === 'win32' ? 'junction' : 'dir'); links.push(alias);

  assert.throws(() => verifyRuntimePackage(runtime), /must not contain links/);
  assert.equal(fs.readFileSync(path.join(outside, 'owner-only.env'), 'utf8'), 'synthetic sentinel');
}));
