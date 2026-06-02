export type StrategyAuditKey = 'momentum' | 'balanced' | 'conservative' | 'dip_and_rebound' | 'wait' | 'avoid' | 'unknown';

export type StrategySetupSeverity = 'info' | 'warning' | 'block';

export interface StrategySetupItem {
  key: string;
  label: string;
  required: boolean;
  passed: boolean;
  actualValue: string | number | boolean | null;
  requiredValue: string | number | boolean | null;
  sourceLayer: 'buy-rule-matrix' | 'autobots-selector' | 'auto-strategy-router' | 'trader-brain' | 'entry-gate';
  severity: StrategySetupSeverity;
  explanation: string;
}

export interface StrategyAuditSnapshot {
  symbol: string;
  selectedStrategy: string;
  strategyRequested: string;
  strategySelected: string;
  strategySource: string;
  marketRecommendedStrategy: string | null;
  runtimeActiveStrategy: string;
  finalPerCoinStrategy: string;
  finalEntryRule: string;
  setupResult?: string;
  finalExecutableAtEntry: boolean;
  entryConfirmedAtEntry: boolean | null;
  riskGroup: string | null;
  marketRegime: string | null;
  marketTrend: string | null;
  groupTrend: string | null;
  btcContext: string | null;
  confidence: number | null;
  score: number | null;
  dataQuality: string | null;
  priceFresh: boolean;
  spreadPct: number | null;
  maxSpreadPct: number | null;
  tpRoomOk: boolean;
  fallingKnifeBlocked: boolean;
  finalExecutable: boolean;
  buyAllowed: boolean;
  setupRequired: StrategySetupItem[];
  setupPassed: StrategySetupItem[];
  setupMissing: StrategySetupItem[];
  blockReasons: string[];
  warningReasons: string[];
  entryReason: string;
  setupMetrics: Array<{
    key: string;
    actualValue: string | number | boolean | null;
    requiredValue: string | number | boolean | null;
    passed: boolean;
    usedByStrategy: boolean;
    role: 'required' | 'optional' | 'advisory' | 'blocker' | 'unused';
    sourceLayer: 'buy-rule-matrix' | 'autobots-selector' | 'auto-strategy-router' | 'trader-brain' | 'entry-gate';
  }>;
  dynamicSetupContext?: {
    marketRegimeBucket: 'bullish_selective' | 'sideways_range' | 'bearish_risk_off' | 'unknown';
    intendedStrategy: string;
    finalStrategy: string;
    requiredDipPctMin: number | null;
    requiredDipPctMax: number | null;
    requiredReboundPctMin: number | null;
    requiredReboundPctMax: number | null;
    actualDipPct: number | null;
    actualReboundPct: number | null;
    setupResult: string;
    primaryBlocker: string;
    source: string;
  };
  createdAt: string;
}
