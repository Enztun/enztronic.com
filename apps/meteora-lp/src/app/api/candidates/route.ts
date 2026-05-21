import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import type { PoolCandidate } from '@/lib/meridian-types';

function mapCandidate(
  c: Awaited<ReturnType<typeof prisma.poolCandidate.findMany>>[number],
  rank: number,
): PoolCandidate {
  return {
    id: c.id,
    rank,
    poolAddress: c.poolAddress,
    tokenPair: c.poolName ?? `${c.baseTokenSymbol ?? 'TOKEN'}/SOL`,
    score: c.score ?? 0,
    feeTvl: c.feeTvlRatio ?? 0,
    tvl: c.tvl ?? 0,
    volume24h: c.volume ?? 0,
    volume7d: c.volume ?? 0,
    organicCount: c.holders ?? 0,
    holders: c.holders ?? 0,
    mcap: c.mcap ?? 0,
    volatility: c.volatility ?? 0,
    binStep: c.binStep ?? 0,
    tokenAMint: c.baseTokenMint ?? '',
    tokenBMint: 'So11111111111111111111111111111111111111112',
  };
}

export async function GET() {
  try {
    const candidates = await prisma.poolCandidate.findMany({
      orderBy: { score: 'desc' },
      take: 20,
    });
    return NextResponse.json(candidates.map((c, i) => mapCandidate(c, i + 1)));
  } catch {
    return NextResponse.json([]);
  }
}
