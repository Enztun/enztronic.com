import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import type { BotHealth } from '@/lib/meridian-types';

const OFFLINE_HEALTH: BotHealth = {
  status: 'offline',
  walletBalance: 0,
  rpcStatus: 'disconnected',
  rpcEndpoint: '',
  rpcLatency: 0,
  ollamaStatus: 'disconnected',
  ollamaModel: '',
  lastScreeningCycle: '',
  lastManagementCycle: '',
  uptime: '0s',
  totalPositions: 0,
  totalDeployed: 0,
};

export async function GET() {
  try {
    const [configs, positionStats] = await Promise.all([
      prisma.botConfig.findMany(),
      prisma.position.aggregate({
        where: { status: 'open' },
        _count: { id: true },
        _sum: { amountSol: true },
      }),
    ]);

    const cfg = Object.fromEntries(configs.map((c) => [c.key, JSON.parse(c.value)])) as Record<
      string,
      string | number
    >;

    const health: BotHealth = {
      status: (cfg['bot_status'] as BotHealth['status']) ?? 'offline',
      walletBalance: (cfg['wallet_balance'] as number) ?? 0,
      rpcStatus: (cfg['rpc_status'] as BotHealth['rpcStatus']) ?? 'disconnected',
      rpcEndpoint: (cfg['rpc_endpoint'] as string) ?? '',
      rpcLatency: (cfg['rpc_latency'] as number) ?? 0,
      ollamaStatus: (cfg['ollama_status'] as BotHealth['ollamaStatus']) ?? 'disconnected',
      ollamaModel: (cfg['ollama_model'] as string) ?? '',
      lastScreeningCycle: (cfg['last_screening_cycle'] as string) ?? '',
      lastManagementCycle: (cfg['last_management_cycle'] as string) ?? '',
      uptime: (cfg['uptime'] as string) ?? '0s',
      totalPositions: positionStats._count.id,
      totalDeployed: positionStats._sum.amountSol ?? 0,
    };

    return NextResponse.json(health);
  } catch {
    return NextResponse.json(OFFLINE_HEALTH);
  }
}
