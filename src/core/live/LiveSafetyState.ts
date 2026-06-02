import type { LiveSafetyState } from '../types';

export function canTransitionTo(current: LiveSafetyState, next: LiveSafetyState): boolean {
  const transitions: Record<LiveSafetyState, LiveSafetyState[]> = {
    LIVE_DISABLED: ['LIVE_CHECK_REQUIRED'],
    LIVE_CHECK_REQUIRED: ['LIVE_CHECK_RUNNING', 'LIVE_DISABLED'],
    LIVE_CHECK_RUNNING: ['LIVE_READY', 'LIVE_BLOCKED', 'LIVE_ERROR'],
    LIVE_READY: ['LIVE_RUNNING', 'LIVE_CHECK_REQUIRED', 'LIVE_STOPPED'],
    LIVE_RUNNING: ['LIVE_STOPPED', 'LIVE_ERROR'],
    LIVE_BLOCKED: ['LIVE_CHECK_REQUIRED', 'LIVE_DISABLED'],
    LIVE_ERROR: ['LIVE_CHECK_REQUIRED', 'LIVE_DISABLED'],
    LIVE_STOPPED: ['LIVE_CHECK_REQUIRED', 'LIVE_DISABLED'],
  };

  return transitions[current]?.includes(next) ?? false;
}

export const INITIAL_SAFETY_STATE: LiveSafetyState = 'LIVE_DISABLED';
