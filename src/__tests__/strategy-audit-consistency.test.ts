import { buildStrategyAuditSnapshotFromCandidate } from '../core/strategy-audit/strategy-audit-builder';
import { logStrategyAudit } from '../core/strategy-audit/strategy-audit-logger';
import { logger } from '../utils/logger';
import { readFileSync } from 'node:fs';

let p = 0;
let f = 0;
const ok = (c: boolean, m: string) => { if (c) p++; else { f++; console.error('FAIL', m); } };

function captureLogs(run: () => void): string[] {
  const msgs: string[] = [];
  const unsub = logger.subscribe((entry) => {
    if (entry.message && entry.message !== '__CLEAR__') msgs.push(entry.message);
  });
  try { run(); } finally { unsub(); }
  return msgs;
}

const conservativeDipMissing: any = {
  symbol: 'CONS_DIP_MISS_USDT',
  selectedStrategy: 'conservative',
  strategySource: 'autobots',
  status: 'WAIT',
  spreadPct: 0.1,
  dipPercent: -0.5,
  reboundPercent: 1.2,
  blockReasons: [],
  entryGateDecision: { decision: 'ALLOW' },
  traderBrainDecision: { ruleDecisionTrace: { unifiedSignal: { reasonCode: 'WAITING_FOR_SETUP', definition: { buyRule: 'conservative' } } } },
};

const conservativeReboundMissing: any = {
  symbol: 'CONS_REBOUND_MISS_USDT',
  selectedStrategy: 'conservative',
  strategySource: 'autobots',
  status: 'WAIT',
  spreadPct: 0.1,
  dipPercent: -2.2,
  reboundPercent: 0.2,
  blockReasons: [],
  entryGateDecision: { decision: 'ALLOW' },
  traderBrainDecision: { ruleDecisionTrace: { unifiedSignal: { reasonCode: 'WAITING_FOR_SETUP', definition: { buyRule: 'conservative' } } } },
};

const waitObservedOnly: any = {
  symbol: 'WAIT_OBS_USDT',
  selectedStrategy: 'wait',
  strategySource: 'autobots',
  status: 'WAIT',
  spreadPct: 0.2,
  dipPercent: -1.1,
  reboundPercent: 0.4,
  blockReasons: ['spread_too_high'],
  entryGateDecision: { decision: 'BLOCK' },
  traderBrainDecision: { ruleDecisionTrace: { unifiedSignal: { reasonCode: 'WAITING_FOR_SETUP', definition: { buyRule: 'wait' } } } },
};

const logsDip = captureLogs(() => logStrategyAudit(buildStrategyAuditSnapshotFromCandidate(conservativeDipMissing)));
const finalDip = logsDip.find((m) => m.includes('STRATEGY_FINAL_EXECUTABLE_AUDIT')) || '';
ok(finalDip.includes('finalExecutable=false'), '1 conservative dip-missing has finalExecutable=false');
ok(finalDip.includes('dip_not_confirmed'), '2 conservative dip-missing logs dip_not_confirmed');
ok(finalDip.includes('strategy_setup_not_met') && finalDip.includes('finalExecutable_false'), '3 conservative dip-missing logs strategy/final executable blockers');
ok(!finalDip.includes('blockReasons=none'), '4 finalExecutable=false never emits blockReasons=none');

const logsRebound = captureLogs(() => logStrategyAudit(buildStrategyAuditSnapshotFromCandidate(conservativeReboundMissing)));
const finalRebound = logsRebound.find((m) => m.includes('STRATEGY_FINAL_EXECUTABLE_AUDIT')) || '';
ok(finalRebound.includes('rebound_not_confirmed'), '5 conservative rebound-missing logs rebound_not_confirmed');

const logsWait = captureLogs(() => logStrategyAudit(buildStrategyAuditSnapshotFromCandidate(waitObservedOnly)));
const waitMetrics = logsWait.find((m) => m.includes('STRATEGY_SETUP_METRICS_AUDIT')) || '';
const waitDipRebound = logsWait.find((m) => m.includes('STRATEGY_DIP_REBOUND_VALUES_AUDIT')) || '';
ok(waitMetrics.includes('dipConfirmed=observed_only') && waitMetrics.includes('reboundConfirmed=observed_only'), '6 wait metrics use observed_only');
ok(waitDipRebound.includes('dipConfirmed=observed_only') && waitDipRebound.includes('reboundConfirmed=observed_only'), '7 wait dip/rebound audit agrees with observed_only');
ok(!waitDipRebound.includes('dipConfirmed=true') && !waitDipRebound.includes('reboundConfirmed=true'), '8 wait does not mark dip/rebound as passed requirements');

const trendAuditSource = readFileSync('src/lib/air-scanner/tradeV4DataAdapter.ts', 'utf8');
ok(trendAuditSource.includes('TOP_CANDIDATE_TREND_SOURCE_AUDIT') && trendAuditSource.includes('fallbackReason='), '9 trend fallback remains visible/auditable');

console.log(`strategy-audit-consistency: ${p} passed, ${f} failed`);
if (f > 0) process.exit(1);
