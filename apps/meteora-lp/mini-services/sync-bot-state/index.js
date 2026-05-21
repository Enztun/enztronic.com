/**
 * sync-bot-state — Meridian JSON → PostgreSQL bridge
 *
 * Reads the four JSON files Meridian writes to its working directory
 * and upserts their content into the shared Postgres database so the
 * dashboard can display live bot data.
 *
 * Files watched (from DATA_DIR):
 *   state.json        → Position model
 *   decision-log.json → DecisionLog model
 *   lessons.json      → Lesson model
 *   pool-memory.json  → PoolMemory model
 *
 * Also writes runtime health keys into BotConfig so /api/health works.
 */

import { PrismaClient } from '@prisma/client';
import fs from 'fs';
import path from 'path';
import { createHash } from 'crypto';

const DATA_DIR = process.env.DATA_DIR ?? '/data';
const POLL_MS  = parseInt(process.env.POLL_MS ?? '5000', 10);
const DB_RETRY_ATTEMPTS = 20;
const DB_RETRY_DELAY_MS = 3000;

const prisma = new PrismaClient({ log: ['error'] });

// ─── Seen-ID cache (avoids re-upserting unchanged records) ────
const seen = {
  decisions: new Set(),
  lessons:   new Set(),
};

// ─── Helpers ──────────────────────────────────────────────────

