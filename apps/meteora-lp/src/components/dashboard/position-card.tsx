'use client';

import { Position } from '@/lib/meridian-types';
import { BinRangeVisualizer } from './bin-range-visualizer';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardAction,
} from '@/components/ui/card';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import {
  TrendingUp,
  TrendingDown,
  Clock,
  DollarSign,
  Coins,
  ExternalLink,
  X,
  ArrowDownToLine,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { motion } from 'framer-motion';

interface PositionCardProps {
  position: Position;
  onExpand?: (id: string | null) => void;
  isExpanded?: boolean;
}

function truncateAddress(addr: string) {
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
}

function formatDuration(ms: number) {
  const hours = Math.floor(ms / 3600000);
  const mins = Math.floor((ms % 3600000) / 60000);
  if (hours > 0) return `${hours}h ${mins}m`;
  return `${mins}m`;
}

export function PositionCard({ position, onExpand, isExpanded }: PositionCardProps) {
  const isProfitable = position.pnlUsd >= 0;

  return (
    <TooltipProvider delayDuration={200}>
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
      >
        <Card className={cn(
          'overflow-hidden transition-colors',
          position.status === 'out-of-range' ? 'border-red-500/30' : position.status === 'near-edge' ? 'border-amber-500/30' : 'border-emerald-500/20'
        )}>
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <CardTitle className="text-base font-bold">{position.tokenPair}</CardTitle>
                <Badge
                  variant="outline"
                  className={cn(
                    'text-[10px] px-1.5 py-0',
                    position.strategy === 'bid_ask'
                      ? 'bg-amber-500/10 text-amber-400 border-amber-500/30'
                      : 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30'
                  )}
                >
                  {position.strategy === 'bid_ask' ? 'Bid/Ask' : 'Spot'}
                </Badge>
              </div>
              <CardAction>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <a
                      href={`https://solscan.io/account/${position.poolAddress}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-muted-foreground hover:text-foreground transition-colors"
                    >
                      <ExternalLink className="h-3.5 w-3.5" />
                    </a>
                  </TooltipTrigger>
                  <TooltipContent>View on Solscan</TooltipContent>
                </Tooltip>
              </CardAction>
            </div>
            <p className="text-[10px] text-muted-foreground font-mono">
              {truncateAddress(position.poolAddress)}
            </p>
          </CardHeader>

          <CardContent className="space-y-3 pt-0">
            {/* Bin Range Visualizer */}
            <BinRangeVisualizer
              binRangeMin={position.binRangeMin}
              binRangeMax={position.binRangeMax}
              activeBin={position.activeBin}
              totalBins={position.totalBins}
              status={position.status}
            />

            {/* PnL Row */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5">
                {isProfitable ? (
                  <TrendingUp className="h-4 w-4 text-emerald-400" />
                ) : (
                  <TrendingDown className="h-4 w-4 text-red-400" />
                )}
                <span className={cn(
                  'text-lg font-bold font-mono',
                  isProfitable ? 'text-emerald-400' : 'text-red-400'
                )}>
                  {isProfitable ? '+' : ''}{position.pnlUsd.toFixed(2)}
                </span>
                <span className={cn(
                  'text-xs font-mono',
                  isProfitable ? 'text-emerald-400' : 'text-red-400'
                )}>
                  ({isProfitable ? '+' : ''}{position.pnlPercent.toFixed(2)}%)
                </span>
              </div>
              <Badge
                variant="outline"
                className={cn(
                  'text-[10px] px-1.5 py-0',
                  position.status === 'in-range'
                    ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30'
                    : position.status === 'near-edge'
                    ? 'bg-amber-500/10 text-amber-400 border-amber-500/30'
                    : 'bg-red-500/10 text-red-400 border-red-500/30'
                )}
              >
                {position.status === 'in-range' ? 'IN RANGE' : position.status === 'near-edge' ? 'NEAR EDGE' : 'OOR'}
              </Badge>
            </div>

            {/* Metrics Grid */}
            <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs">
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground flex items-center gap-1">
                  <DollarSign className="h-3 w-3" />
                  Value
                </span>
                <span className="font-mono">{position.currentValue.toFixed(3)} SOL</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground flex items-center gap-1">
                  <Coins className="h-3 w-3" />
                  Fees
                </span>
                <span className="font-mono text-emerald-400">+{position.unclaimedFees.toFixed(4)}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground flex items-center gap-1">
                  <Clock className="h-3 w-3" />
                  Hold
                </span>
                <span className="font-mono">{formatDuration(position.holdTimeMs)}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Fee/TVL</span>
                <span className="font-mono text-amber-400">{position.feeTvl24h.toFixed(1)}%</span>
              </div>
            </div>

            {/* Deployed amount bar */}
            <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
              <span>Deployed: {position.deployedAmount} SOL</span>
              <div className="flex-1 h-1 bg-muted rounded-full overflow-hidden">
                <div
                  className={cn(
                    'h-full rounded-full',
                    isProfitable ? 'bg-emerald-500' : 'bg-red-500'
                  )}
                  style={{
                    width: `${Math.min((position.currentValue / position.deployedAmount) * 100, 100)}%`,
                  }}
                />
              </div>
              <span>{((position.currentValue / position.deployedAmount) * 100).toFixed(1)}%</span>
            </div>

            {/* Action Buttons */}
            <div className="flex items-center gap-2 pt-1">
              <Button
                variant="destructive"
                size="sm"
                className="h-7 text-xs gap-1 flex-1"
                onClick={() => onExpand?.(position.id)}
              >
                <X className="h-3 w-3" />
                Close
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="h-7 text-xs gap-1 flex-1 border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/10"
              >
                <ArrowDownToLine className="h-3 w-3" />
                Claim
              </Button>
            </div>
          </CardContent>
        </Card>
      </motion.div>
    </TooltipProvider>
  );
}
