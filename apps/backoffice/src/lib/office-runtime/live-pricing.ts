// Live model prices and exact-microunit cost arithmetic. Pure functions only.
// Prices are USD per 1M tokens, Standard processing, short context (<=272K input tokens),
// checked 9 November 2026 on developers.openai.com/api/docs/models/{gpt-6-luna,gpt-6.1-sol}
// and /api/docs/pricing. Recheck before activation and whenever a model or price changes;
// an unknown model is refused rather than priced by guess.

export type ModelPrice = {
  /** Thousandths of a USD per 1M tokens, so per-token cost in microunits is value/1000. */
  inputMilli: number; cachedInputMilli: number; cacheWrite30mMilli: number; cacheWrite12hMilli: number; outputMilli: number;
  efforts: readonly string[];
};
export const OPENAI_MODEL_PRICES: Record<string, ModelPrice> = {
  'gpt-6-luna': { inputMilli: 100, cachedInputMilli: 10, cacheWrite30mMilli: 125, cacheWrite12hMilli: 250, outputMilli: 500, efforts: ['none', 'low', 'medium', 'high', 'xhigh', 'max'] },
  'gpt-6.1-sol': { inputMilli: 2000, cachedInputMilli: 100, cacheWrite30mMilli: 2500, cacheWrite12hMilli: 5000, outputMilli: 10000, efforts: ['low', 'medium', 'high', 'xhigh', 'max'] },
};
export const PRICES_CHECKED_AT = '2026-11-09';
/** Long-context pricing starts above this many input tokens; requests above it are refused. */
export const SHORT_CONTEXT_MAX_INPUT_TOKENS = 272000;
/** Model charges include the 10% regional uplift; count billing, tax and other project usage are excluded. */
export const CONSERVATIVE_MARGIN_PERCENT = 110;
/** Response service tiers and their price multiple of Standard. Unknown tiers need reconciliation. */
const TIER_PERCENT: Record<string, number> = { default: 100, flex: 100, priority: 200, fast: 200, ultrafast: 600 };

export type TokenUsage = { inputTokens: number; cachedTokens: number; cacheWriteTokens: number; cacheWrite12hTokens: number; outputTokens: number; reasoningTokens: number };

export function modelPrice(model: string): ModelPrice {
  const price = OPENAI_MODEL_PRICES[model];
  if (!price) throw new Error(`unpriced_model: ${model}`);
  return price;
}

// Integer ceiling of a sum of token*milli products, expressed in microunits.
function microunits(milliTokens: bigint, percent = 100): number {
  const denominator = 1000n * 100n * 100n;
  const numerator = milliTokens * BigInt(percent) * BigInt(CONSERVATIVE_MARGIN_PERCENT);
  const exact = (numerator + denominator - 1n) / denominator;
  if (exact > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('unrepresentable_charge');
  return Number(exact);
}

/**
 * Maximum possible charge for one request: every counted input token at the 30-minute cache-write
 * rate (the worst input rate without an explicit 12-hour lifetime) plus the whole output allowance,
 * which includes reasoning tokens.
 */
export function reservationMicrounits(model: string, inputTokens: number, maxOutputTokens: number): number {
  const price = modelPrice(model);
  if (!Number.isSafeInteger(inputTokens) || inputTokens < 0 || !Number.isSafeInteger(maxOutputTokens) || maxOutputTokens < 16) throw new Error('invalid_token_bounds');
  return microunits(BigInt(inputTokens) * BigInt(price.cacheWrite30mMilli) + BigInt(maxOutputTokens) * BigInt(price.outputMilli));
}

/** Charge for reported usage. Cache reads, both cache-write lifetimes and uncached input are disjoint. */
export function usageMicrounits(model: string, usage: TokenUsage, serviceTier: string | null): number {
  const price = modelPrice(model);
  if (![usage.inputTokens,usage.cachedTokens,usage.cacheWriteTokens,usage.cacheWrite12hTokens,usage.outputTokens,usage.reasoningTokens].every(value => Number.isSafeInteger(value) && value >= 0)
    || usage.cachedTokens + usage.cacheWriteTokens > usage.inputTokens
    || usage.cacheWrite12hTokens > usage.cacheWriteTokens || usage.reasoningTokens > usage.outputTokens) throw new Error('invalid_token_usage');
  if (usage.inputTokens > SHORT_CONTEXT_MAX_INPUT_TOKENS) throw new Error('unpriced_long_context');
  const tier = serviceTier === null ? undefined : TIER_PERCENT[serviceTier];
  if (tier === undefined) throw new Error('unpriced_service_tier');
  const written30m = usage.cacheWriteTokens - usage.cacheWrite12hTokens;
  const uncached = usage.inputTokens - usage.cachedTokens - usage.cacheWriteTokens;
  const milli = BigInt(uncached) * BigInt(price.inputMilli) + BigInt(usage.cachedTokens) * BigInt(price.cachedInputMilli) + BigInt(written30m) * BigInt(price.cacheWrite30mMilli)
    + BigInt(usage.cacheWrite12hTokens) * BigInt(price.cacheWrite12hMilli) + BigInt(usage.outputTokens) * BigInt(price.outputMilli);
  return microunits(milli, tier);
}

/** Integer formatting (no float rounding): four decimals below USD 1, otherwise two. */
export function formatUsd(microunits: number): string {
  if (!microunits) return 'USD 0.00';
  const decimals = microunits < 1_000_000 ? 4 : 2;
  const units = Math.round(microunits / 10 ** (6 - decimals));
  return `USD ${Math.floor(units / 10 ** decimals)}.${String(units % 10 ** decimals).padStart(decimals, '0')}`;
}