function readJson(filename) {
  const filePath = path.join(DATA_DIR, filename);
  if (!fs.existsSync(filePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

function stableId(text) {
  return createHash('sha1').update(String(text)).digest('hex').slice(0, 25);
}

// ─── Sync: state.json → Position ──────────────────────────────

async function syncPositions() {
  const state = readJson('state.json');
  if (!state?.positions) return;

  for (const pos of Object.values(state.positions)) {
    if (!pos.position) continue;

    const create = {
      positionAddress: pos.position,
      poolAddress:     pos.pool,
      poolName:        pos.pool_name ?? null,
      strategy:        pos.strategy  ?? 'bid_ask',
      binMin:          pos.bin_range?.min ?? 0,
      binMax:          pos.bin_range?.max ?? 0,
      binActive:       pos.active_bin_at_deploy ?? 0,
      binStep:         pos.bin_step ?? null,
      amountSol:       pos.amount_sol  ?? 0,
      amountX:         pos.amount_x   ?? 0,
      amountY:         0,
      volatility:      pos.volatility    ?? null,
      feeTvlRatio:     pos.fee_tvl_ratio ?? null,
      organicScore:    pos.organic_score ?? null,
      initialValueUsd: pos.initial_value_usd ?? null,
      inRange:         !pos.out_of_range_since,
      outOfRangeSince: pos.out_of_range_since ? new Date(pos.out_of_range_since) : null,
      status:          pos.closed ? 'closed' : 'open',
      closedAt:        pos.closed_at ? new Date(pos.closed_at) : null,
      allTimeFeesUsd:  pos.total_fees_claimed_usd ?? 0,
      deployedAt:      new Date(pos.deployed_at),
    };

    const update = {
      inRange:         !pos.out_of_range_since,
      outOfRangeSince: pos.out_of_range_since ? new Date(pos.out_of_range_since) : null,
      status:          pos.closed ? 'closed' : 'open',
      closedAt:        pos.closed_at ? new Date(pos.closed_at) : null,
      allTimeFeesUsd:  pos.total_fees_claimed_usd ?? 0,
      currentValueUsd: pos.current_value_usd ?? null,
      pnlUsd:          pos.pnl_usd ?? null,
      pnlPct:          pos.pnl_pct ?? null,
      unclaimedFeesUsd: pos.unclaimed_fees_usd ?? null,
      feePerTvl24h:    pos.fee_per_tvl_24h ?? null,
    };

    try {
      await prisma.position.upsert({ where: { positionAddress: pos.position }, create, update });
    } catch (err) {
      console.error(`[positions] ${pos.position}: ${err.message}`);
    }
  }
}

// ─── Sync: decision-log.json → DecisionLog ────────────────────

async function syncDecisions() {
  const data = readJson('decision-log.json');
  if (!data?.decisions) return;

  for (const d of data.decisions) {
    if (!d.id || seen.decisions.has(d.id)) continue;

    try {
      await prisma.decisionLog.upsert({
        where: { id: d.id },
        create: {
          id:              d.id,
          type:            d.type   ?? 'note',
          actor:           d.actor  ?? 'GENERAL',
          poolAddress:     d.pool   ?? null,
          poolName:        d.pool_name ?? null,
          positionAddress: d.position ?? null,
          summary:         d.summary ?? '',
          reason:          d.reason  ?? '',
          risks:           JSON.stringify(d.risks    ?? []),
          metrics:         JSON.stringify(d.metrics  ?? {}),
          createdAt:       new Date(d.ts),
        },
        update: {},
      });
      seen.decisions.add(d.id);
    } catch (err) {
      console.error(`[decisions] ${d.id}: ${err.message}`);
    }
  }
}

// ─── Sync: lessons.json → Lesson ──────────────────────────────

async function syncLessons() {
  const data = readJson('lessons.json');
  if (!data?.lessons) return;

  for (const l of data.lessons) {
    if (!l.rule) continue;

    const id = l.id ?? stableId((l.role ?? '') + l.rule);
    if (seen.lessons.has(id)) continue;

    try {
      const existing = await prisma.lesson.findUnique({ where: { id } });
      if (!existing) {
        await prisma.lesson.create({
          data: {
            id,
            rule:      l.rule,
            tags:      JSON.stringify(l.tags ?? []),
            role:      l.role   ?? null,
            pinned:    l.pinned ?? false,
            source:    l.source ?? 'auto',
            createdAt: new Date(l.ts ?? Date.now()),
          },
        });
      }
      seen.lessons.add(id);
    } catch (err) {
      console.error(`[lessons] ${id}: ${err.message}`);
    }
  }
}

// ─── Sync: pool-memory.json → PoolMemory ──────────────────────

async function syncPoolMemory() {
  const data = readJson('pool-memory.json');
  if (!data || typeof data !== 'object') return;

  for (const [poolAddress, mem] of Object.entries(data)) {
    if (!poolAddress || typeof mem !== 'object') continue;

    const deploys    = Array.isArray(mem.deploys) ? mem.deploys : [];
    const wins       = deploys.filter(d => (d.pnl_pct ?? 0) >= 0).length;
    const losses     = deploys.filter(d => (d.pnl_pct ?? 0) < 0).length;
    const totalPnl   = deploys.reduce((s, d) => s + (d.pnl_usd  ?? 0), 0);
    const totalFees  = deploys.reduce((s, d) => s + (d.fees_earned_usd ?? 0), 0);

    const payload = {
      poolName:     mem.pool_name ?? null,
      deployCount:  deploys.length,
      winCount:     wins,
      lossCount:    losses,
      totalPnlUsd:  totalPnl,
      totalFeesUsd: totalFees,
      notes:        JSON.stringify(Array.isArray(mem.notes) ? mem.notes : []),
      lastDeployAt: mem.last_deploy_at ? new Date(mem.last_deploy_at) : null,
    };

    try {
      await prisma.poolMemory.upsert({
        where:  { poolAddress },
        create: { poolAddress, ...payload },
        update: payload,
      });
    } catch (err) {
      console.error(`[pool-memory] ${poolAddress}: ${err.message}`);
    }
  }
}

// ─── Write health metrics → BotConfig ─────────────────────────

async function updateHealth() {
  const state     = readJson('state.json');
  const decisions = readJson('decision-log.json');

  const lastUpdated = state?.lastUpdated ? new Date(state.lastUpdated) : null;
  const ageMs       = lastUpdated ? Date.now() - lastUpdated.getTime() : Infinity;
  const botStatus   =
    ageMs < 2 * 60_000  ? 'online'  :
    ageMs < 10 * 60_000 ? 'degraded': 'offline';

  const decisionList = decisions?.decisions ?? [];
  const lastScreening  = decisionList.find(d => d.actor === 'SCREENER');
  const lastManagement = decisionList.find(d => d.actor === 'MANAGER');

  const updates = [
    { key: 'bot_status',            value: botStatus,                          section: 'runtime' },
    { key: 'uptime',                value: lastUpdated?.toISOString() ?? '',   section: 'runtime' },
    { key: 'last_screening_cycle',  value: lastScreening?.ts  ?? '',           section: 'runtime' },
    { key: 'last_management_cycle', value: lastManagement?.ts ?? '',           section: 'runtime' },
  ];

  for (const { key, value, section } of updates) {
    try {
      await prisma.botConfig.upsert({
        where:  { key },
        create: { key, value: JSON.stringify(value), section },
        update: { value: JSON.stringify(value) },
      });
    } catch (err) {
      console.error(`[health] ${key}: ${err.message}`);
    }
  }
}

// ─── Main loop ────────────────────────────────────────────────

async function connectWithRetry() {
  for (let i = 1; i <= DB_RETRY_ATTEMPTS; i++) {
    try {
      await prisma.$connect();
      console.log('[sidecar] Connected to database');
      return;
    } catch (err) {
      console.log(`[sidecar] DB not ready (${i}/${DB_RETRY_ATTEMPTS}): ${err.message}`);
      await new Promise(r => setTimeout(r, DB_RETRY_DELAY_MS));
    }
  }
  throw new Error('Could not connect to database after retries');
}

async function main() {
  console.log(`[sidecar] Starting — DATA_DIR=${DATA_DIR}, POLL_MS=${POLL_MS}`);
  await connectWithRetry();

  while (true) {
    try {
      await Promise.allSettled([
        syncPositions(),
        syncDecisions(),
        syncLessons(),
        syncPoolMemory(),
        updateHealth(),
      ]);
    } catch (err) {
      console.error('[sidecar] Cycle error:', err.message);
    }
    await new Promise(r => setTimeout(r, POLL_MS));
  }
}

main().catch(err => {
  console.error('[sidecar] Fatal:', err);
  process.exit(1);
});
