// Snapshot destination safety on a tiny synthetic source tree. Nothing here reads or copies the real
// application; every path lives under one new temporary directory that this file removes afterwards.
import { createHash } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SnapshotDestinationError, assertSafeSnapshotDestination, canonicalPath, snapshotWorkingTree } from './lib.mjs';

// Junctions and `mklink /J` are Windows features; the harness itself is Windows-only.
describe.runIf(process.platform === 'win32')('snapshot destinations are validated before anything is created or copied', () => {
  let root = '';
  let source = '';
  const junctions = [];
  const write = (file, text) => { mkdirSync(path.dirname(file), { recursive: true }); writeFileSync(file, text); };
  const junction = (target, link) => { symlinkSync(target, link, 'junction'); junctions.push(link); };
  /** Every entry under a directory (junctions listed, never followed), with file digests. */
  function listing(directory, prefix = '') {
    const entries = [];
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const relative = path.posix.join(prefix, entry.name);
      if (entry.isSymbolicLink()) entries.push(`${relative} -> link`);
      else if (entry.isDirectory()) entries.push(`${relative}/`, ...listing(path.join(directory, entry.name), relative));
      else entries.push(`${relative} ${createHash('sha256').update(readFileSync(path.join(directory, entry.name))).digest('hex')}`);
    }
    return entries.sort();
  }
  async function rejects(destination, code, options = {}) {
    const before = listing(source);
    const error = await snapshotWorkingTree(destination, { source, ...options }).then(() => null, failure => failure);
    expect(error).toBeInstanceOf(SnapshotDestinationError);
    expect(error.code).toBe(code);
    expect(listing(source)).toEqual(before);
  }

  beforeAll(() => {
    root = mkdtempSync(path.join(os.tmpdir(), 'claude-snapshot-guard-'));
    source = path.join(root, 'backoffice');
    write(path.join(source, 'AGENTS.md'), 'synthetic agents');
    write(path.join(source, 'package.json'), '{"name":"synthetic"}');
    write(path.join(source, 'src', 'aaa', 'first.txt'), 'first');
    write(path.join(source, 'src', 'alpha.txt'), 'alpha');
    write(path.join(source, 'scripts', 'sample.mjs'), 'export {};');
    write(path.join(source, '.env.local'), 'SYNTHETIC_ONLY=1');
    write(path.join(source, 'src', '.env.test'), 'SYNTHETIC_ONLY=1');
    write(path.join(source, 'tmp', 'evidence.txt'), 'excluded');
    write(path.join(source, '.runtime', 'state.txt'), 'excluded');
    write(path.join(source, 'output', 'generated.txt'), 'excluded');
    write(path.join(source, 'node_modules', 'synthetic-package', 'index.js'), 'module.exports = 1;');
    write(path.join(root, 'outside', 'not-in-source.txt'), 'must not be copied');
    junction(path.join(root, 'outside'), path.join(source, 'linked-outside'));
  });
  afterAll(() => {
    // Junctions first, so the removal below can never traverse into a target.
    for (const link of junctions.reverse()) if (lstatSync(link, { throwIfNoEntry: false })) rmdirSync(link);
    if (path.dirname(root) === os.tmpdir() && path.basename(root).startsWith('claude-snapshot-guard-')) rmSync(root, { recursive: true, force: true });
  });

  it('copies to a fresh destination outside the source, keeps exclusions and verifies the dependency junction', async () => {
    const destination = path.join(root, 'out', 'claude-office-build-TEST', 'app');
    const before = listing(source);
    const result = await snapshotWorkingTree(destination, { source });
    junctions.push(path.join(destination, 'node_modules'));
    expect(result.files).toBe(5);
    expect(listing(destination).filter(entry => !entry.endsWith('/') && !entry.endsWith('-> link')).map(entry => entry.split(' ')[0])).toEqual(['AGENTS.md', 'package.json', 'scripts/sample.mjs', 'src/aaa/first.txt', 'src/alpha.txt']);
    expect(listing(destination).some(entry => /\.env|tmp\/|\.runtime|output\/|linked-outside\//.test(entry))).toBe(false);
    const modules = path.join(destination, 'node_modules');
    expect(lstatSync(modules).isSymbolicLink()).toBe(true);
    expect(realpathSync.native(modules)).toBe(realpathSync.native(path.join(source, 'node_modules')));
    const manifest = JSON.parse(readFileSync(result.manifest, 'utf8'));
    expect(manifest).toMatchObject({ files: 5, source: realpathSync.native(source) });
    expect(listing(source)).toEqual(before);
  });

  it('rejects an existing destination or manifest and never merges into earlier output', async () => {
    const existing = path.join(root, 'existing-snapshot');
    write(path.join(existing, 'earlier.txt'), 'earlier');
    await rejects(existing, 'exists');
    expect(readdirSync(existing)).toEqual(['earlier.txt']);
    write(path.join(root, 'orphan-app-manifest.json'), '{}');
    await rejects(path.join(root, 'orphan-app'), 'exists');
    expect(existsSync(path.join(root, 'orphan-app'))).toBe(false);
  });

  it('rejects the source itself and "." from inside it', async () => {
    await rejects(source, 'same_as_source');
    await rejects('.', 'same_as_source', { cwd: source });
  });

  it('rejects a destination inside the source before creating any part of it', async () => {
    await rejects(path.join(source, 'src', 'claude-office-build-TEST', 'app'), 'inside_source');
    expect(existsSync(path.join(source, 'src', 'claude-office-build-TEST'))).toBe(false);
    await rejects(path.join(source, 'src', '..', 'snapshot'), 'inside_source');
    await rejects('src/copy', 'inside_source', { cwd: source });
  });

  it('rejects a destination that contains the source', async () => {
    await rejects(root, 'contains_source');
    await rejects(path.join(source, '..'), 'contains_source');
  });

  it('allows a sibling whose name only starts with the source name', async () => {
    const sibling = path.join(root, 'backoffice-other', 'app');
    expect(assertSafeSnapshotDestination({ source, destination: sibling }).destination).toBe(sibling);
    expect((await snapshotWorkingTree(sibling, { source })).files).toBe(5);
    junctions.push(path.join(sibling, 'node_modules'));
  });

  it('sees through a Windows junction alias of the source and through case or separator variants', async () => {
    const alias = path.join(root, 'alias-to-source');
    junction(source, alias);
    expect(canonicalPath(path.join(alias, 'new', 'app'))).toBe(path.join(realpathSync.native(source), 'new', 'app'));
    await rejects(alias, 'same_as_source');
    await rejects(path.join(alias, 'snapshot', 'app'), 'inside_source');
    expect(existsSync(path.join(source, 'snapshot'))).toBe(false);
    await rejects(`${source.toUpperCase().replaceAll('\\', '/')}/SRC/copy/`, 'inside_source');
    // A junction into the source's installed packages (as in an earlier snapshot) is the source too.
    const modulesAlias = path.join(root, 'modules-alias');
    junction(path.join(source, 'node_modules'), modulesAlias);
    await rejects(path.join(modulesAlias, 'copy'), 'inside_source');
    expect(readdirSync(path.join(source, 'node_modules'))).toEqual(['synthetic-package']);
  });
});
