'use client';

import { BotHealth } from '@/lib/meridian-types';
import { useDashboardStore } from '@/lib/dashboard-store';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import {
  Activity,
  Wallet,
  Wifi,
  WifiOff,
  Cpu,
  Clock,
  RefreshCw,
  Zap,
  Shield,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { formatDistanceToNow } from 'date-fns';

interface StatusBarProps {
  health: BotHealth;
}

export function StatusBar({ health }: StatusBarProps) {
  const { autoRefresh, setAutoRefresh } = useDashboardStore();

  const screeningAgo = formatDistanceToNow(new Date(health.lastScreeningCycle), { addSuffix: true });
  const managementAgo = formatDistanceToNow(new Date(health.lastManagementCycle), { addSuffix: true });

  return (
    <TooltipProvider delayDuration={200}>
      <div className="flex flex-wrap items-center gap-3 sm:gap-4 px-4 py-3 bg-card border-b border-border">
        {/* Bot Status */}
        <Tooltip>
          <TooltipTrigger asChild>
            <div className="flex items-center gap-2">
              <div className="relative">
                <div
                  className={cn(
                    'w-2.5 h-2.5 rounded-full',
                    health.status === 'online' ? 'bg-emerald-500' : health.status === 'degraded' ? 'bg-amber-500' : 'bg-red-500'
                  )}
                />
                {health.status === 'online' && (
                  <div className="absolute inset-0 w-2.5 h-2.5 rounded-full bg-emerald-500 animate-ping opacity-75" />
                )}
              </div>
              <span className={cn(
                'text-sm font-medium',
                health.status === 'online' ? 'text-emerald-400' : health.status === 'degraded' ? 'text-amber-400' : 'text-red-400'
              )}>
                {health.status === 'online' ? 'Online' : health.status === 'degraded' ? 'Degraded' : 'Offline'}
              </span>
            </div>
          </TooltipTrigger>
          <TooltipContent>
            <p>Uptime: {health.uptime}</p>
            <p>Positions: {health.totalPositions}</p>
          </TooltipContent>
        </Tooltip>

        <div className="h-4 w-px bg-border" />

        {/* Wallet Balance */}
        <Tooltip>
          <TooltipTrigger asChild>
            <div className="flex items-center gap-1.5">
              <Wallet className="h-3.5 w-3.5 text-muted-foreground" />
              <span className="text-sm font-mono">{health.walletBalance.toFixed(3)} SOL</span>
            </div>
          </TooltipTrigger>
          <TooltipContent>
            <p>Total deployed: {health.totalDeployed} SOL</p>
          </TooltipContent>
        </Tooltip>

        <div className="h-4 w-px bg-border hidden sm:block" />

        {/* RPC Status */}
        <Tooltip>
          <TooltipTrigger asChild>
            <div className="flex items-center gap-1.5 hidden sm:flex">
              {health.rpcStatus === 'connected' ? (
                <Wifi className="h-3.5 w-3.5 text-emerald-400" />
              ) : (
                <WifiOff className="h-3.5 w-3.5 text-red-400" />
              )}
              <span className={cn(
                'text-xs',
                health.rpcStatus === 'connected' ? 'text-muted-foreground' : 'text-red-400'
              )}>
                RPC {health.rpcLatency}ms
              </span>
            </div>
          </TooltipTrigger>
          <TooltipContent>
            <p>{health.rpcEndpoint}</p>
          </TooltipContent>
        </Tooltip>

        <div className="h-4 w-px bg-border hidden sm:block" />

        {/* Ollama Status */}
        <Tooltip>
          <TooltipTrigger asChild>
            <div className="flex items-center gap-1.5 hidden sm:flex">
              <Cpu className={cn(
                'h-3.5 w-3.5',
                health.ollamaStatus === 'connected' ? 'text-amber-400' : 'text-red-400'
              )} />
              <span className={cn(
                'text-xs',
                health.ollamaStatus === 'connected' ? 'text-muted-foreground' : 'text-red-400'
              )}>
                {health.ollamaStatus === 'connected' ? health.ollamaModel : 'Disconnected'}
              </span>
            </div>
          </TooltipTrigger>
          <TooltipContent>
            <p>LLM: {health.ollamaModel}</p>
            <p>Status: {health.ollamaStatus}</p>
          </TooltipContent>
        </Tooltip>

        <div className="h-4 w-px bg-border hidden md:block" />

        {/* Last Cycles */}
        <div className="items-center gap-1.5 hidden md:flex">
          <Clock className="h-3.5 w-3.5 text-muted-foreground" />
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="flex items-center gap-1 cursor-default">
                  <Zap className="h-3 w-3" />
                  {screeningAgo}
                </span>
              </TooltipTrigger>
              <TooltipContent>Last screening cycle</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="flex items-center gap-1 cursor-default">
                  <Activity className="h-3 w-3" />
                  {managementAgo}
                </span>
              </TooltipTrigger>
              <TooltipContent>Last management cycle</TooltipContent>
            </Tooltip>
          </div>
        </div>

        {/* Spacer */}
        <div className="flex-1" />

        {/* Dry Run Badge */}
        <Badge variant="outline" className="bg-amber-500/10 text-amber-400 border-amber-500/30 text-xs gap-1">
          <Shield className="h-3 w-3" />
          DRY RUN
        </Badge>

        {/* Auto Refresh Toggle */}
        <div className="flex items-center gap-2">
          <Label htmlFor="auto-refresh" className="text-xs text-muted-foreground flex items-center gap-1 cursor-pointer">
            <RefreshCw className={cn('h-3 w-3', autoRefresh && 'animate-spin')} style={{ animationDuration: '3s' }} />
            Auto
          </Label>
          <Switch
            id="auto-refresh"
            checked={autoRefresh}
            onCheckedChange={setAutoRefresh}
            className="scale-90"
          />
        </div>
      </div>
    </TooltipProvider>
  );
}
