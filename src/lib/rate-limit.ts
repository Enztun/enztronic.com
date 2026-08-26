import 'server-only';

/**
 * Sliding-window rate limiter for the public API routes.
 *
 * The store is in-process. On Vercel that means the window is per lambda
 * instance rather than global: a burst spread across cold starts gets a fresh
 * budget each time, so this stops casual hammering, retry storms, and
 * double-submits, but not a determined distributed attacker. That is the right
 * floor for the contact form, where the worst case is junk drafts in Sanity.
 *
 * Anything that spends money per request needs this *plus* a hard cap at the
 * provider, and should move to a shared store. Swapping `hits` for Redis is the
 * only change that requires: `checkRateLimit` is deliberately synchronous-shaped
 * around a single key lookup so the call sites do not have to move.
 */

export type RateLimitRule = {
  /**
   * Bucket namespace. Rules share one store, so without this a visitor's chat
   * messages would spend the contact form's budget and lock them out of it.
   */
  name: string;
  /** Requests allowed per window. */
  limit: number;
  /** Window length in ms. Must not exceed SWEEP_HORIZON_MS. */
  windowMs: number;
};

export type RateLimitResult = {
  ok: boolean;
  limit: number;
  remaining: number;
  /** Epoch ms at which the window frees up. */
  resetAt: number;
  /** Whole seconds to put in `Retry-After`. Always >= 1 when `ok` is false. */
  retryAfterSeconds: number;
};

/** Contact form: generous for a human filling it twice, tight for a script. */
export const CONTACT_RULE: RateLimitRule = {
  name: 'contact',
  limit: 5,
  windowMs: 10 * 60 * 1000,
};

/**
 * Chat: room for a real back-and-forth, but every one of these costs a model
 * call, so this is the throttle that protects the bill rather than the data.
 * Because the store is per instance it is a floor, not a ceiling — pair it with
 * a hard monthly cap in the Anthropic Console.
 */
export const CHAT_RULE: RateLimitRule = { name: 'chat', limit: 30, windowMs: 10 * 60 * 1000 };

/** Keys whose newest hit is older than this are dropped during a sweep. */
const SWEEP_HORIZON_MS = 60 * 60 * 1000;

/** Sweeping is O(n), so amortize it instead of running on every request. */
const SWEEP_THRESHOLD = 10_000;

const hits = new Map<string, number[]>();

function sweep(now: number) {
  const cutoff = now - SWEEP_HORIZON_MS;
  for (const [key, timestamps] of hits) {
    if (timestamps.length === 0 || timestamps[timestamps.length - 1] <= cutoff) {
      hits.delete(key);
    }
  }
}

export function checkRateLimit(
  client: string,
  rule: RateLimitRule,
  now = Date.now()
): RateLimitResult {
  const key = `${rule.name}:${client}`;
  const windowStart = now - rule.windowMs;
  // Timestamps are appended in order, so everything still in the window is a
  // suffix of the array.
  const recent = (hits.get(key) ?? []).filter((at) => at > windowStart);

  if (recent.length >= rule.limit) {
    hits.set(key, recent);
    const resetAt = recent[0] + rule.windowMs;
    return {
      ok: false,
      limit: rule.limit,
      remaining: 0,
      resetAt,
      retryAfterSeconds: Math.max(1, Math.ceil((resetAt - now) / 1000)),
    };
  }

  recent.push(now);
  hits.set(key, recent);
  if (hits.size > SWEEP_THRESHOLD) sweep(now);

  return {
    ok: true,
    limit: rule.limit,
    remaining: rule.limit - recent.length,
    resetAt: recent[0] + rule.windowMs,
    retryAfterSeconds: 0,
  };
}

/**
 * Best-effort client identity for bucketing.
 *
 * Vercel sets `x-real-ip` to the connecting address, so it is preferred. In the
 * `x-forwarded-for` fallback the *rightmost* entry is the one the closest proxy
 * appended; entries to its left can be forged by the caller, so reading the
 * usual leftmost value would hand every attacker an unlimited supply of buckets.
 *
 * With no proxy headers at all — `next dev`, mostly — every caller shares the
 * `unknown` bucket. That is intentional: it fails closed, and it only bites when
 * you submit the form more than `limit` times in a window locally.
 */
export function clientKey(req: Request): string {
  const realIp = req.headers.get('x-real-ip')?.trim();
  if (realIp) return realIp;

  const forwarded = req.headers.get('x-forwarded-for');
  if (forwarded) {
    const parts = forwarded
      .split(',')
      .map((part) => part.trim())
      .filter(Boolean);
    if (parts.length > 0) return parts[parts.length - 1];
  }

  return 'unknown';
}

/** Headers describing the caller's current budget, for 200s and 429s alike. */
export function rateLimitHeaders(result: RateLimitResult): Record<string, string> {
  const headers: Record<string, string> = {
    'RateLimit-Limit': String(result.limit),
    'RateLimit-Remaining': String(result.remaining),
    'RateLimit-Reset': String(Math.max(0, Math.ceil((result.resetAt - Date.now()) / 1000))),
  };
  if (!result.ok) headers['Retry-After'] = String(result.retryAfterSeconds);
  return headers;
}
