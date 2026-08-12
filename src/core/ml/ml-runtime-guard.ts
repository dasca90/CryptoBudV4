import type { MlRuntimeMode, MlRuntimeGuardState, MlRuntimeCounters } from '../types';
import { loadMLRuntimeMlExitsEnabled, loadMLRuntimeMode, saveMLRuntimeMlExitsEnabled, saveMLRuntimeMode } from './ml-brain-store';
import { mlRuntimeEvents } from './ml-runtime-events';
import { logger } from '../../utils/logger';

let _mode: MlRuntimeMode;
// V6: ExitEngine is the only canonical automated SELL owner.
let _mlExitsEnabled = false;

function loadPersistedMode(): MlRuntimeMode {
  const stored = loadMLRuntimeMode();
  if (stored && ['off', 'shadow_only', 'advisory_only', 'active_guarded'].includes(stored)) {
    return stored as MlRuntimeMode;
  }
  return 'shadow_only';
}

_mode = loadPersistedMode();

let _lastModeChangeAt: string | null = null;

export const mlRuntimeGuard = {
  getMode(): MlRuntimeMode {
    return _mode;
  },

  setMode(nextMode: MlRuntimeMode): void {
    const previousMode = _mode;
    if (previousMode === nextMode) return;
    _mode = nextMode;
    _lastModeChangeAt = new Date().toISOString();
    saveMLRuntimeMode(nextMode);
    logger.info(`ML_RUNTIME_MODE_CHANGED previousMode=${previousMode} nextMode=${nextMode} changedAt=${_lastModeChangeAt} persisted=true`);
    mlRuntimeEvents.recordModeChange(previousMode, nextMode);
  },

  getLastModeChangeAt(): string | null {
    return _lastModeChangeAt;
  },

  canBlockBuy(): boolean {
    return _mode === 'active_guarded';
  },

  canTriggerSell(): boolean {
    return false;
  },

  areMlExitsEnabled(): boolean {
    return _mlExitsEnabled;
  },

  setMlExitsEnabled(enabled: boolean): void {
    _mlExitsEnabled = false;
    saveMLRuntimeMlExitsEnabled(false);
    if (enabled) logger.warn(`ML_RUNTIME_ML_SELL_RETIRED requested=true applied=false canonicalSellOwner=ExitEngine`);
  },

  canMutateDecision(): boolean {
    return _mode === 'active_guarded';
  },

  canAdjustConfidence(): boolean {
    return _mode === 'active_guarded';
  },

  canForceBuy(): boolean {
    return false;
  },

  canForceUpgrade(): boolean {
    return false;
  },

  isActive(): boolean {
    return _mode === 'active_guarded';
  },

  isSafe(): boolean {
    return _mode !== 'active_guarded';
  },

  getGuardState(brainLoaded: boolean, modelTrained: boolean): MlRuntimeGuardState {
    return {
      mode: _mode,
      brainLoaded,
      modelTrained,
      lastModeChangeAt: _lastModeChangeAt,
      persisted: true,
      mlExitsEnabled: _mlExitsEnabled,
      counters: mlRuntimeEvents.getCounters(),
    };
  },

  getCounters(): MlRuntimeCounters {
    return mlRuntimeEvents.getCounters();
  },

  resetCounters(): void {
    mlRuntimeEvents.resetCounters();
  },
};
