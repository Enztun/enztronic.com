// Minimal OpenAI Responses API client for the Office worker. Uses fetch directly so nothing retries
// behind our back: a duplicate model call costs money, and every retry is a runtime decision.
// Never logs or returns the API key, prompts or model output outside the typed result.
import type { TokenUsage } from './live-pricing';

export type LiveModelCall = {
  model: string; instructions: string; input: string;
  schemaName: string; schema: Record<string, unknown>;
  maxOutputTokens: number; reasoningEffort: string;
  /** IDs only, at most 16 pairs; shown to OpenAI support, never prompts or secrets. */
  metadata: Record<string, string>;
  /** ASCII, <=512 characters; logged by OpenAI for support lookups. Not a deduplication key. */
  clientRequestId: string;
  /** Local deadline supplied by the runtime; never sent to the provider. */
  timeoutMs?: number;
};
export type CountResult =
  | { ok: true; inputTokens: number }
  | { ok: false; code: string; configuration: boolean };
export type CallOutcome =
  | { kind: 'completed'; requestId: string | null; responseId: string; output: unknown; usage: TokenUsage; serviceTier: string | null }
  /** Billed, but the output cannot be used: refusal, truncation, failed status or invalid JSON. */
  | { kind: 'unusable'; code: string; requestId: string | null; responseId: string | null; usage: TokenUsage | null; serviceTier: string | null }
  /** Rejected before processing; treated as not billed. */
  | { kind: 'rejected'; code: string; status: number; retryable: boolean; configuration: boolean; retryAfterMs: number | null; requestId: string | null }
  /** The request may have been processed and billed; the response is missing or unreadable. */
  | { kind: 'unknown'; code: string; retryAfterMs: number | null; requestId: string | null };
export interface LiveProvider {
  readonly name: 'openai';
  countInputTokens(call: LiveModelCall): Promise<CountResult>;
  create(call: LiveModelCall): Promise<CallOutcome>;
}
export type OpenAIProviderOptions = {
  apiKey: string;
  baseUrl?: string;
  timeoutMs?: number;
  countTimeoutMs?: number;
  fetch?: typeof fetch;
};

const BILLING_CODES = new Set(['insufficient_quota', 'credit_balance_exhausted', 'organization_spend_limit_exceeded', 'project_spend_limit_exceeded', 'organization_usage_limit_exceeded']);
// Connection failures that happen before any request byte can reach the server.
const NOT_SENT_CODES = new Set(['ENOTFOUND', 'EAI_AGAIN', 'ECONNREFUSED', 'EHOSTUNREACH', 'ENETUNREACH', 'UND_ERR_CONNECT_TIMEOUT', 'ERR_INVALID_URL', 'CERT_HAS_EXPIRED', 'DEPTH_ZERO_SELF_SIGNED_CERT', 'UNABLE_TO_VERIFY_LEAF_SIGNATURE']);
const safeCode = (value: unknown, fallback: string) => typeof value === 'string' && /^[a-z0-9_.-]{1,64}$/i.test(value) ? value.toLowerCase() : fallback;
const isTokenCount = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
// Untrusted JSON is read through these narrowing helpers only.
type JsonObject = Record<string, unknown>;
const obj = (value: unknown): JsonObject => value && typeof value === 'object' && !Array.isArray(value) ? value as JsonObject : {};
const arr = (value: unknown): unknown[] => Array.isArray(value) ? value : [];

export function requestBody(call: LiveModelCall, purpose: 'count' | 'create'): Record<string, unknown> {
  const shared = {
    model: call.model,
    instructions: call.instructions,
    input: call.input,
    text: { format: { type: 'json_schema', name: call.schemaName, schema: call.schema, strict: true } },
    reasoning: { effort: call.reasoningEffort },
  };
  if (purpose === 'count') return shared;
  // store:false keeps the request stateless. No tools, no background mode, explicit Standard tier.
  return { ...shared, max_output_tokens: call.maxOutputTokens, store: false, service_tier: 'default', truncation: 'disabled', metadata: call.metadata };
}

