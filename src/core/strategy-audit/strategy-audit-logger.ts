import type { StrategyAuditSnapshot } from './strategy-audit-types';
import { logger } from '../../utils/logger';

let lastSig = '';
let lastAt = 0;

export function logStrategyAudit(snapshot: StrategyAuditSnapshot): void {
  const sig = `${snapshot.symbol}|${snapshot.strategySelected}|${snapshot.finalEntryRule}|${snapshot.finalExecutable}|${snapshot.buyAllowed}|${snapshot.setupMissing.map((s) => s.key).join(',')}`;
  const now = Date.now();
  if (sig === lastSig && now - lastAt < 10000) return;
  lastSig = sig;
  lastAt = now;

  const isWaitStrategy = String(snapshot.strategySelected).toLowerCase() === 'wait';
  const dipMetric = snapshot.setupMetrics.find(m => m.key === 'actualDipPct');
  const reboundMetric = snapshot.setupMetrics.find(m => m.key === 'actualReboundPct');
  const momMetric = snapshot.setupMetrics.find(m => m.key === 'momentumConfirmed');
  const setupMissingKeys = snapshot.setupMissing.map((s) => s.key);
  const effectiveBlockReasons = Array.from(new Set([
    ...snapshot.blockReasons,
    ...(setupMissingKeys.includes('dipConfirmed') ? ['dip_not_confirmed'] : []),
    ...(setupMissingKeys.includes('reboundConfirmed') ? ['rebound_not_confirmed'] : []),
    ...(snapshot.finalExecutable ? [] : ['strategy_setup_not_met', 'finalExecutable_false']),
  ]));
  const primaryBlocker = snapshot.dynamicSetupContext?.primaryBlocker
    ?? effectiveBlockReasons[0]
    ?? (snapshot.finalExecutable ? 'none' : 'finalExecutable_false');
  const dipConfirmedLabel = isWaitStrategy ? 'observed_only' : String(snapshot.setupMetrics.find(m => m.key === 'dipConfirmed')?.passed ?? false);
  const reboundConfirmedLabel = isWaitStrategy ? 'observed_only' : String(snapshot.setupMetrics.find(m => m.key === 'reboundConfirmed')?.passed ?? false);

  logger.info(`STRATEGY_SELECTION_AUDIT: symbol=${snapshot.symbol} strategyRequested=${snapshot.strategyRequested} strategySelected=${snapshot.strategySelected} strategySource=${snapshot.strategySource} marketRecommendedStrategy=${snapshot.marketRecommendedStrategy ?? 'none'} runtimeActiveStrategy=${snapshot.runtimeActiveStrategy} finalPerCoinStrategy=${snapshot.finalPerCoinStrategy} finalEntryRule=${snapshot.finalEntryRule}`);
  logger.info(`STRATEGY_SETUP_REQUIREMENTS_AUDIT: symbol=${snapshot.symbol} required=${snapshot.setupRequired.map((s) => s.key).join('|') || 'none'} passed=${snapshot.setupPassed.map((s) => s.key).join('|') || 'none'} missing=${snapshot.setupMissing.map((s) => s.key).join('|') || 'none'}`);
  logger.info(`STRATEGY_SETUP_METRICS_AUDIT: symbol=${snapshot.symbol} selectedStrategy=${snapshot.strategySelected} actualDipPct=${String(snapshot.setupMetrics.find(m => m.key === 'actualDipPct')?.actualValue ?? 'n/a')} requiredDipPct=${String(snapshot.setupMetrics.find(m => m.key === 'requiredDipPct')?.requiredValue ?? 'n/a')} dipConfirmed=${dipConfirmedLabel} actualReboundPct=${String(snapshot.setupMetrics.find(m => m.key === 'actualReboundPct')?.actualValue ?? 'n/a')} requiredReboundPct=${String(snapshot.setupMetrics.find(m => m.key === 'requiredReboundPct')?.requiredValue ?? 'n/a')} reboundConfirmed=${reboundConfirmedLabel} momentumConfirmed=${String(snapshot.setupMetrics.find(m => m.key === 'momentumConfirmed')?.passed ?? false)} conservativeSafetyScore=${String(snapshot.setupMetrics.find(m => m.key === 'conservativeSafetyScore')?.actualValue ?? 'n/a')} safePullbackConfirmed=${String(snapshot.setupMetrics.find(m => m.key === 'safePullbackConfirmed')?.passed ?? false)} spreadPct=${String(snapshot.spreadPct ?? 'n/a')} tpRoomOk=${String(snapshot.tpRoomOk)} finalExecutable=${String(snapshot.finalExecutable)} setupPassed=${snapshot.setupPassed.map((s) => s.key).join('|') || 'none'} setupMissing=${snapshot.setupMissing.map((s) => s.key).join('|') || 'none'}`);
  logger.info(`STRATEGY_DIP_REBOUND_VALUES_AUDIT: symbol=${snapshot.symbol} selectedStrategy=${snapshot.strategySelected} actualDipPct=${String(snapshot.setupMetrics.find(m => m.key === 'actualDipPct')?.actualValue ?? 'n/a')} requiredDipPct=${String(snapshot.setupMetrics.find(m => m.key === 'requiredDipPct')?.requiredValue ?? 'n/a')} actualReboundPct=${String(snapshot.setupMetrics.find(m => m.key === 'actualReboundPct')?.actualValue ?? 'n/a')} requiredReboundPct=${String(snapshot.setupMetrics.find(m => m.key === 'requiredReboundPct')?.requiredValue ?? 'n/a')} dipConfirmed=${dipConfirmedLabel} reboundConfirmed=${reboundConfirmedLabel}`);
  logger.info(`STRATEGY_METRIC_ROLE_AUDIT: symbol=${snapshot.symbol} selectedStrategy=${snapshot.strategySelected} metricRoles=${snapshot.setupMetrics.map((m) => `${m.key}:${m.role}:${m.usedByStrategy ? 'used' : 'unused'}:${m.sourceLayer}`).join('|')}`);
  logger.info(`STRATEGY_FINAL_EXECUTABLE_AUDIT: symbol=${snapshot.symbol} finalExecutable=${String(snapshot.finalExecutable)} buyAllowed=${String(snapshot.buyAllowed)} blockReasons=${effectiveBlockReasons.join('|') || 'none'} warningReasons=${snapshot.warningReasons.join('|') || 'none'}`);
  if (snapshot.dynamicSetupContext) {
    logger.info(`DYNAMIC_ENTRY_SETUP_AUDIT: symbol=${snapshot.symbol} intendedStrategy=${snapshot.dynamicSetupContext.intendedStrategy} finalStrategy=${snapshot.dynamicSetupContext.finalStrategy} marketRegimeBucket=${snapshot.dynamicSetupContext.marketRegimeBucket} requiredDipPctMin=${String(snapshot.dynamicSetupContext.requiredDipPctMin ?? 'n/a')} requiredDipPctMax=${String(snapshot.dynamicSetupContext.requiredDipPctMax ?? 'n/a')} requiredReboundPctMin=${String(snapshot.dynamicSetupContext.requiredReboundPctMin ?? 'n/a')} requiredReboundPctMax=${String(snapshot.dynamicSetupContext.requiredReboundPctMax ?? 'n/a')} actualDipPct=${String(snapshot.dynamicSetupContext.actualDipPct ?? 'n/a')} actualReboundPct=${String(snapshot.dynamicSetupContext.actualReboundPct ?? 'n/a')} setupResult=${snapshot.dynamicSetupContext.setupResult} primaryBlocker=${snapshot.dynamicSetupContext.primaryBlocker} source=${snapshot.dynamicSetupContext.source}`);
  }
  if (isWaitStrategy) {
    logger.info(`WAIT_STRATEGY_AUDIT: symbol=${snapshot.symbol} strategy=WAIT entryRule=WAITING_FOR_SETUP buyAllowed=false finalExecutable=${String(snapshot.finalExecutable)} primaryBlocker=${primaryBlocker} dipObserved=${String(dipMetric?.actualValue ?? 'n/a')} reboundObserved=${String(reboundMetric?.actualValue ?? 'n/a')} momentumObserved=${String(momMetric?.actualValue ?? 'n/a')}`);
    logger.info(`WAIT_BLOCK_REASON_AUDIT: symbol=${snapshot.symbol} primaryBlocker=${primaryBlocker} blockReasons=${effectiveBlockReasons.join('|') || 'none'} setupMissing=${snapshot.setupMissing.map((s) => s.key).join('|') || 'none'} finalExecutable=${String(snapshot.finalExecutable)}`);
  }

  if (snapshot.strategyRequested === 'balanced' && snapshot.strategySelected === 'conservative') {
    logger.warn(`STRATEGY_DOWNGRADED_AUDIT: symbol=${snapshot.symbol} fromStrategy=balanced toStrategy=conservative reason=safety_fallback`);
    logger.warn(`RUNTIME_BALANCED_CONSERVATIVE_SAFETY_APPLIED: symbol=${snapshot.symbol} marketCondition=${snapshot.marketRegime ?? 'unknown'} riskGroup=${snapshot.riskGroup ?? 'unknown'}`);
  }
}
