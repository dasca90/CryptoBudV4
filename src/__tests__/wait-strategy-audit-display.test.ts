import { readFileSync } from 'node:fs';
import { buildStrategyAuditSnapshotFromCandidate } from '../core/strategy-audit/strategy-audit-builder';
import { mapPositionToOpenPositionView } from '../lib/air-scanner/tradeV4DataAdapter';

let p = 0;
let f = 0;
const ok = (c: boolean, m: string) => { if (c) p++; else { f++; console.error('FAIL', m); } };

const waitCandidate: any = {
  symbol: 'WAITUSDT',
  selectedStrategy: 'wait',
  strategySource: 'autobots',
  status: 'WAIT',
  spreadPct: 0.62,
  dipPercent: -0.9,
  reboundPercent: 0.2,
  blockReasons: ['spread_too_high'],
  entryGateDecision: { decision: 'BLOCK' },
  traderBrainDecision: { ruleDecisionTrace: { unifiedSignal: { reasonCode: 'WAITING_FOR_SETUP', definition: { buyRule: 'wait' } } } },
};

const waitSnap = buildStrategyAuditSnapshotFromCandidate(waitCandidate);
ok(waitSnap.strategySelected === 'wait', '1 wait strategy kept');
ok(waitSnap.finalEntryRule === 'WAITING_FOR_SETUP', '2 wait entry rule normalized');
ok(waitSnap.finalExecutable === false, '3 wait remains blocked finalExecutable=false');

const conservativeCandidate: any = {
  ...waitCandidate,
  symbol: 'CONSUSDT',
  selectedStrategy: 'conservative',
  spreadPct: 0.1,
  dipPercent: -2.2,
  reboundPercent: 1.1,
  blockReasons: [],
  status: 'BUY',
  entryGateDecision: { decision: 'ALLOW' },
  traderBrainDecision: { ruleDecisionTrace: { unifiedSignal: { reasonCode: 'CONSERVATIVE_READY', definition: { buyRule: 'conservative' } } } },
};
const conservativeSnap = buildStrategyAuditSnapshotFromCandidate(conservativeCandidate);
ok(conservativeSnap.setupMetrics.some((m) => m.key === 'requiredDipPct' && m.requiredValue === 2), '4 conservative requiredDipPct=2');
ok(conservativeSnap.setupMetrics.some((m) => m.key === 'requiredReboundPct' && m.requiredValue === 1), '5 conservative requiredReboundPct=1');

const position: any = {
  coin: 'WAITUSDT',
  quantity: 10,
  avgEntryPrice: 1,
  currentPrice: 1,
  pnl: 0,
  pnlPercent: 0,
  mode: 'AUTO',
  openedAt: Date.now() - 30_000,
  tradeId: 't_wait',
  highestPrice: 1,
  highestPriceSinceTp: 1,
  tpArmed: false,
  tpArmedAt: Date.now() - 30_000,
  tp1Hit: false,
  tp2Hit: false,
  stopLossPercent: 1.5,
  tp1Percent: 0.8,
  tp2Percent: 0,
  tpMode: 'fixed_single',
  tpTriggerType: 'tp1',
  trailFromPeakPercent: 0,
  maxHoldSec: 3600,
  lastPrice: 1,
  unrealizedPnlPercent: 0,
  ownerType: 'scanner',
  adapter: 'Demo',
  buySnapshot: {
    selectedStrategy: 'wait',
    whySelectedOverOthers: 'spread too high',
    settingsSnapshot: { strategySource: 'autobots' },
    traderBrainDecision: { ruleDecisionTrace: { unifiedSignal: { reasonCode: 'WAITING_FOR_SETUP', dipPercent: -0.9, reboundPct: 0.2, reboundPassed: true, momentumConfirmed: true } } },
    entryConfigSnapshot: { strategyAuditSnapshot: waitSnap },
  },
};
const openView = mapPositionToOpenPositionView(position);
ok(String(openView.strategySetupDipReqLabel).includes('observed'), '6 wait dip label observed-only');
ok(String(openView.strategySetupReboundReqLabel).includes('observed'), '7 wait rebound label observed-only');

const loggerSource = readFileSync('src/core/strategy-audit/strategy-audit-logger.ts', 'utf8');
ok(loggerSource.includes('WAIT_STRATEGY_AUDIT'), '8 wait strategy audit log added');
ok(loggerSource.includes('WAIT_BLOCK_REASON_AUDIT'), '9 wait blocker audit log added');
ok(loggerSource.includes('dipConfirmed=${dipConfirmedLabel}') && loggerSource.includes('reboundConfirmed=${reboundConfirmedLabel}'), '10 metrics/dip-rebound audit use shared observed_only labels for wait');

console.log(`wait-strategy-audit-display: ${p} passed, ${f} failed`);
if (f > 0) process.exit(1);
