import type { MlRuntimeEvent, MlRuntimeMode, MlRuntimeCounters } from '../types';
import { logger } from '../../utils/logger';
import { clearMLRuntimeEventsSnapshot, loadMLRuntimeEventsSnapshot, saveMLRuntimeEventsSnapshot } from './ml-brain-store';

const MAX_EVENTS = 500;

let _events: MlRuntimeEvent[] = [];
let _eventCounter = 0;
let _activeGuardSummary: {
  scanCycleId: string;
  totalEvaluated: number;
  holdCount: number;
  buyCount: number;
  sellCount: number;
  downgradedCount: number;
  exitTriggeredCount: number;
  upgradeBlockedCount: number;
  changedSymbols: string[];
  suppressedDetailedCount: number;
} | null = null;
let _activeGuardFallbackCounter = 0;
let _activeGuardFlushTimer: ReturnType<typeof setTimeout> | null = null;

let _counters: MlRuntimeCounters = {
  shadowDecisions: 0,
  advisoryEvents: 0,
  activeDowngrades: 0,
  mlExitTriggers: 0,
  blockedMutations: 0,
  upgradeAttemptsBlocked: 0,
};

hydrateRuntimeEvents();

export const mlRuntimeEvents = {
  getEvents(): MlRuntimeEvent[] {
    return _events;
  },

  getRecentEvents(limit = 25): MlRuntimeEvent[] {
    return _events.slice(-limit);
  },

  getCounters(): MlRuntimeCounters {
    return { ..._counters };
  },

  resetCounters(): void {
    _counters = {
      shadowDecisions: 0,
      advisoryEvents: 0,
      activeDowngrades: 0,
      mlExitTriggers: 0,
      blockedMutations: 0,
      upgradeAttemptsBlocked: 0,
    };
    persistRuntimeEvents();
  },

  clearEvents(): void {
    _events = [];
    _eventCounter = 0;
    clearActiveGuardSummary();
    clearMLRuntimeEventsSnapshot();
  },

  recordModeChange(_previous: MlRuntimeMode, _next: MlRuntimeMode): void {
    // mode changes are logged by the guard directly
  },

  recordShadowDecision(params: {
    symbol: string;
    originalDecision: string;
    mlPrediction: string | null;
    brainVerdict: string | null;
    wouldHaveChangedDecision: boolean;
    wouldHaveChangedTo: string | null;
    actualDecisionApplied: string;
    reason: string | null;
  }): void {
    _counters.shadowDecisions++;
    const event = makeEvent({
      ...params,
      mode: 'shadow_only',
      mutationBlocked: true,
      exitTriggered: false,
    });
    _events.push(event);
    trimEvents();
    persistRuntimeEvents();
    logger.info(`ML_SHADOW_DECISION_AUDIT symbol=${params.symbol} originalDecision=${params.originalDecision} mlPrediction=${params.mlPrediction ?? 'none'} brainVerdict=${params.brainVerdict ?? 'none'} wouldHaveChangedDecision=${params.wouldHaveChangedDecision} wouldHaveChangedTo=${params.wouldHaveChangedTo ?? 'none'} actualDecisionApplied=${params.actualDecisionApplied} mode=shadow_only`);
  },

  recordAdvisoryEvent(params: {
    symbol: string;
    originalDecision: string;
    mlPrediction: string | null;
    brainVerdict: string | null;
    wouldHaveChangedDecision: boolean;
    wouldHaveChangedTo: string | null;
    actualDecisionApplied: string;
    reason: string | null;
  }): void {
    _counters.advisoryEvents++;
    const event = makeEvent({
      ...params,
      mode: 'advisory_only',
      mutationBlocked: true,
      exitTriggered: false,
    });
    _events.push(event);
    trimEvents();
    persistRuntimeEvents();
    logger.info(`ML_ADVISORY_DECISION_AUDIT symbol=${params.symbol} originalDecision=${params.originalDecision} mlPrediction=${params.mlPrediction ?? 'none'} brainVerdict=${params.brainVerdict ?? 'none'} wouldHaveChangedDecision=${params.wouldHaveChangedDecision} wouldHaveChangedTo=${params.wouldHaveChangedTo ?? 'none'} actualDecisionApplied=${params.actualDecisionApplied} mode=advisory_only`);
  },

  recordActiveDowngrade(params: {
    symbol: string;
    originalDecision: string;
    mlPrediction: string | null;
    finalDecision: string;
    downgraded: boolean;
    exitTriggered: boolean;
    upgradeBlocked: boolean;
    reason: string | null;
  }): void {
    if (params.downgraded) _counters.activeDowngrades++;
    if (params.exitTriggered) _counters.mlExitTriggers++;
    if (params.upgradeBlocked) _counters.upgradeAttemptsBlocked++;
    const event = makeEvent({
      symbol: params.symbol,
      mode: 'active_guarded',
      originalDecision: params.originalDecision,
      mlPrediction: params.mlPrediction,
      brainVerdict: null,
      wouldHaveChangedDecision: params.downgraded || params.exitTriggered,
      wouldHaveChangedTo: params.downgraded ? params.finalDecision : null,
      actualDecisionApplied: params.finalDecision,
      mutationBlocked: params.upgradeBlocked,
      exitTriggered: params.exitTriggered,
      reason: params.reason,
    });
    _events.push(event);
    trimEvents();
    persistRuntimeEvents();
    recordActiveGuardSummary(params);
    if (isDetailedActiveGuardDebugEnabled()) {
      logger.info(`ML_ACTIVE_GUARDED_DECISION_AUDIT symbol=${params.symbol} originalDecision=${params.originalDecision} mlPrediction=${params.mlPrediction ?? 'none'} finalDecision=${params.finalDecision} downgraded=${params.downgraded} exitTriggered=${params.exitTriggered} upgradeBlocked=${params.upgradeBlocked} debugMode=true`);
    }
  },

  beginActiveGuardScanCycle(scanCycleId: string): void {
    if (_activeGuardSummary && _activeGuardSummary.scanCycleId !== scanCycleId) {
      emitActiveGuardSummary('cycle_changed');
    }
    ensureActiveGuardSummary(scanCycleId);
  },

  flushActiveGuardSummary(scanCycleId?: string): void {
    if (scanCycleId && _activeGuardSummary && _activeGuardSummary.scanCycleId !== scanCycleId) return;
    emitActiveGuardSummary('scan_cycle_end');
  },

  recordBlockedMutation(params: {
    symbol: string;
    mode: MlRuntimeMode;
    attemptedMutation: string;
    blockedReason: string;
    originalDecisionPreserved: string;
  }): void {
    _counters.blockedMutations++;
    persistRuntimeEvents();
    logger.info(`ML_RUNTIME_GUARD_BLOCKED_MUTATION symbol=${params.symbol} mode=${params.mode} attemptedMutation=${params.attemptedMutation} blockedReason=${params.blockedReason} originalDecisionPreserved=${params.originalDecisionPreserved}`);
  },
};

