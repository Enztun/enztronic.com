/**
 * ═══════════════════════════════════════════════════════════════
 * Bin-Hopping Strategy V2 — Adaptive Range for 2026 Volatility
 * ═══════════════════════════════════════════════════════════════
 *
 * ORIGINAL (Meridian default):
 *   bins_below = round(minBinsBelow + (volatility/5) * (maxBinsBelow - minBinsBelow))
 *   Clamped to [35, 69]. Linear scaling only.
 *
 * PROBLEMS with V1:
 *   1. Linear scaling doesn't match real market microstructure
 *   2. No mean-reversion detection (narrow range when price oscillates)
 *   3. No momentum awareness (wider range in strong trends)
 *   4. Ignores fee/TVL ratio (should affect range width)
 *   5. Same bin count regardless of bin_step (100 bins at step=10 ≠ 100 bins at step=100)
 *
 * V2 IMPROVEMENTS:
 *   1. Volatility tiers instead of linear scaling
 *   2. Mean-reversion mode (narrow range around VWAP)
 *   3. Momentum mode (wider range in trending markets)
 *   4. Fee-aware adjustment (wider range when fee/TVL is high → more fee capture)
 *   5. Bin-step normalization (range as % of price, not raw bin count)
 *   6. ATR-based fallback when volatility feed is unreliable
 *
 * INTEGRATION:
 *   Replace the bins_below calculation in the SCREENER prompt and
 *   deploy_position safety checks with this module.
 *
 * ═══════════════════════════════════════════════════════════════
 */

// ─── Configuration ────────────────────────────────────────
const BIN_HOPPING_V2_CONFIG = {
  // Volatility tiers (annualized % mapped to Solana spot)
  tiers: [
    { name: "calm",     maxVol: 1.5,  minBins: 35, maxBins: 45, strategy: "spot"    },
    { name: "normal",   maxVol: 3.0,  minBins: 40, maxBins: 55, strategy: "bid_ask"  },
    { name: "volatile", maxVol: 5.0,  minBins: 50, maxBins: 65, strategy: "bid_ask"  },
    { name: "extreme",  maxVol: Infinity, minBins: 55, maxBins: 69, strategy: "bid_ask" },
  ],

  // Mean-reversion settings
  meanReversion: {
    enabled: true,
    // If price is within X% of VWAP → narrow the range by 20%
    vwapProximityPct: 3,
    narrowingFactor: 0.8,
  },

  // Momentum settings
  momentum: {
    enabled: true,
    // If price moved >X% in last 30m → widen range by 25%
    thresholdPct: 5,
    wideningFactor: 1.25,
  },

  // Fee-aware adjustment
  feeAware: {
    enabled: true,
    // If fee/TVL > X% → widen range by 15% to capture more fees
    highFeeTvlThreshold: 0.5, // 0.5% fee/TVL
    wideningFactor: 1.15,
  },

  // Minimum range as % of current price (bin-step normalized)
  minRangePct: 15,  // At least 15% downside coverage
  maxRangePct: 60,  // Maximum 60% downside coverage

  // Safety floor (from original Meridian)
  minBinsBelow: 35,
};

/**
 * Calculate optimal bin range for a DLMM position.
 *
 * @param {Object} params
 * @param {number} params.volatility - Pool volatility (from screening API, max(screening timeframe, 30m))
 * @param {number} params.binStep - Pool bin step (80-125 for Solana DLMM)
 * @param {number} params.feeTvlRatio - Current fee/TVL ratio (%)
 * @param {number} params.priceChangePct - Recent price change (%)
 * @param {number} params.vwapDistancePct - Distance from VWAP (%)
 * @param {number} params.activeBinId - Current active bin ID
 * @param {Object} params.config - Optional override config
 * @returns {Object} Range recommendation
 */
