// Meridian DLMM Bot Types

export type PositionStatus = 'in-range' | 'near-edge' | 'out-of-range';
export type StrategyType = 'bid_ask' | 'spot';
export type DecisionType = 'deploy' | 'close' | 'skip' | 'no-deploy';
export type CloseReason = 'take-profit' | 'stop-loss' | 'out-of-range' | 'manual';

export interface Position {
  id: string;
  poolAddress: string;
  tokenPair: string;
  tokenAMint: string;
  tokenBMint: string;
  strategy: StrategyType;
  binRangeMin: number;
  binRangeMax: number;
  activeBin: number;
  totalBins: number;
  deployedAmount: number; // in SOL
  currentValue: number; // in SOL
  pnlUsd: number;
  pnlPercent: number;
  unclaimedFees: number; // in SOL
  feeTvl24h: number; // fee/TVL annualized
  holdTime: string; // e.g. "4h 23m"
  holdTimeMs: number;
  status: PositionStatus;
  createdAt: string;
  lastUpdated: string;
  xAmount: number;
  yAmount: number;
}

export interface DecisionLog {
  id: string;
  type: DecisionType;
  poolAddress: string;
  tokenPair: string;
  summary: string;
  reason: string;
  risks?: string[];
  metrics?: Record<string, number | string>;
  timestamp: string;
  closeReason?: CloseReason;
  pnlRealized?: number;
}

export interface PoolCandidate {
  id: string;
  rank: number;
  poolAddress: string;
  tokenPair: string;
  score: number;
  feeTvl: number;
  tvl: number;
  volume24h: number;
  volume7d: number;
  organicCount: number;
  holders: number;
  mcap: number;
  volatility: number;
  binStep: number;
  tokenAMint: string;
  tokenBMint: string;
  tokenALogo?: string;
  tokenBLogo?: string;
}

export interface TransactionLog {
  id: string;
  type: 'deploy' | 'close' | 'claim_fees' | 'rebalance';
  poolAddress: string;
  tokenPair: string;
  signature: string;
  amount: number;
  fee: number;
  timestamp: string;
  status: 'confirmed' | 'failed' | 'pending';
}

export interface DryRunResult {
  simulatedPnl: number;
  simulatedFees: number;
  simulatedImpermanentLoss: number;
  poolAddress: string;
  tokenPair: string;
  binRange: [number, number];
  scenarios: {
    bullish: number;
    neutral: number;
    bearish: number;
  };
}

export interface BotConfig {
  // Screening
  minTvl: number;
  minFeeTvl: number;
  minVolume24h: number;
  minHolders: number;
  minOrganicCount: number;
  maxVolatility: number;
  minMcap: number;

  // Management
  takeProfitPercent: number;
  stopLossPercent: number;
  oorThreshold: number;
  nearEdgeThreshold: number;
  maxHoldTimeHours: number;
  claimFeesThreshold: number;

  // Risk
  maxPositions: number;
  maxPositionSizeSol: number;
  maxPoolExposure: number;

  // Schedule
  screeningIntervalMin: number;
  managementIntervalMin: number;

  // LLM
  llmBaseUrl: string;
  llmModel: string;
  ollamaMode: boolean;
  temperature: number;

  // Strategy
  defaultStrategy: StrategyType;
  binRangeWidth: number;
  autoRebalance: boolean;
  dryRun: boolean;
}

export interface BotHealth {
  status: 'online' | 'offline' | 'degraded';
  walletBalance: number; // SOL
  rpcStatus: 'connected' | 'disconnected' | 'degraded';
  rpcEndpoint: string;
  rpcLatency: number; // ms
  ollamaStatus: 'connected' | 'disconnected';
  ollamaModel: string;
  lastScreeningCycle: string;
  lastManagementCycle: string;
  uptime: string;
  totalPositions: number;
  totalDeployed: number; // SOL
}

export interface PnlDataPoint {
  timestamp: string;
  cumulativePnl: number;
  feeIncome: number;
  unrealizedPnl: number;
}

export interface DashboardState {
  positions: Position[];
  decisions: DecisionLog[];
  candidates: PoolCandidate[];
  transactions: TransactionLog[];
  pnlHistory: PnlDataPoint[];
  health: BotHealth;
  config: BotConfig;
}