export function parseUsage(raw: unknown): TokenUsage | null {
  const usage = obj(raw);
  const inputDetails = obj(usage.input_tokens_details);
  const writeDetails = obj(inputDetails.cache_write_tokens_details);
  const outputDetails = obj(usage.output_tokens_details);
  const input = usage.input_tokens, output = usage.output_tokens, total = usage.total_tokens;
  const cached = inputDetails.cached_tokens, written = inputDetails.cache_write_tokens, reasoning = outputDetails.reasoning_tokens;
  // Absent or malformed billing evidence must never become a zero-cost bucket.
  if (!isTokenCount(input) || !isTokenCount(output) || !isTokenCount(total) || !isTokenCount(cached) || !isTokenCount(written) || !isTokenCount(reasoning)) return null;
  if (!Number.isSafeInteger(input + output) || total !== input + output || cached + written > input || reasoning > output) return null;
  let write12h = 0;
  if (written > 0 || inputDetails.cache_write_tokens_details !== undefined) {
    const short = writeDetails.ttl_30m_tokens, long = writeDetails.ttl_12h_tokens;
    if (!isTokenCount(short) || !isTokenCount(long) || short + long !== written) return null;
    write12h = long;
  }
  return {
    inputTokens: input, cachedTokens: cached,
    cacheWriteTokens: written, cacheWrite12hTokens: write12h,
    outputTokens: output, reasoningTokens: reasoning,
  };
}

/** Interprets a parsed Responses API object. Exported for tests. */
export function interpretResponse(raw: unknown, requestId: string | null, expectedModel?: string): CallOutcome {
  const body = obj(raw);
  const responseId = typeof body.id === 'string' ? body.id.slice(0, 120) : null;
  const usage = parseUsage(body.usage);
  const serviceTier = typeof body.service_tier === 'string' ? body.service_tier.slice(0, 32) : null;
  if (!responseId || !usage) return { kind: 'unknown', code: 'response_without_usage', retryAfterMs: null, requestId };
  if (expectedModel && body.model !== expectedModel) return { kind: 'unknown', code: 'unexpected_response_model', retryAfterMs: null, requestId };
  if (expectedModel && !serviceTier) return { kind: 'unknown', code: 'missing_response_service_tier', retryAfterMs: null, requestId };
  if (expectedModel && serviceTier && !['default', 'flex', 'priority', 'fast', 'ultrafast'].includes(serviceTier)) return { kind: 'unknown', code: 'unpriced_response_service_tier', retryAfterMs: null, requestId };
  // Preserve known usage for settlement, but never accept output from another processing tier.
  if (expectedModel && serviceTier !== 'default') return { kind: 'unusable', code: 'unexpected_response_service_tier', requestId, responseId, usage, serviceTier };
  if (body.status === 'incomplete') return { kind: 'unusable', code: `incomplete_${safeCode(obj(body.incomplete_details).reason, 'unknown')}`, requestId, responseId, usage, serviceTier };
  if (body.status === 'failed') return { kind: 'unusable', code: `model_failed_${safeCode(obj(body.error).code, 'unknown')}`, requestId, responseId, usage, serviceTier };
  if (body.status !== 'completed') return { kind: 'unusable', code: `status_${safeCode(body.status, 'unknown')}`, requestId, responseId, usage, serviceTier };
  const parts = arr(body.output).map(obj).filter(item => item.type === 'message').flatMap(item => arr(item.content).map(obj));
  if (parts.some(part => part.type === 'refusal')) return { kind: 'unusable', code: 'refusal', requestId, responseId, usage, serviceTier };
  const text = parts.map(part => part.type === 'output_text' && typeof part.text === 'string' ? part.text : '').join('');
  try {
    return { kind: 'completed', requestId, responseId, output: JSON.parse(text), usage, serviceTier };
  } catch {
    return { kind: 'unusable', code: 'invalid_json_output', requestId, responseId, usage, serviceTier };
  }
}

function retryAfter(response: Response): number | null {
  const seconds = Number(response.headers.get('retry-after'));
  return Number.isFinite(seconds) && seconds > 0 ? Math.min(seconds, 600) * 1000 : null;
}

async function errorCode(response: Response): Promise<{ code: string; type: string }> {
  const error = obj(obj(await response.json().catch(() => null)).error);
  return { code: safeCode(error.code, ''), type: safeCode(error.type, '') };
}

/** Only explicit rejection statuses release a reservation. Timeouts, conflicts and redirects are uncertain. */
export async function classifyHttpError(response: Response, requestId: string | null): Promise<Extract<CallOutcome, { kind: 'rejected' | 'unknown' }>> {
  const { code, type } = await errorCode(response);
  const status = response.status;
  const label = code || type || `http_${status}`;
  if (![400, 401, 403, 404, 422, 429].includes(status)) return { kind: 'unknown', code: `server_${status}_${label}`.slice(0, 80), retryAfterMs: retryAfter(response), requestId };
  if (status === 429) {
    const billing = BILLING_CODES.has(code) || BILLING_CODES.has(type);
    return { kind: 'rejected', code: billing ? `billing_${label}` : `rate_limited_${label}`.slice(0, 80), status, retryable: !billing, configuration: billing, retryAfterMs: retryAfter(response), requestId };
  }
  const configuration = status === 401 || status === 403;
  return { kind: 'rejected', code: `rejected_${status}_${label}`.slice(0, 80), status, retryable: false, configuration, retryAfterMs: retryAfter(response), requestId };
}

