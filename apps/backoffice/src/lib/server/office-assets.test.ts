import { createHash } from 'node:crypto';
import path from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
const session = vi.hoisted(() => ({ require: vi.fn() }));
vi.mock('@/lib/server/session', () => ({ requireAdminSession: session.require, AuthorizationError: class AuthorizationError extends Error {} }));
const fs = vi.hoisted(() => ({ readFile: vi.fn(), realpath: vi.fn(), stat: vi.fn() }));
vi.mock('node:fs/promises', () => fs);
const approved = vi.hoisted(() => ({ assets: [] as { id: string; url: string; sha256: string }[] }));
vi.mock('@/components/office/scene-assets.generated.json', () => ({ default: approved }));

import { AuthorizationError } from '@/lib/server/session';
import { GET } from '@/app/api/office/assets/route';

const bytes = Buffer.from('approved fixture bytes');
const url = 'http://localhost:3118/api/office/assets?file=assets%2Foffice%2Fcharacters%2Fsam.glb';

beforeEach(() => {
  vi.clearAllMocks();
  session.require.mockResolvedValue({ id: 'owner', role: 'admin' });
  fs.realpath.mockImplementation(async (filename: string) => filename);
  fs.stat.mockResolvedValue({ isFile: () => true, size: bytes.length });
  fs.readFile.mockResolvedValue(bytes);
  approved.assets = [{ id: 'character_sam', url: '/api/office/assets?file=assets%2Foffice%2Fcharacters%2Fsam.glb', sha256: createHash('sha256').update(bytes).digest('hex') }];
});

describe('private approved GLB delivery', () => {
  it('reauthenticates before any file lookup', async () => {
    session.require.mockRejectedValue(new AuthorizationError());
    expect((await GET(new Request(url))).status).toBe(403);
    expect(fs.realpath).not.toHaveBeenCalled();
    expect(fs.readFile).not.toHaveBeenCalled();
  });
  it('rejects native sources and traversal instead of exposing the private asset root', async () => {
    expect((await GET(new Request('http://localhost/api/office/assets?file=source/office/common-biped-rig.blend'))).status).toBe(404);
    expect((await GET(new Request('http://localhost/api/office/assets?file=../../.env.local'))).status).toBe(404);
    expect(fs.readFile).not.toHaveBeenCalled();
  });
  it('rejects an allowlisted filename if its bytes changed since approval', async () => {
    fs.readFile.mockResolvedValue(Buffer.from('changed'));
    expect((await GET(new Request(url))).status).toBe(409);
  });
  it('rejects a symlink escaping the private asset directory', async () => {
    fs.realpath.mockResolvedValueOnce(path.resolve('fixture-assets')).mockResolvedValueOnce(path.resolve('outside.glb'));
    expect((await GET(new Request(url))).status).toBe(404);
    expect(fs.readFile).not.toHaveBeenCalled();
  });
  it('returns only approved bytes with private no-store and glTF content type', async () => {
    const result = await GET(new Request(url));
    expect(result.status).toBe(200);
    expect(result.headers.get('cache-control')).toContain('private, no-store');
    expect(result.headers.get('content-type')).toBe('model/gltf-binary');
    expect(Buffer.from(await result.arrayBuffer())).toEqual(bytes);
  });
});
