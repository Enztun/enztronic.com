/**
 * Fastify Proxy — Ollama → OpenAI SDK Compatibility Layer
 *
 * WHY: Ollama's /v1 endpoint has known quirks with the OpenAI SDK:
 *   1. `tool_choice: "required"` is not supported → convert to "auto"
 *   2. System role may be rejected → fallback to user-embedded system
 *   3. Response format differences in tool_calls → normalize
 *   4. No streaming support for tool calls → buffer and respond
 *   5. Rate limiting → add request queuing for the RX 580's limited throughput
 *
 * USAGE:
 *   node fastify-ollama-proxy.js
 *
 * Then in .env:
 *   LLM_BASE_URL=http://localhost:3333/v1
 *   LLM_API_KEY=ollama
 */

import Fastify from "fastify";
import fetch from "node-fetch";

const PROXY_PORT = process.env.FASTIFY_PROXY_PORT || 3333;
const OLLAMA_BASE = process.env.FASTIFY_PROXY_TARGET || "http://localhost:11434/v1";
const MAX_CONCURRENT = 1; // RX 580 can only handle 1 inference at a time
const REQUEST_TIMEOUT = 5 * 60 * 1000; // 5 minutes — local inference is slow

const app = Fastify({ logger: true, requestTimeout: REQUEST_TIMEOUT });

// ─── Request Queue ──────────────────────────────────────────
let activeRequests = 0;
const queue = [];

function enqueue(fn) {
  return new Promise((resolve, reject) => {
    queue.push({ fn, resolve, reject });
    processQueue();
  });
}

function processQueue() {
  while (activeRequests < MAX_CONCURRENT && queue.length > 0) {
    const { fn, resolve, reject } = queue.shift();
    activeRequests++;
    fn()
      .then(resolve)
      .catch(reject)
      .finally(() => {
        activeRequests--;
        processQueue();
      });
  }
}

// ─── Bin-Hopping V2 Prompt Injection ──────────────────────
const BIN_HOP_V2_HINT = `
BIN-HOPPING V2 (adaptive range — use instead of linear bins_below formula):

1. VOLATILITY TIER:
   vol <= 1.5 → "calm"    (35-45 bins, prefer spot strategy)
   vol <= 3.0 → "normal"  (40-55 bins, bid_ask)
   vol <= 5.0 → "volatile"(50-65 bins, bid_ask)
   vol >  5.0 → "extreme" (55-69 bins, bid_ask)

2. MODE ADJUSTMENTS (apply after tier selection):
   - Price within 3% of VWAP → MEAN-REVERSION: narrow range ×0.8
   - Price moved >5% in 30m  → MOMENTUM: widen range ×1.25
   - fee/TVL > 0.5%          → FEE-CAPTURE: widen range ×1.15

3. BIN-STEP NORMALIZATION:
   range_pct = bins_below × bin_step / 100
   If range_pct < 15% → increase bins_below to hit 15%
   If range_pct > 60% → decrease bins_below to cap at 60%

4. SAFETY FLOOR: bins_below ≥ 35 always. bins_above = 0 (single-side SOL).

When calling deploy_position: set bins_below from V2, include volatility, fee_tvl_ratio, and price_change_pct in the tool call.
`.trim();

const SCREENER_KEYWORDS = ['bins_below', 'deploy_position', 'bin_step', 'screener', 'fee_tvl', 'volatility'];

function injectBinHoppingPrompt(messages) {
  if (!Array.isArray(messages) || messages.length === 0) return messages;

  const text = messages.map((m) => (typeof m.content === 'string' ? m.content : '')).join(' ').toLowerCase();
  const isScreener = SCREENER_KEYWORDS.some((kw) => text.includes(kw));
  if (!isScreener) return messages;

  const sysIdx = messages.findIndex((m) => m.role === 'system');
  if (sysIdx >= 0) {
    return messages.map((m, i) =>
      i === sysIdx ? { ...m, content: `${m.content}\n\n${BIN_HOP_V2_HINT}` } : m,
    );
  }
  return [{ role: 'system', content: BIN_HOP_V2_HINT }, ...messages];
}

