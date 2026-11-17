import { createHash } from 'node:crypto';
import { realpath, lstat } from 'node:fs/promises';
import path from 'node:path';

export class OfficeError extends Error {
  constructor(readonly code: 'NOT_FOUND' | 'FORBIDDEN' | 'CONFLICT' | 'INVALID_STATE' | 'CONFIGURATION_REQUIRED' | 'LEASE_LOST', message: string) { super(message); this.name = 'OfficeError'; }
}
export function digest(content: string): string { return createHash('sha256').update(content, 'utf8').digest('hex'); }
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map(key => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(',')}}`;
}

// This validates an existing registered path; it does not provide process isolation.
// No command executor is supplied. Shell/build/install tools remain disabled.
export async function assertRegisteredPath(root: string, target: string): Promise<string> {
  if (!path.isAbsolute(root) || !path.isAbsolute(target)) throw new OfficeError('FORBIDDEN', 'Absolute registered workspace paths are required.');
  const canonicalRoot = await realpath(root);
  if (path.resolve(root).toLowerCase() !== canonicalRoot.toLowerCase()) throw new OfficeError('FORBIDDEN', 'Registered workspace root must remain its reviewed canonical path.');
  const canonicalTarget = await realpath(target);
  const relative = path.relative(canonicalRoot, canonicalTarget);
  if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) throw new OfficeError('FORBIDDEN', 'Path is outside the registered workspace.');
  let cursor = canonicalRoot;
  for (const segment of path.relative(path.resolve(root), path.resolve(target)).split(path.sep).filter(Boolean)) {
    if (segment === '..') throw new OfficeError('FORBIDDEN', 'Parent traversal is forbidden.');
    cursor = path.join(cursor, segment);
    if ((await lstat(cursor)).isSymbolicLink()) throw new OfficeError('FORBIDDEN', 'Workspace symlinks and junctions require a separately reviewed executor.');
  }
  return canonicalTarget;
}
export function assertCommandExecutionAllowed(): never {
  throw new OfficeError('CONFIGURATION_REQUIRED', 'Command execution is disabled: an isolated, constrained executor has not been configured. A worktree is not a sandbox.');
}
