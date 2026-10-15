import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { localUxOrigin, localUxRouteGuard } from './ux-network-guard.mjs';

test('UX origins require exact HTTP loopback hosts and an explicit valid port', () => {
  assert.equal(localUxOrigin('http://localhost:3100'), 'http://localhost:3100');
  assert.equal(localUxOrigin('http://127.0.0.1:3100/'), 'http://127.0.0.1:3100');
  for (const value of [
    'https://localhost:3100', 'http://localhost', 'http://localhost:0',
    'http://localhost:65536', 'http://localhost:3100/en',
    'http://localhost:3100/?token=secret', 'http://localhost:3100/#fragment',
    'http://user:secret@localhost:3100', 'http://localhost.example.com:3100',
    'http://127.1:3100', 'http://0x7f000001:3100', 'http://example.com:3100',
  ]) assert.throws(() => localUxOrigin(value), /BASE_URL/);
});

test('context guard permits only reads at the exact local origin', async () => {
  const writes = [];
  const guard = localUxRouteGuard('http://127.0.0.1:3100', writes);
  for (const method of ['GET', 'HEAD', 'OPTIONS']) {
    let action;
    await guard({
      request: () => ({ url: () => 'http://127.0.0.1:3100/en', method: () => method }),
      continue: async () => { action = 'continue'; },
      abort: async () => { action = 'abort'; },
    });
    assert.equal(action, 'continue');
  }
  for (const url of [
    'https://127.0.0.1:3100/en', 'http://127.0.0.1:3101/en',
    'http://localhost:3100/en', 'https://example.com/private?token=secret',
  ]) {
    let action;
    await guard({
      request: () => ({ url: () => url, method: () => 'GET' }),
      continue: async () => { action = 'continue'; },
      abort: async () => { action = 'abort'; },
    });
    assert.equal(action, 'abort');
  }
  assert.deepEqual(writes, []);
});

test('unmocked mutations abort and retain only safe diagnostics', async () => {
  const writes = [];
  const guard = localUxRouteGuard('http://127.0.0.1:3100', writes);
  for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
    for (const url of ['http://127.0.0.1:3100/api/contact?token=secret', 'https://example.com/private']) {
      let aborted = false;
      await guard({
        request: () => ({ url: () => url, method: () => method }),
        continue: async () => assert.fail('Mutations must not leave the browser'),
        abort: async () => { aborted = true; },
      });
      assert(aborted);
    }
  }
  assert.equal(writes.length, 8);
  assert.deepEqual(writes.slice(0, 2), [{ method: 'POST', scope: 'local' }, { method: 'POST', scope: 'external' }]);
  assert(!JSON.stringify(writes).includes('secret'));
});

test('the actual UX entry point installs guards before navigation and scopes mocks locally', async () => {
  const source = await readFile(new URL('./verify-ux.mjs', import.meta.url), 'utf8');
  assert(source.indexOf("context.route('**/*'") < source.indexOf('context.newPage()'));
  assert(source.includes("serviceWorkers: 'block'"));
  assert(source.includes('storageState: { cookies: [], origins: [] }'));
  assert(source.includes("assert.deepEqual(unmatchedWrites, []"));
  for (const path of ['/api/contact', '/api/chat', '/api/chat/confirm']) {
    assert(source.includes('page.route(`${base}' + path + '`'));
  }
  assert(!source.includes('launchPersistentContext'));
});
