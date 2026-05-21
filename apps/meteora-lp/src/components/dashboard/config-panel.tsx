'use client';

import { BotConfig } from '@/lib/meridian-types';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import {
  Settings,
  Sliders,
  Shield,
  Clock,
  Cpu,
  Target,
  Save,
  RotateCcw,
} from 'lucide-react';
import { useDashboardStore } from '@/lib/dashboard-store';
import { useState, useMemo } from 'react';

interface ConfigPanelProps {
  config: BotConfig;
}

interface ConfigField {
  key: string;
  label: string;
  type: 'number' | 'text' | 'boolean';
  group: string;
  suffix?: string;
  description?: string;
  step?: number;
}

const configFields: ConfigField[] = [
  // Screening
  { key: 'minTvl', label: 'Min TVL', type: 'number', group: 'Screening', suffix: '$', description: 'Minimum pool TVL in USD' },
  { key: 'minFeeTvl', label: 'Min Fee/TVL', type: 'number', group: 'Screening', suffix: '%', description: 'Minimum annualized fee/TVL ratio' },
  { key: 'minVolume24h', label: 'Min Volume 24h', type: 'number', group: 'Screening', suffix: '$', description: 'Minimum 24h trading volume' },
  { key: 'minHolders', label: 'Min Holders', type: 'number', group: 'Screening', description: 'Minimum token holder count' },
  { key: 'minOrganicCount', label: 'Min Organic Count', type: 'number', group: 'Screening', description: 'Min organic tx count per 5min' },
  { key: 'maxVolatility', label: 'Max Volatility', type: 'number', group: 'Screening', step: 0.01, description: 'Maximum acceptable volatility' },
  { key: 'minMcap', label: 'Min Market Cap', type: 'number', group: 'Screening', suffix: '$', description: 'Minimum token market cap' },

  // Management
  { key: 'takeProfitPercent', label: 'Take Profit', type: 'number', group: 'Management', suffix: '%', description: 'Close position when PnL exceeds this' },
  { key: 'stopLossPercent', label: 'Stop Loss', type: 'number', group: 'Management', suffix: '%', description: 'Close position when loss exceeds this' },
  { key: 'oorThreshold', label: 'OOR Threshold', type: 'number', group: 'Management', suffix: 'bins', description: 'Bins outside range before closing' },
  { key: 'nearEdgeThreshold', label: 'Near Edge Threshold', type: 'number', group: 'Management', suffix: '%', description: 'Distance to edge for near-edge status' },
  { key: 'maxHoldTimeHours', label: 'Max Hold Time', type: 'number', group: 'Management', suffix: 'h', description: 'Auto-close after this many hours' },
  { key: 'claimFeesThreshold', label: 'Claim Fees At', type: 'number', group: 'Management', suffix: 'SOL', description: 'Auto-claim fees when accumulated above this' },

  // Risk
  { key: 'maxPositions', label: 'Max Positions', type: 'number', group: 'Risk', description: 'Maximum concurrent open positions' },
  { key: 'maxPositionSizeSol', label: 'Max Position Size', type: 'number', group: 'Risk', suffix: 'SOL', description: 'Maximum SOL per position' },
  { key: 'maxPoolExposure', label: 'Max Pool Exposure', type: 'number', group: 'Risk', step: 0.01, description: 'Max fraction of wallet per pool' },

  // Schedule
  { key: 'screeningIntervalMin', label: 'Screening Interval', type: 'number', group: 'Schedule', suffix: 'min', description: 'How often to scan for new pools' },
  { key: 'managementIntervalMin', label: 'Management Interval', type: 'number', group: 'Schedule', suffix: 'min', description: 'How often to check positions' },

  // LLM
  { key: 'llmBaseUrl', label: 'LLM Base URL', type: 'text', group: 'LLM', description: 'Ollama or API endpoint URL' },
  { key: 'llmModel', label: 'LLM Model', type: 'text', group: 'LLM', description: 'Model name for decision making' },
  { key: 'ollamaMode', label: 'Ollama Mode', type: 'boolean', group: 'LLM', description: 'Use local Ollama instead of cloud API' },
  { key: 'temperature', label: 'Temperature', type: 'number', group: 'LLM', step: 0.1, description: 'LLM sampling temperature' },

  // Strategy
  { key: 'defaultStrategy', label: 'Default Strategy', type: 'text', group: 'Strategy', description: 'bid_ask or spot' },
  { key: 'binRangeWidth', label: 'Bin Range Width', type: 'number', group: 'Strategy', description: 'Number of bins on each side' },
  { key: 'autoRebalance', label: 'Auto Rebalance', type: 'boolean', group: 'Strategy', description: 'Automatically rebalance positions' },
  { key: 'dryRun', label: 'Dry Run Mode', type: 'boolean', group: 'Strategy', description: 'Simulate without executing trades' },
];

