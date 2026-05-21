import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import type { Position, PositionStatus, StrategyType } from '@/lib/meridian-types';

function mapPosition(p: Awaited<ReturnType<typeof prisma.position.findMany>>[number]): Position {
  const now = Date.now();
  const holdMs = now - p.deployedAt.getTime();
  const holdHours = Math.floor(holdMs / 3600000);
  const holdMins = Math.floor((holdMs % 3600000) / 60000);
  const holdTime = holdHours > 0 ? `${holdHours}h ${holdMins}m` : `${holdMins}m`;

  let status: PositionStatus = 'in-range';
  if (!p.inRange) {
    const oorMs = p.outOfRangeSince ? now - p.outOfRangeSince.getTime() : 0;
    status = oorMs > 30 * 60_000 ? 'out-of-range' : 'near-edge';
  }

  return {
    id: p.id,
    poolAddress: p.poolAddress,
    tokenPair: p.poolName ?? `${p.baseSymbol ?? 'TOKEN'}/SOL`,
    tokenAMint: p.baseMint ?? '',
    tokenBMint: p.quoteMint ?? 'So11111111111111111111111111111111111111112',
    strategy: (p.strategy as StrategyType) ?? 'bid_ask',
    binRangeMin: p.binMin,
    binRangeMax: p.binMax,
    activeBin: p.binActive,
    totalBins: p.binMax - p.binMin,
    deployedAmount: p.amountSol,
    currentValue: p.currentValueUsd ?? p.amountSol,
    pnlUsd: p.pnlUsd ?? 0,
    pnlPercent: p.pnlPct ?? 0,
    unclaimedFees: p.unclaimedFeesUsd ?? 0,
    feeTvl24h: p.feePerTvl24h ?? 0,
    holdTime,
    holdTimeMs: holdMs,
    status,
    createdAt: p.deployedAt.toISOString(),
    lastUpdated: new Date().toISOString(),
    xAmount: p.amountX,
    yAmount: p.amountY,
  };
}

export async function GET() {
  try {
    const positions = await prisma.position.findMany({
      where: { status: 'open' },
      orderBy: { deployedAt: 'desc' },
    });
    return NextResponse.json(positions.map(mapPosition));
  } catch {
    return NextResponse.json([]);
  }
}