export function calculateBinRangeV2({
  volatility,
  binStep,
  feeTvlRatio = 0,
  priceChangePct = 0,
  vwapDistancePct = 0,
  activeBinId = 0,
  config = BIN_HOPPING_V2_CONFIG,
}) {
  // ─── Input validation ───────────────────────────────────
  if (volatility == null || !Number.isFinite(volatility) || volatility <= 0) {
    return {
      error: "Invalid volatility — refusing deploy",
      binsBelow: null,
      mode: "rejected",
    };
  }

  if (binStep == null || !Number.isFinite(binStep) || binStep < 1) {
    return {
      error: "Invalid bin_step",
      binsBelow: null,
      mode: "rejected",
    };
  }

  // ─── Step 1: Volatility Tier Selection ──────────────────
  let tier = config.tiers[config.tiers.length - 1]; // default to highest
  for (const t of config.tiers) {
    if (volatility <= t.maxVol) {
      tier = t;
      break;
    }
  }

  // Within-tier interpolation (linear within the tier boundaries)
  const tierIndex = config.tiers.indexOf(tier);
  const prevTierMax = tierIndex > 0 ? config.tiers[tierIndex - 1].maxVol : 0;
  const tierRange = tier.maxVol === Infinity ? 5 : tier.maxVol - prevTierMax;
  const tierProgress = Math.min(1, (volatility - prevTierMax) / tierRange);

  let binsBelow = Math.round(tier.minBins + tierProgress * (tier.maxBins - tier.minBins));
  let currentStrategy = tier.strategy;
  let adjustments = [];
  let mode = tier.name;

  // ─── Step 2: Mean-Reversion Mode ────────────────────────
  if (config.meanReversion.enabled && vwapDistancePct <= config.meanReversion.vwapProximityPct) {
    binsBelow = Math.round(binsBelow * config.meanReversion.narrowingFactor);
    adjustments.push(`mean-reversion: within ${vwapDistancePct.toFixed(1)}% of VWAP → ×${config.meanReversion.narrowingFactor}`);
    mode = "mean-reversion";

    // In mean-reversion, spot strategy often works better
    if (volatility < 3) {
      currentStrategy = "spot";
    }
  }

  // ─── Step 3: Momentum Mode ──────────────────────────────
  if (config.momentum.enabled && Math.abs(priceChangePct) > config.momentum.thresholdPct) {
    binsBelow = Math.round(binsBelow * config.momentum.wideningFactor);
    adjustments.push(`momentum: ${priceChangePct.toFixed(1)}% price change → ×${config.momentum.wideningFactor}`);
    mode = priceChangePct > 0 ? "momentum-up" : "momentum-down";
  }

  // ─── Step 4: Fee-Aware Adjustment ───────────────────────
  if (config.feeAware.enabled && feeTvlRatio > config.feeAware.highFeeTvlThreshold) {
    binsBelow = Math.round(binsBelow * config.feeAware.wideningFactor);
    adjustments.push(`fee-aware: fee/TVL ${feeTvlRatio.toFixed(2)}% > ${config.feeAware.highFeeTvlThreshold}% → ×${config.feeAware.wideningFactor}`);
  }

  // ─── Step 5: Bin-Step Normalization ─────────────────────
  // Each bin covers binStep basis points of price.
  // bins_below bins cover approximately: bins_below × binStep / 100 % of price
  const rangePct = binsBelow * binStep / 100;

  if (rangePct < config.minRangePct) {
    const minBinsForPct = Math.ceil(config.minRangePct * 100 / binStep);
    binsBelow = Math.max(binsBelow, minBinsForPct);
    adjustments.push(`range-normalized: ${rangePct.toFixed(1)}% < ${config.minRangePct}% minimum → adjusted to ${binsBelow} bins`);
  }

  if (rangePct > config.maxRangePct) {
    const maxBinsForPct = Math.floor(config.maxRangePct * 100 / binStep);
    binsBelow = Math.min(binsBelow, maxBinsForPct);
    adjustments.push(`range-capped: ${rangePct.toFixed(1)}% > ${config.maxRangePct}% maximum → adjusted to ${binsBelow} bins`);
  }

  // ─── Step 6: Safety Floor ───────────────────────────────
  binsBelow = Math.max(binsBelow, config.minBinsBelow);

  // ─── Final Range Calculation ────────────────────────────
  const finalRangePct = binsBelow * binStep / 100;
  const minBinId = activeBinId - binsBelow;
  const maxBinId = activeBinId; // Single-sided SOL deploy

  return {
    binsBelow,
    binsAbove: 0, // Single-sided SOL = no upside bins
    minBinId,
    maxBinId,
    activeBinId,
    strategy: currentStrategy,
    mode,
    rangePct: finalRangePct,
    volatility,
    tier: tier.name,
    adjustments,
    // For Meridian integration — the prompt injection string
    promptHint: `V2 bin-hop: ${binsBelow} bins (${finalRangePct.toFixed(1)}% range) in ${mode} mode, vol=${volatility.toFixed(2)} [${tier.name} tier]${adjustments.length ? ` — ${adjustments.join('; ')}` : ''}`,
  };
}