function hydrateRuntimeEvents(): void {
  const persisted = loadMLRuntimeEventsSnapshot();
  if (!persisted) return;
  _events = persisted.events.slice(-MAX_EVENTS);
  _eventCounter = _events.length;
  _counters = normalizeCounters(persisted.counters);
  logger.info(`ML_RUNTIME_EVENTS_HYDRATED: events=${_events.length} shadow=${_counters.shadowDecisions} advisory=${_counters.advisoryEvents} downgrades=${_counters.activeDowngrades} exits=${_counters.mlExitTriggers} blocked=${_counters.blockedMutations} upgradesBlocked=${_counters.upgradeAttemptsBlocked}`);
}

function persistRuntimeEvents(): void {
  saveMLRuntimeEventsSnapshot({
    version: 1,
    savedAt: new Date().toISOString(),
    counters: { ..._counters },
    events: _events.slice(-MAX_EVENTS),
  });
}

function normalizeCounters(counters: Partial<MlRuntimeCounters>): MlRuntimeCounters {
  return {
    shadowDecisions: Number(counters.shadowDecisions ?? 0),
    advisoryEvents: Number(counters.advisoryEvents ?? 0),
    activeDowngrades: Number(counters.activeDowngrades ?? 0),
    mlExitTriggers: Number(counters.mlExitTriggers ?? 0),
    blockedMutations: Number(counters.blockedMutations ?? 0),
    upgradeAttemptsBlocked: Number(counters.upgradeAttemptsBlocked ?? 0),
  };
}

function isDetailedActiveGuardDebugEnabled(): boolean {
  const envDebug = typeof import.meta !== 'undefined' && (import.meta as any).env?.VITE_ML_ACTIVE_GUARD_DEBUG === 'true';
  if (envDebug) return true;
  try {
    return typeof localStorage !== 'undefined' && localStorage.getItem('cryptobud:ml-active-guard-debug') === 'true';
  } catch {
    return false;
  }
}

