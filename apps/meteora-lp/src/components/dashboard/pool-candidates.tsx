'use client';

import { PoolCandidate } from '@/lib/meridian-types';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { Progress } from '@/components/ui/progress';
import {
  Rocket,
  ChevronDown,
  ChevronUp,
  ExternalLink,
  Shield,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

interface PoolCandidatesProps {
  candidates: PoolCandidate[];
  dryRun?: boolean;
}

function formatNumber(num: number): string {
  if (num >= 1_000_000_000) return `${(num / 1_000_000_000).toFixed(1)}B`;
  if (num >= 1_000_000) return `${(num / 1_000_000).toFixed(1)}M`;
  if (num >= 1_000) return `${(num / 1_000).toFixed(1)}K`;
  return num.toFixed(0);
}

function ScoreBar({ score }: { score: number }) {
  const color = score >= 75 ? 'text-emerald-400' : score >= 60 ? 'text-amber-400' : 'text-red-400';
  return (
    <div className="flex items-center gap-2 min-w-[100px]">
      <Progress
        value={score}
        className={cn(
          'h-1.5 flex-1',
          score >= 75 ? '[&>div]:bg-emerald-500' : score >= 60 ? '[&>div]:bg-amber-500' : '[&>div]:bg-red-500'
        )}
      />
      <span className={cn('text-xs font-mono w-8 text-right', color)}>{score}</span>
    </div>
  );
}

function CandidateRow({ candidate, dryRun }: { candidate: PoolCandidate; dryRun: boolean }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <>
      <TableRow
        className="cursor-pointer hover:bg-muted/30 transition-colors"
        onClick={() => setExpanded(!expanded)}
      >
        <TableCell className="font-mono text-center w-10">{candidate.rank}</TableCell>
        <TableCell>
          <div className="flex items-center gap-2">
            <span className="font-medium text-sm">{candidate.tokenPair}</span>
            <TooltipProvider delayDuration={200}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <a
                    href={`https://solscan.io/account/${candidate.poolAddress}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={(e) => e.stopPropagation()}
                    className="text-muted-foreground hover:text-foreground transition-colors"
                  >
                    <ExternalLink className="h-3 w-3" />
                  </a>
                </TooltipTrigger>
                <TooltipContent>View on Solscan</TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </div>
        </TableCell>
        <TableCell><ScoreBar score={candidate.score} /></TableCell>
        <TableCell className="font-mono text-xs text-amber-400">{candidate.feeTvl.toFixed(1)}%</TableCell>
        <TableCell className="font-mono text-xs">${formatNumber(candidate.tvl)}</TableCell>
        <TableCell className="font-mono text-xs">${formatNumber(candidate.volume24h)}</TableCell>
        <TableCell className="font-mono text-xs text-center">{candidate.organicCount}</TableCell>
        <TableCell className="font-mono text-xs text-center hidden lg:table-cell">{formatNumber(candidate.holders)}</TableCell>
        <TableCell className="font-mono text-xs hidden xl:table-cell">${formatNumber(candidate.mcap)}</TableCell>
        <TableCell className="font-mono text-xs text-center hidden xl:table-cell">
          <span className={candidate.volatility > 0.6 ? 'text-red-400' : candidate.volatility > 0.4 ? 'text-amber-400' : 'text-emerald-400'}>
            {(candidate.volatility * 100).toFixed(0)}%
          </span>
        </TableCell>
        <TableCell className="text-right">
          <Button
            variant="outline"
            size="sm"
            className={cn(
              'h-7 text-[10px] gap-1',
              dryRun
                ? 'opacity-50 cursor-not-allowed border-muted text-muted-foreground'
                : 'border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/10'
            )}
            disabled={dryRun}
            onClick={(e) => e.stopPropagation()}
          >
            <Rocket className="h-3 w-3" />
            Deploy
          </Button>
        </TableCell>
      </TableRow>
      <AnimatePresence>
        {expanded && (
          <TableRow>
            <TableCell colSpan={10} className="p-0">
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.2 }}
                className="overflow-hidden"
              >
                <div className="p-4 bg-muted/20 space-y-3">
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
                    <div>
                      <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Volume 7D</p>
                      <p className="font-mono">${formatNumber(candidate.volume7d)}</p>
                    </div>
                    <div>
                      <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Bin Step</p>
                      <p className="font-mono">{candidate.binStep}</p>
                    </div>
                    <div>
                      <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Holders</p>
                      <p className="font-mono">{candidate.holders.toLocaleString()}</p>
                    </div>
                    <div>
                      <p className="text-[10px] text-muted-foreground uppercase tracking-wider">MCap</p>
                      <p className="font-mono">${formatNumber(candidate.mcap)}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-4 text-[10px] text-muted-foreground font-mono">
                    <span>Token A: {candidate.tokenAMint.slice(0, 8)}...{candidate.tokenAMint.slice(-4)}</span>
                    <span>Token B: {candidate.tokenBMint.slice(0, 8)}...{candidate.tokenBMint.slice(-4)}</span>
                  </div>
                  {dryRun && (
                    <div className="flex items-center gap-1.5 text-[10px] text-amber-400">
                      <Shield className="h-3 w-3" />
                      Deploy disabled in DRY_RUN mode
                    </div>
                  )}
                </div>
              </motion.div>
            </TableCell>
          </TableRow>
        )}
      </AnimatePresence>
    </>
  );
}

export function PoolCandidates({ candidates, dryRun = true }: PoolCandidatesProps) {
  return (
    <div className="space-y-3">
      {dryRun && (
        <div className="flex items-center gap-2 px-3 py-2 bg-amber-500/10 border border-amber-500/30 rounded-lg text-xs text-amber-400">
          <Shield className="h-4 w-4 shrink-0" />
          <span>Bot is running in DRY_RUN mode — deploy actions are disabled</span>
        </div>
      )}

      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-10 text-center">#</TableHead>
              <TableHead>Pool</TableHead>
              <TableHead>Score</TableHead>
              <TableHead>Fee/TVL</TableHead>
              <TableHead>TVL</TableHead>
              <TableHead>Vol 24h</TableHead>
              <TableHead className="text-center">Organic</TableHead>
              <TableHead className="text-center hidden lg:table-cell">Holders</TableHead>
              <TableHead className="hidden xl:table-cell">MCap</TableHead>
              <TableHead className="text-center hidden xl:table-cell">Vol</TableHead>
              <TableHead className="text-right">Action</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {candidates.map((candidate) => (
              <CandidateRow key={candidate.id} candidate={candidate} dryRun={dryRun} />
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
