import { beforeAll, describe, expect, it, vi } from 'vitest';
import { SignJWT, generateKeyPair, exportJWK, createLocalJWKSet, type JWTVerifyGetKey } from 'jose';

vi.mock('server-only', () => ({}));
const keys = vi.hoisted(() => ({ resolver: null as JWTVerifyGetKey | null }));
vi.mock('jose', async original => ({ ...await original<typeof import('jose')>(), createRemoteJWKSet: () => keys.resolver }));
vi.mock('@/lib/env', () => ({ getCloudflareAccessEnv: () => ({ developmentBypass: false, issuer: 'https://office-test.cloudflareaccess.com', audience: ['office-aud'], allowedEmails: new Set(['owner@example.test']) }) }));
import { authenticateAccessHeaders, verifyCloudflareAccessToken } from './auth';

let privateKey: Awaited<ReturnType<typeof generateKeyPair>>['privateKey'];
beforeAll(async () => {
  const pair = await generateKeyPair('RS256'); privateKey = pair.privateKey;
  keys.resolver = createLocalJWKSet({ keys: [{ ...await exportJWK(pair.publicKey), kid: 'test', alg: 'RS256' }] });
});
async function token(email = 'owner@example.test', aud = 'office-aud', expiry = '5m') {
  return new SignJWT({ email }).setProtectedHeader({ alg: 'RS256', kid: 'test' }).setSubject('test-owner').setIssuer('https://office-test.cloudflareaccess.com').setAudience(aud).setIssuedAt().setExpirationTime(expiry).sign(privateKey);
}
describe('Cloudflare identity remains verified', () => {
  it('accepts a valid signature and allowed identity', async () => { expect((await verifyCloudflareAccessToken(await token())).email).toBe('owner@example.test'); });
  it('rejects expired Access assertions', async () => { await expect(verifyCloudflareAccessToken(await token(undefined, undefined, '-1m'))).rejects.toMatchObject({ code: 'invalid_token', status: 401 }); });
  it('rejects a different audience', async () => { await expect(verifyCloudflareAccessToken(await token(undefined, 'another-app'))).rejects.toMatchObject({ status: 401 }); });
  it('rejects a correctly signed but disallowed email', async () => { await expect(verifyCloudflareAccessToken(await token('other@example.test'))).rejects.toMatchObject({ code: 'email_not_allowed', status: 403 }); });
  it('does not trust an unsigned forwarded email header', async () => { await expect(authenticateAccessHeaders(new Headers({ 'cf-access-authenticated-user-email': 'owner@example.test' }))).rejects.toMatchObject({ code: 'missing_token' }); });
});