function ensureActiveGuardSummary(scanCycleId?: string): NonNullable<typeof _activeGuardSummary> {
  const fallbackId = scanCycleId ?? `ml_active_guard_fallback_${++_activeGuardFallbackCounter}`;
  if (!_activeGuardSummary) {
    _activeGuardSummary = {
      scanCycleId: fallbackId,
      totalEvaluated: 0,
      holdCount: 0,
      buyCount: 0,
      sellCount: 0,
      downgradedCount: 0,
      exitTriggeredCount: 0,
      upgradeBlockedCount: 0,
      changedSymbols: [],
      suppressedDetailedCount: 0,
    };
  }
  return _activeGuardSummary;
}

function recordActiveGuardSummary(params: {
  symbol: string;
  mlPrediction: string | null;
  finalDecision: string;
  downgraded: boolean;
  exitTriggered: boolean;
  upgradeBlocked: boolean;
}): void {
  const summary = ensureActiveGuardSummary();
  summary.totalEvaluated++;
  const action = normalizeMlAction(params.mlPrediction ?? params.finalDecision);
  if (action === 'BUY') summary.buyCount++;
  else if (action === 'SELL') summary.sellCount++;
  else summary.holdCount++;
  if (params.downgraded) summary.downgradedCount++;
  if (params.exitTriggered) summary.exitTriggeredCount++;
  if (params.upgradeBlocked) summary.upgradeBlockedCount++;
  if ((params.downgraded || params.exitTriggered || params.upgradeBlocked) && !summary.changedSymbols.includes(params.symbol)) {
    summary.changedSymbols.push(params.symbol);
  }
  if (!isDetailedActiveGuardDebugEnabled()) summary.suppressedDetailedCount++;
  scheduleFallbackActiveGuardFlush();
}

function normalizeMlAction(action: string | null): 'BUY' | 'SELL' | 'HOLD' {
  const a = String(action ?? '').toUpperCase();
  if (a === 'BUY' || a === 'ALLOW') return 'BUY';
  if (a === 'SELL' || a === 'EXIT') return 'SELL';
  return 'HOLD';
}

function scheduleFallbackActiveGuardFlush(): void {
  if (_activeGuardFlushTimer != null) return;
  _activeGuardFlushTimer = setTimeout(() => {
    _activeGuardFlushTimer = null;
    emitActiveGuardSummary('fallback_timer');
  }, 2000);
}

function emitActiveGuardSummary(reason: string): void {
  if (!_activeGuardSummary || _activeGuardSummary.totalEvaluated <= 0) {
    clearActiveGuardSummary();
    return;
  }
  const s = _activeGuardSummary;
  logger.info(`ML_ACTIVE_GUARD_SUMMARY_AUDIT: scanCycleId=${s.scanCycleId} totalEvaluated=${s.totalEvaluated} holdCount=${s.holdCount} buyCount=${s.buyCount} sellCount=${s.sellCount} downgradedCount=${s.downgradedCount} exitTriggeredCount=${s.exitTriggeredCount} upgradeBlockedCount=${s.upgradeBlockedCount} topSymbolsChanged=${s.changedSymbols.slice(0, 10).join('|') || 'none'} suppressedDetailedCount=${s.suppressedDetailedCount} flushReason=${reason}`);
  clearActiveGuardSummary();
}

function clearActiveGuardSummary(): void {
  _activeGuardSummary = null;
  if (_activeGuardFlushTimer != null) {
    clearTimeout(_activeGuardFlushTimer);
    _activeGuardFlushTimer = null;
  }
}

function makeEvent(params: {
  symbol: string;
  mode: MlRuntimeMode;
  originalDecision: string;
  mlPrediction: string | null;
  brainVerdict: string | null;
  wouldHaveChangedDecision: boolean;
  wouldHaveChangedTo: string | null;
  actualDecisionApplied: string;
  mutationBlocked: boolean;
  exitTriggered: boolean;
  reason: string | null;
}): MlRuntimeEvent {
  _eventCounter++;
  return {
    id: `ml_evt_${Date.now()}_${_eventCounter}`,
    timestamp: Date.now(),
    symbol: params.symbol,
    mode: params.mode,
    originalDecision: params.originalDecision,
    mlPrediction: params.mlPrediction,
    brainVerdict: params.brainVerdict,
    wouldHaveChangedDecision: params.wouldHaveChangedDecision,
    wouldHaveChangedTo: params.wouldHaveChangedTo,
    actualDecisionApplied: params.actualDecisionApplied,
    mutationBlocked: params.mutationBlocked,
    exitTriggered: params.exitTriggered,
    reason: params.reason,
  };
}

function trimEvents(): void {
  while (_events.length > MAX_EVENTS) {
    _events.shift();
  }
}