// ─── Normalize Request ─────────────────────────────────────
function normalizeRequestBody(body) {
  const normalized = { ...body };

  // 1. Convert tool_choice: "required" → "auto" (Ollama doesn't support "required")
  if (normalized.tool_choice === "required") {
    normalized.tool_choice = "auto";
  }

  // 2. Reduce max_tokens if too large for local model context
  if (normalized.max_tokens && normalized.max_tokens > 4096) {
    normalized.max_tokens = 4096;
  }

  // 3. Ensure model name is set
  if (!normalized.model) {
    normalized.model = process.env.LLM_MODEL || "llama3.1:8b-instruct-q4_K_M";
  }

  // 4. Inject bin-hopping V2 guidance for screener/deploy requests
  if (normalized.messages) {
    normalized.messages = injectBinHoppingPrompt(normalized.messages);
  }

  // 5. Strip unsupported parameters that Ollama may reject
  delete normalized.frequency_penalty;
  delete normalized.presence_penalty;
  if (normalized.temperature && normalized.temperature < 0.1) {
    normalized.temperature = 0.1; // Ollama minimum
  }

  return normalized;
}

// ─── Normalize Response ─────────────────────────────────────
function normalizeResponse(data) {
  // Ensure choices array exists
  if (!data.choices || data.choices.length === 0) {
    return data;
  }

  for (const choice of data.choices) {
    const msg = choice.message || {};

    // Fix null content when tool_calls are present
    if (msg.tool_calls && msg.tool_calls.length > 0 && !msg.content) {
      msg.content = null; // OpenAI SDK expects null, not undefined
    }

    // Ensure tool_calls have proper structure
    if (msg.tool_calls) {
      for (const tc of msg.tool_calls) {
        if (!tc.id) tc.id = `call_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        if (!tc.type) tc.type = "function";
        if (tc.function && typeof tc.function.arguments === "undefined") {
          tc.function.arguments = "{}";
        }
      }
    }

    // Ensure finish_reason is set
    if (!choice.finish_reason) {
      choice.finish_reason = msg.tool_calls ? "tool_calls" : "stop";
    }
  }

  return data;
}

// ─── Chat Completions Proxy ────────────────────────────────
app.post("/v1/chat/completions", async (request, reply) => {
  const normalizedBody = normalizeRequestBody(request.body);

  const response = await enqueue(async () => {
    app.log.info(`Proxying to Ollama: model=${normalizedBody.model}, messages=${normalizedBody.messages?.length}, tools=${normalizedBody.tools?.length || 0}`);

    const res = await fetch(`${OLLAMA_BASE}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(normalizedBody),
      timeout: REQUEST_TIMEOUT,
    });

    if (!res.ok) {
      const errorText = await res.text();
      app.log.error(`Ollama error: ${res.status} ${errorText}`);
      throw { status: res.status, body: errorText };
    }

    const data = await res.json();
    return normalizeResponse(data);
  });

  return reply.send(response);
});

// ─── Models Proxy ──────────────────────────────────────────
app.get("/v1/models", async (request, reply) => {
  const res = await fetch(`${OLLAMA_BASE}/models`);
  const data = await res.json();
  return reply.send(data);
});

// ─── Health Check ──────────────────────────────────────────
app.get("/v1/health", async (request, reply) => {
  try {
    const res = await fetch(`${OLLAMA_BASE.replace("/v1", "")}/api/tags`, { timeout: 5000 });
    const data = await res.json();
    return reply.send({
      status: "ok",
      ollama: "connected",
      models: data.models?.map((m) => m.name) || [],
      queueLength: queue.length,
      activeRequests,
    });
  } catch (e) {
    return reply.code(503).send({
      status: "error",
      ollama: "disconnected",
      error: e.message,
    });
  }
});

// ─── Root Health ───────────────────────────────────────────
app.get("/health", async (request, reply) => {
  return reply.send({ status: "ok", proxy: "fastify-ollama", port: PROXY_PORT });
});

// ─── Start ─────────────────────────────────────────────────
app.listen({ port: PROXY_PORT, host: "0.0.0.0" }, (err) => {
  if (err) {
    app.log.error(err);
    process.exit(1);
  }
  console.log(`🚀 Ollama Proxy running on http://localhost:${PROXY_PORT}/v1`);
  console.log(`   Target: ${OLLAMA_BASE}`);
  console.log(`   Max concurrent: ${MAX_CONCURRENT}`);
  console.log(`   Timeout: ${REQUEST_TIMEOUT / 1000}s`);
});
