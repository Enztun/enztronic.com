'use client';

import type { DecisionLog, DecisionType } from '@/lib/meridian-types';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Button } from '@/components/ui/button';
import {
  Rocket,
  XCircle,
  AlertTriangle,
  Ban,
  ChevronDown,
  ChevronUp,
  Clock,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { formatDistanceToNow } from 'date-fns';
import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

interface DecisionLogProps {
  decisions: DecisionLog[];
}

const decisionConfig: Record<DecisionType, {
  icon: React.ElementType;
  label: string;
  badgeClass: string;
  borderClass: string;
}> = {
  deploy: {
    icon: Rocket,
    label: 'Deploy',
    badgeClass: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30',
    borderClass: 'border-l-emerald-500',
  },
  close: {
    icon: XCircle,
    label: 'Close',
    badgeClass: 'bg-red-500/10 text-red-400 border-red-500/30',
    borderClass: 'border-l-red-500',
  },
  skip: {
    icon: AlertTriangle,
    label: 'Skip',
    badgeClass: 'bg-amber-500/10 text-amber-400 border-amber-500/30',
    borderClass: 'border-l-amber-500',
  },
  'no-deploy': {
    icon: Ban,
    label: 'No Deploy',
    badgeClass: 'bg-muted text-muted-foreground border-border',
    borderClass: 'border-l-muted-foreground',
  },
};

type FilterType = 'all' | DecisionType;

function DecisionItem({ decision }: { decision: DecisionLog }) {
  const [expanded, setExpanded] = useState(false);
  const config = decisionConfig[decision.type];
  const Icon = config.icon;

  return (
    <motion.div
      initial={{ opacity: 0, x: -8 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.2 }}
    >
      <Card className={cn('border-l-2', config.borderClass, 'py-0 overflow-hidden')}>
        <CardContent className="p-3">
          <div className="flex items-start gap-3">
            <div className="mt-0.5">
              <Icon className={cn('h-4 w-4', decision.type === 'deploy' ? 'text-emerald-400' : decision.type === 'close' ? 'text-red-400' : decision.type === 'skip' ? 'text-amber-400' : 'text-muted-foreground')} />
            </div>
            <div className="flex-1 min-w-0 space-y-1">
              <div className="flex items-center gap-2 flex-wrap">
                <Badge variant="outline" className={cn('text-[10px] px-1.5 py-0', config.badgeClass)}>
                  {config.label}
                </Badge>
                <span className="text-sm font-medium">{decision.tokenPair}</span>
                {decision.closeReason && (
                  <Badge variant="outline" className="text-[10px] px-1.5 py-0 bg-muted/50">
                    {decision.closeReason}
                  </Badge>
                )}
                {decision.pnlRealized !== undefined && (
                  <span className={cn(
                    'text-xs font-mono',
                    decision.pnlRealized >= 0 ? 'text-emerald-400' : 'text-red-400'
                  )}>
                    {decision.pnlRealized >= 0 ? '+' : ''}{decision.pnlRealized.toFixed(4)} SOL
                  </span>
                )}
              </div>
              <p className="text-xs text-muted-foreground leading-relaxed">
                {decision.summary}
              </p>
              <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
                <Clock className="h-3 w-3" />
                {formatDistanceToNow(new Date(decision.timestamp), { addSuffix: true })}
              </div>
            </div>
            <Button
              variant="ghost"
              size="sm"
              className="h-6 w-6 p-0 shrink-0"
              onClick={() => setExpanded(!expanded)}
            >
              {expanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
            </Button>
          </div>

          <AnimatePresence>
            {expanded && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.2 }}
                className="overflow-hidden"
              >
                <div className="mt-3 pt-3 border-t border-border/50 space-y-2">
                  <div>
                    <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1">Reasoning</p>
                    <p className="text-xs leading-relaxed">{decision.reason}</p>
                  </div>
                  {decision.risks && decision.risks.length > 0 && (
                    <div>
                      <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1">Risks</p>
                      <div className="flex flex-wrap gap-1">
                        {decision.risks.map((risk, i) => (
                          <Badge key={i} variant="outline" className="text-[10px] px-1.5 py-0 bg-red-500/10 text-red-400 border-red-500/30">
                            {risk}
                          </Badge>
                        ))}
                      </div>
                    </div>
                  )}
                  {decision.metrics && (
                    <div>
                      <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1">Metrics</p>
                      <div className="grid grid-cols-2 sm:grid-cols-3 gap-1">
                        {Object.entries(decision.metrics).map(([key, val]) => (
                          <div key={key} className="flex items-center justify-between text-[10px] bg-muted/30 rounded px-2 py-1">
                            <span className="text-muted-foreground">{key}</span>
                            <span className="font-mono">{typeof val === 'number' ? val.toLocaleString() : val}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </CardContent>
      </Card>
    </motion.div>
  );
}

export function DecisionLog({ decisions }: DecisionLogProps) {
  const [filter, setFilter] = useState<FilterType>('all');

  const filtered = filter === 'all'
    ? decisions
    : decisions.filter((d) => d.type === filter);

  const filters: { key: FilterType; label: string }[] = [
    { key: 'all', label: 'All' },
    { key: 'deploy', label: 'Deploy' },
    { key: 'close', label: 'Close' },
    { key: 'skip', label: 'Skip' },
    { key: 'no-deploy', label: 'No Deploy' },
  ];

  return (
    <div className="space-y-3">
      {/* Filter Tabs */}
      <div className="flex items-center gap-1 overflow-x-auto pb-1">
        {filters.map((f) => (
          <Button
            key={f.key}
            variant={filter === f.key ? 'default' : 'outline'}
            size="sm"
            className={cn(
              'h-7 text-xs px-2.5 shrink-0',
              filter === f.key && 'bg-amber-500/20 text-amber-400 border-amber-500/30 hover:bg-amber-500/30'
            )}
            onClick={() => setFilter(f.key)}
          >
            {f.label}
          </Button>
        ))}
      </div>

      {/* Decision List */}
      <ScrollArea className="max-h-[500px] pr-2">
        <div className="space-y-2">
          {filtered.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground text-sm">
              No decisions matching filter
            </div>
          ) : (
            filtered.map((decision) => (
              <DecisionItem key={decision.id} decision={decision} />
            ))
          )}
        </div>
      </ScrollArea>
    </div>
  );
}
