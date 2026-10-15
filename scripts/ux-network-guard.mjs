import assert from 'node:assert/strict';

export function localUxOrigin(value) {
  const match = /^http:\/\/(localhost|127\.0\.0\.1):([0-9]{1,5})\/?$/.exec(value);
  assert(match && Number(match[2]) > 0 && Number(match[2]) <= 65535,
    'BASE_URL must be an HTTP loopback origin with an explicit port, without credentials, a path, query or fragment');
  return new URL(value).origin;
}

// Page-specific mock routes run before context routes. Everything else is read-only
// on one origin. The audit container also disables network egress, including
// redirect follow-ups that Playwright does not route again.
export function localUxRouteGuard(origin, unmatchedWrites) {
  return async (route) => {
    const request = route.request();
    const sameOrigin = new URL(request.url()).origin === origin;
    const method = request.method().toUpperCase();
    if (!['GET', 'HEAD', 'OPTIONS'].includes(method)) {
      // Keep diagnostics free of request bodies, query strings and credentials.
      unmatchedWrites.push({ method, scope: sameOrigin ? 'local' : 'external' });
      await route.abort('blockedbyclient');
    } else if (!sameOrigin) {
      await route.abort('blockedbyclient');
    } else {
      await route.continue();
    }
  };
}