function transportCode(error: unknown): { sent: boolean; code: string } {
  const failure = error as { name?: string; code?: string; cause?: { code?: string; name?: string } };
  if (failure?.name === 'TimeoutError' || failure?.name === 'AbortError') return { sent: true, code: 'timeout' };
  const code = failure?.cause?.code ?? failure?.code ?? '';
  if (NOT_SENT_CODES.has(code)) return { sent: false, code: `not_sent_${code.toLowerCase()}` };
  return { sent: true, code: `transport_${safeCode(code, 'error')}` };
}

function requestTimeout(call: LiveModelCall, maximum: number): number | null {
  const remaining = call.timeoutMs ?? maximum;
  return Number.isFinite(remaining) && remaining > 0 ? Math.max(1, Math.floor(Math.min(maximum, remaining))) : null;
}

export function createOpenAIProvider(options: OpenAIProviderOptions): LiveProvider {
  if (!/^sk-[A-Za-z0-9_-]{20,400}$/.test(options.apiKey)) throw new Error('configuration_required: an OpenAI API key is required');
  const base = (options.baseUrl ?? 'https://api.openai.com/v1').replace(/\/+$/, '');
  const doFetch = options.fetch ?? fetch;
  const timeoutMs = options.timeoutMs ?? 90000;
  const countTimeoutMs = options.countTimeoutMs ?? 20000;
  const headers = (call: LiveModelCall) => ({
    authorization: `Bearer ${options.apiKey}`,
    'content-type': 'application/json',
    'x-client-request-id': call.clientRequestId.replace(/[^\x20-\x7e]/g, '').slice(0, 512),
  });
  return {
    name: 'openai',
    async countInputTokens(call) {
      const timeout = requestTimeout(call, countTimeoutMs);
      if (timeout === null) return { ok: false, code: 'count_attempt_timeout', configuration: false };
      let response: Response;
      try {
        response = await doFetch(`${base}/responses/input_tokens`, { method: 'POST', redirect: 'manual', headers: headers(call), body: JSON.stringify(requestBody(call, 'count')), signal: AbortSignal.timeout(timeout) });
      } catch (error) {
        return { ok: false, code: `count_${transportCode(error).code}`, configuration: false };
      }
      if (!response.ok) {
        const outcome = await classifyHttpError(response, response.headers.get('x-request-id'));
        return { ok: false, code: `count_${outcome.code}`.slice(0, 80), configuration: outcome.kind === 'rejected' && outcome.configuration };
      }
      const body = obj(await response.json().catch(() => null)), tokens = body.input_tokens;
      return body.object === 'response.input_tokens' && isTokenCount(tokens) && tokens > 0
        ? { ok: true, inputTokens: tokens }
        : { ok: false, code: 'count_invalid_response', configuration: false };
    },
    async create(call) {
      const timeout = requestTimeout(call, timeoutMs);
      if (timeout === null) return { kind: 'rejected', code: 'attempt_timeout_before_dispatch', status: 0, retryable: false, configuration: false, retryAfterMs: null, requestId: null };
      let response: Response;
      try {
        response = await doFetch(`${base}/responses`, { method: 'POST', redirect: 'manual', headers: headers(call), body: JSON.stringify(requestBody(call, 'create')), signal: AbortSignal.timeout(timeout) });
      } catch (error) {
        const transport = transportCode(error);
        return transport.sent
          ? { kind: 'unknown', code: transport.code, retryAfterMs: null, requestId: null }
          : { kind: 'rejected', code: transport.code, status: 0, retryable: true, configuration: false, retryAfterMs: null, requestId: null };
      }
      const requestId = response.headers.get('x-request-id')?.slice(0, 120) ?? null;
      if (!response.ok) return classifyHttpError(response, requestId);
      let body: unknown;
      try { body = await response.json(); } catch { return { kind: 'unknown', code: 'unreadable_response', retryAfterMs: null, requestId }; }
      return interpretResponse(body, requestId, call.model);
    },
  };
}