const groupIcons: Record<string, React.ElementType> = {
  Screening: Sliders,
  Management: Target,
  Risk: Shield,
  Schedule: Clock,
  LLM: Cpu,
  Strategy: Settings,
};

export function ConfigPanel({ config }: ConfigPanelProps) {
  const { configEditState, setConfigField, resetConfigEdit } = useDashboardStore();

  // Derive current config from prop + edits
  const currentConfig = useMemo(() => {
    const base = Object.fromEntries(Object.entries(config)) as Record<string, string | number | boolean>;
    return { ...base, ...configEditState };
  }, [config, configEditState]);

  function handleFieldChange(key: string, value: string | number | boolean) {
    setConfigField(key, value);
  }

  function handleSave() {
    // Would POST to /api/config
    console.log('Saving config:', currentConfig);
  }

  function handleReset() {
    resetConfigEdit();
  }

  const groups = [...new Set(configFields.map((f) => f.group))];

  return (
    <div className="space-y-4">
      {/* Header with Ollama Mode Toggle */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Cpu className="h-4 w-4 text-amber-400" />
          <span className="text-sm font-medium">Ollama Mode</span>
          <Switch
            checked={currentConfig.ollamaMode as boolean}
            onCheckedChange={(checked) => handleFieldChange('ollamaMode', checked)}
          />
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            className="h-7 text-xs gap-1"
            onClick={handleReset}
          >
            <RotateCcw className="h-3 w-3" />
            Reset
          </Button>
          <Button
            size="sm"
            className="h-7 text-xs gap-1 bg-amber-500/20 text-amber-400 border-amber-500/30 hover:bg-amber-500/30"
            onClick={handleSave}
          >
            <Save className="h-3 w-3" />
            Save Config
          </Button>
        </div>
      </div>

      {/* Config Sections */}
      <div className="grid gap-4">
        {groups.map((group) => {
          const Icon = groupIcons[group] || Settings;
          const fields = configFields.filter((f) => f.group === group);

          return (
            <Card key={group} className="py-4">
              <CardHeader className="pb-2">
                <div className="flex items-center gap-2">
                  <Icon className="h-4 w-4 text-amber-400" />
                  <CardTitle className="text-sm font-medium">{group}</CardTitle>
                </div>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                  {fields.map((field) => {
                    const value = currentConfig[field.key];
                    const hasChanged = configEditState[field.key] !== undefined;

                    return (
                      <div key={field.key} className="space-y-1.5">
                        <div className="flex items-center justify-between">
                          <Label
                            htmlFor={field.key}
                            className="text-xs text-muted-foreground"
                          >
                            {field.label}
                            {hasChanged && (
                              <Badge variant="outline" className="ml-1.5 text-[8px] px-1 py-0 bg-amber-500/10 text-amber-400 border-amber-500/30">
                                modified
                              </Badge>
                            )}
                          </Label>
                          {field.suffix && (
                            <span className="text-[10px] text-muted-foreground">{field.suffix}</span>
                          )}
                        </div>
                        {field.type === 'boolean' ? (
                          <div className="flex items-center gap-2 h-9">
                            <Switch
                              id={field.key}
                              checked={value as boolean}
                              onCheckedChange={(checked) => handleFieldChange(field.key, checked)}
                            />
                            <span className="text-xs">{(value as boolean) ? 'Enabled' : 'Disabled'}</span>
                          </div>
                        ) : (
                          <Input
                            id={field.key}
                            type={field.type === 'number' ? 'number' : 'text'}
                            value={value as string | number}
                            step={(field as ConfigField & { step?: number }).step || 1}
                            onChange={(e) => {
                              const val = field.type === 'number' ? parseFloat(e.target.value) || 0 : e.target.value;
                              handleFieldChange(field.key, val);
                            }}
                            className="h-9 text-xs font-mono"
                          />
                        )}
                        {field.description && (
                          <p className="text-[10px] text-muted-foreground">{field.description}</p>
                        )}
                      </div>
                    );
                  })}
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
