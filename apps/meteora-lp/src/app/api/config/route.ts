import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import type { BotConfig } from '@/lib/meridian-types';

const DEFAULT_CONFIG: BotConfig = {
  minTvl: 50000,
  minFeeTvl: 0.3,
  minVolume24h: 25000,
  minHolders: 100,
  minOrganicCount: 10,
  maxVolatility: 5,
  minMcap: 500000,
  takeProfitPercent: 8,
  stopLossPercent: -5,
  oorThreshold: 0.95,
  nearEdgeThreshold: 0.85,
  maxHoldTimeHours: 24,
  claimFeesThreshold: 0.05,
  maxPositions: 3,
  maxPositionSizeSol: 1,
  maxPoolExposure: 0.4,
  screeningIntervalMin: 15,
  managementIntervalMin: 5,
  llmBaseUrl: 'http://localhost:3333/v1',
  llmModel: 'llama3.1:8b-instruct-q4_K_M',
  ollamaMode: true,
  temperature: 0.3,
  defaultStrategy: 'bid_ask',
  binRangeWidth: 50,
  autoRebalance: false,
  dryRun: true,
};

export async function GET() {
  try {
    const configs = await prisma.botConfig.findMany();
    if (configs.length === 0) return NextResponse.json(DEFAULT_CONFIG);

    const merged = { ...DEFAULT_CONFIG } as Record<string, unknown>;
    for (const c of configs) {
      merged[c.key] = JSON.parse(c.value);
    }
    return NextResponse.json(merged);
  } catch {
    return NextResponse.json(DEFAULT_CONFIG);
  }
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as Record<string, unknown>;
    const updates = Object.entries(body);

    // Determine section by key prefix
    const sectionOf = (key: string) => {
      if (['minTvl', 'minFeeTvl', 'minVolume24h', 'minHolders', 'minOrganicCount', 'maxVolatility', 'minMcap'].includes(key)) return 'screening';
      if (['takeProfitPercent', 'stopLossPercent', 'oorThreshold', 'nearEdgeThreshold', 'maxHoldTimeHours', 'claimFeesThreshold'].includes(key)) return 'management';
      if (['maxPositions', 'maxPositionSizeSol', 'maxPoolExposure'].includes(key)) return 'risk';
      if (['screeningIntervalMin', 'managementIntervalMin'].includes(key)) return 'schedule';
      if (['llmBaseUrl', 'llmModel', 'ollamaMode', 'temperature'].includes(key)) return 'llm';
      return 'strategy';
    };

    await Promise.all(
      updates.map(([key, value]) =>
        prisma.botConfig.upsert({
          where: { key },
          update: { value: JSON.stringify(value) },
          create: { key, value: JSON.stringify(value), section: sectionOf(key) },
        }),
      ),
    );

    return NextResponse.json({ success: true });
  } catch (e) {
    return NextResponse.json({ success: false, error: String(e) }, { status: 500 });
  }
}
