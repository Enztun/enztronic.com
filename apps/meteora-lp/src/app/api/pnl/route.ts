import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import type { PnlDataPoint } from '@/lib/meridian-types';

export async function GET() {
  try {
    // Build cumulative PnL from closed positions ordered by close date
    const closed = await prisma.position.findMany({
      where: { status: 'closed', closedAt: { not: null } },
      orderBy: { closedAt: 'asc' },
      select: { closedAt: true, pnlUsd: true, allTimeFeesUsd: true },
    });

    // Also include fee claim transactions for ongoing fee income
    const claims = await prisma.transactionLog.findMany({
      where: { type: 'claim', success: true },
      orderBy: { createdAt: 'asc' },
      select: { createdAt: true, feesCollected: true },
    });

    const points: PnlDataPoint[] = [];
    let cumulativePnl = 0;
    let cumulativeFees = 0;

    // Merge closed positions and fee claims by date
    type Event =
      | { kind: 'close'; date: Date; pnl: number; fees: number }
      | { kind: 'claim'; date: Date; fees: number };

    const events: Event[] = [
      ...closed.map((p) => ({
        kind: 'close' as const,
        date: p.closedAt!,
        pnl: p.pnlUsd ?? 0,
        fees: p.allTimeFeesUsd ?? 0,
      })),
      ...claims.map((c) => ({
        kind: 'claim' as const,
        date: c.createdAt,
        fees: c.feesCollected ?? 0,
      })),
    ].sort((a, b) => a.date.getTime() - b.date.getTime());

    for (const ev of events) {
      if (ev.kind === 'close') {
        cumulativePnl += ev.pnl;
        cumulativeFees += ev.fees;
      } else {
        cumulativeFees += ev.fees;
      }
      points.push({
        timestamp: ev.date.toISOString(),
        cumulativePnl,
        feeIncome: cumulativeFees,
        unrealizedPnl: 0,
      });
    }

    // Add unrealized PnL from open positions as the last point
    if (points.length > 0) {
      const open = await prisma.position.aggregate({
        where: { status: 'open' },
        _sum: { pnlUsd: true, unclaimedFeesUsd: true },
      });
      const unrealized = (open._sum.pnlUsd ?? 0) + (open._sum.unclaimedFeesUsd ?? 0);
      points[points.length - 1].unrealizedPnl = unrealized;
    }

    return NextResponse.json(points);
  } catch {
    return NextResponse.json([]);
  }
}
