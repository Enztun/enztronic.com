import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { privatePath } from './office-assets.mjs';

test('asset validation accepts bounded missing paths but rejects traversal and absolute provenance paths', () => {
  const root = path.join(tmpdir(), 'office-path-fixture');
  assert.equal(privatePath(root, 'reports/pending.json'), path.join(root, 'reports', 'pending.json'));
  assert.throws(() => privatePath(root, '../outside.json'), /escapes/);
  assert.throws(() => privatePath(root, path.join(tmpdir(), 'outside.json')), /relative/);
});

test('incoming bundle junctions cannot redirect validator or provenance reads outside the private root', () => {
  const fixture = mkdtempSync(path.join(tmpdir(), 'office-assets-boundary-'));
  try {
    const root = path.join(fixture, 'bundle'), outside = path.join(fixture, 'other-client');
    mkdirSync(root); mkdirSync(outside); writeFileSync(path.join(outside, 'private.json'), '{"private":"fixture"}');
    symlinkSync(outside, path.join(root, 'reports'), process.platform === 'win32' ? 'junction' : 'dir');
    assert.throws(() => privatePath(root, 'reports/private.json'), /symlinks and junctions/);
  } finally {
    // Remove only the task-owned mkdtemp fixture, using Node end to end.
    const absolute = path.resolve(fixture);
    assert.ok(absolute.startsWith(path.resolve(tmpdir()) + path.sep) && path.basename(absolute).startsWith('office-assets-boundary-'));
    rmSync(absolute, { recursive: true, force: true });
  }
});
