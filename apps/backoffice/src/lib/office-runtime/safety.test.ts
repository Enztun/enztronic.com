import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, writeFile, symlink, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { assertRegisteredPath, assertCommandExecutionAllowed, canonicalJson } from './safety';

describe('registered workspace path boundary and disabled executor', () => {
  let fixture: string;
  beforeAll(async () => {
    fixture = await mkdtemp(path.join(tmpdir(), 'enztronic-office-path-test-'));
    await mkdir(path.join(fixture, 'registered'));
    await mkdir(path.join(fixture, 'other-client'));
    await writeFile(path.join(fixture, 'registered', 'draft.md'), 'Synthetic permitted draft');
    await writeFile(path.join(fixture, 'other-client', 'private.md'), 'Synthetic forbidden other-client file');
    await symlink(path.join(fixture, 'other-client'), path.join(fixture, 'registered', 'escape'), process.platform === 'win32' ? 'junction' : 'dir');
  });
  afterAll(async () => {
    const absolute = path.resolve(fixture);
    const allowed = path.resolve(tmpdir());
    if (path.dirname(absolute) !== allowed || !path.basename(absolute).startsWith('enztronic-office-path-test-')) throw new Error('Refusing unsafe fixture cleanup.');
    await rm(absolute, { recursive: true, force: true });
  });
  it('allows only a canonical registered descendant and rejects traversal, junction escapes and sibling roots', async () => {
    const root = path.join(fixture, 'registered');
    await expect(assertRegisteredPath(root, path.join(root, 'draft.md'))).resolves.toBe(path.join(root, 'draft.md'));
    await expect(assertRegisteredPath(root, path.join(fixture, 'other-client', 'private.md'))).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(assertRegisteredPath(root, path.join(root, 'escape', 'private.md'))).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(assertRegisteredPath(path.join(root, 'escape'), path.join(root, 'escape', 'private.md'))).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(assertRegisteredPath(root, '../other-client/private.md')).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
  it('cannot execute untrusted install/build scripts without an isolated executor capability', () => {
    expect(() => assertCommandExecutionAllowed()).toThrow('isolated, constrained executor has not been configured');
    expect(canonicalJson({ b: 1, a: { d: 2, c: 3 } })).toBe('{"a":{"c":3,"d":2},"b":1}');
  });
});
