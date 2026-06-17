import type { MlRuntimeEvent, MlRuntimeMode, MlRuntimeCounters } from '../types';
import { logger } from '../../utils/logger';

const MAX_EVENTS = 500;

let _events: MlRuntimeEvent[] = [];
let _eventCounter = 0;

let _counters: MlRuntimeCounters = {
  shadowDecisions: 0,
  advisoryEvents: 0,
  activeDowngrades: 0,
  mlExitTriggers: 0,
  blockedMutations: 0,
  upgradeAttemptsBlocked: 0,
};

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
  },

  clearEvents(): void {
    _events = [];
    _eventCounter = 0;
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
    logger.info(`ML_ACTIVE_GUARDED_DECISION_AUDIT symbol=${params.symbol} originalDecision=${params.originalDecision} mlPrediction=${params.mlPrediction ?? 'none'} finalDecision=${params.finalDecision} downgraded=${params.downgraded} exitTriggered=${params.exitTriggered} upgradeBlocked=${params.upgradeBlocked}`);
  },

  recordBlockedMutation(params: {
    symbol: string;
    mode: MlRuntimeMode;
    attemptedMutation: string;
    blockedReason: string;
    originalDecisionPreserved: string;
  }): void {
    _counters.blockedMutations++;
    logger.info(`ML_RUNTIME_GUARD_BLOCKED_MUTATION symbol=${params.symbol} mode=${params.mode} attemptedMutation=${params.attemptedMutation} blockedReason=${params.blockedReason} originalDecisionPreserved=${params.originalDecisionPreserved}`);
  },
};

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