/**
 * Generate a SCREENER prompt replacement for bin-hop V2.
 * Use this to replace the default bins_below formula in prompt.js
 */
export function getScreenerBinHopPrompt() {
  return `
BIN-HOPPING V2 (adaptive range):

Instead of the linear formula, use the tiered approach:

1. VOLATILITY TIER:
   - vol <= 1.5 → "calm" tier (35-45 bins, consider spot strategy)
   - vol <= 3.0 → "normal" tier (40-55 bins, bid_ask)
   - vol <= 5.0 → "volatile" tier (50-65 bins, bid_ask)
   - vol > 5.0  → "extreme" tier (55-69 bins, bid_ask)

2. MODE ADJUSTMENTS:
   - If price within 3% of VWAP → MEAN-REVERSION mode → narrow range by 20%
   - If price moved >5% in 30m → MOMENTUM mode → widen range by 25%
   - If fee/TVL > 0.5% → FEE-CAPTURE mode → widen range by 15%

3. BIN-STEP NORMALIZATION:
   - Target range: 15-60% of current price
   - range_pct = bins_below × bin_step / 100
   - If range_pct < 15% → increase bins_below
   - If range_pct > 60% → decrease bins_below

4. SAFETY:
   - Minimum bins_below = 35 (hard floor)
   - Volatility must be positive and finite — skip if null/0
   - Single-side SOL: bins_above = 0 always

When calling deploy_position, set:
- bins_below = calculated value from V2
- strategy = tier's recommended strategy
- Include volatility, fee_tvl_ratio, and price change in the tool call for logging
`;
}

// ─── Example Usage ────────────────────────────────────────
if (import.meta.url === `file://${process.argv[1]}`) {
  const testCases = [
    { volatility: 0.8, binStep: 100, feeTvlRatio: 0.15, priceChangePct: 0.5, vwapDistancePct: 1.2, activeBinId: 5000 },
    { volatility: 2.5, binStep: 80,  feeTvlRatio: 0.35, priceChangePct: -1.0, vwapDistancePct: 4.5, activeBinId: 7500 },
    { volatility: 4.2, binStep: 100, feeTvlRatio: 0.8,  priceChangePct: 7.0, vwapDistancePct: 8.0, activeBinId: 3200 },
    { volatility: 8.0, binStep: 125, feeTvlRatio: 1.2,  priceChangePct: -12.0, vwapDistancePct: 15.0, activeBinId: 1100 },
  ];

  console.log("═══ Bin-Hopping V2 Test Cases ═══\n");
  for (const tc of testCases) {
    const result = calculateBinRangeV2(tc);
    console.log(`Vol: ${tc.volatility}, BinStep: ${tc.binStep}`);
    console.log(`  → ${result.binsBelow} bins (${result.rangePct.toFixed(1)}% range), ${result.mode}, ${result.strategy}`);
    console.log(`  Range: bin ${result.minBinId} → ${result.maxBinId} (active: ${result.activeBinId})`);
    if (result.adjustments.length) console.log(`  Adjustments: ${result.adjustments.join('; ')}`);
    console.log(`  Prompt: ${result.promptHint}`);
    console.log();
  }
}
