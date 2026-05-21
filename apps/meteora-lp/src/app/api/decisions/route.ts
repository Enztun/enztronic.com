import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import type { DecisionLog, DecisionType } from '@/lib/meridian-types';

function mapDecision(
  d: Awaited<ReturnType<typeof prisma.decisionLog.findMany>>[number],
): DecisionLog {
  return {
    id: d.id,
    type: d.type as DecisionType,
    poolAddress: d.poolAddress ?? '',
    tokenPair: d.poolName ?? d.poolAddress ?? 'Unknown',
    summary: d.summary,
    reason: d.reason,
    risks: d.risks ? (JSON.parse(d.risks) as string[]) : undefined,
    metrics: d.metrics ? (JSON.parse(d.metrics) as Record<string, number | string>) : undefined,
    timestamp: d.createdAt.toISOString(),
  };
}

export async function GET() {
  try {
    const decisions = await prisma.decisionLog.findMany({
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
    return NextResponse.json(decisions.map(mapDecision));
  } catch {
    return NextResponse.json([]);
  }
}
