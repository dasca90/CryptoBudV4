import { STRATEGY_AUDIT_REGISTRY } from '../core/strategy-audit/strategy-audit-registry';
import { buildStrategyAuditSnapshotFromCandidate } from '../core/strategy-audit/strategy-audit-builder';

let p = 0, f = 0;
const ok = (c: boolean, m: string) => { if (c) p++; else { f++; console.error('FAIL', m); } };

const candidate: any = {
  symbol: 'NEARUSDT',
  selectedStrategy: 'dip_and_rebound',
  strategySource: 'AutoBots',
  groupRecommendedStrategy: 'balanced',
  effectiveStrategy: 'dip_and_rebound',
  status: 'WAIT',
  entryGateDecision: { decision: 'WAIT' },
  confidence: 0.76,
  rawScore: 78,
  riskGroup: 'mid_caps',
  periodRegime: 'sideways',
  periodTrend: 'SIDEWAYS',
  groupTrend: 'sideways',
  spreadPct: 0.22,
  dipPercent: -1.2,
  reboundPercent: 0.2,
  dataQuality: 'GOOD',
  mainReason: 'rebound pending',
  blockReasons: ['BLOCK_REBOUND_NOT_CONFIRMED'],
  requiredNextActions: ['rebound +0.3%'],
  autoStrategyDecision: { strategySource: 'AutoBots', effectiveStrategy: 'dip_and_rebound', groupRecommendedStrategy: 'balanced', warnings: [] },
  traderBrainDecision: { ruleDecisionTrace: { unifiedSignal: { reasonCode: 'WAITING_FOR_REBOUND', definition: { buyRule: 'dip_and_rebound' } } } },
};

ok(!!STRATEGY_AUDIT_REGISTRY.momentum, '1 momentum registry exists');
ok(!!STRATEGY_AUDIT_REGISTRY.balanced, '2 balanced registry exists');
ok(!!STRATEGY_AUDIT_REGISTRY.conservative, '3 conservative registry exists');
ok(!!STRATEGY_AUDIT_REGISTRY.dip_and_rebound, '4 dip_and_rebound registry exists');
ok(STRATEGY_AUDIT_REGISTRY.conservative.minDipPct === 2.0 && STRATEGY_AUDIT_REGISTRY.conservative.minReboundPct === 1.0, '4b conservative min dip/rebound canonical thresholds');
ok(STRATEGY_AUDIT_REGISTRY.dip_and_rebound.minDipPct === 0.8 && STRATEGY_AUDIT_REGISTRY.dip_and_rebound.minReboundPct === 0.4, '4c dip_and_rebound min dip/rebound canonical thresholds');
ok(STRATEGY_AUDIT_REGISTRY.momentum.reboundRequirement === 'required', '4d momentum rebound requirement is required');

const snap = buildStrategyAuditSnapshotFromCandidate(candidate);
ok(!!snap.strategySelected && !!snap.strategySource && !!snap.runtimeActiveStrategy, '5 snapshot includes selected/source/runtime');
ok(Array.isArray(snap.setupRequired) && Array.isArray(snap.setupPassed) && Array.isArray(snap.setupMissing), '6 setup arrays exist');
ok(Array.isArray(snap.blockReasons) && Array.isArray(snap.warningReasons), '7 block/warning arrays exist');
ok(typeof snap.finalExecutable === 'boolean', '8 finalExecutable is present');
ok(snap.setupMissing.some((s) => s.key === 'reboundConfirmed'), '9 missing rebound appears in setupMissing');
ok(Array.isArray(snap.setupMetrics) && snap.setupMetrics.length > 0, '10 setupMetrics array exists');
ok(snap.setupMetrics.some((m) => m.key === 'actualDipPct') && snap.setupMetrics.some((m) => m.key === 'actualReboundPct'), '11 dip/rebound exact metrics exist');
ok(snap.setupMetrics.some((m) => m.key === 'actualReboundPct' && m.requiredValue != null), '12 required rebound metric is present');
ok(snap.setupMetrics.some((m) => m.key === 'momentum5m'), '13 momentum timeframe metric exists');

console.log(`strategy-audit-registry: ${p} passed, ${f} failed`);
if (f > 0) process.exit(1);
