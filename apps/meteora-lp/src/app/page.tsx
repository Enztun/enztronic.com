'use client';

import { useQuery, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState, useEffect, useCallback } from 'react';
import { useDashboardStore, type DashboardTab } from '@/lib/dashboard-store';
import type {
  Position,
  DecisionLog,
  PoolCandidate,
  PnlDataPoint,
  BotHealth,
  BotConfig,
} from '@/lib/meridian-types';

import { useLiveData } from '@/lib/use-live-data';
import { StatusBar } from '@/components/dashboard/status-bar';
import { PositionCard } from '@/components/dashboard/position-card';
import { PnlChart } from '@/components/dashboard/pnl-chart';
import { DecisionLog as DecisionLogComponent } from '@/components/dashboard/decision-log';
import { PoolCandidates } from '@/components/dashboard/pool-candidates';
import { ConfigPanel } from '@/components/dashboard/config-panel';
import { SetupGuide } from '@/components/dashboard/setup-guide';

import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Skeleton } from '@/components/ui/skeleton';
import { Card, CardContent } from '@/components/ui/card';
import {
  LineChart,
  Brain,
  Search,
  Settings,
  BookOpen,
} from 'lucide-react';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      staleTime: 15000,
    },
  },
});

function useDashboardData() {
  const { autoRefresh } = useDashboardStore();

  const health = useQuery<BotHealth>({
    queryKey: ['health'],
    queryFn: () => fetch('/api/health').then((r) => r.json()),
    refetchInterval: autoRefresh ? 30000 : false,
  });

  const positions = useQuery<Position[]>({
    queryKey: ['positions'],
    queryFn: () => fetch('/api/positions').then((r) => r.json()),
    refetchInterval: autoRefresh ? 30000 : false,
  });

  const decisions = useQuery<DecisionLog[]>({
    queryKey: ['decisions'],
    queryFn: () => fetch('/api/decisions').then((r) => r.json()),
    refetchInterval: autoRefresh ? 30000 : false,
  });

  const candidates = useQuery<PoolCandidate[]>({
    queryKey: ['candidates'],
    queryFn: () => fetch('/api/candidates').then((r) => r.json()),
    refetchInterval: autoRefresh ? 30000 : false,
  });

  const pnl = useQuery<PnlDataPoint[]>({
    queryKey: ['pnl'],
    queryFn: () => fetch('/api/pnl').then((r) => r.json()),
    refetchInterval: autoRefresh ? 30000 : false,
  });

  const config = useQuery<BotConfig>({
    queryKey: ['config'],
    queryFn: () => fetch('/api/config').then((r) => r.json()),
    refetchInterval: false,
  });

  return { health, positions, decisions, candidates, pnl, config };
}

function LoadingSkeleton() {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {[1, 2, 3].map((i) => (
          <Card key={i} className="py-4">
            <CardContent className="p-4 pt-0 space-y-3">
              <Skeleton className="h-5 w-24" />
              <Skeleton className="h-3 w-40" />
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-4 w-full" />
              <div className="grid grid-cols-2 gap-2">
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-full" />
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
      <Skeleton className="h-[400px] w-full" />
    </div>
  );
}

const tabConfig: { key: DashboardTab; label: string; icon: React.ElementType }[] = [
  { key: 'pnl', label: 'PnL', icon: LineChart },
  { key: 'decisions', label: 'Decisions', icon: Brain },
  { key: 'pools', label: 'Pools', icon: Search },
  { key: 'config', label: 'Config', icon: Settings },
  { key: 'setup', label: 'Setup', icon: BookOpen },
];

function DashboardContent() {
  const { activeTab, setActiveTab, selectedPositionId, setSelectedPositionId } = useDashboardStore();
  const { health, positions, decisions, candidates, pnl, config } = useDashboardData();
  useLiveData();

  const isLoading = positions.isLoading || health.isLoading;

  return (
    <div className="min-h-screen flex flex-col bg-background">
      {/* Status Bar */}
      {health.data ? (
        <StatusBar health={health.data} />
      ) : (
        <div className="px-4 py-3 bg-card border-b border-border">
          <Skeleton className="h-6 w-full max-w-2xl" />
        </div>
      )}

      {/* Main Content */}
      <div className="flex-1 p-4 space-y-4 max-w-[1440px] mx-auto w-full">
        {/* Position Cards */}
        {isLoading ? (
          <LoadingSkeleton />
        ) : (
          <>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {positions.data?.map((position) => (
                <PositionCard
                  key={position.id}
                  position={position}
                  onExpand={setSelectedPositionId}
                  isExpanded={selectedPositionId === position.id}
                />
              ))}
              {(!positions.data || positions.data.length === 0) && (
                <Card className="py-4 md:col-span-2 lg:col-span-3">
                  <CardContent className="p-6 text-center text-muted-foreground">
                    <p className="text-sm">No open positions</p>
                    <p className="text-xs mt-1">Waiting for the bot to deploy...</p>
                  </CardContent>
                </Card>
              )}
            </div>

            {/* Tabbed Content */}
            <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as DashboardTab)}>
              <TabsList className="w-full sm:w-auto">
                {tabConfig.map(({ key, label, icon: Icon }) => (
                  <TabsTrigger key={key} value={key} className="gap-1.5 text-xs">
                    <Icon className="h-3.5 w-3.5" />
                    <span className="hidden sm:inline">{label}</span>
                  </TabsTrigger>
                ))}
              </TabsList>

              <TabsContent value="pnl" className="mt-4">
                {pnl.data ? (
                  <PnlChart data={pnl.data} />
                ) : (
                  <Skeleton className="h-[400px] w-full" />
                )}
              </TabsContent>

              <TabsContent value="decisions" className="mt-4">
                {decisions.data ? (
                  <DecisionLogComponent decisions={decisions.data} />
                ) : (
                  <Skeleton className="h-[400px] w-full" />
                )}
              </TabsContent>

              <TabsContent value="pools" className="mt-4">
                {candidates.data ? (
                  <PoolCandidates candidates={candidates.data} dryRun={config.data?.dryRun} />
                ) : (
                  <Skeleton className="h-[400px] w-full" />
                )}
              </TabsContent>

              <TabsContent value="config" className="mt-4">
                {config.data ? (
                  <ConfigPanel config={config.data} />
                ) : (
                  <Skeleton className="h-[400px] w-full" />
                )}
              </TabsContent>

              <TabsContent value="setup" className="mt-4">
                <SetupGuide />
              </TabsContent>
            </Tabs>
          </>
        )}
      </div>
    </div>
  );
}

export default function DashboardPage() {
  return (
    <QueryClientProvider client={queryClient}>
      <DashboardContent />
    </QueryClientProvider>
  );
}
