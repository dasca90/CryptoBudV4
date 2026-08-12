import type { LiveSafetyState } from '../types';

export type ExecutionMode = 'DEMO' | 'LIVE';

export interface ExecutionModeSwitchDecision {
  allowed: boolean;
  noOp: boolean;
  reason: 'ALREADY_ACTIVE' | 'LIVE_CHECK_REQUIRED' | 'OPEN_LIVE_EXPOSURE' | 'ALLOWED';
}

export function evaluateExecutionModeSwitch(input: {
  currentMode: ExecutionMode;
  targetMode: ExecutionMode;
  liveState: LiveSafetyState;
  liveCheckPassed: boolean;
  openLivePositionCount: number;
}): ExecutionModeSwitchDecision {
  if (input.currentMode === input.targetMode) return { allowed: true, noOp: true, reason: 'ALREADY_ACTIVE' };
  if (input.targetMode === 'DEMO' && input.openLivePositionCount > 0) {
    return { allowed: false, noOp: false, reason: 'OPEN_LIVE_EXPOSURE' };
  }
  if (input.targetMode === 'LIVE' && (input.liveState !== 'LIVE_READY' || !input.liveCheckPassed)) {
    return { allowed: false, noOp: false, reason: 'LIVE_CHECK_REQUIRED' };
  }
  return { allowed: true, noOp: false, reason: 'ALLOWED' };
}
