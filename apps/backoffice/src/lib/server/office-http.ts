import 'server-only';

import { NextResponse } from 'next/server';
import { ZodError } from 'zod';
import { AccessAuthenticationError } from '@/lib/server/auth';
import { AuthorizationError } from '@/lib/server/session';

export const officeHeaders = { 'Cache-Control': 'private, no-store, max-age=0', 'X-Content-Type-Options': 'nosniff' };

export function officeJson(value: unknown, status = 200) {
  return NextResponse.json(value, { status, headers: officeHeaders });
}

export function officeError(error: unknown) {
  if (error instanceof AccessAuthenticationError) return officeJson({ error: 'Authentication required', code: error.code }, error.status);
  if (error instanceof AuthorizationError) return officeJson({ error: 'Administrator access required', code: 'access_denied' }, 403);
  if (error instanceof ZodError || error instanceof SyntaxError) return officeJson({ error: 'Invalid Office request', code: 'validation_error' }, 400);
  // Only known domain errors may disclose their controlled explanation.
  if (error instanceof Error && 'code' in error) {
    const code = String(error.code);
    const statuses: Record<string, number> = { NOT_FOUND: 404, CONFLICT: 409, INVALID_STATE: 409, VALIDATION_ERROR: 400, SCOPE_DENIED: 403, FORBIDDEN: 403, CONFIGURATION_REQUIRED: 503, STALE_LEASE: 409, LEASE_LOST: 409 };
    if (statuses[code]) return officeJson({ error: error.message, code }, statuses[code]);
  }
  return officeJson({ error: 'Office storage is unavailable. Check migration and worker configuration.', code: 'storage_unavailable' }, 503);
}

export function sameOriginMutation(request: Request) {
  const origin = request.headers.get('origin');
  const fetchSite = request.headers.get('sec-fetch-site');
  const url = new URL(request.url);
  // Next may normalize the internal URL to localhost behind a reverse proxy.
  // Host is the browser's actual request authority; never trust X-Forwarded-Host.
  const authority = request.headers.get('host') ?? url.host;
  const protocol = request.headers.get('x-forwarded-proto')?.split(',')[0].trim() ?? url.protocol.slice(0, -1);
  let parsed: URL | null = null;
  try { if (origin) parsed = new URL(origin); } catch { /* denied below */ }
  if (fetchSite === 'cross-site' || !parsed || parsed.host !== authority || parsed.protocol !== `${protocol}:` || !['http:', 'https:'].includes(parsed.protocol) || parsed.origin !== origin) {
    throw new AuthorizationError('Same-origin request required');
  }
}

export async function boundedOfficeBody(request: Request) {
  if (!request.headers.get('content-type')?.startsWith('application/json')) throw new SyntaxError('JSON required');
  const maxBytes = 160 * 1024;
  if (Number(request.headers.get('content-length')) > maxBytes) throw new SyntaxError('Body too large');
  const reader = request.body?.getReader();
  if (!reader) throw new SyntaxError('Body required');
  let bytes = 0;
  const chunks: Uint8Array[] = [];
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > maxBytes) { await reader.cancel(); throw new SyntaxError('Body too large'); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
}
