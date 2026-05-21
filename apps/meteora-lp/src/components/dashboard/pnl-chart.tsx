'use client';

import { PnlDataPoint } from '@/lib/meridian-types';
import {
  Area,
  AreaChart,
  CartesianGrid,
  Line,
  ComposedChart,
  XAxis,
  YAxis,
} from 'recharts';
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  ChartLegend,
  ChartLegendContent,
  type ChartConfig,
} from '@/components/ui/chart';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { TrendingUp, TrendingDown, Percent, DollarSign } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useState } from 'react';
import { format } from 'date-fns';

interface PnlChartProps {
  data: PnlDataPoint[];
}

const chartConfig: ChartConfig = {
  cumulativePnl: {
    label: 'Cumulative PnL',
    color: '#f59e0b',
  },
  feeIncome: {
    label: 'Fee Income',
    color: '#10b981',
  },
};

export function PnlChart({ data }: PnlChartProps) {
  const [timeRange, setTimeRange] = useState<'24h' | '7d'>('24h');

  const totalPnl = data.length > 0 ? data[data.length - 1].cumulativePnl : 0;
  const totalFees = data.reduce((acc, d) => acc + d.feeIncome, 0);
  const winCount = data.filter((d) => d.cumulativePnl > 0).length;
  const winRate = data.length > 0 ? (winCount / data.length) * 100 : 0;
  const isProfitable = totalPnl >= 0;

  const formattedData = data.map((d) => ({
    ...d,
    time: format(new Date(d.timestamp), 'HH:mm'),
  }));

  return (
    <div className="space-y-4">
      {/* Summary Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Card className="py-3">
          <CardContent className="p-3 pt-0">
            <div className="flex items-center gap-2">
              {isProfitable ? (
                <TrendingUp className="h-4 w-4 text-emerald-400" />
              ) : (
                <TrendingDown className="h-4 w-4 text-red-400" />
              )}
              <div>
                <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Total PnL</p>
                <p className={cn(
                  'text-lg font-bold font-mono',
                  isProfitable ? 'text-emerald-400' : 'text-red-400'
                )}>
                  ${totalPnl >= 0 ? '+' : ''}{totalPnl.toFixed(2)}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className="py-3">
          <CardContent className="p-3 pt-0">
            <div className="flex items-center gap-2">
              <DollarSign className="h-4 w-4 text-emerald-400" />
              <div>
                <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Fee Income</p>
                <p className="text-lg font-bold font-mono text-emerald-400">
                  +${totalFees.toFixed(2)}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className="py-3">
          <CardContent className="p-3 pt-0">
            <div className="flex items-center gap-2">
              <Percent className="h-4 w-4 text-amber-400" />
              <div>
                <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Win Rate</p>
                <p className="text-lg font-bold font-mono text-amber-400">
                  {winRate.toFixed(0)}%
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className="py-3">
          <CardContent className="p-3 pt-0">
            <div className="flex items-center gap-2">
              <DollarSign className="h-4 w-4 text-muted-foreground" />
              <div>
                <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Avg Fee/TVL</p>
                <p className="text-lg font-bold font-mono">
                  28.9%
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Chart */}
      <Card className="py-4">
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm font-medium">Cumulative PnL</CardTitle>
            <div className="flex items-center gap-1">
              <Button
                variant={timeRange === '24h' ? 'default' : 'outline'}
                size="sm"
                className="h-6 text-[10px] px-2"
                onClick={() => setTimeRange('24h')}
              >
                24H
              </Button>
              <Button
                variant={timeRange === '7d' ? 'default' : 'outline'}
                size="sm"
                className="h-6 text-[10px] px-2"
                onClick={() => setTimeRange('7d')}
              >
                7D
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <ChartContainer config={chartConfig} className="h-[280px] w-full">
            <ComposedChart data={formattedData} margin={{ top: 10, right: 10, bottom: 0, left: 0 }}>
              <defs>
                <linearGradient id="pnlGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#f59e0b" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="#f59e0b" stopOpacity={0} />
                </linearGradient>
                <linearGradient id="pnlGradientNegative" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#ef4444" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="#ef4444" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" className="stroke-border/30" />
              <XAxis
                dataKey="time"
                tickLine={false}
                axisLine={false}
                tickMargin={8}
                className="text-[10px]"
                tick={{ fill: 'var(--color-muted-foreground)', fontSize: 10 }}
              />
              <YAxis
                tickLine={false}
                axisLine={false}
                tickMargin={8}
                className="text-[10px]"
                tick={{ fill: 'var(--color-muted-foreground)', fontSize: 10 }}
                tickFormatter={(val) => `$${val}`}
              />
              <ChartTooltip
                content={
                  <ChartTooltipContent
                    labelFormatter={(label, payload) => {
                      if (payload?.[0]?.payload) {
                        return format(new Date(payload[0].payload.timestamp), 'MMM d, HH:mm');
                      }
                      return label;
                    }}
                    formatter={(value, name) => {
                      const numVal = value as number;
                      if (name === 'cumulativePnl') {
                        return (
                          <span className={cn('font-mono', numVal >= 0 ? 'text-emerald-400' : 'text-red-400')}>
                            ${numVal >= 0 ? '+' : ''}{numVal.toFixed(2)}
                          </span>
                        );
                      }
                      return <span className="font-mono text-emerald-400">+${numVal.toFixed(2)}</span>;
                    }}
                  />
                }
              />
              <ChartLegend content={<ChartLegendContent />} />
              <Area
                type="monotone"
                dataKey="cumulativePnl"
                stroke="#f59e0b"
                fill="url(#pnlGradient)"
                strokeWidth={2}
              />
              <Line
                type="monotone"
                dataKey="feeIncome"
                stroke="#10b981"
                strokeWidth={1.5}
                strokeDasharray="4 4"
                dot={false}
              />
            </ComposedChart>
          </ChartContainer>
        </CardContent>
      </Card>
    </div>
  );
}
