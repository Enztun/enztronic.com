import { prisma } from '@/lib/prisma';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const POLL_MS = 5000;

export async function GET(request: Request) {
  const { signal } = request;
  const encoder = new TextEncoder();

  let lastPositionHash = '';
  let lastDecisionId = '';
  let lastCandidateCount = 0;
  let interval: ReturnType<typeof setInterval> | null = null;

  const stream = new ReadableStream<Uint8Array>({
    start(ctrl) {
      const send = (event: string, data: unknown) => {
        try {
          ctrl.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
        } catch {
          // controller already closed
        }
      };

      send('connected', { ts: Date.now() });

      interval = setInterval(async () => {
        if (signal.aborted) {
          if (interval) clearInterval(interval);
          return;
        }

        try {
          const [positions, latestDecision, candidateCount] = await Promise.all([
            prisma.position.findMany({
              where: { status: 'open' },
              select: { id: true, pnlUsd: true, inRange: true, unclaimedFeesUsd: true },
            }),
            prisma.decisionLog.findFirst({ orderBy: { createdAt: 'desc' }, select: { id: true } }),
            prisma.poolCandidate.count(),
          ]);

          // Positions changed (count, PnL, or range status)
          const posHash = positions
            .map((p) => `${p.id}:${p.pnlUsd}:${p.inRange}:${p.unclaimedFeesUsd}`)
            .sort()
            .join('|');
          if (posHash !== lastPositionHash) {
            lastPositionHash = posHash;
            send('positions_changed', { count: positions.length });
          }

          // New decision logged
          if (latestDecision && latestDecision.id !== lastDecisionId) {
            lastDecisionId = latestDecision.id;
            send('decision_added', { id: latestDecision.id });
          }

          // Candidate pool updated
          if (candidateCount !== lastCandidateCount) {
            lastCandidateCount = candidateCount;
            send('candidates_changed', { count: candidateCount });
          }
        } catch {
          // DB not ready yet — skip tick
        }
      }, POLL_MS);
    },
    cancel() {
      if (interval) clearInterval(interval);
    },
  });

  signal.addEventListener('abort', () => {
    if (interval) clearInterval(interval);
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  });
}
