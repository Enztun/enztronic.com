import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
const session = vi.hoisted(() => ({ require: vi.fn() }));
vi.mock('@/lib/server/session', () => ({
  requireAdminSession: session.require,
  AuthorizationError: class AuthorizationError extends Error {},
}));
const engine = vi.hoisted(() => ({ snapshot: vi.fn(), submitTask: vi.fn(), events: vi.fn(), artifact: vi.fn() }));
vi.mock('@/lib/server/office', () => ({
  officeEnabled: () => process.env.OFFICE_ENABLED === 'true',
  getOfficeRuntime: () => engine,
  unavailableOfficeSnapshot: () => ({ available: false, configurationRequired: ['activation_required'] }),
}));

import { AuthorizationError } from '@/lib/server/session';
import { AccessAuthenticationError } from '@/lib/server/auth';
import { GET, POST } from '@/app/api/office/route';
import { GET as events } from '@/app/api/office/events/route';
import { GET as artifact } from '@/app/api/office/artifacts/[id]/route';
import { GET as reference } from '@/app/api/office/reference/[name]/route';
import { boundedOfficeBody, sameOriginMutation } from './office-http';

const workspaceId = '10000000-0000-4000-8000-000000000001';
const artifactId = '10000000-0000-4000-8000-000000000002';
const base = 'http://localhost:3118';
function mutation(body: unknown, origin = base) {
  return new Request(`${base}/api/office`, { method: 'POST', headers: { 'content-type': 'application/json', origin }, body: JSON.stringify(body) });
}

beforeEach(() => { vi.clearAllMocks(); process.env.OFFICE_ENABLED = 'true'; session.require.mockResolvedValue({ id: artifactId, role: 'admin' }); });

describe('every Office boundary reauthenticates', () => {
  for (const [name, call] of [
    ['snapshot', () => GET(new Request(`${base}/api/office`))],
    ['mutation', () => POST(mutation({ operation: 'submit', input: {} }))],
    ['events', () => events(new Request(`${base}/api/office/events?workspaceId=${workspaceId}`))],
    ['artifact', () => artifact(new Request(`${base}/api/office/artifacts/${artifactId}?workspaceId=${workspaceId}`), { params: Promise.resolve({ id: artifactId }) })],
    ['portrait', () => reference(new Request(`${base}/api/office/reference/sam.png`), { params: Promise.resolve({ name: 'sam.png' }) })],
  ] as const) {
    it(`${name} denies a sales/revoked user`, async () => {
      session.require.mockRejectedValue(new AuthorizationError());
      expect((await call()).status).toBe(403);
      expect(engine.snapshot).not.toHaveBeenCalled();
      expect(engine.artifact).not.toHaveBeenCalled();
    });
    it(`${name} denies an expired token`, async () => {
      session.require.mockRejectedValue(new AccessAuthenticationError('invalid_token', 401));
      expect((await call()).status).toBe(401);
    });
  }
  it('disabled feature reports setup without querying office tables', async () => {
    process.env.OFFICE_ENABLED = 'false';
    const result = await GET(new Request(`${base}/api/office`));
    expect(await result.json()).toMatchObject({ available: false });
    expect(engine.snapshot).not.toHaveBeenCalled();
  });
  it('rejects cross-origin mutations before dispatch', async () => {
    expect((await POST(mutation({ operation: 'submit', input: {} }, 'https://untrusted.example'))).status).toBe(403);
    expect(engine.submitTask).not.toHaveBeenCalled();
  });
  it('accepts the real request Host when Next normalizes its internal URL', () => {
    expect(() => sameOriginMutation(new Request('http://localhost:3118/api/office', { method: 'POST', headers: { host: '127.0.0.1:3118', origin: 'http://127.0.0.1:3118', 'x-forwarded-proto': 'http' } }))).not.toThrow();
    expect(() => sameOriginMutation(new Request('http://localhost:3118/api/office', { method: 'POST', headers: { host: '127.0.0.1:3118', origin: 'https://evil.example', 'x-forwarded-host': 'evil.example' } }))).toThrow();
  });
  it('rejects unknown mutation fields and excessive event replay', async () => {
    expect((await POST(mutation({ operation: 'submit', input: {}, ownerId: artifactId }))).status).toBe(400);
    expect((await events(new Request(`${base}/api/office/events?workspaceId=${workspaceId}&limit=100000`))).status).toBe(400);
  });
  it('never derives a portrait path from arbitrary input', async () => {
    expect((await reference(new Request(`${base}/api/office/reference/x`), { params: Promise.resolve({ name: '../../.env.local' }) })).status).toBe(404);
  });
  it('requires explicit workspace scope for artifact delivery', async () => {
    expect((await artifact(new Request(`${base}/api/office/artifacts/${artifactId}`), { params: Promise.resolve({ id: artifactId }) })).status).toBe(400);
    expect(engine.artifact).not.toHaveBeenCalled();
  });
  it('bounds streamed bodies even when Content-Length is missing', async () => {
    const req = new Request(`${base}/api/office`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ large: 'x'.repeat(170 * 1024) }) });
    await expect(boundedOfficeBody(req)).rejects.toThrow('Body too large');
  });
});
